-- 010_zones_config.sql
-- Delivery fee rules + the platform_settings dispatch-mode switch.
--
-- MVP keeps fees SIMPLE: a flat base fee per zone (per_km_fee = 0). The columns
-- for distance-based pricing exist so we can turn it on later without DDL.
--
-- platform_settings is the dispatch-mode control: a singleton row sets the whole
-- platform to 'manual' now; zones.dispatch_mode (mig 005) overrides per zone so
-- you can pilot 'auto' in one neighborhood later.
--
-- Non-destructive: new tables + seed rows.

-- ============================================================================
-- DELIVERY FEE RULES (per-zone base; per-vertical optional)
-- ============================================================================
create table if not exists public.delivery_fee_rules (
  id           uuid primary key default gen_random_uuid(),
  zone_id      zone_type references public.zones(id) on delete cascade,
  vertical_id  text references public.verticals(id) on delete cascade,
  base_fee     int not null default 25 check (base_fee >= 0),  -- EGP
  per_km_fee   int not null default 0  check (per_km_fee >= 0),-- 0 for MVP
  min_fee      int not null default 0  check (min_fee >= 0),
  free_over    int,                                            -- subtotal >= free_over => free delivery (null = never)
  created_at   timestamptz not null default now()
);

-- One rule per (zone, vertical) pair; null vertical = applies to all verticals in the zone.
create unique index if not exists delivery_fee_rules_zone_vertical_uniq
  on public.delivery_fee_rules (zone_id, coalesce(vertical_id, ''));

-- Seed a flat base fee per Sharm zone for the food vertical.
-- Tourist-core zones (Naama/Soho/Sharks Bay) priced a touch higher; residential lower.
insert into public.delivery_fee_rules (zone_id, vertical_id, base_fee) values
  ('naama',                 'food', 30),
  ('soho',                  'food', 30),
  ('sharks_bay',            'food', 35),
  ('hadaba',                'food', 25),
  ('nabq',                  'food', 40),
  ('old_market',            'food', 25),
  ('el_salam',              'food', 25),
  ('mubarak_7',             'food', 20),
  ('el_rowaisat',           'food', 20),
  ('hay_el_nour',           'food', 20),
  ('el_hadaba_residential', 'food', 25)
on conflict (zone_id, coalesce(vertical_id, '')) do nothing;

-- ============================================================================
-- PLATFORM_SETTINGS (singleton-ish key/value; the dispatch-mode switch lives here)
-- ============================================================================
create table if not exists public.platform_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

insert into public.platform_settings (key, value) values
  ('dispatch_mode',          '"manual"'::jsonb),     -- 'manual' | 'auto'
  ('auto_dispatch_radius_m', '4000'::jsonb),         -- used when auto (and for nearest_drivers default)
  ('service_fee_pct',        '0'::jsonb),            -- keep simple at launch
  ('tax_pct',                '0'::jsonb)             -- prices tax-inclusive at launch
on conflict (key) do nothing;

create trigger platform_settings_touch_updated_at before update on public.platform_settings
  for each row execute function public.touch_updated_at();

alter table public.delivery_fee_rules enable row level security;
alter table public.platform_settings  enable row level security;

comment on table public.delivery_fee_rules is
  'Per-zone (optionally per-vertical) delivery fee. MVP = flat base_fee, per_km_fee 0. quote_delivery_fee reads this.';
comment on table public.platform_settings is
  'Global knobs as key/value JSON. dispatch_mode=''manual'' now; flip to ''auto'' (or set zones.dispatch_mode) to enable nearest_drivers auto-dispatch.';
