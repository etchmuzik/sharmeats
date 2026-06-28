-- 030_driver_verified_gate.sql
-- Enforce driver verification at the RPC layer (audit H3).
--
-- THE PROBLEM THIS FIXES
-- A driver's eligibility to take jobs (drivers.is_verified) was enforced ONLY in
-- the driver app UI (apps/driver/app/home.tsx disables the online toggle on
-- !is_verified). The authority RPCs did not check it:
--   * driver_respond (mig 027) verified ownership + assignment state, but NOT
--     is_verified/is_active — an unverified driver who received an offer (e.g. a
--     dispatcher manual assign) could accept it by calling the RPC directly.
--   * assign_driver (mig 027) checked is_active but NOT is_verified — a
--     dispatcher could offer an order to an unverified driver.
-- nearest_drivers (auto-dispatch) already filters is_verified, so auto flow was
-- safe; this closes the manual-assign + direct-RPC paths.
--
-- THE FIX
-- CREATE OR REPLACE both functions (bodies identical to mig 027, including the
-- rider snapshot) with an added is_verified + is_active gate. Driver creation is
-- already admin-only (012 drivers_admin_insert), so this completes the gate:
-- only an admin-verified, active driver can be offered or accept work.
--
-- Non-destructive: CREATE OR REPLACE of two existing functions only.

-- ============================================================================
-- assign_driver — manual dispatch. Now requires the target driver be
-- is_active AND is_verified (was is_active only).
-- ============================================================================
create or replace function public.assign_driver(p_order_id uuid, p_driver_id uuid)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_role app_role := public.auth_role();
  v_user uuid := auth.uid();
begin
  if v_role not in ('admin','dispatcher') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  -- [030] target driver must be active AND verified (was is_active only).
  if not exists (
    select 1 from public.drivers
     where id = p_driver_id and is_active and is_verified
  ) then
    raise exception 'DRIVER_NOT_ELIGIBLE: driver must be active and verified'
      using errcode = 'check_violation';
  end if;

  -- Reassign: mark any prior active assignment reassigned.
  update public.order_assignments
     set status = 'reassigned', responded_at = now()
   where order_id = p_order_id and status in ('offered','accepted');

  insert into public.order_assignments (order_id, driver_id, status, assigned_by, assigned_by_id)
  values (p_order_id, p_driver_id, 'offered', 'dispatcher', v_user);

  -- Snapshot the rider so the customer card renders the new driver immediately.
  update public.orders
     set assigned_driver_id = p_driver_id,
         rider = public.rider_snapshot(p_driver_id)
   where id = p_order_id;
end;
$$;

-- ============================================================================
-- driver_respond — accept/reject an offered assignment. Now the accepting
-- driver must be is_verified AND is_active (rejecting is always allowed so an
-- unverified driver can still decline a stale offer).
-- ============================================================================
create or replace function public.driver_respond(p_assignment_id uuid, p_accept boolean)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_asg  public.order_assignments;
  v_drv  public.drivers;
begin
  select * into v_asg from public.order_assignments where id = p_assignment_id for update;
  if not found then raise exception 'ASSIGNMENT_NOT_FOUND' using errcode = 'check_violation'; end if;

  select * into v_drv from public.drivers where id = v_asg.driver_id;
  if v_drv.profile_id is distinct from v_user then
    raise exception 'NOT_YOUR_ASSIGNMENT' using errcode = 'check_violation';
  end if;
  if v_asg.status <> 'offered' then
    raise exception 'ALREADY_RESPONDED' using errcode = 'check_violation';
  end if;

  if p_accept then
    -- [030] only a verified, active driver may ACCEPT work. (Reject falls
    -- through below and is always permitted.)
    if not (v_drv.is_verified and v_drv.is_active) then
      raise exception 'DRIVER_NOT_ELIGIBLE: driver must be active and verified to accept'
        using errcode = 'check_violation';
    end if;
    update public.order_assignments set status = 'accepted', responded_at = now() where id = p_assignment_id;
    update public.drivers set status = 'on_job' where id = v_asg.driver_id;
    -- Customer-facing: fill the rider card now that a real driver owns the order.
    update public.orders
       set rider = public.rider_snapshot(v_asg.driver_id)
     where id = v_asg.order_id;
  else
    update public.order_assignments set status = 'rejected', responded_at = now() where id = p_assignment_id;
    -- Clear both the id and the snapshot so the card reverts to "finding a driver".
    update public.orders set assigned_driver_id = null, rider = null where id = v_asg.order_id;
  end if;
end;
$$;

-- Grants unchanged (idempotent re-grant for safety).
grant execute on function public.assign_driver(uuid, uuid) to authenticated;
grant execute on function public.driver_respond(uuid, boolean) to authenticated;
