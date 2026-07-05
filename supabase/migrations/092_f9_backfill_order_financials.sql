-- 092_f9_backfill_order_financials.sql
-- F9 (2026-07-05 audit): backfill order_financials for delivered orders that
-- pre-date the commission-snapshot trigger (mig 062). Exactly 3 legacy orders in
-- prod as of the audit (2× 2026-06-07, 1× 2026-07-01).
--
-- Math mirrors snapshot_order_financials() exactly: commission = floor(subtotal
-- * rate / 100) at the restaurant's CURRENT commission_pct (default 12.0 like
-- the trigger) — there is no historical snapshot to recover, which is precisely
-- the gap 062 closed. VAT from platform_settings.commission_vat_pct (0 if
-- unset). delivered_at falls back to updated_at for rows delivered before the
-- delivered_at column was reliably stamped.
--
-- NO SLA credit is issued here (the legacy orders were handled at the time;
-- retroactive credits would be a money event, out of scope for a backfill).
--
-- Idempotent: anti-join + ON CONFLICT DO NOTHING.
-- Rollback: delete from order_financials where order_id in (<the 3 ids>) —
-- identifiable as the only rows whose delivered_at predates mig 062.

insert into public.order_financials (
  order_id, restaurant_id, subtotal_egp, discount_egp, commission_pct,
  commission_egp, commission_vat_egp, delivery_fee_egp, payment_method, delivered_at
)
select
  o.id,
  o.restaurant_id,
  coalesce(o.subtotal_egp, 0),
  coalesce(o.discount_egp, 0),
  coalesce(r.commission_pct, 12.0),
  floor(coalesce(o.subtotal_egp, 0) * coalesce(r.commission_pct, 12.0) / 100.0)::int,
  floor(
    floor(coalesce(o.subtotal_egp, 0) * coalesce(r.commission_pct, 12.0) / 100.0)
    * coalesce((select (value #>> '{}')::int from public.platform_settings
                 where key = 'commission_vat_pct'), 0) / 100.0
  )::int,
  coalesce(o.delivery_fee_egp, 0),
  o.payment_method,
  coalesce(o.delivered_at, o.updated_at)
from public.orders o
join public.restaurants r on r.id = o.restaurant_id
where o.status = 'delivered'
  and not exists (select 1 from public.order_financials f where f.order_id = o.id)
on conflict (order_id) do nothing;
