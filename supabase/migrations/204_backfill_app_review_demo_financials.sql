-- ============================================================================
-- 204 — Backfill order_financials for the 3 App Review demo orders
--
-- The 2026-07-31 audit (§7) found 3 delivered orders with no order_financials
-- row and blamed a NULL commission_pct_snapshot. Recon against production
-- corrected the mechanism: these are the Apple App Review DEMO orders, seeded
-- in a single transaction on 2026-07-21 23:18 UTC (all three share the same
-- microsecond fraction on every timestamp) and INSERTed directly with
-- status='delivered'. The financials writer is an AFTER UPDATE OF status
-- trigger — no update ever happened, so it never fired, and
-- order_financials_failures (mig 135) did not exist yet. The NULL snapshot is
-- expected: the snapshot column itself arrived with mig 135, six days later.
--
-- WHAT THIS DOES: inserts the 3 missing rows so that "every delivered order
-- has a financials row" holds again and future reconciliation queries stop
-- tripping on them. Commission = floor(subtotal * rate / 100), rate resolved
-- exactly as the live trigger would have: snapshot first (NULL here), then the
-- restaurant's live commission_pct (12.00 — founding rate). Expected rows:
--   000fee3b… subtotal 420 → commission 50
--   78ef11d0… subtotal 320 → commission 38
--   1227b4cb… subtotal 225 → commission 27
--
-- POLICY, decided deliberately and recorded here: these orders are FICTIONAL
-- (demo restaurant "Demo Kitchen (App Review)", no real customer, cash never
-- collected — payment_status is still 'pending'). We backfill for ledger
-- completeness but do NOT generate settlements for the weeks 2026-07-13..19 /
-- 07-20..26: settlement_sweep only ever computes the just-ended week, so no
-- automatic path will bill these, and manually drafting an EGP 115 receivable
-- against a fictional merchant would be inventing money. If the demo
-- restaurant is ever deleted, order_financials rows go with their orders (FK).
--
-- Does NOT touch public.orders (stamping the snapshot retroactively would fire
-- the touch/notify triggers for no benefit — the financials trigger can never
-- re-fire for an already-delivered order).
-- ============================================================================

-- Pre-assertions: fail loudly rather than backfill blind.
do $$
declare
  v_ids uuid[] := array[
    '000fee3b-a115-4e86-bfc9-43391d5f9958',
    '78ef11d0-ed03-40a3-94f2-3911badbba95',
    '1227b4cb-4b8f-4bc1-843d-69f04391905a']::uuid[];
  v_missing uuid[];
  v_bad int;
begin
  -- (a) The delivered-without-financials population is EXACTLY these 3 orders.
  select coalesce(array_agg(o.id order by o.id), '{}') into v_missing
    from public.orders o
   where o.status = 'delivered'
     and not exists (select 1 from public.order_financials f where f.order_id = o.id);
  if v_missing <> (select array_agg(x order by x) from unnest(v_ids) x) then
    raise exception '[204] delivered-without-financials set is %, expected exactly the 3 demo orders — investigate before backfilling', v_missing;
  end if;

  -- (b) Field sanity on all 3: delivered_at present, COD, resolvable rate.
  select count(*) into v_bad
    from public.orders o join public.restaurants r on r.id = o.restaurant_id
   where o.id = any(v_ids)
     and (o.delivered_at is null
          or o.payment_method <> 'cash_on_delivery'
          or coalesce(o.commission_pct_snapshot, r.commission_pct) is null);
  if v_bad > 0 then
    raise exception '[204] % of the demo orders fail field sanity (delivered_at / payment_method / rate)', v_bad;
  end if;

  -- (c) No settlement anywhere references the demo restaurant, and no PAID
  -- settlement covers the seeded dates — a backfill must not change any
  -- settled amount.
  if exists (
    select 1 from public.restaurant_settlements s
     where s.restaurant_id = (select restaurant_id from public.orders where id = v_ids[1])
        or (s.status = 'paid' and s.period_start <= date '2026-07-21'
            and s.period_end >= date '2026-07-19')
  ) then
    raise exception '[204] a settlement overlaps the demo orders — resolve settlement state first';
  end if;

  -- (d) No unresolved failure rows claim these orders.
  if to_regclass('public.order_financials_failures') is not null then
    if exists (select 1 from public.order_financials_failures ff
                where ff.order_id = any(v_ids) and ff.resolved_at is null) then
      raise exception '[204] unresolved order_financials_failures row exists for a demo order';
    end if;
  end if;
end $$;

create temporary table _mig204_settlements_before as
  select count(*) as n from public.restaurant_settlements;

insert into public.order_financials (
    order_id, restaurant_id, subtotal_egp, discount_egp, commission_pct,
    commission_egp, commission_vat_egp, delivery_fee_egp, payment_method, delivered_at)
select o.id,
       o.restaurant_id,
       coalesce(o.subtotal_egp, 0),
       coalesce(o.discount_egp, 0),
       coalesce(o.commission_pct_snapshot, r.commission_pct),
       floor(coalesce(o.subtotal_egp, 0)
             * coalesce(o.commission_pct_snapshot, r.commission_pct) / 100.0)::int,
       floor(floor(coalesce(o.subtotal_egp, 0)
                   * coalesce(o.commission_pct_snapshot, r.commission_pct) / 100.0)
             * coalesce((select (value #>> '{}')::numeric
                           from public.platform_settings
                          where key = 'commission_vat_pct'), 0) / 100.0)::int,
       coalesce(o.delivery_fee_egp, 0),
       o.payment_method,
       o.delivered_at
  from public.orders o
  join public.restaurants r on r.id = o.restaurant_id
 where o.id in ('000fee3b-a115-4e86-bfc9-43391d5f9958',
                '78ef11d0-ed03-40a3-94f2-3911badbba95',
                '1227b4cb-4b8f-4bc1-843d-69f04391905a')
   and o.status = 'delivered'
   and not exists (select 1 from public.order_financials f where f.order_id = o.id)
on conflict (order_id) do nothing;

-- Post-assertions.
do $$
declare
  v_left int; v_badmath int; v_settlements_now int;
begin
  select count(*) into v_left
    from public.orders o
   where o.status = 'delivered'
     and not exists (select 1 from public.order_financials f where f.order_id = o.id);
  if v_left <> 0 then
    raise exception '[204] % delivered orders still lack a financials row after backfill', v_left;
  end if;

  select count(*) into v_badmath
    from public.order_financials f
   where f.order_id in ('000fee3b-a115-4e86-bfc9-43391d5f9958',
                        '78ef11d0-ed03-40a3-94f2-3911badbba95',
                        '1227b4cb-4b8f-4bc1-843d-69f04391905a')
     and f.commission_egp <> floor(f.subtotal_egp * f.commission_pct / 100.0)::int;
  if v_badmath > 0 then
    raise exception '[204] commission math mismatch on % backfilled rows', v_badmath;
  end if;

  select count(*) into v_settlements_now from public.restaurant_settlements;
  if v_settlements_now <> (select n from _mig204_settlements_before) then
    raise exception '[204] settlement row count changed during a pure order_financials backfill';
  end if;
end $$;

drop table _mig204_settlements_before;
