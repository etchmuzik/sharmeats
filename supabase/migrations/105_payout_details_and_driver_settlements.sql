-- 105 — payout details capture + driver settlements (P0 #1 buildable half, 2026-07-11 gap analysis).
--
-- GAP: restaurant_settlements (mig 074) computes net_payable but there is (a) NO
-- bank/payout-detail capture anywhere in the schema, so "mark paid" is a free-text
-- honor-system flag with no destination on record, and (b) NO driver-side settlement
-- analog at all — driver_earnings accrues per delivery but nothing aggregates it into
-- a payable statement. This migration builds the buildable half of the payout rail:
-- payout-detail columns + a driver_settlements system mirroring the restaurant one.
-- The ACTUAL bank/Instapay transfer integration remains owner-gated (needs a provider
-- account); this makes the platform able to record WHERE money goes and WHAT is owed
-- to each driver, which is the prerequisite for any transfer rail.
-- Non-destructive: new columns + table + RPCs + RLS + cron.

-- ============================================================================
-- Payout-detail capture. Stored on the entity; only the owner (merchant staff /
-- the driver) and admin can see/set them. Kept minimal + non-sensitive-by-design
-- (bank name + IBAN/wallet handle + account holder). No secrets; IBAN is not a
-- credential. Wallet handle covers Instapay / mobile-wallet payouts common in EG.
-- ============================================================================
alter table public.drivers
  add column if not exists payout_method   text,   -- 'bank' | 'instapay' | 'wallet' | null
  add column if not exists payout_bank_name text,
  add column if not exists payout_iban      text,
  add column if not exists payout_wallet    text,   -- Instapay address / mobile-wallet number
  add column if not exists payout_holder    text;   -- account holder name

alter table public.restaurants
  add column if not exists payout_method   text,
  add column if not exists payout_bank_name text,
  add column if not exists payout_iban      text,
  add column if not exists payout_wallet    text,
  add column if not exists payout_holder    text;

comment on column public.drivers.payout_iban is
  'Driver payout destination (IBAN). Not a credential; visible only to the driver + admin via RLS. Populated by the driver in-app or by ops.';

-- The drivers self-UPDATE column grant (mig 081 locks columns) must include the new
-- payout fields so a driver can set their own payout destination via PostgREST.
grant update (payout_method, payout_bank_name, payout_iban, payout_wallet, payout_holder)
  on public.drivers to authenticated;
-- Restaurants: merchant-staff update is gated by the existing restaurants UPDATE
-- policy (is_merchant_staff OR admin); grant the new columns to authenticated so the
-- policy can allow them. (mig 037-style column grant.)
grant update (payout_method, payout_bank_name, payout_iban, payout_wallet, payout_holder)
  on public.restaurants to authenticated;

-- ============================================================================
-- driver_settlements — one row per driver per payout period, aggregated from
-- driver_earnings. Mirrors restaurant_settlements (mig 074) exactly.
--   gross_earnings = sum(total)              (fee + tip + bonus the driver earned)
--   cod_collected  = sum(cod_collected)      (cash the driver took in — a RECEIVABLE
--                                             the platform is owed back, netted out)
--   net_payable    = gross_earnings − cod_collected
--     COD week: driver already holds cash ≥ earnings, so net_payable is usually
--     NEGATIVE — the driver OWES the platform (settled via cash hand-in, mig 104).
--     Card week: cod_collected = 0, so net_payable = gross_earnings — the platform
--     pays the driver their fees+tips+bonuses.
-- ============================================================================
create table if not exists public.driver_settlements (
  id                 uuid primary key default gen_random_uuid(),
  driver_id          uuid not null references public.drivers(id) on delete cascade,
  period_start       date not null,
  period_end         date not null,
  delivery_count     int  not null default 0,
  gross_earnings_egp int  not null default 0,   -- sum(driver_earnings.total)
  cod_collected_egp  int  not null default 0,   -- sum(driver_earnings.cod_collected)
  net_payable_egp    int  not null default 0,   -- gross_earnings − cod_collected
  status             text not null default 'draft'
                       check (status in ('draft','finalized','paid')),
  paid_at            timestamptz,
  paid_reference     text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (driver_id, period_start, period_end)
);
create index if not exists driver_settlements_driver_idx
  on public.driver_settlements (driver_id, period_start desc);

comment on table public.driver_settlements is
  'Per-driver per-period payout statement aggregated from driver_earnings. net_payable = gross earnings − COD cash collected (driver holds COD as a receivable). Negative net_payable means the driver owes the platform (reconciled via cash hand-in). draft -> finalized -> paid.';

alter table public.driver_settlements enable row level security;
create policy driver_settlements_select on public.driver_settlements
  for select using (
    (select public.auth_role()) = 'admin'
    or exists (select 1 from public.drivers d
                where d.id = driver_settlements.driver_id and d.profile_id = (select auth.uid()))
  );

-- ============================================================================
-- generate_driver_settlements — ADMIN (re)builds draft rows for a period from
-- driver_earnings. Idempotent per (driver, period); never rewrites a paid row.
-- ============================================================================
create or replace function public.generate_driver_settlements(p_period_start date, p_period_end date)
returns int
language plpgsql
security definer set search_path = public, pg_temp
as $function$
declare v_count int := 0;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;
  if coalesce(public.auth_role()::text,'') <> 'admin' then raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation'; end if;
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'INVALID_PERIOD' using errcode = 'check_violation';
  end if;

  with agg as (
    select
      e.driver_id,
      count(*)                     as delivery_count,
      sum(e.total)                 as gross_earnings,
      sum(e.cod_collected)         as cod_collected
    from public.driver_earnings e
    where e.created_at::date between p_period_start and p_period_end
    group by e.driver_id
  )
  insert into public.driver_settlements (
    driver_id, period_start, period_end, delivery_count,
    gross_earnings_egp, cod_collected_egp, net_payable_egp, status
  )
  select
    a.driver_id, p_period_start, p_period_end, a.delivery_count,
    coalesce(a.gross_earnings,0), coalesce(a.cod_collected,0),
    coalesce(a.gross_earnings,0) - coalesce(a.cod_collected,0),
    'draft'
  from agg a
  on conflict (driver_id, period_start, period_end) do update set
    delivery_count     = excluded.delivery_count,
    gross_earnings_egp = excluded.gross_earnings_egp,
    cod_collected_egp  = excluded.cod_collected_egp,
    net_payable_egp    = excluded.net_payable_egp,
    updated_at         = now()
  where public.driver_settlements.status <> 'paid';

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;
revoke all on function public.generate_driver_settlements(date, date) from public, anon;
grant execute on function public.generate_driver_settlements(date, date) to authenticated;

-- ============================================================================
-- finalize / mark-paid — ADMIN state transitions (mirror the restaurant RPCs).
-- ============================================================================
create or replace function public.finalize_driver_settlement(p_settlement_id uuid)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $function$
begin
  if coalesce(public.auth_role()::text,'') <> 'admin' then raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation'; end if;
  update public.driver_settlements
     set status = 'finalized', updated_at = now()
   where id = p_settlement_id and status = 'draft';
  if not found then raise exception 'NOT_DRAFT_OR_MISSING' using errcode = 'check_violation'; end if;
end;
$function$;
revoke all on function public.finalize_driver_settlement(uuid) from public, anon;
grant execute on function public.finalize_driver_settlement(uuid) to authenticated;

create or replace function public.mark_driver_settlement_paid(p_settlement_id uuid, p_reference text)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $function$
begin
  if coalesce(public.auth_role()::text,'') <> 'admin' then raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation'; end if;
  update public.driver_settlements
     set status = 'paid', paid_at = now(), paid_reference = nullif(btrim(coalesce(p_reference,'')), ''), updated_at = now()
   where id = p_settlement_id and status = 'finalized';
  if not found then raise exception 'NOT_FINALIZED_OR_MISSING' using errcode = 'check_violation'; end if;
end;
$function$;
revoke all on function public.mark_driver_settlement_paid(uuid, text) from public, anon;
grant execute on function public.mark_driver_settlement_paid(uuid, text) to authenticated;

-- ============================================================================
-- my_driver_settlements — a driver reads their own statements.
-- ============================================================================
create or replace function public.my_driver_settlements(p_limit int default 12)
returns setof public.driver_settlements
language sql
stable
security definer set search_path = public, pg_temp
as $function$
  select s.* from public.driver_settlements s
   join public.drivers d on d.id = s.driver_id
   where d.profile_id = auth.uid()
   order by s.period_start desc
   limit greatest(1, least(coalesce(p_limit,12), 100));
$function$;
revoke all on function public.my_driver_settlements(int) from public, anon;
grant execute on function public.my_driver_settlements(int) to authenticated;

-- ============================================================================
-- driver_settlement_sweep — weekly cron mirror of settlement_sweep (mig 084).
-- Runs the just-ended Mon–Sun week without the admin gate (cron runs as owner).
-- ============================================================================
create or replace function public.driver_settlement_sweep()
returns integer language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_start date; v_end date; v_count int := 0;
begin
  v_start := (date_trunc('week', now()) - interval '7 days')::date;
  v_end   := (date_trunc('week', now()) - interval '1 day')::date;

  with agg as (
    select e.driver_id, count(*) as delivery_count,
           sum(e.total) as gross_earnings, sum(e.cod_collected) as cod_collected
    from public.driver_earnings e
    where e.created_at::date between v_start and v_end
    group by e.driver_id
  )
  insert into public.driver_settlements (
    driver_id, period_start, period_end, delivery_count,
    gross_earnings_egp, cod_collected_egp, net_payable_egp, status
  )
  select a.driver_id, v_start, v_end, a.delivery_count,
         coalesce(a.gross_earnings,0), coalesce(a.cod_collected,0),
         coalesce(a.gross_earnings,0) - coalesce(a.cod_collected,0), 'draft'
  from agg a
  on conflict (driver_id, period_start, period_end) do update set
    delivery_count     = excluded.delivery_count,
    gross_earnings_egp = excluded.gross_earnings_egp,
    cod_collected_egp  = excluded.cod_collected_egp,
    net_payable_egp    = excluded.net_payable_egp,
    updated_at         = now()
  where public.driver_settlements.status <> 'paid';

  get diagnostics v_count = row_count;
  return v_count;
end; $function$;
revoke all on function public.driver_settlement_sweep() from public, anon, authenticated;

-- Every Monday 03:05 UTC (5 min after the restaurant sweep) — driver statements
-- for the just-ended week are ready for the admin to finalize + pay.
select cron.schedule('sharmeats-weekly-driver-settlement', '5 3 * * 1', $$select public.driver_settlement_sweep();$$);
