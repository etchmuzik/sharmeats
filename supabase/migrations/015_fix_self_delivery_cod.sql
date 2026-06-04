-- 015_fix_self_delivery_cod.sql
-- Fix: self-delivery merchants could deliver a COD order but never settle it.
--
-- The original mark_cod_collected (mig 011) authorized ONLY the assigned driver
-- or an admin, and always inserted a driver_earnings row. Self-delivery orders
-- have assigned_driver_id = NULL and no driver, so:
--   (a) a self-delivering merchant got NOT_AUTHORIZED → payment_status stuck
--       'pending' forever, and
--   (b) the driver_earnings insert would violate its NOT NULL driver_id FK.
--
-- This migration replaces mark_cod_collected so that:
--   * the assigned driver OR an admin can settle (unchanged), AND
--   * for self_delivery orders, a merchant_staff member of the order's
--     restaurant can settle, AND
--   * driver_earnings is written ONLY when a driver was actually assigned
--     (platform orders). Self-delivery keeps 100% of the cash at the merchant;
--     the platform cut is taken via restaurants.commission_pct at reconciliation,
--     which is NOT a driver-earnings concern.
--
-- The platform/driver COD path is unchanged (verified working: SE-2UGM5S settled
-- with fee_share=30, tip=15).

create or replace function public.mark_cod_collected(p_order_id uuid, p_amount int)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_user   uuid := auth.uid();
  v_order  public.orders;
  v_drv    public.drivers;
  v_role   app_role := public.auth_role();
  v_is_self boolean;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'check_violation'; end if;
  if v_order.payment_method <> 'cash_on_delivery' then
    raise exception 'NOT_A_COD_ORDER' using errcode = 'check_violation';
  end if;

  v_is_self := (v_order.fulfillment_type = 'self_delivery');

  -- The assigned driver (if any) — used both for authz and the earnings branch.
  select * into v_drv from public.drivers where id = v_order.assigned_driver_id;

  -- Authorize the settler:
  --   admin always; the assigned driver; OR (self_delivery) staff of the
  --   order's restaurant.
  if v_role = 'admin' then
    null;  -- ok
  elsif v_drv.id is not null and v_drv.profile_id is not distinct from v_user then
    null;  -- ok: the assigned driver
  elsif v_is_self and public.is_merchant_staff(v_order.restaurant_id) then
    null;  -- ok: self-delivery merchant settling their own order
  else
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;

  -- Settle payment for ALL fulfillment types.
  update public.orders set payment_status = 'paid' where id = p_order_id;

  -- Driver-earnings ledger ONLY when an actual driver delivered (platform).
  -- Self-delivery has no driver row, and driver_earnings.driver_id is NOT NULL,
  -- so we intentionally skip it; merchant settlement happens via commission_pct.
  if v_order.assigned_driver_id is not null then
    insert into public.driver_earnings (driver_id, order_id, delivery_fee_share, tip, cod_collected, total)
    values (
      v_order.assigned_driver_id, p_order_id,
      v_order.delivery_fee_egp, v_order.tip_egp,
      coalesce(p_amount, v_order.total_egp),
      v_order.delivery_fee_egp + v_order.tip_egp
    )
    on conflict (order_id) do update set cod_collected = excluded.cod_collected;
  end if;
end;
$$;

grant execute on function public.mark_cod_collected(uuid, int) to authenticated;

comment on function public.mark_cod_collected is
  'COD settlement. Authorized: admin, the assigned driver, or (self_delivery) staff of the order''s restaurant. Writes driver_earnings only when a driver was assigned; self-delivery cash is reconciled via restaurants.commission_pct.';
