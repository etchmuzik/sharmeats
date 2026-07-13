-- 109 — close the spatial_ref_sys write hole via a guard TRIGGER (postgres-applicable).
--
-- BACKGROUND: spatial_ref_sys (PostGIS SRID table) has RLS off + INSERT/UPDATE/DELETE
-- granted to anon+authenticated, so any anon-key caller could corrupt SRID rows that
-- all geo/dispatch math depends on. mig 102's REVOKE was a NO-OP: the grant was made by
-- supabase_admin and the `postgres` migration role can't revoke another role's grant,
-- so that fix was owner-gated (Dashboard SQL only).
--
-- ALTERNATIVE that postgres CAN apply: has_table_privilege(postgres, spatial_ref_sys,
-- 'TRIGGER') is true — so we attach a BEFORE INSERT/UPDATE/DELETE trigger that rejects
-- writes from the anon-key roles. This closes the exact hole without any owner action.
-- auth.role() is NULL for postgres/service_role/cron/PostGIS-internal contexts (verified),
-- so only anon/authenticated are blocked; everything privileged still writes freely.
-- Verified via rolled-back dry run: an authenticated INSERT raises insufficient_privilege.

create or replace function public._guard_spatial_ref_sys()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  -- Block only the anon-key attack surface. auth.role() is NULL/other for postgres,
  -- service_role, supabase_admin, pg_cron, and PostGIS-internal callers — they pass.
  if (select auth.role()) in ('anon', 'authenticated') then
    raise exception 'spatial_ref_sys is read-only for this role'
      using errcode = 'insufficient_privilege';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

drop trigger if exists guard_spatial_ref_sys on public.spatial_ref_sys;
create trigger guard_spatial_ref_sys
  before insert or update or delete on public.spatial_ref_sys
  for each row execute function public._guard_spatial_ref_sys();

comment on function public._guard_spatial_ref_sys() is
  'Guards spatial_ref_sys writes: rejects INSERT/UPDATE/DELETE from anon/authenticated (the anon-key surface) while allowing privileged roles. Trigger-based because the postgres migration role cannot REVOKE supabase_admin''s grant (mig 102 no-op). Closes the write hole without owner action (mig 109).';
