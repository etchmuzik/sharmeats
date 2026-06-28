-- 029_cod_amount_validation.sql
-- Harden COD settlement: validate the collected amount against the order total.
--
-- THE PROBLEM THIS FIXES (audit H1)
-- mark_cod_collected (mig 015) accepted ANY p_amount and recorded it verbatim
-- into driver_earnings.cod_collected with NO comparison to orders.total_egp. A
-- driver calling the RPC directly could mark 50 EGP collected on a 200 EGP
-- order, under-reporting cash owed to the platform — a reconciliation loss.
--
-- The legitimate driver app ALWAYS passes job.total_egp (apps/driver/app/job/
-- [id].tsx:86), so requiring an exact match changes nothing for the real flow;
-- it only rejects tampered/out-of-band calls. p_amount IS NULL is still allowed
-- (means "collect the full total" — the coalesce default path), so any caller
-- that omits the amount keeps working. Only a NON-NULL mismatch is rejected.
--
-- Same body as mig 015 + a single guard before the ledger write.

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
