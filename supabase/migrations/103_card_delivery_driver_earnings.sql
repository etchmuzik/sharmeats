-- 103 — record driver_earnings on CARD delivery (P0 #2 from the 2026-07-11 gap analysis).
--
-- BUG: driver_earnings is written ONLY inside mark_cod_collected (mig 050), which
-- runs only for cash_on_delivery orders. When a card order reaches 'delivered' via
-- advance_order_status, NO earnings row is written — so every card delivery silently
-- pays the assigned driver zero (fee + tip + bonus lost). The moment card payments
-- are enabled this is unpaid labor and a wage-dispute vector.
--
-- FIX: in advance_order_status, when a CARD order transitions to 'delivered' with an
-- assigned driver, insert the same driver_earnings row mark_cod_collected writes for
-- COD — with cod_collected = 0 (the customer already paid by card, the driver holds
-- no cash for this order). COD is unchanged: it still books earnings at collection
-- time via mark_cod_collected, and the `on conflict (order_id) do nothing` below means
-- a COD order that somehow reaches this path won't double-book or clobber its cash row.
--
-- This is a create-or-replace of advance_order_status. The body below is IDENTICAL to
-- the live version (verified) except for the new earnings block after the terminal
-- driver-release. search_path + security definer + all authz/transition logic preserved.

create or replace function public.advance_order_status(p_order_id uuid, p_new_status order_status_type, p_note text default null::text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user   uuid := auth.uid();
  v_role   app_role := public.auth_role();
  v_order  public.orders;
  v_ok     boolean := false;
  v_actor  text;
  v_bonus  int;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;

  select * into v_order from public.orders where orders.id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'check_violation'; end if;

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

  if v_order.payment_method = 'card'
     and v_order.payment_status <> 'paid'
     and p_new_status not in ('cancelled','rejected') then
    raise exception 'CARD_NOT_PAID: cannot advance an unpaid card order'
      using errcode = 'check_violation';
  end if;

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

  -- [054] Release the assigned driver back to 'online' on terminal status.
  if p_new_status in ('delivered','cancelled','rejected')
     and v_order.assigned_driver_id is not null then
    update public.drivers
       set status = 'online'
     where id = v_order.assigned_driver_id
       and status = 'on_job';
  end if;

  -- [103] CARD delivery earnings. COD books earnings in mark_cod_collected (with the
  -- cash amount); card orders are prepaid, so we book fee + tip + bonus here with
  -- cod_collected = 0. `do nothing` on conflict keeps this idempotent and never
  -- clobbers a COD cash row if a COD order ever reaches this branch.
  if p_new_status = 'delivered'
     and v_order.payment_method = 'card'
     and v_order.assigned_driver_id is not null then
    select coalesce(bonus_per_delivery_egp, 0) into v_bonus
      from public.driver_loyalty
     where driver_id = v_order.assigned_driver_id;

    insert into public.driver_earnings (driver_id, order_id, delivery_fee_share, tip, bonus, cod_collected, total)
    values (
      v_order.assigned_driver_id, p_order_id,
      v_order.delivery_fee_egp, v_order.tip_egp, coalesce(v_bonus, 0),
      0,
      v_order.delivery_fee_egp + v_order.tip_egp + coalesce(v_bonus, 0)
    )
    on conflict (order_id) do nothing;
  end if;

  insert into public.order_status_events (order_id, status, actor_role, actor_id, note)
  values (p_order_id, p_new_status, v_role, v_user, p_note);
end;
$function$;
