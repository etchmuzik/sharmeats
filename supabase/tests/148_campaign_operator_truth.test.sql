-- Assertions for migration 148 (campaign operator truth).
--
-- Run inside a rolled-back transaction:
--   BEGIN; \i supabase/migrations/148_campaign_operator_truth.sql
--          \i supabase/tests/148_campaign_operator_truth.test.sql
--   ROLLBACK;

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------- shape ----
do $$
declare
  v_fail text[] := '{}';
  v_n int;
begin
  -- Exactly ONE send_push_campaign. The old 4-arg version must be GONE, or
  -- PostgREST answers PGRST202 on every call (house rule 1).
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'send_push_campaign';
  if v_n <> 1 then
    v_fail := v_fail || ('send_push_campaign has ' || v_n || ' overloads, expected 1')::text;
  end if;

  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'send_push_campaign'
     and p.prosecdef
     and array_to_string(coalesce(p.proconfig,'{}'), ',') like '%search_path%';
  if v_n <> 1 then
    v_fail := v_fail || 'send_push_campaign must be SECURITY DEFINER with a pinned search_path'::text;
  end if;

  if has_function_privilege('anon', 'public.send_push_campaign(text,text,text,text,boolean,text)', 'EXECUTE') then
    v_fail := v_fail || 'anon can EXECUTE send_push_campaign'::text;
  end if;

  -- A customer must not be able to ask whether ANOTHER customer consented.
  if has_function_privilege('authenticated', 'public.marketing_suppression_reason(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.marketing_suppression_reason(uuid)', 'EXECUTE') then
    v_fail := v_fail || 'marketing_suppression_reason is exposed to clients'::text;
  end if;

  -- marketing_allowed must be UNCHANGED -- other callers depend on it.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'marketing_allowed';
  if v_n <> 1 then
    v_fail := v_fail || 'marketing_allowed was altered or duplicated'::text;
  end if;

  -- Unauthenticated callers refused.
  begin
    perform * from public.send_push_campaign('t','b','all');
    v_fail := v_fail || 'send_push_campaign did NOT refuse an unauthenticated caller'::text;
  exception when sqlstate '23514' then null;
    when others then v_fail := v_fail || ('unexpected: ' || sqlerrm)::text;
  end;

  if array_length(v_fail,1) > 0 then
    raise exception E'MIG 148 SHAPE FAILED (%):\n  - %',
      array_length(v_fail,1), array_to_string(v_fail, E'\n  - ');
  end if;
  raise notice 'MIG 148 shape assertions PASSED';
end $$;


-- ------------------------------------------------------------ behaviour ----
-- Four customers covering every classification, plus an admin to act as.
do $$
declare
  v_admin uuid := gen_random_uuid();
  v_ok    uuid := gen_random_uuid();  -- consented + token      -> eligible
  v_quiet uuid := gen_random_uuid();  -- consented + quiet hours-> suppressed
  v_nc    uuid := gen_random_uuid();  -- no consent             -> suppressed
  v_notok uuid := gen_random_uuid();  -- consented, NO token    -> suppressed
  v_ids uuid[];
begin
  v_ids := array[v_admin, v_ok, v_quiet, v_nc, v_notok];
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         '_t148_' || u::text || '@example.test', '', now(), now(), now()
    from unnest(v_ids) u;

  -- A trigger on auth.users already created public.users rows.
  update public.users set role = 'admin', phone = '+2010148000', display_name = '_t148 admin'
   where id = v_admin;
  -- Distinct phones: public.users.phone is NOT NULL and unique-ish, so each
  -- fixture needs its own.
  update public.users set role = 'customer', display_name = '_t148 c' 
   where id in (v_ok, v_quiet, v_nc, v_notok);
  update public.users set phone = '+2010148001' where id = v_ok;
  update public.users set phone = '+2010148002' where id = v_quiet;
  update public.users set phone = '+2010148003' where id = v_nc;
  update public.users set phone = '+2010148004' where id = v_notok;

  -- Consent states.
  insert into public.notification_prefs (user_id, marketing) values (v_ok, true);
  -- The quiet window must contain the CURRENT hour, or this test passes or
  -- fails depending on what time the drill is run -- and a test that is green
  -- 23 hours a day is worse than no test. There is no window that covers all
  -- 24 hours (start = end is explicitly zero-width), so derive one from the
  -- clock: [now, now+23) in the customer's timezone always contains now.
  declare
    v_h int := extract(hour from now() at time zone 'Africa/Cairo')::int;
  begin
    insert into public.notification_prefs
      (user_id, marketing, quiet_hours_start, quiet_hours_end, timezone)
    values (v_quiet, true, v_h::smallint, ((v_h + 23) % 24)::smallint, 'Africa/Cairo');
  end;
  insert into public.notification_prefs (user_id, marketing) values (v_nc, false);
  insert into public.notification_prefs (user_id, marketing) values (v_notok, true);

  -- Tokens for everyone EXCEPT v_notok.
  insert into public.push_tokens (user_id, token)
  values (v_ok, 'ExponentPushToken[_t148ok]'),
         (v_quiet, 'ExponentPushToken[_t148quiet]'),
         (v_nc, 'ExponentPushToken[_t148nc]');

  perform set_config('_t148.admin', v_admin::text, false);
  perform set_config('_t148.ok', v_ok::text, false);
  perform set_config('_t148.quiet', v_quiet::text, false);
  perform set_config('_t148.nc', v_nc::text, false);
  perform set_config('_t148.notok', v_notok::text, false);
end $$;

do $$
declare
  v_fail text[] := '{}';
  v_admin uuid := current_setting('_t148.admin')::uuid;
  v_ok    uuid := current_setting('_t148.ok')::uuid;
  v_quiet uuid := current_setting('_t148.quiet')::uuid;
  v_nc    uuid := current_setting('_t148.nc')::uuid;
  v_notok uuid := current_setting('_t148.notok')::uuid;
  v_r record;
  v_r2 record;
  v_n int;
begin
  -- 1. The reason function separates the two states the old boolean merged.
  if public.marketing_suppression_reason(v_ok) is not null then
    v_fail := v_fail || 'a consented, awake customer was marked suppressed'::text;
  end if;
  if public.marketing_suppression_reason(v_quiet) is distinct from 'quiet_hours' then
    v_fail := v_fail || format('quiet-hours customer reported %L',
                               public.marketing_suppression_reason(v_quiet));
  end if;
  if public.marketing_suppression_reason(v_nc) is distinct from 'no_consent' then
    v_fail := v_fail || format('opted-out customer reported %L',
                               public.marketing_suppression_reason(v_nc));
  end if;
  -- An absent prefs row is the mig-138 opt-in default: OFF.
  if public.marketing_suppression_reason(gen_random_uuid()) is distinct from 'no_consent' then
    v_fail := v_fail || 'a customer with no prefs row was not treated as no_consent'::text;
  end if;

  -- Act as the admin for the campaign calls.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);

  -- 2. DRY RUN: counts, no campaign row, nothing sent.
  select count(*) into v_n from public.push_campaigns;
  select * into v_r from public.send_push_campaign('t','b','all', null, true, null);

  if not v_r.dry_run then v_fail := v_fail || 'dry run did not report dry_run=true'::text; end if;
  if v_r.campaign_id is not null then
    v_fail := v_fail || 'dry run returned a campaign id (it must record nothing)'::text;
  end if;
  if (select count(*) from public.push_campaigns) <> v_n then
    v_fail := v_fail || 'dry run INSERTED a campaign row'::text;
  end if;

  -- The four fixtures must be classified into four different buckets.
  if v_r.recipients < 1 then
    v_fail := v_fail || 'dry run found no eligible recipient'::text;
  end if;
  if v_r.suppressed_no_consent < 1 then
    v_fail := v_fail || 'no_consent bucket did not count the opted-out customer'::text;
  end if;
  if v_r.suppressed_quiet_hours < 1 then
    v_fail := v_fail || 'quiet_hours bucket did not count the sleeping customer'::text;
  end if;
  if v_r.suppressed_no_token < 1 then
    v_fail := v_fail || 'no_token bucket did not count the tokenless customer'::text;
  end if;

  -- 3. Every segment member lands in exactly ONE bucket.
  if v_r.segment_size <>
     v_r.recipients + v_r.suppressed_no_consent + v_r.suppressed_quiet_hours + v_r.suppressed_no_token then
    v_fail := v_fail || format(
      'buckets do not partition the segment: size %s <> %s+%s+%s+%s',
      v_r.segment_size, v_r.recipients, v_r.suppressed_no_consent,
      v_r.suppressed_quiet_hours, v_r.suppressed_no_token);
  end if;

  -- 4. IDEMPOTENCY: the same key twice sends once.
  select * into v_r from public.send_push_campaign('t','b','all', null, false, '_t148-key');
  select * into v_r2 from public.send_push_campaign('t','b','all', null, false, '_t148-key');
  if v_r.campaign_id is distinct from v_r2.campaign_id then
    v_fail := v_fail || 'a repeated idempotency key created a SECOND campaign'::text;
  end if;
  select count(*) into v_n from public.push_campaigns where idempotency_key = '_t148-key';
  if v_n <> 1 then
    v_fail := v_fail || format('%s campaign rows share one idempotency key', v_n);
  end if;

  -- 5. A dry run must NOT burn the key -- it sends nothing, so replaying it is
  --    harmless and must not block the real send.
  select * into v_r from public.send_push_campaign('t','b','all', null, true, '_t148-fresh');
  select count(*) into v_n from public.push_campaigns where idempotency_key = '_t148-fresh';
  if v_n <> 0 then
    v_fail := v_fail || 'a dry run recorded an idempotency key'::text;
  end if;

  -- 6. The stored breakdown must match what was returned.
  select * into v_r2 from public.push_campaigns where idempotency_key = '_t148-key';
  if v_r2.suppressed_count is distinct from
     (v_r2.suppressed_no_consent + v_r2.suppressed_quiet_hours + v_r2.suppressed_no_token) then
    v_fail := v_fail || 'legacy suppressed_count is not the sum of the new buckets'::text;
  end if;

  -- 7. A non-admin must be refused even though the grant is to authenticated.
  perform set_config('request.jwt.claims', json_build_object('sub', v_ok)::text, true);
  begin
    perform * from public.send_push_campaign('t','b','all');
    v_fail := v_fail || 'a CUSTOMER was allowed to send a campaign'::text;
  exception when sqlstate '23514' then null;
  end;

  if array_length(v_fail,1) > 0 then
    raise exception E'MIG 148 BEHAVIOUR FAILED (%):\n  - %',
      array_length(v_fail,1), array_to_string(v_fail, E'\n  - ');
  end if;
  raise notice 'MIG 148 behaviour assertions PASSED';
end $$;
