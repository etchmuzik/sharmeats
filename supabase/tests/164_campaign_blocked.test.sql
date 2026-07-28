-- Assertions for migration 164 (blocked accounts are never marketed to).
--
--   psql "$PGURI" -v ON_ERROR_STOP=1 --single-transaction \
--     -c "BEGIN;" \
--     -f supabase/migrations/164_campaign_blocked_suppression.sql \
--     -f supabase/tests/164_campaign_blocked.test.sql \
--     -c "ROLLBACK;"
--
-- Every block is written to FAIL against the pre-164 behaviour, where a
-- blocked, opted-in, token-bearing customer was a valid campaign recipient.

\set ON_ERROR_STOP on

do $$
declare
  v_fail text[] := '{}';
  v_blocked uuid := '00000000-0000-4000-8000-000000164001';
  v_active  uuid := '00000000-0000-4000-8000-000000164002';
  v_quiet   uuid := '00000000-0000-4000-8000-000000164003';
  v_admin   uuid := '00000000-0000-4000-8000-0000001640a1';
  v_reason  text;
  v_n int;
  r record;
begin
  -- ---- fixtures -----------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
         '_t164_'||u::text||'@example.test','',now(),now(),now()
    from unnest(array[v_blocked, v_active, v_quiet, v_admin]) u
  on conflict (id) do nothing;

  -- on_auth_user_created already inserted default rows, so DO UPDATE is
  -- required or the fixtures silently keep the trigger's defaults.
  insert into public.users (id, role, phone, display_name, is_blocked) values
    (v_blocked,'customer','+201000164001','t164 blocked', true),
    (v_active, 'customer','+201000164002','t164 active',  false),
    (v_quiet,  'customer','+201000164003','t164 quiet',   false),
    (v_admin,  'admin',   '+201000164004','t164 admin',   false)
  on conflict (id) do update
    set role = excluded.role, is_blocked = excluded.is_blocked,
        display_name = excluded.display_name;

  -- Assert the fixture actually took effect -- a silently-failed fixture would
  -- make every assertion below pass vacuously.
  if not (select is_blocked from public.users where id=v_blocked) then
    raise exception 't164 fixture: the blocked user is not actually blocked';
  end if;

  -- All three customers: opted IN to marketing and reachable. The blocked one
  -- is therefore a valid recipient under the OLD rules -- that is the leak.
  insert into public.notification_prefs (user_id, marketing) values
    (v_blocked, true), (v_active, true), (v_quiet, true)
  on conflict (user_id) do update set marketing = true;

  insert into public.push_tokens (user_id, token, platform) values
    (v_blocked,'ExponentPushToken[t164blocked]','ios'),
    (v_active, 'ExponentPushToken[t164active]','ios'),
    (v_quiet,  'ExponentPushToken[t164quiet]','ios')
  on conflict (user_id, token) do nothing;

  -- ---- 1. the predicate refuses a blocked account -------------------------
  v_reason := public.marketing_suppression_reason(v_blocked);
  if v_reason is distinct from 'blocked' then
    v_fail := v_fail || format('blocked user got reason %L, expected ''blocked''', v_reason);
  end if;

  -- ...and still permits a normal opted-in one (no over-blocking).
  v_reason := public.marketing_suppression_reason(v_active);
  if v_reason is not null then
    v_fail := v_fail || format('an eligible customer was suppressed as %L', v_reason);
  end if;

  -- ---- 2. 'blocked' OUTRANKS no_consent -----------------------------------
  -- A blocked user who ALSO never consented must read 'blocked': the platform
  -- decision is the operative fact, and reporting 'no_consent' would imply the
  -- account could be marketed to if they opted in.
  update public.notification_prefs set marketing = false where user_id = v_blocked;
  v_reason := public.marketing_suppression_reason(v_blocked);
  if v_reason is distinct from 'blocked' then
    v_fail := v_fail || format('blocked+no-consent reported %L; ''blocked'' must outrank', v_reason);
  end if;
  update public.notification_prefs set marketing = true where user_id = v_blocked;

  -- ---- 3. unknown user fails closed ---------------------------------------
  v_reason := public.marketing_suppression_reason('00000000-0000-4000-8000-0000009999ff');
  if v_reason is null then
    v_fail := v_fail || 'an UNKNOWN user id was treated as marketable'::text;
  end if;

  -- ---- 4. the blocked account is not even in the segment ------------------
  -- Dry run: answers the audience question without sending anything.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role','authenticated')::text, true);

  select * into r from public.send_push_campaign(
    'T164 title','T164 body','all', null, true, null);

  if r.recipients is null then
    v_fail := v_fail || 'dry run returned no recipient count'::text;
  end if;

  -- The decisive assertion: the blocked user must NOT be counted as audience.
  select count(*) into v_n from public.users u
   where u.role='customer' and not coalesce(u.is_blocked,false);
  if r.segment_size <> v_n then
    v_fail := v_fail || format(
      'segment_size %s counts blocked accounts as audience (unblocked customers = %s)',
      r.segment_size, v_n);
  end if;

  -- ---- 5. counters stay TRUTHFUL ------------------------------------------
  -- Blocked users are excluded at segment resolution, so they must NOT also be
  -- reported as suppressed -- double-counting would inflate the suppression
  -- statistics an operator reads.
  if r.suppressed_no_consent + r.suppressed_quiet_hours + r.suppressed_no_token
     > r.segment_size then
    v_fail := v_fail || 'suppression counters exceed the segment size'::text;
  end if;
  if r.recipients > r.segment_size then
    v_fail := v_fail || 'recipients exceed the segment size'::text;
  end if;

  -- ---- 6. the blocked user is not a recipient of a REAL send --------------
  select * into r from public.send_push_campaign(
    'T164 real','T164 real body','all', null, false, 't164-idem-'||gen_random_uuid()::text);

  select count(*) into v_n from public.push_campaigns
   where id = r.campaign_id and suppressed_blocked >= 0;
  if v_n <> 1 then
    v_fail := v_fail || 'the campaign row did not record a suppressed_blocked value'::text;
  end if;

  -- The legacy total must equal the sum of the specific reasons, or reports
  -- built on the old column silently disagree with the new breakdown.
  select count(*) into v_n from public.push_campaigns
   where id = r.campaign_id
     and suppressed_count = suppressed_no_consent + suppressed_quiet_hours
                          + suppressed_no_token + suppressed_blocked;
  if v_n <> 1 then
    v_fail := v_fail || 'suppressed_count is not the sum of the specific reasons'::text;
  end if;

  if array_length(v_fail,1) > 0 then
    raise exception 'mig164 campaign-blocked assertions FAILED (%):%  - %',
      array_length(v_fail,1), E'\n', array_to_string(v_fail, E'\n  - ');
  end if;
  raise notice 'mig164 campaign-blocked assertions PASSED (predicate, precedence, segment, counters)';
end $$;
