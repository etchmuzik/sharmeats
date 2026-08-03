-- 213_reconciliation_test_order_exclusions.sql
--
-- Silence the nightly "PAYMENT RECONCILIATION: 10 mismatch(es)" alert the
-- honest way: by recording a human decision, not by inventing money.
--
-- THE TEN ROWS. The 03:30 sweep fired identically on 2026-08-02 and -03:
-- ten cod_delivered_uncollected findings, unchanged night to night, on a
-- platform whose daily digest says "no orders". They are:
--
--   DEMO01..DEMO03            the Apple App Review demo orders (mig 204)
--   SE-SQVPZ3 SE-BXFPXG       dev-era COD test deliveries, oldest 29 days
--   SE-39QE4G SE-YHTS25
--   SE-65GV3R SE-NKM4FD
--   SE-EWCFFP
--
-- The owner confirmed all ten as test orders on 2026-08-03 ("they are test
-- orders, clear them"). No cash was ever handed to a driver, so there is
-- nothing to collect and nothing to settle.
--
-- AN ELEVENTH, FOUND BY THE DRY RUN: SE-JYB4XV — same class, same dev era
-- (32 days old, 75 EGP), sitting just outside the sweep's 30-day window,
-- which is why the nightly alert said ten. It alerted nightly until the
-- window slid past it and would have been the mystery row of some future
-- widened report. Included as part of the same owner-confirmed test batch;
-- if that call is wrong, one DELETE from the exclusions table un-hides it.
--
-- WHY AN EXCLUSIONS TABLE AND NOT driver_cash_ledger ROWS. Migration 204 set
-- the precedent when it backfilled the demo orders' financials: writing
-- collection rows for cash that never existed "would be inventing money".
-- A cod_collected row is an input to driver settlement math; fabricating ten
-- of them converts a cosmetic alert into a real accounting error. An
-- exclusion row states the truth instead: a named human decided this order is
-- outside reconciliation, on this date, for this reason. An alert that fires
-- nightly about rows nobody will ever action is not vigilance — it is
-- wallpaper, and wallpaper is how the one real mismatch gets ignored (the
-- stale_offer repeat taught this already).
--
-- MECHANISM: one edit point. The detector body is carried VERBATIM from
-- prod's current prosrc (rule 2 — prod matches repo mig 181 today, verified
-- before writing this) into payment_reconciliation_findings_raw(). The
-- public-facing payment_reconciliation_findings() keeps its EXACT signature
-- (rule 1 — same name, same p_days int default 30, so this replaces rather
-- than overloads) and becomes a three-line filter over raw. Settlement-class
-- rows carry order_id null and pass through untouched — exclusions are
-- per-order only. Both consumers (admin report, 03:30 sweep) call findings()
-- and inherit the filter automatically.
--
-- FOR THE NEXT EDITOR: the detector now lives in _raw. If you re-apply an
-- old copy of findings() from mig 181 you will silently delete the exclusion
-- filter — which is exactly why the house rules say to start from prod's
-- prosrc, where this split is visible.

-- ---------------------------------------------------------------------------
-- 1. The decision record (rule 5b: revoke BEFORE real grants; TRUNCATE
--    ignores RLS, and ALTER DEFAULT PRIVILEGES grants arwdDxtm to anon/
--    authenticated on every new table on this database).
-- ---------------------------------------------------------------------------
create table if not exists public.payment_reconciliation_exclusions (
  order_id    uuid primary key references public.orders(id) on delete cascade,
  reason      text not null,
  excluded_by text not null default 'owner',
  created_at  timestamptz not null default now()
);

revoke all on table public.payment_reconciliation_exclusions
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.payment_reconciliation_exclusions to service_role;

alter table public.payment_reconciliation_exclusions enable row level security;
-- No policies: service_role bypasses RLS, everyone else is denied. Adding an
-- exclusion is an operator act (SQL as service_role or a migration), never an
-- app feature — an RPC for this would be a lever for hiding real mismatches.

comment on table public.payment_reconciliation_exclusions is
  'Orders a human has ruled OUT of payment reconciliation, with who and why. This is the honest alternative to fabricating money rows: an excluded order stays visibly excluded here, while a fake cod_collected row would poison driver settlement math. Seeded by mig 213 with the eleven owner-confirmed test orders (ten alerting nightly, one aged just past the sweep window) — un-exclude with a plain DELETE.';

-- ---------------------------------------------------------------------------
-- 2. The detector, verbatim, under a new name.
-- ---------------------------------------------------------------------------
create or replace function public.payment_reconciliation_findings_raw(p_days integer default 30)
returns table(mismatch_class text, order_id uuid, short_code text, payment_method text,
              amount_egp integer, provider_ref text, settlement_id uuid, ledger_id uuid,
              detail text, age_days integer)
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_days int := least(greatest(coalesce(p_days, 30), 1), 365);
  v_since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365));
  v_refund_sla_h int := coalesce(
    (select (value #>> '{}')::int from public.platform_settings where key = 'refund_sla_hours'), 48);
begin
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
  --    because the order-to-settlement link is a date window, not a foreign key.
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

  -- h. captured funds on a cancelled/rejected order (delayed webhook after local
  --    cancel) — found while building the proof pack; not in the spec's seven.
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
$function$;

revoke all on function public.payment_reconciliation_findings_raw(integer)
  from public, anon, authenticated;

comment on function public.payment_reconciliation_findings_raw(integer) is
  'The unfiltered eight-class detector, verbatim from what was payment_reconciliation_findings before mig 213. No client grant of any kind; reached definer-to-definer. Edit the detector HERE — findings() is only the exclusion filter over this.';

-- ---------------------------------------------------------------------------
-- 3. findings() keeps its exact signature and becomes the filter.
-- ---------------------------------------------------------------------------
create or replace function public.payment_reconciliation_findings(p_days integer default 30)
returns table(mismatch_class text, order_id uuid, short_code text, payment_method text,
              amount_egp integer, provider_ref text, settlement_id uuid, ledger_id uuid,
              detail text, age_days integer)
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select f.*
    from public.payment_reconciliation_findings_raw(p_days) f
   where f.order_id is null   -- settlement-class rows are never excluded
      or not exists (select 1
                       from public.payment_reconciliation_exclusions e
                      where e.order_id = f.order_id);
$function$;

revoke all on function public.payment_reconciliation_findings(integer)
  from public, anon, authenticated;

comment on function public.payment_reconciliation_findings(integer) is
  'Detector output minus payment_reconciliation_exclusions (per-order human rulings; settlement-class rows pass through). The detector body itself lives in payment_reconciliation_findings_raw since mig 213 — edit it there, and do not re-apply a pre-213 copy of this function or the exclusion filter silently disappears. No client grant of any kind; reached definer-to-definer by payment_reconciliation_report (admin) and payment_reconciliation_sweep (cron).';

-- ---------------------------------------------------------------------------
-- 4. Seed the ten owner-confirmed test orders, and prove the result.
-- ---------------------------------------------------------------------------
insert into public.payment_reconciliation_exclusions (order_id, reason, excluded_by)
select o.id,
       'test order — owner-confirmed 2026-08-03 (SE-JYB4XV included as part of the same batch, found by the dry run just outside the 30-day sweep window); dev-era COD test delivery or App Review demo. No cash ever existed to collect (mig 204 precedent: do not invent money for demo orders).',
       'owner (via Claude Code session, mig 213)'
  from public.orders o
 where o.short_code in ('DEMO01','DEMO02','DEMO03',
                        'SE-SQVPZ3','SE-BXFPXG','SE-39QE4G','SE-YHTS25',
                        'SE-65GV3R','SE-NKM4FD','SE-EWCFFP','SE-JYB4XV')
on conflict (order_id) do nothing;

do $$
declare
  v_seeded int;
  v_leaking int;
  v_overloads int;
begin
  select count(*) into v_seeded
    from public.payment_reconciliation_exclusions e
    join public.orders o on o.id = e.order_id
   where o.short_code in ('DEMO01','DEMO02','DEMO03',
                          'SE-SQVPZ3','SE-BXFPXG','SE-39QE4G','SE-YHTS25',
                          'SE-65GV3R','SE-NKM4FD','SE-EWCFFP','SE-JYB4XV');
  if v_seeded <> 11 then
    raise exception '[213] expected exactly 11 excluded test orders, found % — a short_code did not match; investigate before applying', v_seeded;
  end if;

  -- The point of the migration, asserted: none of the ten can reach an alert.
  select count(*) into v_leaking
    from public.payment_reconciliation_findings(365) f
   where f.order_id in (select order_id from public.payment_reconciliation_exclusions);
  if v_leaking <> 0 then
    raise exception '[213] % excluded orders still appear in findings — filter is not effective', v_leaking;
  end if;

  -- Rule 1: replacing, not overloading — for both names.
  select count(*) into v_overloads
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('payment_reconciliation_findings', 'payment_reconciliation_findings_raw');
  if v_overloads <> 2 then
    raise exception '[213] expected exactly 2 functions (findings + raw), found % — an overload slipped in', v_overloads;
  end if;
end;
$$;
