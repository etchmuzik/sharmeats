-- 135_commission_snapshot_at_placement.sql
--
-- Three defects in snapshot_order_financials, all in the same body.
-- Body taken from migration 083 (the LATEST of three definitions: 062 -> 075 ->
-- 083), per house rule 2. Same trigger, same signature, no new overload.
--
-- ================= DEFECT 1: RETROACTIVE REPRICING =================
-- The trigger read restaurants.commission_pct LIVE at the 'delivered'
-- transition (083:32-33). The rate a merchant is billed was therefore whatever
-- the rate happened to be when the food arrived, not when the order was placed.
--
-- Consequences, in order of seriousness:
--   a) admin_set_commission (or the founding-rate expiry move to 15%) silently
--      reprices EVERY in-flight order. A founding merchant who accepted orders
--      at 12% is billed 15% on the ones still out for delivery.
--   b) The LOI and the published partner terms promise 12% for three months
--      from go-live. Billing 15% on an order placed inside that window is a
--      contract breach we would have no record of, because the snapshot stores
--      only the rate it used.
-- The table comment at 062:54 already states the intent -- "commission_pct is
-- frozen here so the nightly loyalty sweep rewriting restaurants.commission_pct
-- can never alter historic billing." Freezing at DELIVERY only half-achieves
-- that: it stops later rewrites mutating the row, but the window between
-- placement and delivery was still exposed.
--
-- FIX: resolve the rate as of orders.placed_at.
--   - orders.commission_pct_snapshot (new, nullable) is stamped by place_order
--     going forward -- authoritative, since it is written in the same
--     transaction that priced the order.
--   - When absent (every order already in flight when this migration applies),
--     fall back to the live restaurants.commission_pct, which is exactly
--     today's behaviour. No historical order changes billing as a result of
--     this migration.
--
-- ================= DEFECT 2: WRONG FALLBACK RATE =================
-- coalesce(v_rate, 12.0) (083:33). 12 is the FOUNDING rate; the standard rate
-- is 15 (docs/FINANCIALS.md:14-15). A NULL commission_pct therefore billed the
-- promotional rate by accident -- a silent 3pp revenue leak, and the wrong
-- direction for a default. restaurants.commission_pct is NOT NULL with default
-- 12.0 (006:47) so this should be unreachable; a defensive default that is
-- wrong is worse than no default, because it hides the anomaly it is masking.
-- FIX: fall back to platform_settings.standard_commission_pct (15), and log the
-- anomaly rather than absorbing it silently.
--
-- ================= DEFECT 3: BLANKET EXCEPTION SWALLOW =================
-- The body ended in `exception when others then return new` (083:63-64). Any
-- failure anywhere in the trigger was discarded and the delivery proceeded. Two
-- distinct silent-loss paths:
--   a) The order_financials INSERT fails -> the order is delivered with NO
--      financial record. Because the insert is `on conflict (order_id) do
--      nothing`, nothing will ever write it again. That order is invisible to
--      generate_settlements, settlement_sweep and platform_revenue_report
--      FOREVER -- unbilled commission, with no error and no way to detect it
--      except by reconciling delivered orders against order_financials by hand.
--   b) The SLA auto-credit fails -> the customer silently does not receive the
--      compensation the app publicly promises ("credited if 15+ minutes late").
--      That is the exact class of advertised-compensation gap the SLA engine was
--      built to close.
--
-- FIX: keep the trigger non-blocking (a failed snapshot must never roll back a
-- real delivery -- the food is already at the door), but make every failure
-- LOUD and RECOVERABLE:
--   - the financial snapshot is attempted first and its failure is recorded in
--     order_financials_failures for repair, then re-raised as a WARNING;
--   - the SLA credit is wrapped separately, so its failure can no longer
--     prevent the snapshot (previously an SLA failure aborted the whole block
--     AFTER the insert, which happened to be harmless only by statement order);
--   - both paths ops_alert() so a human finds out the same night.

-- ---------------------------------------------------------------------------
-- 1. Rate-as-of-placement: the snapshot column + the standard-rate setting
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists commission_pct_snapshot numeric(5,2);

comment on column public.orders.commission_pct_snapshot is
  'The merchant commission rate in force when this order was PLACED, stamped by place_order. NULL for orders placed before mig 135, which fall back to the live restaurants.commission_pct at delivery (the pre-135 behaviour). Authority for billing: snapshot_order_financials prefers this over the live rate so that changing a rate never reprices an in-flight order. Mig 135.';

-- No client may write it: it is billing authority. (RLS cannot restrict
-- columns, so this is enforced by the absence of a grant -- house rule 5.)
revoke update (commission_pct_snapshot) on public.orders from public, anon, authenticated;

insert into public.platform_settings (key, value)
values ('standard_commission_pct', to_jsonb(15))
on conflict (key) do nothing;

-- Repair queue for snapshots that could not be written. Deliberately outside
-- order_financials so a failure here can never contend with the money table.
create table if not exists public.order_financials_failures (
  order_id    uuid primary key references public.orders(id) on delete cascade,
  failed_at   timestamptz not null default now(),
  sqlstate    text,
  message     text,
  resolved_at timestamptz
);

comment on table public.order_financials_failures is
  'Orders that reached delivered but whose order_financials snapshot raised. Because the snapshot insert is on-conflict-do-nothing and the trigger fires only on the delivered transition, a failure here is otherwise UNRECOVERABLE and the order is invisible to every settlement and revenue report. Any unresolved row is unbilled revenue -- the weekly digest should surface it. Mig 135.';

alter table public.order_financials_failures enable row level security;
-- No policies: RLS-on with zero policies denies all client access. The trigger
-- writes as definer; admins read via SQL or a future ops screen.

-- ---------------------------------------------------------------------------
-- 2. place_order: stamp the rate at placement
-- ---------------------------------------------------------------------------
-- place_order is defined 14 times across the history; the current body is
-- migration 096. Rather than restate 200+ lines of pricing logic here (and risk
-- reverting later hardening -- the exact failure house rule 2 forbids), stamp
-- the column with a BEFORE INSERT trigger. Same transaction, same effect,
-- no risk to the pricing path.
create or replace function public.stamp_order_commission_pct()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $function$
begin
  if new.commission_pct_snapshot is null then
    select commission_pct into new.commission_pct_snapshot
      from public.restaurants where id = new.restaurant_id;
  end if;
  return new;
end;
$function$;

revoke all on function public.stamp_order_commission_pct() from public, anon, authenticated;

comment on function public.stamp_order_commission_pct() is
  'BEFORE INSERT on orders: freeze the merchant commission rate as of placement. Implemented as a trigger rather than editing place_order because place_order has 14 historical definitions and re-stating its body risks reverting later hardening (house rule 2). Mig 135.';

drop trigger if exists trg_stamp_order_commission_pct on public.orders;
create trigger trg_stamp_order_commission_pct
  before insert on public.orders
  for each row execute function public.stamp_order_commission_pct();

-- ---------------------------------------------------------------------------
-- 3. snapshot_order_financials — rate-as-of-placement, honest default, loud
--    failures. Body from 083:24-66, with the three fixes applied.
-- ---------------------------------------------------------------------------
create or replace function public.snapshot_order_financials()
returns trigger
language plpgsql
security definer set search_path to 'public','pg_temp'
as $function$
declare
  v_rate numeric(5,2); v_vat_pct int; v_commission int; v_grace int;
  v_pct int; v_max int; v_late_min numeric; v_credit int;
  v_standard numeric(5,2);
begin
  if new.status <> 'delivered' or old.status = 'delivered' then return new; end if;

  -- DEFECT 1: prefer the rate frozen at placement; fall back to the live rate
  -- for orders placed before mig 135 (identical to the old behaviour).
  v_rate := new.commission_pct_snapshot;
  if v_rate is null then
    select commission_pct into v_rate from public.restaurants where id = new.restaurant_id;
  end if;

  -- DEFECT 2: fall back to the STANDARD rate (15), never the founding rate.
  if v_rate is null then
    select coalesce((value #>> '{}')::numeric, 15) into v_standard
      from public.platform_settings where key = 'standard_commission_pct';
    v_rate := coalesce(v_standard, 15);
    -- Unreachable given restaurants.commission_pct is NOT NULL -- so if it
    -- happens, say so rather than silently billing a guess.
    begin
      perform public.ops_alert(
        'commission rate missing for order ' || new.id::text ||
        ' (restaurant ' || new.restaurant_id::text || ') — billed at standard ' || v_rate::text || '%');
    exception when others then null;
    end;
  end if;

  v_commission := floor(coalesce(new.subtotal_egp, 0) * v_rate / 100.0)::int;
  select coalesce((value #>> '{}')::int, 0) into v_vat_pct
    from public.platform_settings where key = 'commission_vat_pct';

  -- DEFECT 3a: the money snapshot gets its own handler. A failure is recorded
  -- for repair and raised as a WARNING -- never silently dropped. The delivery
  -- itself still succeeds: the food is at the door and refusing the status
  -- transition would strand a completed order.
  begin
    insert into public.order_financials (
      order_id, restaurant_id, subtotal_egp, discount_egp, commission_pct, commission_egp,
      commission_vat_egp, delivery_fee_egp, payment_method, delivered_at
    ) values (
      new.id, new.restaurant_id, coalesce(new.subtotal_egp, 0), coalesce(new.discount_egp, 0),
      v_rate, v_commission,
      floor(v_commission * coalesce(v_vat_pct,0) / 100.0)::int,
      coalesce(new.delivery_fee_egp, 0), new.payment_method,
      coalesce(new.delivered_at, now())
    ) on conflict (order_id) do nothing;
  exception when others then
    begin
      insert into public.order_financials_failures (order_id, sqlstate, message)
      values (new.id, sqlstate, sqlerrm)
      on conflict (order_id) do update
        set failed_at = now(), sqlstate = excluded.sqlstate, message = excluded.message;
      perform public.ops_alert('UNBILLED ORDER ' || new.id::text ||
        ' — order_financials snapshot failed: ' || sqlerrm);
    exception when others then null;
    end;
    raise warning 'snapshot_order_financials: order % not billed (%): %', new.id, sqlstate, sqlerrm;
  end;

  -- DEFECT 3b: the SLA credit gets its own handler, so its failure can neither
  -- abort the snapshot above nor vanish. The published promise is
  -- "credited if 15+ minutes late" — a silent miss is a broken promise.
  begin
    select coalesce((value #>> '{}')::int, 15)  into v_grace from public.platform_settings where key = 'sla_credit_grace_minutes';
    select coalesce((value #>> '{}')::int, 10)  into v_pct   from public.platform_settings where key = 'sla_credit_pct';
    select coalesce((value #>> '{}')::int, 100) into v_max   from public.platform_settings where key = 'sla_credit_max_egp';

    if new.eta_at is not null then
      v_late_min := extract(epoch from (coalesce(new.delivered_at, now()) - new.eta_at)) / 60.0;
      if v_late_min > v_grace then
        v_credit := least(v_max, floor(coalesce(new.subtotal_egp, 0) * v_pct / 100.0)::int);
        if v_credit > 0 then
          begin
            perform public.issue_credit(new.user_id, v_credit, 'sla_late', new.id,
              'Auto late credit: ' || round(v_late_min)::text || ' min late');
          exception when unique_violation then null;  -- one credit per order (062:83-85)
          end;
        end if;
      end if;
    end if;
  exception when others then
    begin
      perform public.ops_alert('SLA credit FAILED for late order ' || new.id::text || ': ' || sqlerrm);
    exception when others then null;
    end;
    raise warning 'snapshot_order_financials: SLA credit failed for order %: %', new.id, sqlerrm;
  end;

  return new;
end;
$function$;

revoke all on function public.snapshot_order_financials() from public, anon, authenticated;

comment on function public.snapshot_order_financials() is
  'On the delivered transition: freeze per-order economics into order_financials and issue the automatic SLA late credit. Commission is resolved as of PLACEMENT (orders.commission_pct_snapshot), so changing a merchant rate never reprices an in-flight order; falls back to the live rate for pre-135 orders, then to platform_settings.standard_commission_pct (15) with an ops alert. Snapshot and SLA credit have SEPARATE exception handlers: neither can silently swallow the other, failures land in order_financials_failures / ops_alert, and a failure never blocks the delivery. Migs 062, 075, 083, 135.';
