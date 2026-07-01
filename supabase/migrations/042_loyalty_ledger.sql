-- 042_loyalty_ledger.sql
-- Three-sided loyalty system, part 1: the shared points ledger + config.
--
-- One append-only ledger drives customer, driver, and restaurant loyalty.
-- Each subject_type earns points on order delivery (migration 042 adds the
-- triggers) and a nightly sweep (migration 043) recomputes tier from it.
-- Redemption/clawback are also just ledger rows (negative delta_points).
--
-- Security model: RLS enabled, read-only-own policy, ALL writes via
-- SECURITY DEFINER functions/triggers — same shape as promo_redemptions
-- and referrals (019/026). No client can insert/update/delete directly.
--
-- Non-destructive: new table + new platform_settings rows only.

-- ============================================================================
-- loyalty_points_ledger
-- ============================================================================
create table if not exists public.loyalty_points_ledger (
  id            uuid primary key default gen_random_uuid(),
  subject_type  text not null check (subject_type in ('customer','driver','restaurant')),
  subject_id    uuid not null,
  delta_points  int  not null,
  reason        text not null check (reason in ('order_earn','redeem','clawback','tier_bonus')),
  ref_order_id  uuid references public.orders(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists loyalty_ledger_subject_idx
  on public.loyalty_points_ledger (subject_type, subject_id, created_at desc);
create index if not exists loyalty_ledger_ref_order_idx
  on public.loyalty_points_ledger (ref_order_id) where ref_order_id is not null;

alter table public.loyalty_points_ledger enable row level security;

-- A customer may read their own ledger rows (history screen). Drivers and
-- restaurants read via their own SECURITY DEFINER RPCs (migration 044) rather
-- than a direct policy, since subject_id there is drivers.id/restaurants.id,
-- not auth.uid() — a plain policy can't express that join cheaply per-row.
create policy "loyalty_ledger_customer_read_own" on public.loyalty_points_ledger
  for select using (subject_type = 'customer' and subject_id = auth.uid());

comment on table public.loyalty_points_ledger is
  'Append-only points ledger for all three loyalty programs (customer/driver/restaurant). Never mutated in place — reversals are negative-delta rows. All writes via SECURITY DEFINER triggers/functions; RLS blocks direct client writes.';

-- ============================================================================
-- Config (tunable without a deploy) — mirrors the referral system's pattern.
-- ============================================================================
insert into public.platform_settings (key, value) values
  ('loyalty_points_per_egp',               to_jsonb(10)),   -- 1 point per 10 EGP subtotal
  ('loyalty_tier_multiplier_silver',       to_jsonb(125)),  -- x1.25, stored as hundredths
  ('loyalty_tier_multiplier_gold',         to_jsonb(150)),  -- x1.50
  ('loyalty_customer_silver_threshold',    to_jsonb(500)),  -- rolling-12mo points
  ('loyalty_customer_gold_threshold',      to_jsonb(2000)),
  ('loyalty_driver_silver_threshold',      to_jsonb(60)),   -- rolling-90d deliveries
  ('loyalty_driver_gold_threshold',        to_jsonb(200)),
  ('loyalty_driver_min_acceptance_pct',    to_jsonb(80)),   -- quality gate
  ('loyalty_driver_min_rating',            to_jsonb(450)),  -- 4.50, stored as hundredths
  ('loyalty_driver_bonus_silver_egp',      to_jsonb(5)),    -- per-delivery bonus
  ('loyalty_driver_bonus_gold_egp',        to_jsonb(10)),
  ('loyalty_driver_first_look_gold_seconds', to_jsonb(8)),  -- Gold sees offer N sec early
  ('loyalty_restaurant_silver_threshold',  to_jsonb(50)),   -- rolling-90d delivered orders
  ('loyalty_restaurant_gold_threshold',    to_jsonb(200)),
  ('loyalty_restaurant_silver_discount_pct', to_jsonb(100)), -- -1.00pp off commission_pct
  ('loyalty_restaurant_gold_discount_pct',   to_jsonb(200))  -- -2.00pp off commission_pct
on conflict (key) do nothing;

-- Reserve the LOY- prefix for minted redemption codes, same guard as SHARM-
-- for referrals (026) — keeps validate_promo's code-resolution unambiguous.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'promo_codes_not_loyalty_prefix_chk') then
    alter table public.promo_codes
      add constraint promo_codes_not_loyalty_prefix_chk
      check (upper(code) not like 'LOY-%');
  end if;
end $$;
