-- 074_restaurant_settlement.sql
-- Restaurant settlement / payout system (P1 from the 2026-07-03 gap analysis).
-- Builds directly on order_financials (mig 062): now that every delivered order
-- has a frozen commission snapshot, we can aggregate them into weekly statements
-- and record payouts — fulfilling the LOI's "weekly Sunday bank transfer".
--
-- THE MONEY FLOW (why the sign of the settlement differs by payment method):
--   COD order  — the driver collected the full total in cash. The restaurant's
--     food money is in that cash; the platform is OWED its commission but the
--     restaurant already effectively holds subtotal (via the driver hand-off /
--     the restaurant's own reconciliation). Net platform position on a COD order
--     is +commission (a RECEIVABLE from the merchant).
--   Card order — the platform received the full amount via Paymob. The platform
--     OWES the restaurant (subtotal − commission) and owes the driver their fee+
--     tips. Net platform position is a PAYABLE to the merchant of subtotal−commission.
--
-- A statement therefore reports, per restaurant per period:
--   gross_sales  = sum(subtotal)         (food revenue the restaurant generated)
--   commission   = sum(commission_egp)   (what the platform earned)
--   cod_sales    = sum(subtotal) on COD  (restaurant already holds this in cash)
--   card_sales   = sum(subtotal) on card (platform holds this, owes it out)
--   net_payable  = card_sales − commission_on_card − (commission_on_cod owed back)
--               simplified: card_subtotal − total_commission  (what we transfer)
--     i.e. we pay the restaurant its card food sales minus ALL commission (COD +
--     card), because COD commission is netted out of the money we owe them on card.
--     If net_payable is negative (mostly-COD week), the restaurant OWES the
--     platform that amount (a receivable we collect at reconciliation).
--
-- Non-destructive: new tables + RPCs + RLS. Idempotent.

-- ============================================================================
-- restaurant_settlements — one row per restaurant per payout period.
-- ============================================================================
create table if not exists public.restaurant_settlements (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid not null references public.restaurants(id) on delete cascade,
  period_start      date not null,                 -- inclusive
  period_end        date not null,                 -- inclusive
  order_count       int  not null default 0,
  gross_sales_egp   int  not null default 0,        -- sum(subtotal) all orders
  cod_sales_egp     int  not null default 0,        -- sum(subtotal) COD orders
  card_sales_egp    int  not null default 0,        -- sum(subtotal) card orders
  commission_egp    int  not null default 0,        -- sum(commission) all orders
  net_payable_egp   int  not null default 0,        -- card_sales − total commission (see header)
  status            text not null default 'draft'   -- draft | finalized | paid
                      check (status in ('draft','finalized','paid')),
  paid_at           timestamptz,
  paid_reference    text,                            -- bank transfer ref, set on mark-paid
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (restaurant_id, period_start, period_end)
);
create index if not exists restaurant_settlements_rest_idx
  on public.restaurant_settlements (restaurant_id, period_start desc);

comment on table public.restaurant_settlements is
  'Per-restaurant per-period payout statement, aggregated from order_financials. net_payable_egp = card food sales minus all commission (COD commission netted out). Fulfills the LOI weekly Sunday payout. draft -> finalized -> paid.';

alter table public.restaurant_settlements enable row level security;
-- Restaurants read their own statements; admins read/manage all. No client writes.
create policy restaurant_settlements_select on public.restaurant_settlements
  for select using (
    public.auth_role() = 'admin'
    or public.is_merchant_staff(restaurant_id)
  );

-- ============================================================================
-- generate_settlements — ADMIN builds/refreshes draft statements for a period
-- from order_financials. Idempotent per (restaurant, period): recomputes and
-- upserts a draft row per restaurant that had delivered orders in the window.
-- Never touches already-'paid' rows.
-- ============================================================================
create or replace function public.generate_settlements(p_period_start date, p_period_end date)
returns int
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare v_count int := 0;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;
  if coalesce(public.auth_role()::text,'') <> 'admin' then raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation'; end if;
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'INVALID_PERIOD' using errcode = 'check_violation';
  end if;

  with agg as (
    select
      f.restaurant_id,
      count(*)                                                          as order_count,
      sum(f.subtotal_egp)                                              as gross_sales,
      sum(f.subtotal_egp) filter (where f.payment_method = 'cash_on_delivery') as cod_sales,
      sum(f.subtotal_egp) filter (where f.payment_method <> 'cash_on_delivery') as card_sales,
      sum(f.commission_egp)                                            as commission
    from public.order_financials f
    where f.delivered_at::date between p_period_start and p_period_end
    group by f.restaurant_id
  )
  insert into public.restaurant_settlements (
    restaurant_id, period_start, period_end, order_count,
    gross_sales_egp, cod_sales_egp, card_sales_egp, commission_egp, net_payable_egp, status
  )
  select
    a.restaurant_id, p_period_start, p_period_end, a.order_count,
    a.gross_sales, coalesce(a.cod_sales,0), coalesce(a.card_sales,0), a.commission,
    coalesce(a.card_sales,0) - a.commission,   -- net payable (see header math)
    'draft'
  from agg a
  on conflict (restaurant_id, period_start, period_end) do update set
    order_count     = excluded.order_count,
    gross_sales_egp = excluded.gross_sales_egp,
    cod_sales_egp   = excluded.cod_sales_egp,
    card_sales_egp  = excluded.card_sales_egp,
    commission_egp  = excluded.commission_egp,
    net_payable_egp = excluded.net_payable_egp,
    updated_at      = now()
  where public.restaurant_settlements.status <> 'paid';  -- never rewrite a paid statement

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.generate_settlements(date, date) from public, anon;
grant execute on function public.generate_settlements(date, date) to authenticated;

comment on function public.generate_settlements is
  'ADMIN: (re)build draft settlement rows for a period from order_financials. Idempotent; skips paid rows. Returns rows written.';

-- ============================================================================
-- finalize_settlement / mark_settlement_paid — ADMIN state transitions.
-- ============================================================================
create or replace function public.finalize_settlement(p_settlement_id uuid)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if coalesce(public.auth_role()::text,'') <> 'admin' then raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation'; end if;
  update public.restaurant_settlements
     set status = 'finalized', updated_at = now()
   where id = p_settlement_id and status = 'draft';
  if not found then raise exception 'NOT_DRAFT_OR_MISSING' using errcode = 'check_violation'; end if;
end;
$$;
revoke all on function public.finalize_settlement(uuid) from public, anon;
grant execute on function public.finalize_settlement(uuid) to authenticated;

create or replace function public.mark_settlement_paid(p_settlement_id uuid, p_reference text)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if coalesce(public.auth_role()::text,'') <> 'admin' then raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation'; end if;
  update public.restaurant_settlements
     set status = 'paid', paid_at = now(), paid_reference = nullif(btrim(coalesce(p_reference,'')), ''), updated_at = now()
   where id = p_settlement_id and status = 'finalized';
  if not found then raise exception 'NOT_FINALIZED_OR_MISSING' using errcode = 'check_violation'; end if;
end;
$$;
revoke all on function public.mark_settlement_paid(uuid, text) from public, anon;
grant execute on function public.mark_settlement_paid(uuid, text) to authenticated;

comment on function public.mark_settlement_paid is
  'ADMIN: mark a finalized settlement paid with a bank-transfer reference. draft->finalized->paid is the only forward path.';

-- ============================================================================
-- my_restaurant_settlements — a merchant reads their own statements.
-- ============================================================================
create or replace function public.my_restaurant_settlements(p_limit int default 12)
returns setof public.restaurant_settlements
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select s.* from public.restaurant_settlements s
   where public.is_merchant_staff(s.restaurant_id)
   order by s.period_start desc
   limit greatest(1, least(coalesce(p_limit,12), 100));
$$;
grant execute on function public.my_restaurant_settlements(int) to authenticated;

comment on function public.my_restaurant_settlements is
  'A merchant staffer reads their own restaurant''s settlement statements, newest first.';
