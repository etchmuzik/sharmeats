-- 056_drivers_realtime_and_assign_guard.sql
-- Two dispatch-ops fixes (pre-ship review HIGH).
--
-- H-DB1a — `drivers` was never added to the supabase_realtime publication.
-- Only orders (mig 002), order_status_events + order_assignments (mig 013) are
-- published. The admin DispatchBoard subscribes to postgres_changes on
-- public.drivers (DispatchBoard.tsx:46) and receives ZERO events → the "drivers
-- online" count and status dots never update until a full page reload. Add the
-- table to the publication (idempotent, mirroring mig 013's guard).
--
-- H-DB1b — assign_driver let a dispatcher assign an OFFLINE driver. It checked
-- only is_active + is_verified (mig 030), not reachability. Assigning an offline
-- driver silently succeeds → the order sits "in progress" with a driver who will
-- never see the offer. Add a guard: the target driver must not be 'offline'
-- (online or on_job is fine — a dispatcher may reassign to a driver finishing
-- another run, and status can lag; a hard 'online'-only check would over-restrict
-- legitimate manual dispatch).

-- ---------------------------------------------------------------------------
-- H-DB1a: publish public.drivers for realtime.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'drivers'
  ) then
    alter publication supabase_realtime add table public.drivers;
  end if;
end $$;

-- Realtime needs the full old-row image to deliver UPDATE/DELETE payloads with
-- all columns (the board reads status/current_geo off the changed row).
alter table public.drivers replica identity full;

-- ---------------------------------------------------------------------------
-- H-DB1b: assign_driver — reject an offline target. Body identical to mig 030
-- plus the reachability guard.
-- ---------------------------------------------------------------------------
create or replace function public.assign_driver(p_order_id uuid, p_driver_id uuid)
returns void
language plpgsql
security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  v_role app_role := public.auth_role();
  v_user uuid := auth.uid();
begin
  if v_role not in ('admin','dispatcher') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  -- [030] target driver must be active AND verified.
  -- [056] ...and reachable (not offline) so the manual assignment can be seen.
  if not exists (
    select 1 from public.drivers
     where id = p_driver_id and is_active and is_verified and status <> 'offline'
  ) then
    raise exception 'DRIVER_NOT_ELIGIBLE: driver must be active, verified and online'
      using errcode = 'check_violation';
  end if;

  update public.order_assignments
     set status = 'reassigned', responded_at = now()
   where order_id = p_order_id and status in ('offered','accepted');

  insert into public.order_assignments (order_id, driver_id, status, assigned_by, assigned_by_id)
  values (p_order_id, p_driver_id, 'offered', 'dispatcher', v_user);

  update public.orders
     set assigned_driver_id = p_driver_id,
         rider = public.rider_snapshot(p_driver_id)
   where id = p_order_id;
end;
$function$;
grant execute on function public.assign_driver(uuid, uuid) to authenticated;
