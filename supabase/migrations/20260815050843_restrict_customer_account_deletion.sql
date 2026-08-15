-- The public account-deletion RPC is called by the customer app. Before this
-- migration it accepted every authenticated coarse role, then ran a scrub that
-- only knows customer-owned rows. Deleting a driver therefore detached
-- drivers.profile_id while retaining name, phone, plate and operational data;
-- staff/admin deletion had similarly undefined retention semantics.
--
-- Preserve the latest migration-207 implementation under a private name and
-- put the role guard at the public database authority. The Edge Function maps
-- this stable error to HTTP 403, but direct RPC callers cannot bypass it.

alter function public.anonymize_my_account() set schema private;
alter function private.anonymize_my_account() rename to anonymize_customer_account_impl;

revoke all on function private.anonymize_customer_account_impl()
  from public, anon, authenticated, service_role;

create function public.anonymize_my_account()
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_role public.app_role;
begin
  select u.role into v_role
  from public.users u
  where u.id = v_uid;

  if v_uid is null or v_role is distinct from 'customer'::public.app_role then
    raise exception 'ACCOUNT_DELETION_ROLE_NOT_SUPPORTED'
      using errcode = 'check_violation';
  end if;

  perform private.anonymize_customer_account_impl();
end;
$$;

revoke all on function public.anonymize_my_account()
  from public, anon, service_role;
grant execute on function public.anonymize_my_account() to authenticated;

comment on function public.anonymize_my_account() is
  'Customer-only account deletion authority. Rejects driver, merchant_staff, dispatcher and admin identities before delegating to the private migration-207 customer scrub. Mig 20260815050843.';

do $$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'anonymize_my_account') <> 1 then
    raise exception '[20260815050843] public anonymize_my_account overload drift';
  end if;
  if has_function_privilege('authenticated',
      'private.anonymize_customer_account_impl()', 'EXECUTE') then
    raise exception '[20260815050843] private customer scrub is client-executable';
  end if;
  if has_function_privilege('anon', 'public.anonymize_my_account()', 'EXECUTE') then
    raise exception '[20260815050843] anon can execute account deletion';
  end if;
end;
$$;
