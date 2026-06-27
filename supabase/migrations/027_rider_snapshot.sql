-- 027_rider_snapshot.sql
-- Populate orders.rider so the customer's tracking screen actually shows the
-- driver who is delivering their food.
--
-- THE PROBLEM THIS FIXES
-- The customer tracking card (order/[id].tsx) renders the driver's name, photo,
-- plate, rating and the call/message buttons from order.rider (a jsonb snapshot
-- on the orders row). But NOTHING ever writes that column: dispatch (mig 025)
-- and the manual assign/accept RPCs (mig 011) only ever set assigned_driver_id.
-- The 008_fleet.sql comment even promises "orders.rider keeps a JSONB snapshot
-- for the customer card" — but no code fills it. Result: a customer with a real
-- driver en route sees no name, photo, plate, rating, or contact affordance, and
-- the timeline 'on the way' row degrades to the literal word "Rider".
--
-- THE FIX
-- Write a rider snapshot when a driver becomes the order's deliverer, and clear
-- it when they stop being. We CREATE OR REPLACE the two functions that change
-- assignment ownership:
--   * driver_respond  — accept: write snapshot. reject: clear it.
--   * assign_driver   — dispatcher (re)assign: write snapshot (and the prior
--                       assignment was already marked reassigned).
-- Snapshot shape mirrors the customer's Rider type exactly
-- (id/name/photo/plate/vehicle/rating) PLUS phone, so the call/message buttons
-- can dial the driver. Extra keys are harmless to the mapper (it reads the typed
-- fields). No client change needed — the mapper and UI already consume
-- order.rider.
--
-- Non-destructive: CREATE OR REPLACE of two existing functions only.

-- ============================================================================
-- Helper: build the rider jsonb snapshot from a drivers row id.
-- Centralizes the shape so accept + assign + any future path stay consistent.
-- ============================================================================
create or replace function public.rider_snapshot(p_driver_id uuid)
returns jsonb
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object(
           'id',      d.id,
           'name',    d.name,
           'photo',   coalesce(d.photo, ''),
           'plate',   coalesce(d.plate, ''),
           'vehicle', d.vehicle::text,
           'rating',  coalesce(d.rating, 0),
           'phone',   coalesce(d.phone, '')
         )
  from public.drivers d
  where d.id = p_driver_id;
$$;
revoke all on function public.rider_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.rider_snapshot(uuid) to authenticated;

-- ============================================================================
-- assign_driver — manual dispatch (dispatcher/admin). Now also snapshots rider.
-- (Body identical to mig 011 except the final UPDATE also sets orders.rider.)
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
  if not exists (select 1 from public.drivers where id = p_driver_id and is_active) then
    raise exception 'DRIVER_NOT_FOUND' using errcode = 'check_violation';
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
-- driver_respond — accept/reject an offered assignment (the assigned driver).
-- accept  -> write rider snapshot (customer now sees the driver).
-- reject  -> clear assigned_driver_id AND rider (card goes back to "finding").
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

-- Grants unchanged from mig 011 (idempotent re-grant for safety).
grant execute on function public.assign_driver(uuid, uuid) to authenticated;
grant execute on function public.driver_respond(uuid, boolean) to authenticated;

comment on function public.rider_snapshot is
  'Builds the customer-facing rider jsonb snapshot (id/name/photo/plate/vehicle/rating/phone) for orders.rider. Used by driver_respond (accept) and assign_driver so the tracking card shows the real driver.';
