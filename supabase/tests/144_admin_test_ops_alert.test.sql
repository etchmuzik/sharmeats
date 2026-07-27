-- Assertions for migration 144 (admin_test_ops_alert).
--
-- Run INSIDE a transaction that is rolled back:
--   BEGIN; \i supabase/migrations/144_admin_test_ops_alert.sql
--          \i supabase/tests/144_admin_test_ops_alert.test.sql
--   ROLLBACK;
--
-- The negative cases matter more than the positive one here: this function's
-- whole purpose is to be a doorway into an otherwise client-inaccessible alert
-- channel, so the value is in proving the door is narrow.

\set ON_ERROR_STOP on

do $$
declare
  v_fail text[] := '{}';
  v_n    int;
  v_txt  text;
begin
  -- 1. Exactly ONE overload. Two means PGRST202 on every call (house rule 1).
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_test_ops_alert';
  if v_n <> 1 then
    v_fail := v_fail || ('expected exactly 1 admin_test_ops_alert overload, found ' || v_n);
  end if;

  -- 2. SECURITY DEFINER with a pinned search_path.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_test_ops_alert'
     and p.prosecdef
     and p.proconfig is not null
     and array_to_string(p.proconfig, ',') like '%search_path%';
  if v_n <> 1 then
    v_fail := v_fail || 'admin_test_ops_alert must be SECURITY DEFINER with a pinned search_path';
  end if;

  -- 3. PUBLIC and anon must NOT hold EXECUTE. Granting to `authenticated` does
  --    not revoke the default PUBLIC/anon grant on this database -- the exact
  --    trap behind the 2026-07-03 anon exploit.
  if has_function_privilege('anon', 'public.admin_test_ops_alert()', 'EXECUTE') then
    v_fail := v_fail || 'anon can EXECUTE admin_test_ops_alert';
  end if;
  if has_function_privilege('public', 'public.admin_test_ops_alert()', 'EXECUTE') then
    v_fail := v_fail || 'PUBLIC can EXECUTE admin_test_ops_alert';
  end if;

  -- 4. authenticated SHOULD hold it (the in-body role check is the real gate).
  if not has_function_privilege('authenticated', 'public.admin_test_ops_alert()', 'EXECUTE') then
    v_fail := v_fail || 'authenticated cannot EXECUTE admin_test_ops_alert';
  end if;

  -- 5. It must not be callable with an unauthenticated session. auth.uid() is
  --    NULL here (no request JWT), which is exactly the anon-key case.
  begin
    perform public.admin_test_ops_alert();
    v_fail := v_fail || 'admin_test_ops_alert did NOT refuse an unauthenticated caller';
  exception
    when sqlstate '23514' then
      null; -- check_violation: AUTH_REQUIRED or NOT_AUTHORIZED. Correct.
    when others then
      v_fail := v_fail || ('unexpected error from unauthenticated call: ' || sqlerrm);
  end;

  -- 6. The function must not be able to send caller-supplied text: it takes no
  --    arguments at all.
  select pg_get_function_identity_arguments(p.oid) into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_test_ops_alert';
  if coalesce(v_txt, 'x') <> '' then
    v_fail := v_fail || ('admin_test_ops_alert must take no arguments, has: ' || coalesce(v_txt, '?'));
  end if;

  if array_length(v_fail, 1) > 0 then
    raise exception E'MIG 144 ASSERTIONS FAILED (%):\n  - %',
      array_length(v_fail, 1), array_to_string(v_fail, E'\n  - ');
  end if;

  raise notice 'MIG 144 ASSERTIONS PASSED';
end $$;
