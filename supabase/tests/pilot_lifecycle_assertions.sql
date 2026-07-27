-- Pilot lifecycle postconditions (package 01 §2).
--
-- READ-ONLY. This file contains no INSERT, UPDATE, DELETE or DDL, and must
-- never acquire any. Its whole purpose is to check a lifecycle that was driven
-- through the real RPCs and the real apps. A "pass" manufactured by writing
-- rows directly proves nothing about the code paths an operator actually uses,
-- and would be worse than no test at all -- it would certify a broken system.
--
-- USAGE
--   psql "$PROD_URI" -v order_id="'<uuid>'" -f supabase/tests/pilot_lifecycle_assertions.sql
--
-- Safe against production because it only reads. Run it after each scenario in
-- docs/PILOT-LIFECYCLE-TEST.md.
--
-- Every column name here was verified against the live schema on 2026-07-27.

\set ON_ERROR_STOP on
\timing off

\if :{?order_id}
\else
  \echo 'ERROR: pass the order under test, e.g. -v order_id="''<uuid>''"'
  \quit 1
\endif

\echo ''
\echo '=== Sharm Eats pilot lifecycle assertions ==='

-- psql does NOT substitute :variables inside a dollar-quoted body -- the body is
-- opaque to it, so `:order_id` reached the server literally and raised a syntax
-- error. The id is handed to the block through a session GUC set out here,
-- where substitution does happen.
select set_config('sharmeats.drill_order_id', :order_id, false) as _configured \gset

do $$
declare
  v_oid     uuid := current_setting('sharmeats.drill_order_id')::uuid;
  v_order   record;
  v_fail    text[] := '{}';
  v_warn    text[] := '{}';
  v_n       int;
  v_terminal text;
begin
  select * into v_order from public.orders where id = v_oid;
  if v_order.id is null then
    raise exception 'order % not found', v_oid;
  end if;

  v_terminal := v_order.status;

  -- 1. TERMINAL STATUS ----------------------------------------------------
  -- A pilot run must end somewhere final. An order parked in a working state
  -- is the single most common real failure (a stuck order nobody noticed), so
  -- it is checked first and explicitly.
  if v_terminal not in ('delivered', 'cancelled', 'rejected') then
    v_fail := v_fail || format(
      'order is in non-terminal status %L -- the run did not finish (or is stuck)', v_terminal);
  end if;

  -- 2. EVENT CHAIN --------------------------------------------------------
  -- advance_order_status is the only writer of orders.status, so every
  -- transition must have left a row. A terminal order with no event history
  -- means something wrote status directly, which is the failure mode the
  -- whole authority design exists to prevent.
  select count(*) into v_n
    from public.order_status_events where order_id = v_order.id;
  if v_n = 0 then
    v_fail := v_fail || ('no order_status_events rows -- status was changed outside advance_order_status')::text;
  end if;

  -- The terminal status must be the LAST recorded event, not merely present:
  -- orders.status and the newest event disagreeing means one of the two writers
  -- is lying about where the order actually is.
  declare
    v_last_event text;
  begin
    select status into v_last_event
      from public.order_status_events
     where order_id = v_order.id
     order by created_at desc, id desc
     limit 1;

    if v_last_event is not null and v_last_event is distinct from v_terminal then
      v_fail := v_fail || format(
        'orders.status is %L but the newest status event is %L -- they disagree',
        v_terminal, v_last_event);
    end if;
  end;

  -- A delivered order must have passed through the states that make delivery
  -- physically possible. Missing 'accepted' means it was never confirmed by a
  -- merchant.
  if v_terminal = 'delivered' then
    if not exists (select 1 from public.order_status_events
                    where order_id = v_order.id and status = 'accepted') then
      v_fail := v_fail || ('delivered order has no accepted event')::text;
    end if;
    if v_order.delivered_at is null then
      v_fail := v_fail || ('delivered order has a NULL delivered_at')::text;
    end if;
  end if;

  -- 3. FINANCIAL SNAPSHOT -------------------------------------------------
  -- Exactly one row per delivered order. Zero means revenue is invisible to
  -- settlement; more than one would double-count it.
  if v_terminal = 'delivered' then
    select count(*) into v_n
      from public.order_financials where order_id = v_order.id;
    if v_n <> 1 then
      v_fail := v_fail || format('delivered order has %s order_financials rows (expected exactly 1)', v_n);
    end if;

    -- Commission must be snapshotted at placement (mig 135), not recomputed
    -- later from a rate that may since have changed.
    if v_order.commission_pct_snapshot is null then
      v_warn := v_warn || ('commission_pct_snapshot is NULL -- order predates mig 135 or the snapshot did not run')::text;
    end if;

    -- The snapshot must agree with what was actually charged.
    if exists (
      select 1 from public.order_financials f
       where f.order_id = v_order.id
         and f.subtotal_egp is distinct from v_order.subtotal_egp
    ) then
      v_fail := v_fail || ('order_financials.subtotal_egp disagrees with orders.subtotal_egp')::text;
    end if;
  end if;

  -- 4. NO UNRESOLVED FINANCE REPAIR ROW -----------------------------------
  -- order_financials_failures is the queue for snapshots that threw. An
  -- unresolved row means money was NOT recorded and nobody has fixed it.
  if exists (
    select 1 from public.order_financials_failures
     where order_id = v_order.id and resolved_at is null
  ) then
    v_fail := v_fail || ('an UNRESOLVED order_financials_failures row exists for this order')::text;
  end if;

  -- 5. COD CASH LEDGER ----------------------------------------------------
  -- A delivered cash order must have created exactly one collection entry. If
  -- it did not, the driver is holding money the platform has no record of --
  -- the reconciliation gap that makes cash operations unauditable.
  -- Literals verified against production 2026-07-27: orders.payment_method is
  -- 'cash_on_delivery' (NOT 'cash') and the ledger reason is 'cod_collected'
  -- (NOT 'collection'). Both were guessed wrong on the first draft, and a
  -- mismatched literal here does not error -- the branch simply never runs, so
  -- the check silently passes forever. That is worse than having no check.
  if v_terminal = 'delivered' and v_order.payment_method = 'cash_on_delivery' then
    select count(*) into v_n
      from public.driver_cash_ledger
     where ref_order_id = v_order.id and reason = 'cod_collected';
    if v_n <> 1 then
      v_fail := v_fail || format(
        'delivered COD order has %s driver_cash_ledger cod_collected rows (expected exactly 1)', v_n);
    end if;
  end if;

  -- A cancelled/rejected order must NOT have collected cash.
  if v_terminal in ('cancelled', 'rejected') then
    if exists (select 1 from public.driver_cash_ledger
                where ref_order_id = v_order.id and reason = 'cod_collected') then
      v_fail := v_fail || ('a cancelled/rejected order has a cash cod_collected row')::text;
    end if;
  end if;

  -- 6. CREDIT RECONCILES --------------------------------------------------
  -- Credit issued against this order must be non-negative in aggregate and
  -- must not exceed what the customer actually paid. Refunding more than was
  -- charged is the money bug worth failing a pilot over.
  select coalesce(sum(delta_egp), 0) into v_n
    from public.credit_ledger where ref_order_id = v_order.id and delta_egp > 0;
  if v_n > coalesce(v_order.total_egp, 0) then
    v_fail := v_fail || format(
      'credit issued against this order (%s EGP) exceeds the order total (%s EGP)',
      v_n, v_order.total_egp);
  end if;

  -- 7. NO IMPOSSIBLE ACTIVE OFFER -----------------------------------------
  -- A finished order must not still be OFFERED to a driver: the driver app
  -- would show a job that cannot be completed.
  --
  -- 'accepted' is deliberately NOT failed here. Checking production on
  -- 2026-07-27 showed all 9 accepted assignments sit on finished orders --
  -- accepted is where a COMPLETED assignment rests; nothing moves it to a
  -- separate done state. The first draft failed on it and would therefore have
  -- failed every correct pilot run forever, which is how a test pack teaches
  -- operators to ignore it.
  select count(*) into v_n
    from public.order_assignments
   where order_id = v_order.id and status = 'offered';
  if v_n > 0 then
    v_fail := v_fail || format(
      '%s assignment(s) still OFFERED on a %s order -- a driver can see an impossible job',
      v_n, v_terminal);
  end if;

  -- 8. SETTLEMENT INCLUSION ----------------------------------------------
  -- Informational: settlements run weekly, so a fresh order legitimately has
  -- none yet. Reported, never failed -- a check that fails for a correct
  -- system trains operators to ignore it.
  if v_terminal = 'delivered' then
    select count(*) into v_n
      from public.restaurant_settlements s
     where s.restaurant_id = v_order.restaurant_id
       and v_order.delivered_at::date between s.period_start and s.period_end;
    if v_n = 0 then
      v_warn := v_warn || ('not yet covered by a settlement period (expected until the weekly run)')::text;
    end if;
  end if;

  -- REPORT ----------------------------------------------------------------
  if array_length(v_warn, 1) > 0 then
    raise notice E'NOTES:\n  - %', array_to_string(v_warn, E'\n  - ');
  end if;

  if array_length(v_fail, 1) > 0 then
    raise exception E'LIFECYCLE ASSERTIONS FAILED for order % (%):\n  - %',
      v_oid, array_length(v_fail, 1), array_to_string(v_fail, E'\n  - ');
  end if;

  raise notice 'LIFECYCLE ASSERTIONS PASSED for order % (terminal: %)', v_oid, v_terminal;
end $$;

-- Operator-readable summary of what was just asserted.
select
  o.short_code,
  o.status,
  o.payment_method,
  o.total_egp,
  (select count(*) from public.order_status_events e where e.order_id = o.id) as status_events,
  (select count(*) from public.order_financials f where f.order_id = o.id)    as financial_rows,
  (select count(*) from public.driver_cash_ledger c
     where c.ref_order_id = o.id and c.reason = 'cod_collected')              as cash_collections,
  (select coalesce(sum(c.delta_egp), 0) from public.credit_ledger c
     where c.ref_order_id = o.id and c.delta_egp > 0)                         as credit_issued_egp
from public.orders o
where o.id = :order_id;
