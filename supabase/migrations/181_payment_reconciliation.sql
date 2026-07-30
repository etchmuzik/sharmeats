-- 181_payment_reconciliation.sql
--
-- Package 04 Slice A: the reconciliation surface and daily detector the spec
-- requires — "an admin-only reconciliation surface or export" plus "an automated
-- daily job" over eight mismatch classes, alerting BY CLASS, not per row.
--
-- ================= WHY THIS EXISTS =================
-- The money path has four accounting identities (order total composition,
-- captured/refunded vs provider records, settlement math, ledger-summed driver
-- cash). Nothing watched them: a paid card order with no provider transaction, a
-- refund stuck in 'requested', or an unbilled delivered order (mig 135's repair
-- queue) would sit silently until a human went looking. Mig 121 sat unapplied for
-- 58 migrations for exactly this reason — nothing compared intent to reality on a
-- schedule. scripts/check-db-drift.sh now watches repo-vs-database drift; this
-- migration watches the money data itself.
--
-- ================= SHAPE =================
-- One internal detector (payment_reconciliation_findings) produces typed mismatch
-- rows; two callers share it:
--   * payment_reconciliation_report(p_days)  — admin-only, PostgREST-callable, the
--     operator export. Carries provider REFERENCES only — never provider_detail,
--     client_secret or checkout_url (the spec: "must not expose secrets or full
--     payment details").
--   * payment_reconciliation_sweep()         — cron-only, daily. ONE ops_alert
--     summarising count + worst age PER CLASS. Quiet when clean.
-- The detector itself is executable by NOBODY client-side: callers reach it
-- definer-to-definer (privilege is checked against the calling role, and inside a
-- SECURITY DEFINER function that role is the owner).
--
-- ================= MISMATCH CLASSES (spec order) =================
--   card_paid_without_provider_txn   paid card order, no provider transaction ref
--   provider_txn_without_settled_order  a 'paid' payment attempt whose order is not
--                                    settled to that transaction
--   refund_pending_beyond_sla        'requested' older than refund_sla_hours (48)
--   refund_above_captured            succeeded refunds exceed the captured total,
--                                    or any succeeded refund on a never-paid order
--   cod_delivered_uncollected        delivered COD order still unpaid, or paid with
--                                    no cash-custody ledger row (1 h grace; self-
--                                    delivery is exempt from the ledger requirement
--                                    — the restaurant holds that cash, mig 104)
--   duplicate_settlement_coverage    overlapping settlement periods for one
--                                    restaurant or one driver. The order→settlement
--                                    link is IMPLICIT (delivered_at::date between
--                                    period bounds — there is no settlement_id
--                                    column), so overlapping periods ARE double
--                                    counting; no row-level duplicate can exist.
--   card_captured_but_cancelled      cancelled/rejected order holding captured card
--                                    funds with no refund in flight (the delayed-
--                                    webhook-after-local-cancel case; not one of the
--                                    spec's seven — found while building the proof
--                                    pack's card scenarios)
--   finance_repair_open              order_financials_failures.resolved_at IS NULL
--                                    (mig 135's unbilled-revenue queue; no repair
--                                    RPC exists — repair is a manual admin action)
--
-- ================= HYGIENE RIDER: driver_cash_ledger grants =================
-- Verified live 2026-07-30: anon/authenticated hold INSERT/UPDATE/DELETE on
-- driver_cash_ledger via default privileges (mig 104 predates house rule 5b).
-- Writes are currently denied only because RLS has no write policy — the same
-- fragile containment order_refunds had before mig 180. Closed here properly:
-- revoke-first, then re-grant only SELECT (the driver_cash_balance view is
-- security_invoker, so the invoker needs table SELECT; row scope stays with RLS).

revoke all on table public.driver_cash_ledger from public, anon, authenticated;
grant select on table public.driver_cash_ledger to authenticated;
grant select, insert, update, delete on table public.driver_cash_ledger to service_role;

-- ---------------------------------------------------------------------------
-- 1. The detector
-- ---------------------------------------------------------------------------
create or replace function public.payment_reconciliation_findings(p_days int default 30)
returns table (
  mismatch_class text,
  order_id       uuid,
  short_code     text,
  payment_method text,
  amount_egp     int,
  provider_ref   text,
  settlement_id  uuid,
  ledger_id      uuid,
  detail         text,
  age_days       int
)
language plpgsql
stable
security definer set search_path = public, pg_temp
as $$
declare
  v_days int := least(greatest(coalesce(p_days, 30), 1), 365);
  v_since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365));
  v_refund_sla_h int := coalesce(
    (select (value #>> '{}')::int from public.platform_settings where key = 'refund_sla_hours'), 48);
begin
  -- Window note: order-anchored classes scan p_days back (clamped 1..365) so the
  -- daily sweep stays cheap; settlement overlap and the repair queue are scanned
  -- in FULL — both tables are small and an old open item is MORE alarming, not
  -- less.

  -- a. paid card order without a provider transaction
  return query
  select 'card_paid_without_provider_txn'::text, o.id, o.short_code, o.payment_method,
         o.total_egp, o.paymob_order_ref, null::uuid, null::uuid,
         'payment_status=paid with no paymob_txn_id and no paid payment_attempt',
         extract(day from now() - o.placed_at)::int
    from public.orders o
   where o.placed_at >= v_since
     and o.payment_method = 'card'
     and o.payment_status = 'paid'
     and o.paymob_txn_id is null
     and not exists (select 1 from public.payment_attempts a
                      where a.order_id = o.id and a.status = 'paid');

  -- b. provider transaction without a settled order
  return query
  select 'provider_txn_without_settled_order'::text, a.order_id, o.short_code,
         o.payment_method, a.amount_egp, a.provider_txn_id, null::uuid, null::uuid,
         'payment_attempt is paid but the order is ' || o.payment_status
           || case when o.paymob_txn_id is distinct from a.provider_txn_id
                   then ' under a different transaction' else '' end,
         extract(day from now() - a.created_at)::int
    from public.payment_attempts a
    join public.orders o on o.id = a.order_id
   where a.created_at >= v_since
     and a.status = 'paid'
     and (o.payment_status not in ('paid', 'refunded')
          or o.paymob_txn_id is distinct from a.provider_txn_id);

  -- c. refund pending beyond its SLA
  return query
  select 'refund_pending_beyond_sla'::text, r.order_id, o.short_code, o.payment_method,
         r.amount_egp, r.provider_ref, null::uuid, null::uuid,
         'requested ' || extract(epoch from now() - r.created_at)::int / 3600
           || 'h ago; SLA ' || v_refund_sla_h || 'h. A stuck refund BLOCKS retries '
           || 'by design (order_refunds_one_active_or_succeeded) — resolve it, do not retry around it',
         extract(day from now() - r.created_at)::int
    from public.order_refunds r
    join public.orders o on o.id = r.order_id
   where r.status = 'requested'
     and r.created_at < now() - make_interval(hours => v_refund_sla_h);

  -- d. refund total above captured total
  return query
  select 'refund_above_captured'::text, o.id, o.short_code, o.payment_method,
         (s.refunded - o.total_egp)::int, null::text, null::uuid, null::uuid,
         'succeeded refunds total ' || s.refunded || ' EGP against a captured total of '
           || o.total_egp || ' EGP'
           || case when o.payment_status not in ('paid','refunded')
                   then ' on an order that was never paid' else '' end,
         extract(day from now() - o.placed_at)::int
    from public.orders o
    join lateral (
      select coalesce(sum(r.amount_egp), 0)::int as refunded
        from public.order_refunds r
       where r.order_id = o.id and r.status = 'succeeded'
    ) s on true
   where o.placed_at >= v_since
     and s.refunded > 0
     and (s.refunded > o.total_egp or o.payment_status not in ('paid', 'refunded'));

  -- e. delivered COD order without collection / ledger entry (1 h grace)
  return query
  select 'cod_delivered_uncollected'::text, o.id, o.short_code, o.payment_method,
         o.total_egp, null::text, null::uuid, null::uuid,
         case when o.payment_status <> 'paid'
              then 'delivered but payment_status=' || o.payment_status
              else 'paid but no cod_collected row in driver_cash_ledger' end,
         extract(day from now() - o.delivered_at)::int
    from public.orders o
   where o.delivered_at is not null
     and o.delivered_at >= v_since
     and o.delivered_at < now() - interval '1 hour'
     and o.payment_method = 'cash_on_delivery'
     and o.status = 'delivered'
     and (o.payment_status <> 'paid'
          or (o.assigned_driver_id is not null
              and coalesce(o.fulfillment_type::text, '') <> 'self_delivery'
              and not exists (select 1 from public.driver_cash_ledger l
                               where l.ref_order_id = o.id
                                 and l.reason = 'cod_collected')));

  -- f. duplicate settlement coverage: overlapping periods double-count orders,
  --    because the order→settlement link is a date window, not a foreign key.
  return query
  select 'duplicate_settlement_coverage'::text, null::uuid, null::text, null::text,
         s1.net_payable_egp, null::text, s1.id, null::uuid,
         'restaurant ' || s1.restaurant_id || ' period ' || s1.period_start || '..'
           || s1.period_end || ' overlaps settlement ' || s2.id,
         extract(day from now() - s1.created_at)::int
    from public.restaurant_settlements s1
    join public.restaurant_settlements s2
      on s2.restaurant_id = s1.restaurant_id
     and s2.id > s1.id
     and s1.period_start <= s2.period_end
     and s2.period_start <= s1.period_end;

  return query
  select 'duplicate_settlement_coverage'::text, null::uuid, null::text, null::text,
         d1.net_payable_egp, null::text, d1.id, null::uuid,
         'driver ' || d1.driver_id || ' period ' || d1.period_start || '..'
           || d1.period_end || ' overlaps settlement ' || d2.id,
         extract(day from now() - d1.created_at)::int
    from public.driver_settlements d1
    join public.driver_settlements d2
      on d2.driver_id = d1.driver_id
     and d2.id > d1.id
     and d1.period_start <= d2.period_end
     and d2.period_start <= d1.period_end;

  -- h. captured funds on a cancelled/rejected order — NOT in the spec's seven,
  --    added because the proof pack's delayed-webhook scenario produces it
  --    legally: reconcile_stale_card_orders cancels a stale checkout
  --    (payment_status='failed'), then the late Paymob webhook settles it to
  --    'paid' — CORRECTLY, the money moved at the provider. The result is a
  --    cancelled order holding captured funds, which needs a refund and matches
  --    none of the other classes (its provider txn IS consistent).
  return query
  select 'card_captured_but_cancelled'::text, o.id, o.short_code, o.payment_method,
         o.total_egp, o.paymob_txn_id, null::uuid, null::uuid,
         'order is ' || o.status || ' but holds captured card funds — needs a refund',
         extract(day from now() - o.placed_at)::int
    from public.orders o
   where o.placed_at >= v_since
     and o.payment_method = 'card'
     and o.payment_status = 'paid'
     and o.status in ('cancelled', 'rejected')
     and not exists (select 1 from public.order_refunds r
                      where r.order_id = o.id and r.status in ('requested', 'succeeded'));

  -- g. finance-repair item still open (mig 135's unbilled-revenue queue)
  return query
  select 'finance_repair_open'::text, f.order_id, o.short_code, o.payment_method,
         o.total_egp, null::text, null::uuid, null::uuid,
         'order_financials snapshot failed (' || coalesce(f.sqlstate, '?') || ': '
           || coalesce(f.message, 'no message') || ') and is unrepaired — this is unbilled revenue',
         extract(day from now() - f.failed_at)::int
    from public.order_financials_failures f
    left join public.orders o on o.id = f.order_id
   where f.resolved_at is null;
end;
$$;

-- Executable by NOBODY client-side; both callers reach it as the function owner.
revoke all on function public.payment_reconciliation_findings(int)
  from public, anon, authenticated;

comment on function public.payment_reconciliation_findings(int) is
  'Package 04 Slice A detector: eight money-path mismatch classes as typed rows (provider REFERENCES only, never payloads). No client grant of any kind — reached definer-to-definer by payment_reconciliation_report (admin) and payment_reconciliation_sweep (cron). Mig 181.';

-- ---------------------------------------------------------------------------
-- 2. Admin export
-- ---------------------------------------------------------------------------
create or replace function public.payment_reconciliation_report(p_days int default 30)
returns table (
  mismatch_class text,
  order_id       uuid,
  short_code     text,
  payment_method text,
  amount_egp     int,
  provider_ref   text,
  settlement_id  uuid,
  ledger_id      uuid,
  detail         text,
  age_days       int
)
language plpgsql
stable
security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null
     or coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  return query select * from public.payment_reconciliation_findings(p_days);
end;
$$;

revoke all on function public.payment_reconciliation_report(int)
  from public, anon, authenticated;
grant execute on function public.payment_reconciliation_report(int) to authenticated;

comment on function public.payment_reconciliation_report(int) is
  'ADMIN ONLY (fail-closed role check): the Slice A reconciliation export — mismatch class, order, provider reference, amounts, settlement id, age in days. Carries provider references only; provider payloads, client secrets and checkout URLs are structurally excluded. Mig 181.';

-- ---------------------------------------------------------------------------
-- 3. Daily sweep — one alert PER CLASS, silent when clean
-- ---------------------------------------------------------------------------
create or replace function public.payment_reconciliation_sweep()
returns integer
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_total int := 0;
  v_line  text;
begin
  -- Aggregation IS the alert contract: the spec forbids one noisy alert per row.
  -- Each class contributes "class=count (worst Nd)"; a clean day sends nothing.
  select sum(n)::int,
         string_agg(mismatch_class || '=' || n || ' (worst ' || worst || 'd)',
                    ', ' order by n desc)
    into v_total, v_line
    from (
      select f.mismatch_class, count(*) as n, max(f.age_days) as worst
        from public.payment_reconciliation_findings(30) f
       group by f.mismatch_class
    ) agg;

  if coalesce(v_total, 0) > 0 then
    perform public.ops_alert(
      'PAYMENT RECONCILIATION: ' || v_total || ' mismatch(es) — ' || v_line
      || '. Details: payment_reconciliation_report() as admin.');
  end if;

  -- The count lands in cron.job_run_details, so an operator can tell "ran and
  -- found nothing" from "never ran" (same contract as the other sweeps).
  return coalesce(v_total, 0);
end;
$$;

-- Cron-only, same rationale as every other sweep: the revoke is required because
-- ALTER DEFAULT PRIVILEGES hands EXECUTE to PUBLIC on every new function.
revoke all on function public.payment_reconciliation_sweep()
  from public, anon, authenticated;

comment on function public.payment_reconciliation_sweep() is
  'Daily money-path reconciliation (Package 04 Slice A). Runs the eight-class detector over 30 days and sends ONE aggregated ops_alert (class=count, worst age) when anything is found; silent when clean. Cron-only as sharmeats-daily-payment-reconciliation; returns the finding count for cron.job_run_details. Mig 181.';

-- Scratch/local databases have no pg_cron; scheduling is conditional so the same
-- file runs everywhere. On prod the schema exists and the job is registered.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule(
      'sharmeats-daily-payment-reconciliation',
      '30 3 * * *',
      $job$select public.payment_reconciliation_sweep();$job$);
  end if;
end;
$$;
