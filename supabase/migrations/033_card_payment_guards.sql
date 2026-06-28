-- 033_card_payment_guards.sql
-- Close the card-payment gaps (audit M1 + M2). Defense in depth so an UNPAID
-- card order can never be accepted, dispatched, or stuck forever.
--
-- Card payments are DISABLED at launch (COD-only), so these are latent until
-- card is enabled — but they must be in place before that switch is flipped.
--
-- THREE GUARDS:
--   M2a — advance_order_status: refuse to move a CARD order out of 'placed'
--         (accept/preparing/etc.) while payment_status <> 'paid'. A human
--         dispatcher/merchant could previously accept an unpaid card order,
--         after which dispatch would offer it to a driver.
--   M1  — dispatch_sweep: only ever offer COD orders or PAID card orders.
--         Belt-and-suspenders with M2a (covers any order that reached an
--         eligible status by another path).
--   M2b — reconcile_stale_card_orders: a pg_cron sweep that EXPIRES card orders
--         stuck at payment_status='pending' past a 30-minute window (abandoned
--         Paymob checkout / lost webhook) → payment_status='failed',
--         status='cancelled'. A late webhook is then a no-op (it only flips
--         pending->paid, and the order is no longer pending). 30 min is far
--         longer than any real hosted-checkout redirect.
--
-- Non-destructive: CREATE OR REPLACE of two functions + one new function + cron.

-- ============================================================================
-- M2a — advance_order_status with an unpaid-card guard.
-- Body identical to mig 011 plus one check after authorization: a card order
-- may not LEAVE 'placed' until it is paid. (COD is unaffected; cancel/reject of
-- an unpaid card order is still allowed so it can be cleaned up.)
-- ============================================================================
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

  insert into public.order_status_events (order_id, status, actor_role, actor_id, note)
  values (p_order_id, p_new_status, v_role, v_user, p_note);
end;
$$;
grant execute on function public.advance_order_status(uuid, order_status_type, text) to authenticated;

-- ============================================================================
-- M1 — dispatch_sweep, now with a payment guard on the dispatch query.
-- Body identical to mig 025 except the eligibility WHERE adds:
--   (payment_method = 'cash_on_delivery' OR payment_status = 'paid')
-- so an unpaid card order is never offered to a driver.
-- ============================================================================
create or replace function public.dispatch_sweep()
returns int
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_default text;
  v_count   int := 0;
  v_rec     record;
begin
  -- (1) Expire lapsed offers.
  with expired as (
    update public.order_assignments
       set status = 'rejected', responded_at = now()
     where status = 'offered'
       and offer_expires_at is not null
       and offer_expires_at < now()
    returning order_id
  )
  update public.orders o
     set assigned_driver_id = null
    from expired e
   where o.id = e.order_id
     and o.status not in ('picked_up','out_for_delivery','delivered');

  select coalesce((value #>> '{}'), 'manual') into v_default
    from public.platform_settings where key = 'dispatch_mode';

  -- (2) Dispatch eligible orders.
  for v_rec in
    select o.id
      from public.orders o
      left join public.zones z on z.id = o.zone
     where o.status in ('accepted','preparing','ready')
       and o.dropoff_geo is not null
       -- [033 M1] never dispatch an unpaid card order.
       and (o.payment_method = 'cash_on_delivery' or o.payment_status = 'paid')
       and coalesce(z.dispatch_mode, v_default) = 'auto'
       and not exists (
             select 1 from public.order_assignments oa
              where oa.order_id = o.id and oa.status in ('offered','accepted')
           )
     order by o.placed_at asc
     limit 50
  loop
    if public.auto_assign_order(v_rec.id) is not null then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.dispatch_sweep() from public, anon, authenticated;
grant execute on function public.dispatch_sweep() to postgres;

-- ============================================================================
-- M2b — reconcile_stale_card_orders: expire abandoned/unpaid card checkouts so
-- they don't sit at 'pending' forever (lost Paymob webhook). 30-minute window.
-- ============================================================================
create or replace function public.reconcile_stale_card_orders()
returns int
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_count int := 0;
begin
  with stale as (
    update public.orders
       set payment_status = 'failed',
           status = 'cancelled',
           cancel_reason = coalesce(cancel_reason, 'Payment not completed — checkout expired')
     where payment_method = 'card'
       and payment_status = 'pending'
       and status = 'placed'
       and placed_at < now() - interval '30 minutes'
    returning id
  )
  -- actor_role is null: the app_role enum has no 'system' member (mirrors the
  -- same pattern in mig 026_auto_accept's sweep).
  insert into public.order_status_events (order_id, status, actor_role, actor_id, note)
  select id, 'cancelled', null, null, 'Card payment not completed within 30 minutes'
    from stale;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.reconcile_stale_card_orders() from public, anon, authenticated;
grant execute on function public.reconcile_stale_card_orders() to postgres;

-- Schedule the reconciliation every 5 minutes.
create extension if not exists pg_cron;
do $$
begin
  perform cron.unschedule('sharmeats-reconcile-card');
exception when others then
  null;
end $$;
select cron.schedule('sharmeats-reconcile-card', '5 minutes', $$select public.reconcile_stale_card_orders();$$);

comment on function public.reconcile_stale_card_orders is
  'Expires card orders stuck at payment_status=pending past 30 min (abandoned checkout / lost Paymob webhook) -> failed + cancelled. Runs via pg_cron every 5 min. A late webhook is then a no-op (it only flips pending->paid).';
