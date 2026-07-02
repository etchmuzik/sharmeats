-- 054_release_driver_on_terminal_status.sql
-- Fix a fleet-wide dispatch stall: drivers get stuck 'on_job' forever after
-- every delivery and never receive another auto-dispatch offer.
--
-- THE BUG THIS FIXES
-- Accepting an offer sets drivers.status = 'on_job' (driver_respond, mig 030:99).
-- Auto-dispatch eligibility requires drivers.status = 'online'
-- (nearest_drivers / auto_assign, mig 011:502: "d.is_active and d.is_verified
-- and d.status = 'online'"). NOTHING anywhere — in any migration or any app —
-- ever resets a driver from 'on_job' back to 'online' after the job ends.
-- advance_order_status (mig 033) only touched the order, not the driver; the
-- driver app's completeDelivery only calls advance() + stopStreaming().
--
-- RESULT: with auto-dispatch ON in prod, every driver drops out of the
-- dispatchable pool after their FIRST completed delivery. The fleet decays to
-- zero, one delivery at a time. The driver app's home toggle reads
-- `status !== 'offline'` so the UI shows "online · receiving offers" while the
-- DB has them 'on_job' and excluded — a silent, fleet-wide failure.
--
-- THE FIX
-- CREATE OR REPLACE advance_order_status (body identical to mig 033 — the final
-- definition — plus ONE block): when an order reaches a TERMINAL status
-- (delivered / cancelled / rejected) and it had an assigned driver, reset that
-- driver from 'on_job' back to 'online' so dispatch can offer them the next job.
--
-- SAFETY OF THE RESET
--   * Guarded on `status = 'on_job'`: a driver who went 'offline' mid-job (e.g.
--     ended their shift) is NOT flipped back online.
--   * Scoped to `v_order.assigned_driver_id`: only the one driver on this order.
--   * Runs inside the same txn with the order row already locked (for update),
--     so it is atomic with the status change.
--   * cancelled/rejected also frees the driver — an admin-cancelled in-flight
--     order must not strand its rider on_job either.
--
-- Everything else in this function is byte-for-byte the mig 033 body (the M2a
-- unpaid-card guard, the full transition table, the timestamp writes, the
-- status-event insert). Only the terminal-status driver reset is new.

create or replace function public.advance_order_status(
  p_order_id uuid,
  p_new_status order_status_type,
  p_note text default null
)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_user   uuid := auth.uid();
  v_role   app_role := public.auth_role();
  v_order  public.orders;
  v_ok     boolean := false;
  v_actor  text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;

  select * into v_order from public.orders where orders.id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'check_violation'; end if;

  -- Authorize the actor for THIS order.
  if v_role in ('admin','dispatcher') then
    v_ok := true; v_actor := v_role::text;
  elsif v_role = 'merchant_staff' and public.is_merchant_staff(v_order.restaurant_id) then
    v_ok := true; v_actor := 'merchant';
  elsif v_role = 'driver' and exists (
      select 1 from public.drivers d
       where d.id = v_order.assigned_driver_id and d.profile_id = v_user) then
    v_ok := true; v_actor := 'driver';
  elsif v_role = 'customer' and v_order.user_id = v_user then
    v_ok := true; v_actor := 'customer';
  end if;

  if not v_ok then raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation'; end if;

  -- [033 M2a] A CARD order must be PAID before it can move FORWARD out of
  -- 'placed'. Cancel/reject (cleanup) of an unpaid card order stays allowed.
  if v_order.payment_method = 'card'
     and v_order.payment_status <> 'paid'
     and p_new_status not in ('cancelled','rejected') then
    raise exception 'CARD_NOT_PAID: cannot advance an unpaid card order'
      using errcode = 'check_violation';
  end if;

  -- Legal transition check (mirror of the shared state machine).
  v_ok := case
    when v_order.status = 'placed'           and p_new_status = 'accepted'         and v_actor in ('merchant','admin','dispatcher') then true
    when v_order.status = 'accepted'         and p_new_status = 'preparing'        and v_actor in ('merchant','admin','dispatcher') then true
    when v_order.status = 'preparing'        and p_new_status = 'ready'            and v_actor in ('merchant','admin','dispatcher') then true
    when v_order.status = 'ready'            and p_new_status = 'picked_up'        and v_actor in ('driver','merchant','admin','dispatcher') then true
    when v_order.status = 'picked_up'        and p_new_status = 'out_for_delivery' and v_actor in ('driver','merchant','admin','dispatcher') then true
    when v_order.status = 'out_for_delivery' and p_new_status = 'delivered'        and v_actor in ('driver','merchant','admin','dispatcher') then true
    when v_order.status = 'placed'           and p_new_status = 'rejected'         and v_actor in ('merchant','admin','dispatcher') then true
    when v_order.status = 'accepted'         and p_new_status = 'rejected'         and v_actor in ('merchant','admin','dispatcher') then true
    when v_order.status = 'placed'           and p_new_status = 'cancelled'        and v_actor in ('customer','admin','dispatcher') then true
    when p_new_status = 'cancelled'          and v_actor in ('admin','dispatcher')
         and v_order.status not in ('delivered','cancelled','rejected') then true
    else false
  end;

  if not v_ok then
    raise exception 'ILLEGAL_TRANSITION: % -> %', v_order.status, p_new_status using errcode = 'check_violation';
  end if;

  update public.orders set
    status = p_new_status,
    accepted_at   = case when p_new_status = 'accepted'         then now() else accepted_at end,
    ready_at      = case when p_new_status = 'ready'            then now() else ready_at end,
    picked_up_at  = case when p_new_status = 'picked_up'        then now() else picked_up_at end,
    delivered_at  = case when p_new_status = 'delivered'        then now() else delivered_at end,
    cancel_reason = case when p_new_status in ('cancelled','rejected') then coalesce(p_note, cancel_reason) else cancel_reason end
   where id = p_order_id;

  -- [054] Release the assigned driver back to 'online' when the order reaches a
  -- terminal status, so auto-dispatch can offer them the next job. Guarded on
  -- 'on_job' so a driver who went offline mid-job is left alone.
  if p_new_status in ('delivered','cancelled','rejected')
     and v_order.assigned_driver_id is not null then
    update public.drivers
       set status = 'online'
     where id = v_order.assigned_driver_id
       and status = 'on_job';
  end if;

  insert into public.order_status_events (order_id, status, actor_role, actor_id, note)
  values (p_order_id, p_new_status, v_role, v_user, p_note);
end;
$$;
grant execute on function public.advance_order_status(uuid, order_status_type, text) to authenticated;

comment on function public.advance_order_status is
  'Order state-machine RPC. Final definition: mig 033 body (unpaid-card guard +'
  ' transition table) plus mig 054 terminal-status driver release'
  ' (on_job -> online on delivered/cancelled/rejected) so the fleet does not'
  ' decay after each delivery.';
