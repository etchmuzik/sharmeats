-- 223_admin_link_merchant_staff.test.sql
--
-- Transaction-wrapped assertions for public.admin_link_merchant_staff.
-- Run inside BEGIN ... ROLLBACK: this file writes nothing that survives.
--
--   psql "$DATABASE_URL" -f supabase/tests/223_admin_link_merchant_staff.test.sql
--
-- Substitute the three ids below for the environment under test. The defaults
-- are prod's as of 2026-09-02 (an admin, a disposable .test merchant account,
-- and a real active restaurant).

begin;

\set ADMIN_UID    '42412cae-aba4-46e4-99d9-3ecf3dffab17'
\set NONADMIN_UID 'd92467ad-8b59-4e1c-b513-50053a8a161d'
\set TEST_EMAIL   'owner.koshary@sharmeats.test'
\set RESTAURANT   '775cda31-3ff1-55ed-a448-76b802873575'

-- ---------------------------------------------------------------------------
-- Structure: one overload, pinned search_path, definer, and no anon/public grant.
-- ---------------------------------------------------------------------------
do $$
declare v_oid oid; n int;
begin
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'admin_link_merchant_staff';
  if n <> 1 then
    raise exception 'FAIL: expected exactly 1 overload, found % (PGRST202 risk, house rule 1)', n;
  end if;

  select p.oid into v_oid from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'admin_link_merchant_staff';

  if not (select prosecdef from pg_proc where oid = v_oid) then
    raise exception 'FAIL: must be SECURITY DEFINER';
  end if;
  if (select coalesce(array_to_string(proconfig, ','), '') from pg_proc where oid = v_oid)
     not like '%search_path=public, pg_temp%' then
    raise exception 'FAIL: search_path is not pinned (house rule: 152/162 pin it)';
  end if;
  if has_function_privilege('anon', v_oid, 'execute') then
    raise exception 'FAIL: anon can execute (house rule 3)';
  end if;
  if has_function_privilege('public', v_oid, 'execute') then
    raise exception 'FAIL: PUBLIC can execute — granting authenticated does not revoke it';
  end if;
  if not has_function_privilege('authenticated', v_oid, 'execute') then
    raise exception 'FAIL: authenticated cannot execute';
  end if;
  raise notice 'ok: structure (1 overload, definer, pinned path, anon/PUBLIC revoked)';
end $$;

-- ---------------------------------------------------------------------------
-- Behaviour. Each case must RAISE; a silent success is the bug.
-- ---------------------------------------------------------------------------
create temp table probe(step text, outcome text, passed boolean) on commit drop;
grant insert on probe to authenticated;

do $$
declare RID uuid := :'RESTAURANT';
begin
  set local role authenticated;

  -- Authority: only an admin may link staff.
  perform set_config('request.jwt.claims', '{"sub":":NONADMIN_UID","role":"authenticated"}', true);
  begin
    perform public.admin_link_merchant_staff(:'TEST_EMAIL', RID, 'owner');
    insert into probe values ('non-admin caller', 'ALLOWED', false);
  exception when others then
    insert into probe values ('non-admin caller', sqlerrm, sqlerrm like 'NOT_AUTHORIZED%');
  end;

  perform set_config('request.jwt.claims', '', true);
  begin
    perform public.admin_link_merchant_staff(:'TEST_EMAIL', RID, 'owner');
    insert into probe values ('anonymous caller', 'ALLOWED', false);
  exception when others then
    insert into probe values ('anonymous caller', sqlerrm, sqlerrm like 'AUTH_REQUIRED%');
  end;

  -- From here on, a real admin.
  perform set_config('request.jwt.claims', '{"sub":":ADMIN_UID","role":"authenticated"}', true);

  -- This function never creates auth accounts; an unknown email must fail loudly
  -- rather than silently minting a profile row.
  begin
    perform public.admin_link_merchant_staff('nobody@nowhere.example', RID, 'owner');
    insert into probe values ('unknown email', 'ALLOWED', false);
  exception when others then
    insert into probe values ('unknown email', sqlerrm, sqlerrm like 'USER_NOT_FOUND%');
  end;

  begin
    perform public.admin_link_merchant_staff(:'TEST_EMAIL', '00000000-0000-0000-0000-000000000000', 'owner');
    insert into probe values ('unknown restaurant', 'ALLOWED', false);
  exception when others then
    insert into probe values ('unknown restaurant', sqlerrm, sqlerrm like 'RESTAURANT_NOT_FOUND%');
  end;

  begin
    perform public.admin_link_merchant_staff(:'TEST_EMAIL', RID, 'superuser');
    insert into probe values ('invalid staff_role', 'ALLOWED', false);
  exception when others then
    insert into probe values ('invalid staff_role', sqlerrm, sqlerrm like 'INVALID_STAFF_ROLE%');
  end;

  -- An operator must never be silently demoted out of their admin access.
  begin
    perform public.admin_link_merchant_staff('admin@sharmeats.online', RID, 'owner');
    insert into probe values ('demote an operator', 'ALLOWED', false);
  exception when others then
    insert into probe values ('demote an operator', sqlerrm, sqlerrm like 'REFUSING_TO_DEMOTE_OPERATOR%');
  end;

  -- Happy path, then the same pair again: a re-link corrects the role instead of
  -- raising, so a typo'd staff_role is fixable by re-running.
  begin
    perform public.admin_link_merchant_staff(:'TEST_EMAIL', RID, 'owner');
    perform public.admin_link_merchant_staff(:'TEST_EMAIL', RID, 'manager');
    insert into probe values ('link then re-link', 'idempotent', true);
  exception when others then
    insert into probe values ('link then re-link', sqlerrm, false);
  end;
end $$;

reset role;

do $$
declare n int;
begin
  select count(*) into n from probe where not passed;
  if n > 0 then
    raise exception 'FAIL: % behavioural case(s) did not behave as required', n;
  end if;
  raise notice 'ok: all behavioural cases passed';
end $$;

select step, outcome, passed from probe order by step;

-- Effect check, still inside the transaction.
select 'linked row present' as assertion,
       exists(select 1 from public.merchant_staff ms
               where ms.restaurant_id = :'RESTAURANT'
                 and ms.staff_role = 'manager') as result;

rollback;
