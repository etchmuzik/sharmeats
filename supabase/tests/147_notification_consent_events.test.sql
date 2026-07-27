-- Assertions for migration 147 (notification_consent_events).
--
-- Run inside a rolled-back transaction:
--   BEGIN; \i supabase/migrations/147_notification_consent_events.sql
--          \i supabase/tests/147_notification_consent_events.test.sql
--   ROLLBACK;

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------- shape ----
do $$
declare
  v_fail text[] := '{}';
  v_n    int;
begin
  -- RLS on, and exactly one policy: SELECT. A write policy would mean the
  -- table is writable outside the owner-bound RPC.
  select count(*) into v_n
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'notification_consent_events'
     and c.relrowsecurity;
  if v_n <> 1 then
    v_fail := v_fail || 'RLS is not enabled on notification_consent_events'::text;
  end if;

  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'notification_consent_events';
  if v_n <> 1 then
    v_fail := v_fail || ('expected exactly 1 policy (select), found ' || v_n)::text;
  end if;

  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'notification_consent_events'
     and cmd <> 'SELECT';
  if v_n <> 0 then
    v_fail := v_fail || 'a non-SELECT policy exists -- the table must only be written by the RPC'::text;
  end if;

  -- House rule 5b: anon must hold nothing, and TRUNCATE must be gone (it
  -- ignores RLS entirely).
  if has_table_privilege('anon', 'public.notification_consent_events', 'SELECT') then
    v_fail := v_fail || 'anon can SELECT consent events'::text;
  end if;
  foreach v_n in array array[1] loop null; end loop;
  if has_table_privilege('anon', 'public.notification_consent_events', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.notification_consent_events', 'TRUNCATE') then
    v_fail := v_fail || 'TRUNCATE is still granted (it bypasses RLS)'::text;
  end if;
  if has_table_privilege('authenticated', 'public.notification_consent_events', 'INSERT')
     or has_table_privilege('authenticated', 'public.notification_consent_events', 'UPDATE')
     or has_table_privilege('authenticated', 'public.notification_consent_events', 'DELETE') then
    v_fail := v_fail || 'authenticated holds a write grant on consent events'::text;
  end if;
  if not has_table_privilege('authenticated', 'public.notification_consent_events', 'SELECT') then
    v_fail := v_fail || 'authenticated cannot SELECT its own consent events'::text;
  end if;

  -- The RPC: definer, pinned search_path, PUBLIC/anon revoked, one overload.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_consent_event';
  if v_n <> 1 then
    v_fail := v_fail || ('expected 1 record_consent_event overload, found ' || v_n)::text;
  end if;

  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_consent_event'
     and p.prosecdef
     and array_to_string(coalesce(p.proconfig, '{}'), ',') like '%search_path%';
  if v_n <> 1 then
    v_fail := v_fail || 'record_consent_event must be SECURITY DEFINER with a pinned search_path'::text;
  end if;

  if has_function_privilege('anon', 'public.record_consent_event(text, boolean, text, text)', 'EXECUTE') then
    v_fail := v_fail || 'anon can EXECUTE record_consent_event'::text;
  end if;

  -- set_notification_prefs must still be exactly ONE overload after being
  -- replaced -- two means PGRST202 on every call (house rule 1).
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_notification_prefs';
  if v_n <> 1 then
    v_fail := v_fail || ('set_notification_prefs has ' || v_n || ' overloads, expected 1')::text;
  end if;

  -- Unauthenticated callers are refused.
  begin
    perform public.record_consent_event('marketing', true);
    v_fail := v_fail || 'record_consent_event did NOT refuse an unauthenticated caller'::text;
  exception
    when sqlstate '23514' then null;
    when others then
      v_fail := v_fail || ('unexpected error unauthenticated: ' || sqlerrm)::text;
  end;

  if array_length(v_fail, 1) > 0 then
    raise exception E'MIG 147 SHAPE/SECURITY FAILED (%):\n  - %',
      array_length(v_fail, 1), array_to_string(v_fail, E'\n  - ');
  end if;
  raise notice 'MIG 147 shape + security assertions PASSED';
end $$;


-- ------------------------------------------------------------ behaviour ----
-- Two real users so the cross-user case is genuinely cross-user.
do $$
declare
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (v_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          '_t147a@example.test', '', now(), now(), now()),
         (v_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          '_t147b@example.test', '', now(), now(), now());
  -- A trigger on auth.users already creates the public.users row, so this
  -- UPDATEs rather than INSERTs -- inserting duplicates the primary key.
  update public.users set role = 'customer', phone = '+2010000147a',
                          display_name = '_t147 A' where id = v_a;
  update public.users set role = 'customer', phone = '+2010000147b',
                          display_name = '_t147 B' where id = v_b;
  perform set_config('_t147.a', v_a::text, false);
  perform set_config('_t147.b', v_b::text, false);
end $$;

do $$
declare
  v_fail text[] := '{}';
  v_a uuid := current_setting('_t147.a')::uuid;
  v_b uuid := current_setting('_t147.b')::uuid;
  v_n int;
  v_id uuid;
  v_granted boolean;
  v_actor uuid;
begin
  -- Act as user A.
  perform set_config('request.jwt.claims', json_build_object('sub', v_a)::text, true);

  -- 1. A real opt-IN through the existing writer records provenance.
  perform public.set_notification_prefs(p_marketing => true, p_source => 'settings');
  select count(*) into v_n from public.notification_consent_events
   where user_id = v_a and granted;
  if v_n <> 1 then
    v_fail := v_fail || format('opt-in recorded %s events, expected 1', v_n);
  end if;

  -- 2. A NO-OP re-save must not manufacture a consent event.
  perform public.set_notification_prefs(p_marketing => true, p_source => 'settings');
  select count(*) into v_n from public.notification_consent_events where user_id = v_a;
  if v_n <> 1 then
    v_fail := v_fail || format('a no-op re-save created an event (total %s)', v_n);
  end if;

  -- 3. Changing locale/timezone/quiet hours is NOT a consent change.
  perform public.set_notification_prefs(p_timezone => 'Europe/Berlin');
  perform public.set_notification_prefs(p_quiet_hours_start => 22::smallint,
                                        p_quiet_hours_end => 7::smallint);
  select count(*) into v_n from public.notification_consent_events where user_id = v_a;
  if v_n <> 1 then
    v_fail := v_fail || format('a locale/quiet-hours change created a consent event (total %s)', v_n);
  end if;

  -- 4. The opt-OUT is recorded -- the case the prefs row CANNOT represent,
  --    because opting out clears its stamp.
  perform public.set_notification_prefs(p_marketing => false, p_source => 'settings');
  select count(*) into v_n from public.notification_consent_events
   where user_id = v_a and not granted;
  if v_n <> 1 then
    v_fail := v_fail || format('opt-out recorded %s events, expected 1', v_n);
  end if;

  -- ...and the effective row really did clear its stamp, so history is the
  -- only place the opt-out survives.
  select marketing_consent_at is null into v_granted
    from public.notification_prefs where user_id = v_a;
  if not v_granted then
    v_fail := v_fail || 'opt-out did not clear marketing_consent_at'::text;
  end if;

  -- 5. actor_id is recorded and equals the customer for a self-service change.
  select actor_id into v_actor from public.notification_consent_events
   where user_id = v_a order by created_at desc limit 1;
  if v_actor is distinct from v_a then
    v_fail := v_fail || 'actor_id was not recorded for a self-service change'::text;
  end if;

  -- 6. History is APPEND-ONLY, even from this definer/owner context.
  select id into v_id from public.notification_consent_events where user_id = v_a limit 1;
  begin
    update public.notification_consent_events set granted = not granted where id = v_id;
    v_fail := v_fail || 'a consent event was UPDATEable'::text;
  exception when sqlstate '23514' then null;
  end;
  begin
    delete from public.notification_consent_events where id = v_id;
    v_fail := v_fail || 'a consent event was DELETEable'::text;
  exception when sqlstate '23514' then null;
  end;

  -- 7. The RPC cannot be used to disguise a human action as automated.
  begin
    perform public.record_consent_event('marketing', true, 'system');
    v_fail := v_fail || 'record_consent_event accepted source=system from a client'::text;
  exception when sqlstate '23514' then null;
  end;

  -- 8. Only the 'marketing' channel exists today; anything else is refused
  --    rather than silently stored as an unenforced category.
  begin
    perform public.record_consent_event('transactional', true);
    v_fail := v_fail || 'record_consent_event accepted an unknown channel'::text;
  exception when sqlstate '23514' then null;
  end;

  -- 9. CROSS-USER: acting as B, A's history must be invisible under RLS.
  --    Checked through a security-INVOKER view of the policy: set the role so
  --    RLS actually applies (it is bypassed for the table owner).
  perform set_config('request.jwt.claims', json_build_object('sub', v_b)::text, true);
  set local role authenticated;
  select count(*) into v_n from public.notification_consent_events where user_id = v_a;
  if v_n <> 0 then
    v_fail := v_fail || format('user B can read %s of user A''s consent events', v_n);
  end if;
  -- ...and B can still read their own (none yet, but the query must not error).
  select count(*) into v_n from public.notification_consent_events;
  if v_n <> 0 then
    v_fail := v_fail || format('user B sees %s events but has none', v_n);
  end if;
  reset role;

  if array_length(v_fail, 1) > 0 then
    raise exception E'MIG 147 BEHAVIOUR FAILED (%):\n  - %',
      array_length(v_fail, 1), array_to_string(v_fail, E'\n  - ');
  end if;
  raise notice 'MIG 147 behaviour assertions PASSED';
end $$;
