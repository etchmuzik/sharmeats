-- 050_driver_bonus_payout.sql
-- Fix: driver loyalty bonus (driver_loyalty.bonus_per_delivery_egp) is computed
-- by the nightly tier sweep (045_loyalty_tier_sweep.sql) and displayed to
-- drivers in-app ("Gold tier: +10 EGP/delivery"), but the ONLY function in the
-- whole migration chain that inserts into public.driver_earnings —
-- mark_cod_collected — never reads it. The bonus column is always left at its
-- table default of 0 and `total` never includes it, so the advertised bonus is
-- never actually paid.
--
-- mark_cod_collected has been fully redefined twice since its original
-- (011_rpcs.sql): once in 015_fix_self_delivery_cod.sql (added self-delivery
-- authz + guarded the earnings insert), and again in
-- 029_cod_amount_validation.sql (added the COD-amount-mismatch guard). No
-- migration after 029 touches this function or driver_earnings, so 029's body
-- is the current, live definition. This migration reproduces that body
-- verbatim and changes ONLY the driver_earnings insert: `bonus` now reads
-- driver_loyalty.bonus_per_delivery_egp for the assigned driver (coalesced to
-- 0 for drivers with no loyalty row yet), and `total` is corrected to include
-- it, matching the documented formula on driver_earnings.total
-- (008_fleet.sql: 'total = delivery_fee_share + tip + bonus').
--
-- No other logic changed: COD amount validation, authz branches, and the
-- self-delivery skip condition are all copied unmodified from 029.

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
  v_bonus  int;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'check_violation'; end if;
  if v_order.payment_method <> 'cash_on_delivery' then
    raise exception 'NOT_A_COD_ORDER' using errcode = 'check_violation';
  end if;

  -- [029] Validate the collected amount: a non-null p_amount MUST equal the
  -- order total. NULL is allowed (defaults to the full total below). This blocks
  -- direct-RPC under-reporting; the app always passes the exact total_egp.
  if p_amount is not null and p_amount <> v_order.total_egp then
    raise exception 'COD_AMOUNT_MISMATCH: expected % got %', v_order.total_egp, p_amount
      using errcode = 'check_violation';
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
    -- [050] Loyalty tier bonus (nightly sweep, 045_loyalty_tier_sweep.sql).
    -- Coalesced to 0: a driver may not yet have a driver_loyalty row (e.g.
    -- brand-new driver, first delivery before the first nightly sweep run).
    select coalesce(bonus_per_delivery_egp, 0) into v_bonus
      from public.driver_loyalty
     where driver_id = v_order.assigned_driver_id;

    insert into public.driver_earnings (driver_id, order_id, delivery_fee_share, tip, bonus, cod_collected, total)
    values (
      v_order.assigned_driver_id, p_order_id,
      v_order.delivery_fee_egp, v_order.tip_egp,
      coalesce(v_bonus, 0),
      coalesce(p_amount, v_order.total_egp),
      v_order.delivery_fee_egp + v_order.tip_egp + coalesce(v_bonus, 0)
    )
    on conflict (order_id) do update set cod_collected = excluded.cod_collected;
  end if;
end;
$$;

comment on function public.mark_cod_collected is
  'COD settlement. Authorized: admin, the assigned driver, or (self_delivery) staff of the order''s restaurant. Writes driver_earnings only when a driver was assigned, including the driver''s current loyalty-tier bonus_per_delivery_egp; self-delivery cash is reconciled via restaurants.commission_pct.';
