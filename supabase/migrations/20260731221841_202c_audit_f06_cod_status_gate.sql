-- ============================================================================
-- TRANSCRIPT OF AN ALREADY-APPLIED MIGRATION — DO NOT RE-APPLY TO PRODUCTION.
--
--   prod ledger version : 20260731221841
--   prod ledger name    : 202c_audit_f06_cod_status_gate
--   applied to prod     : 2026-07-31 (directly, with no file in this repo)
--   reconstructed       : 2026-08-01, from
--                         supabase_migrations.schema_migrations.statements
--
-- WHY THIS FILE EXISTS. On 2026-07-31 eleven migrations were applied straight to
-- production and never committed. The repo therefore no longer described the
-- database. This file is a byte-exact copy of what production recorded, written
-- back so that (a) the repo describes production again, and (b) a fresh database
-- rebuilt by replaying supabase/migrations/ ends up in the same state.
--
-- WHAT IT IS NOT. It is not a change. Production ALREADY has everything below.
-- Do not point this at production, do not "re-run it to be sure", and do not
-- edit it to fix a defect — a later, higher-numbered migration does that. Editing
-- a transcript makes the repo lie about production a second time.
--
-- HOUSE RULE 2 APPLIES TO THE NEXT PERSON. This body is now the latest version
-- of mark_cod_collected(uuid, integer). Anyone changing that function must start
-- from THIS text, not from mig 104's copy, or the two gates added here are
-- silently reverted.
--
-- The body below this marker is reproduced verbatim, including its own original
-- header comments (which refer to a "202" file that was never committed) and its
-- own numbering claims. Those are left untouched on purpose: this records what
-- ran, not what we wish had run. Verified byte-for-byte against the prod ledger
-- (md5 8b51c3f27f1e0c8ec63a0fd36d34f3ee).
-- ============================================================================
-- ===== BEGIN TRANSCRIPT =====
-- 202 section F-06 — mark_cod_collected refuses a non-delivered or cancelled
-- order. Body from mig 104 (the latest definition) with two gates added; the
-- COD ceiling, driver_earnings and cash-custody logic are unchanged.
--
-- Previously it checked payment method, amount and actor but never the order's
-- status, so a driver tapping "collect" early — or retrying on an order
-- cancelled a second earlier — left a `paid` + `cancelled` COD order with no
-- un-pay path, a driver_earnings row for a delivery that never happened, and
-- cash custody recorded against a driver who may not hold it. The gate existed
-- only in the driver UI, which is precisely the arrangement this codebase
-- exists to avoid.

create or replace function public.mark_cod_collected(p_order_id uuid, p_amount integer)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user   uuid := auth.uid();
  v_order  public.orders;
  v_drv    public.drivers;
  v_role   app_role := public.auth_role();
  v_is_self boolean;
  v_bonus  int;
  v_cash   int;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'check_violation'; end if;
  if v_order.payment_method <> 'cash_on_delivery' then
    raise exception 'NOT_A_COD_ORDER' using errcode = 'check_violation';
  end if;

  -- [202 F-06] Cash is collected at the door, so the order must have got there.
  -- coalesce so a NULL status fails closed.
  if coalesce(v_order.status::text, '') <> 'delivered' then
    raise exception
      'COD_NOT_COLLECTABLE: order is % — cash can only be settled on a delivered order',
      coalesce(v_order.status::text, 'unknown')
      using errcode = 'check_violation';
  end if;

  -- [202 F-06] And at most once. The ledger insert is already idempotent per
  -- order, but driver_earnings' DO UPDATE and the orders write were not, so a
  -- double tap re-ran both. Returning (rather than raising) keeps a retry
  -- harmless for the driver app, which cannot distinguish a lost response from
  -- a failure.
  if coalesce(v_order.payment_status::text, '') = 'paid' then
    return;
  end if;

  if p_amount is not null and p_amount <> v_order.total_egp then
    raise exception 'COD_AMOUNT_MISMATCH: expected % got %', v_order.total_egp, p_amount
      using errcode = 'check_violation';
  end if;

  v_is_self := (v_order.fulfillment_type = 'self_delivery');

  select * into v_drv from public.drivers where id = v_order.assigned_driver_id;

  if v_role = 'admin' then
    null;
  elsif v_drv.id is not null and v_drv.profile_id is not distinct from v_user then
    null;
  elsif v_is_self and public.is_merchant_staff(v_order.restaurant_id) then
    null;
  else
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;

  update public.orders set payment_status = 'paid' where id = p_order_id;

  v_cash := coalesce(p_amount, v_order.total_egp);

  if v_order.assigned_driver_id is not null then
    select coalesce(bonus_per_delivery_egp, 0) into v_bonus
      from public.driver_loyalty
     where driver_id = v_order.assigned_driver_id;

    insert into public.driver_earnings (driver_id, order_id, delivery_fee_share, tip, bonus, cod_collected, total)
    values (
      v_order.assigned_driver_id, p_order_id,
      v_order.delivery_fee_egp, v_order.tip_egp,
      coalesce(v_bonus, 0),
      v_cash,
      v_order.delivery_fee_egp + v_order.tip_egp + coalesce(v_bonus, 0)
    )
    on conflict (order_id) do update set cod_collected = excluded.cod_collected;

    -- [104] Credit the driver's cash-custody ledger: they now physically hold this
    -- cash and owe it to the platform. Idempotent per order (partial unique index).
    -- A courier-delivered COD only — for self_delivery the restaurant holds the cash,
    -- not a driver, so skip when there is no assigned driver (already guarded above).
    insert into public.driver_cash_ledger (driver_id, delta_egp, reason, ref_order_id, actor_id)
    values (v_order.assigned_driver_id, v_cash, 'cod_collected', p_order_id, v_user)
    on conflict (ref_order_id) where reason = 'cod_collected' do nothing;
  end if;
end;
$function$;

comment on function public.mark_cod_collected(uuid, integer) is
  'Settles a cash-on-delivery order. Requires the order to BE delivered (mig 202, audit F-06: previously callable at any status, so an early tap or a race with a cancel left a paid+cancelled order, a phantom driver_earnings row and mis-stated cash custody), settles at most once, validates the amount against the server-side total, and authorises admin / the assigned driver / self-delivery merchant staff only.';

revoke all on function public.mark_cod_collected(uuid, integer) from public, anon;
grant execute on function public.mark_cod_collected(uuid, integer) to authenticated, service_role;
