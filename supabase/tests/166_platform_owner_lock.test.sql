-- Assertions for migration 166 (platform-owner row lock + offboarding).
--
--   psql "$PGURI" -v ON_ERROR_STOP=1 --single-transaction \
--     -c "BEGIN;" \
--     -f supabase/migrations/166_platform_owner_lock_and_offboarding.sql \
--     -f supabase/tests/166_platform_owner_lock.test.sql \
--     -c "ROLLBACK;"
--
-- Written to FAIL before mig 166: assert_platform_owner_locked and
-- offboard_platform_owner do not exist, and nothing locks private.platform_owners.

\set ON_ERROR_STOP on

do $$
declare
  v_fail text[] := '{}';
  v_owner uuid := '00000000-0000-4000-8000-000000166001';
  v_other uuid := '00000000-0000-4000-8000-000000166002';
  v_target uuid := '00000000-0000-4000-8000-000000166003';
  v_def text;
  v_n int;
  v_err text;
begin
  -- ---- fixtures -----------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
         '_t166_'||u::text||'@example.test','',now(),now(),now()
    from unnest(array[v_owner, v_other, v_target]) u
  on conflict (id) do nothing;

  insert into public.users (id, role, phone, display_name) values
    (v_owner, 'admin','+201000166001','t166 owner'),
    (v_other, 'admin','+201000166002','t166 other'),
    (v_target,'customer','+201000166003','t166 target')
  on conflict (id) do update set role = excluded.role, is_blocked = false;

  -- ---- 1. the locking helper exists and actually takes a row lock ---------
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='assert_platform_owner_locked';
  if v_def is null then
    v_fail := v_fail || 'assert_platform_owner_locked does not exist'::text;
  elsif position('for update' in lower(v_def)) = 0 then
    v_fail := v_fail || 'assert_platform_owner_locked does not lock the owner row'::text;
  elsif position('platform_owners' in v_def) = 0 then
    v_fail := v_fail || 'assert_platform_owner_locked does not read platform_owners'::text;
  end if;

  -- ---- 2. the mutating paths CALL it -------------------------------------
  -- Defining a lock helper nothing invokes is the failure mode this checks for.
  for v_n in 1..1 loop end loop;
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='grant_platform_capability';
  if position('assert_platform_owner_locked' in v_def) = 0 then
    v_fail := v_fail || 'grant_platform_capability never locks the owner row'::text;
  end if;
  -- ...and BEFORE the users-row lock, establishing owner -> users ordering.
  if position('assert_platform_owner_locked' in v_def)
     > position('perform 1 from public.users' in v_def) then
    v_fail := v_fail || 'grant locks users BEFORE the owner row (inverted order)'::text;
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='revoke_platform_capability';
  if position('assert_platform_owner_locked' in v_def) = 0 then
    v_fail := v_fail || 'revoke_platform_capability never locks the owner row'::text;
  end if;

  -- ---- 3. a non-owner is refused (fail closed) ---------------------------
  begin
    perform public.assert_platform_owner_locked(v_other);
    v_fail := v_fail || 'a NON-OWNER passed the locked ownership check'::text;
  exception when sqlstate '23514' then null;
  end;

  -- ---- 4. offboarding exists, is audited, and is owner-only --------------
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='offboard_platform_owner') then
    v_fail := v_fail || 'offboard_platform_owner does not exist (ownership has no writer)'::text;
  end if;

  if not exists (select 1 from information_schema.tables
                  where table_schema='private' and table_name='platform_owner_events') then
    v_fail := v_fail || 'no ownership audit table'::text;
  end if;

  -- A caller who is not an owner cannot offboard anyone.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_other, 'role','authenticated')::text, true);
  begin
    perform public.offboard_platform_owner(v_owner, 'not my authority');
    v_fail := v_fail || 'a NON-OWNER offboarded an owner'::text;
  exception when sqlstate '23514' then null;
  end;

  -- ---- 5. the real path: a genuine owner CAN be offboarded, and audited ---
  -- This is the only place ownership is created, and it is created HERE, inside
  -- a transaction that rolls back -- production's platform_owners stays empty.
  insert into private.platform_owners (user_id, status, granted_by_database_owner, granted_at)
  values (v_owner, 'active', true, now())
  on conflict (user_id) do update set status='active', revoked_at=null;

  -- The owner now passes the locked check.
  begin
    perform public.assert_platform_owner_locked(v_owner);
  exception when others then
    v_fail := v_fail || format('a genuine owner failed the locked check: %s', sqlerrm);
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role','authenticated')::text, true);
  perform public.offboard_platform_owner(v_owner, 'test offboarding');

  select count(*) into v_n from private.platform_owners
   where user_id = v_owner and status = 'revoked';
  if v_n <> 1 then
    v_fail := v_fail || 'offboarding did not revoke the ownership row'::text;
  end if;

  select count(*) into v_n from private.platform_owner_events
   where owner_user_id = v_owner and action = 'revoked' and actor_user_id = v_owner;
  if v_n <> 1 then
    v_fail := v_fail || 'offboarding was not audited'::text;
  end if;

  -- ---- 6. a REVOKED owner immediately loses authority --------------------
  begin
    perform public.assert_platform_owner_locked(v_owner);
    v_fail := v_fail || 'a REVOKED owner still passes the locked ownership check'::text;
  exception when sqlstate '23514' then null;
  end;
  if public.is_platform_owner(v_owner) then
    v_fail := v_fail || 'is_platform_owner still reports a revoked owner as active'::text;
  end if;

  -- ---- 7. offboarding is idempotent-safe (second call refuses) -----------
  begin
    perform public.offboard_platform_owner(v_owner, 'second attempt');
    v_fail := v_fail || 'offboarding an already-revoked owner succeeded'::text;
  exception when sqlstate '23514' then null;
  end;

  -- ---- 8. the audit row is IMMUTABLE -------------------------------------
  begin
    update private.platform_owner_events set reason = 'rewritten'
     where owner_user_id = v_owner;
    v_fail := v_fail || 'the ownership audit trail is rewritable'::text;
  exception when others then null;
  end;

  -- ---- 9. reason is required ---------------------------------------------
  insert into private.platform_owners (user_id, status, granted_by_database_owner, granted_at)
  values (v_owner, 'active', true, now())
  on conflict (user_id) do update set status='active', revoked_at=null;
  begin
    perform public.offboard_platform_owner(v_owner, '');
    v_fail := v_fail || 'offboarding accepted an empty reason'::text;
  exception when sqlstate '23514' then null;
  end;

  if array_length(v_fail,1) > 0 then
    raise exception 'mig166 owner-lock assertions FAILED (%):%  - %',
      array_length(v_fail,1), E'\n', array_to_string(v_fail, E'\n  - ');
  end if;
  raise notice 'mig166 owner-lock assertions PASSED (lock, ordering, offboarding, audit, revocation)';
end $$;
