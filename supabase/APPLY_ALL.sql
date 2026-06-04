-- =============================================================
-- Sharm Eats — FULL SCHEMA, migrations 001 → 014, in order.
-- Paste this entire file into the Supabase SQL Editor and Run.
-- Safe to run on a fresh project. Order matters (later depends on earlier).
-- =============================================================


-- ─────────────────────────────────────────────────────────────
-- 001_waitlist.sql
-- ─────────────────────────────────────────────────────────────
-- 001_waitlist.sql
-- Waitlist signups from the landing page.
-- Anon clients NEVER write here directly; inserts go through the Next.js API route
-- using the service role key, after Zod validation.

create extension if not exists "pgcrypto";

create table if not exists public.waitlist (
  id            uuid        primary key default gen_random_uuid(),
  email         text        not null,
  whatsapp      text        null,
  locale        text        not null check (locale in ('en','ar','ru','it','de')),
  source        text        not null default 'landing',
  referrer      text        null,
  ip            inet        null,
  user_agent    text        null,
  created_at    timestamptz not null default now(),
  constraint waitlist_email_lower check (email = lower(email)),
  constraint waitlist_email_unique unique (email)
);

create index if not exists waitlist_created_at_idx on public.waitlist (created_at desc);
create index if not exists waitlist_locale_idx on public.waitlist (locale);

-- Lock the table down. Service role bypasses RLS, so the API route still works.
alter table public.waitlist enable row level security;

-- No anon select / insert / update / delete. Intentionally no policies.
-- Only the service role key (used from the Next.js server) can touch this table.

comment on table public.waitlist is
  'Landing page waitlist signups. Writes via Next.js /api/waitlist using service role key only.';


-- ─────────────────────────────────────────────────────────────
-- 002_app_schema.sql
-- ─────────────────────────────────────────────────────────────
-- 002_app_schema.sql
-- Core customer-app schema for sharmeats.
-- Matches the TypeScript types in apps/customer/src/data/types.ts so that the
-- Supabase adapters (apps/customer/src/data/supabase/*.ts) can map rows 1:1
-- without translation tables.
--
-- RLS posture (locked):
--   public read:    restaurants, menu_sections, menu_items, hotels, zones, riders (public profile cols only)
--   user-scoped:    users, addresses, payment_methods, orders, ratings (auth.uid() = user_id)
--   service-role:   merchant/admin writes (Edge Functions only — never client)
--
-- Enums mirror the union types in apps/customer/src/data/types.ts. When you
-- add a new cuisine/zone/payment-kind there, update the matching enum here.

create extension if not exists "pgcrypto";

-- ============================================================================
-- ENUMS
-- ============================================================================

create type cuisine_type as enum (
  'italian','seafood','egyptian','sushi','healthy','burgers','cafe','asian',
  'pizza','breakfast','late_night','street_food','sweets','grocery','pharmacy'
);

create type zone_type as enum (
  'naama','hadaba','nabq','old_market','soho','sharks_bay',
  'el_salam','mubarak_7','el_rowaisat','hay_el_nour','el_hadaba_residential'
);

create type address_kind_type as enum ('hotel','street','beach_pin');
create type handoff_type as enum ('lobby','reception','poolside');
create type payment_kind_type as enum ('cash','fawry','vodafone_cash','instapay','card','apple_pay');
create type order_status_type as enum (
  'placed','accepted','preparing','ready','out_for_delivery','delivered','cancelled'
);
create type currency_type as enum ('EGP','EUR','USD','GBP','RUB');
create type locale_type as enum ('en','ar','ru','it','de');
create type vehicle_type as enum ('scooter','motorbike','bicycle','car');
create type item_flag_type as enum (
  'halal','vegetarian','vegan','contains_pork','contains_alcohol','contains_nuts','spicy','glutenfree'
);

-- ============================================================================
-- USERS (1:1 with auth.users)
-- ============================================================================

create table public.users (
  id                          uuid primary key references auth.users(id) on delete cascade,
  phone                       text not null,
  display_name                text not null,
  email                       text,
  default_address_id          uuid,
  default_payment_method_id   uuid,
  preferred_currency          currency_type not null default 'EGP',
  locale                      locale_type   not null default 'ar',
  created_at                  timestamptz   not null default now(),
  updated_at                  timestamptz   not null default now()
);

create index users_phone_idx on public.users (phone);

-- ============================================================================
-- ZONES (Sharm neighborhoods)
-- ============================================================================

create table public.zones (
  id          zone_type primary key,
  name_en     text not null,
  name_ar     text not null,
  is_active   boolean not null default true
);

insert into public.zones (id, name_en, name_ar) values
  ('naama',                   'Naama Bay',                  'خليج نعمة'),
  ('hadaba',                  'Hadaba',                     'الهضبة'),
  ('nabq',                    'Nabq',                       'نبق'),
  ('old_market',              'Old Market',                 'السوق القديم'),
  ('soho',                    'Soho Square',                'سوهو سكوير'),
  ('sharks_bay',              'Sharks Bay',                 'خليج القروش'),
  ('el_salam',                'El-Salam',                   'السلام'),
  ('mubarak_7',               'Mubarak 7',                  'مبارك ٧'),
  ('el_rowaisat',             'El-Rowaisat',                'الرويسات'),
  ('hay_el_nour',             'Hay El-Nour',                'حي النور'),
  ('el_hadaba_residential',   'El-Hadaba Residential',      'الهضبة السكنية');

-- ============================================================================
-- HOTELS
-- ============================================================================

create table public.hotels (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  brand               text,
  zone                zone_type not null references public.zones(id),
  reception_phone     text not null,
  verified            boolean not null default false,
  created_at          timestamptz not null default now()
);

create index hotels_zone_idx on public.hotels (zone);
create index hotels_verified_idx on public.hotels (verified) where verified = true;

-- ============================================================================
-- ADDRESSES (user-scoped)
-- ============================================================================

create table public.addresses (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  kind            address_kind_type not null,
  label           text not null,
  hotel_id        uuid references public.hotels(id),
  hotel_name      text,
  room_number     text,
  handoff         handoff_type,
  street_text     text,
  building        text,
  apartment       text,
  landmark        text,
  beach_name      text,
  is_default      boolean not null default false,
  created_at      timestamptz not null default now(),
  -- Kind invariants
  constraint addresses_hotel_has_room
    check (kind <> 'hotel' or room_number is not null),
  constraint addresses_street_has_text
    check (kind <> 'street' or street_text is not null),
  constraint addresses_beach_has_name
    check (kind <> 'beach_pin' or beach_name is not null)
);

create index addresses_user_idx on public.addresses (user_id);
create unique index addresses_one_default_per_user on public.addresses (user_id)
  where is_default = true;

-- Link users.default_address_id FK once addresses table exists.
alter table public.users
  add constraint users_default_address_fk
  foreign key (default_address_id) references public.addresses(id) on delete set null;

-- ============================================================================
-- PAYMENT METHODS (user-scoped)
-- ============================================================================

create table public.payment_methods (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  kind            payment_kind_type not null,
  label           text not null,
  subline         text not null default '',
  is_default      boolean not null default false,
  -- Provider-specific tokens (only the kind-relevant column should be set)
  card_last4      text,
  card_brand      text,
  card_exp        text,
  vodafone_msisdn text,
  instapay_handle text,
  created_at      timestamptz not null default now()
);

create index payment_methods_user_idx on public.payment_methods (user_id);
create unique index payment_methods_one_default_per_user on public.payment_methods (user_id)
  where is_default = true;

alter table public.users
  add constraint users_default_payment_method_fk
  foreign key (default_payment_method_id) references public.payment_methods(id) on delete set null;

-- ============================================================================
-- RESTAURANTS
-- ============================================================================

create table public.restaurants (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique,
  name                text not null,
  description         text not null default '',
  cuisines            cuisine_type[] not null default '{}',
  cuisine_label       text not null default '',
  cover_image         text not null,
  logo                text,
  zone                zone_type not null references public.zones(id),
  rating              numeric(2,1) not null default 0 check (rating >= 0 and rating <= 5),
  rating_count        int not null default 0,
  prep_time_low       int not null default 10,
  prep_time_high      int not null default 30,
  delivery_fee_egp    int not null default 25 check (delivery_fee_egp >= 0),
  min_order_egp       int not null default 50 check (min_order_egp >= 0),
  distance_meters     int not null default 0,
  tourist_safe        boolean not null default false,
  is_open             boolean not null default true,
  is_open_24h         boolean,
  featured            boolean,
  promo               text,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index restaurants_active_idx on public.restaurants (is_active) where is_active = true;
create index restaurants_featured_idx on public.restaurants (featured) where featured = true;
create index restaurants_zone_idx on public.restaurants (zone);
create index restaurants_cuisines_gin on public.restaurants using gin (cuisines);

-- ============================================================================
-- MENUS
-- ============================================================================

create table public.menu_sections (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants(id) on delete cascade,
  name            text not null,
  sort_order      int not null default 0
);

create index menu_sections_restaurant_idx on public.menu_sections (restaurant_id, sort_order);

create table public.menu_items (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants(id) on delete cascade,
  section_id      uuid not null references public.menu_sections(id) on delete cascade,
  name            text not null,
  description     text not null default '',
  price_egp       int not null check (price_egp >= 0),
  image           text not null default '',
  flags           item_flag_type[] not null default '{}',
  is_available    boolean not null default true,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);

create index menu_items_restaurant_idx on public.menu_items (restaurant_id) where is_available = true;
create index menu_items_section_idx on public.menu_items (section_id, sort_order);

create table public.modifiers (
  id              uuid primary key default gen_random_uuid(),
  item_id         uuid not null references public.menu_items(id) on delete cascade,
  name            text not null,
  required        boolean not null default false,
  min_select      int not null default 0,
  max_select      int not null default 1,
  sort_order      int not null default 0
);

create table public.modifier_options (
  id                  uuid primary key default gen_random_uuid(),
  modifier_id         uuid not null references public.modifiers(id) on delete cascade,
  name                text not null,
  price_delta_egp     int not null default 0,
  is_default          boolean not null default false,
  sort_order          int not null default 0
);

-- ============================================================================
-- RIDERS
-- ============================================================================

create table public.riders (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users(id),
  name            text not null,
  photo           text not null default '',
  plate           text not null,
  vehicle         vehicle_type not null default 'scooter',
  rating          numeric(2,1) not null default 5.0,
  verified        boolean not null default false,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

-- ============================================================================
-- ORDERS
-- ============================================================================

create table public.orders (
  id                      uuid primary key default gen_random_uuid(),
  short_code              text not null unique,
  user_id                 uuid not null references public.users(id) on delete restrict,
  restaurant_id           uuid not null references public.restaurants(id) on delete restrict,
  restaurant_name         text not null,
  address_id              uuid not null references public.addresses(id) on delete restrict,
  address_snapshot        jsonb not null,
  items                   jsonb not null,
  subtotal_egp            int not null check (subtotal_egp >= 0),
  delivery_fee_egp        int not null check (delivery_fee_egp >= 0),
  tax_egp                 int not null check (tax_egp >= 0),
  tip_egp                 int not null default 0 check (tip_egp >= 0),
  total_egp               int not null check (total_egp >= 0),
  payment_method_kind     payment_kind_type not null,
  payment_label           text not null,
  status                  order_status_type not null default 'placed',
  history                 jsonb not null default '[]'::jsonb,
  rider                   jsonb,
  placed_at               timestamptz not null default now(),
  delivered_at            timestamptz,
  eta_at                  timestamptz not null,
  sla_minutes             int not null default 30,
  rating_food             int check (rating_food between 1 and 5),
  rating_delivery         int check (rating_delivery between 1 and 5),
  rating_comment          text,
  updated_at              timestamptz not null default now()
);

create index orders_user_idx on public.orders (user_id, placed_at desc);
create index orders_restaurant_idx on public.orders (restaurant_id, placed_at desc);
create index orders_status_idx on public.orders (status) where status not in ('delivered','cancelled');

-- Short-code generator (6-char Crockford-like, collision-tolerant via unique constraint).
create or replace function public.generate_order_short_code() returns text
language plpgsql as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text := '';
  i int;
begin
  for i in 1..6 loop
    code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return 'SE-' || code;
end;
$$;

create or replace function public.set_order_short_code() returns trigger
language plpgsql as $$
begin
  if new.short_code is null or new.short_code = '' then
    new.short_code := public.generate_order_short_code();
  end if;
  return new;
end;
$$;

create trigger orders_short_code_trg
  before insert on public.orders
  for each row execute function public.set_order_short_code();

-- ============================================================================
-- updated_at triggers
-- ============================================================================

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger users_touch_updated_at      before update on public.users
  for each row execute function public.touch_updated_at();
create trigger restaurants_touch_updated_at before update on public.restaurants
  for each row execute function public.touch_updated_at();
create trigger orders_touch_updated_at     before update on public.orders
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- RLS — Row Level Security
-- ============================================================================

alter table public.users            enable row level security;
alter table public.addresses        enable row level security;
alter table public.payment_methods  enable row level security;
alter table public.orders           enable row level security;
alter table public.hotels           enable row level security;
alter table public.restaurants      enable row level security;
alter table public.menu_sections    enable row level security;
alter table public.menu_items       enable row level security;
alter table public.modifiers        enable row level security;
alter table public.modifier_options enable row level security;
alter table public.riders           enable row level security;
alter table public.zones            enable row level security;

-- Users see / update only themselves.
create policy "users_select_self"
  on public.users for select using (auth.uid() = id);
create policy "users_update_self"
  on public.users for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "users_insert_self"
  on public.users for insert with check (auth.uid() = id);

-- Addresses scoped to the owner.
create policy "addresses_owner_all"
  on public.addresses for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Payment methods scoped to the owner.
create policy "payment_methods_owner_all"
  on public.payment_methods for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Orders: owner sees own; insert must reference own user_id.
-- Updates to order status come from service-role (Edge Functions), bypassing RLS.
create policy "orders_owner_select"
  on public.orders for select using (auth.uid() = user_id);
create policy "orders_owner_insert"
  on public.orders for insert with check (auth.uid() = user_id);
create policy "orders_owner_update_rating"
  on public.orders for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Public read for catalogs (anyone can browse without auth).
create policy "hotels_public_read"
  on public.hotels for select using (true);
create policy "zones_public_read"
  on public.zones for select using (true);
create policy "restaurants_public_read"
  on public.restaurants for select using (is_active = true);
create policy "menu_sections_public_read"
  on public.menu_sections for select using (true);
create policy "menu_items_public_read"
  on public.menu_items for select using (is_available = true);
create policy "modifiers_public_read"
  on public.modifiers for select using (true);
create policy "modifier_options_public_read"
  on public.modifier_options for select using (true);

-- Riders: only public-safe columns via a view in a later migration. For now,
-- block direct client reads — orders carry a JSON rider snapshot anyway.
-- (No select policy defined → default deny.)

-- ============================================================================
-- Realtime
-- ============================================================================
-- Enable Realtime for order updates so customer apps can subscribe per order.
alter publication supabase_realtime add table public.orders;

-- ============================================================================
-- Auto-create users row on auth signup
-- ============================================================================

create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, phone, display_name, locale, preferred_currency)
  values (
    new.id,
    coalesce(new.phone, ''),
    coalesce(new.raw_user_meta_data->>'display_name', 'Guest'),
    coalesce((new.raw_user_meta_data->>'locale')::locale_type, 'ar'),
    coalesce((new.raw_user_meta_data->>'preferred_currency')::currency_type, 'EGP')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ============================================================================
-- Comments
-- ============================================================================

comment on table public.users is
  'App users (1:1 with auth.users). Phone-OTP via Twilio/WhatsApp.';
comment on table public.addresses is
  'Delivery addresses. Three kinds: hotel (room+handoff), street (block+floor+apt for Egyptian convention), beach_pin (GPS-pin + beach name).';
comment on table public.payment_methods is
  'User-scoped payment instruments. Egyptian rails (cash/Fawry/Vodafone Cash/InstaPay) first; intl card/Apple Pay second.';
comment on table public.orders is
  'Customer orders. Status transitions are server-driven (Edge Function on Paymob webhook + rider app status pushes).';
comment on table public.restaurants is
  'Restaurant catalog. tourist_safe flag gates the "Tourist-safe" badge — requires English menu + allergen flags + per-item photos.';


-- ─────────────────────────────────────────────────────────────
-- 003_allergy_profile.sql
-- ─────────────────────────────────────────────────────────────
-- 003_allergy_profile.sql
-- Adds the structured allergy profile + per-order kitchen briefing.
--
-- Driven by the customer-app changes that surface a user-level allergy profile
-- (Settings → Allergies), apply it as pre-selected chips on every item modal,
-- aggregate allergens across the cart at checkout, and persist both the
-- aggregated allergen list and a free-text kitchen note on the order.

-- ============================================================================
-- ENUM for structured allergens (mirrors AllergyKey in apps/customer/src/data/types.ts)
-- ============================================================================

create type allergy_key_type as enum (
  'nuts',
  'gluten',
  'dairy',
  'shellfish',
  'eggs',
  'soy',
  'spicy',
  'sesame'
);

-- ============================================================================
-- USERS: allergy_profile
-- ============================================================================

alter table public.users
  add column allergy_profile allergy_key_type[] not null default '{}';

comment on column public.users.allergy_profile is
  'Structured allergy profile. Pre-selected on every item modal in the customer app; aggregated into Order.aggregate_allergens at checkout. Empty array = no warnings shown.';

-- ============================================================================
-- ORDERS: kitchen_notes + aggregate_allergens
-- ============================================================================

alter table public.orders
  add column kitchen_notes text,
  add column aggregate_allergens allergy_key_type[];

comment on column public.orders.kitchen_notes is
  'Order-wide free-text instructions captured at checkout. Separate from per-line CartItem.notes.';
comment on column public.orders.aggregate_allergens is
  'Deduplicated union of all CartItem.allergens across this order. The kitchen reads this as the authoritative allergy briefing.';

-- Helpful index for analytics (which allergens are most-flagged in orders?).
create index orders_aggregate_allergens_gin on public.orders using gin (aggregate_allergens);


-- ─────────────────────────────────────────────────────────────
-- 004_scheduled_orders.sql
-- ─────────────────────────────────────────────────────────────
-- 004_scheduled_orders.sql
-- Adds the scheduled-for timestamp on orders.
--
-- Drives the customer-app "schedule for later" flow (Checkout → Timing →
-- 30-minute slots). When null, the order is ASAP. When set, the order
-- countdown is hidden and tracking shows "Scheduled for {time}".

alter table public.orders
  add column scheduled_for timestamptz;

comment on column public.orders.scheduled_for is
  'When the customer asked the kitchen to start. NULL = ASAP. Set = preferred handoff time; tracking suppresses the live ETA countdown in favor of this.';

create index orders_scheduled_for_idx on public.orders (scheduled_for)
  where scheduled_for is not null;


-- ─────────────────────────────────────────────────────────────
-- 005_extensions_postgis.sql
-- ─────────────────────────────────────────────────────────────
-- 005_extensions_postgis.sql
-- Geo foundation for the delivery super-app.
--
-- Adds PostGIS and geography(Point/Polygon, 4326) columns so we can:
--   * resolve a dropoff/pickup to a Sharm zone,
--   * compute real-meter distances for dispatch (nearest driver),
--   * drop GPS pins from the customer app and driver app without reprojection.
--
-- We use `geography` (not `geometry`) so ST_DWithin / ST_Distance return METERS,
-- and SRID 4326 (WGS84 lat/lng) to match every GPS device and map API.
--
-- Non-destructive: only enables an extension and ADDs nullable columns +
-- backfills zone centroids. Existing rows/data untouched.

-- ============================================================================
-- Extension
-- ============================================================================
create extension if not exists postgis;

-- ============================================================================
-- ZONES: centroid (point) + boundary (polygon, nullable for MVP)
-- ============================================================================
alter table public.zones
  add column if not exists centroid geography(Point, 4326),
  add column if not exists boundary geography(Polygon, 4326),
  add column if not exists dispatch_mode text;  -- per-zone override; null = use platform default

-- Approximate centroids for Sharm el-Sheikh neighborhoods (lng, lat order!).
-- These are good-enough anchors for zone resolution + fee lookup at MVP;
-- precise polygons can be added later by setting `boundary`.
update public.zones set centroid = st_setsrid(st_makepoint(34.3300, 27.9100), 4326)::geography where id = 'naama';
update public.zones set centroid = st_setsrid(st_makepoint(34.3000, 27.8600), 4326)::geography where id = 'hadaba';
update public.zones set centroid = st_setsrid(st_makepoint(34.4200, 27.9900), 4326)::geography where id = 'nabq';
update public.zones set centroid = st_setsrid(st_makepoint(34.2950, 27.8550), 4326)::geography where id = 'old_market';
update public.zones set centroid = st_setsrid(st_makepoint(34.3270, 27.9170), 4326)::geography where id = 'soho';
update public.zones set centroid = st_setsrid(st_makepoint(34.3480, 27.9230), 4326)::geography where id = 'sharks_bay';
update public.zones set centroid = st_setsrid(st_makepoint(34.3120, 27.8780), 4326)::geography where id = 'el_salam';
update public.zones set centroid = st_setsrid(st_makepoint(34.3050, 27.8700), 4326)::geography where id = 'mubarak_7';
update public.zones set centroid = st_setsrid(st_makepoint(34.3150, 27.8900), 4326)::geography where id = 'el_rowaisat';
update public.zones set centroid = st_setsrid(st_makepoint(34.3080, 27.8820), 4326)::geography where id = 'hay_el_nour';
update public.zones set centroid = st_setsrid(st_makepoint(34.2980, 27.8620), 4326)::geography where id = 'el_hadaba_residential';

-- ============================================================================
-- RESTAURANTS: pickup location (for dispatch distance)
-- ============================================================================
alter table public.restaurants
  add column if not exists geo geography(Point, 4326);

-- Spatial index for nearest-merchant / distance queries.
create index if not exists restaurants_geo_gix on public.restaurants using gist (geo);

-- ============================================================================
-- ADDRESSES: a GPS pin is captured for EVERY address kind (even hotels),
-- so the driver always has a map point regardless of structured fields.
-- ============================================================================
alter table public.addresses
  add column if not exists geo geography(Point, 4326);

create index if not exists addresses_geo_gix on public.addresses using gist (geo);

-- Zone spatial index (for ST_Contains when polygons exist).
create index if not exists zones_boundary_gix on public.zones using gist (boundary);
create index if not exists zones_centroid_gix on public.zones using gist (centroid);

comment on column public.zones.centroid is
  'Approximate zone center (WGS84). Used for zone resolution by nearest-centroid until precise `boundary` polygons are added.';
comment on column public.zones.boundary is
  'Optional precise zone polygon (WGS84). When set, zone resolution uses ST_Contains; otherwise falls back to nearest centroid.';
comment on column public.zones.dispatch_mode is
  'Per-zone dispatch override (''manual''|''auto''). NULL = inherit platform_settings.dispatch_mode. Lets you pilot auto-dispatch in one zone.';
comment on column public.restaurants.geo is
  'Merchant pickup location (WGS84). Source for dispatch distance (nearest_drivers).';
comment on column public.addresses.geo is
  'Delivery drop GPS pin (WGS84). Captured for ALL address kinds — even hotels get a pin so the driver has a map point.';


-- ─────────────────────────────────────────────────────────────
-- 006_verticals_catalog.sql
-- ─────────────────────────────────────────────────────────────
-- 006_verticals_catalog.sql
-- Multi-category foundation — the "no schema rewrite for groceries/pharmacy" keystone.
--
-- The existing schema is food-only by naming (restaurants, menu_*). We make it
-- category-AGNOSTIC by introducing `verticals` and tagging each merchant
-- (restaurants table) with a vertical_id. A "restaurant" is just a merchant
-- WHERE vertical = 'food'; a grocery store is a merchant WHERE vertical =
-- 'grocery'. The catalog tables (menu_sections / menu_items / modifiers /
-- modifier_options) already work for any vertical — they hang off the merchant.
--
-- Launch: seed 'food' ACTIVE. 'grocery' and 'pharmacy' rows exist but INACTIVE.
-- Adding them later = flip is_active + insert merchants. Zero DDL.
--
-- Also adds the hybrid-fulfillment + payment-acceptance flags per merchant.
-- Non-destructive: new table + ADD COLUMN with safe defaults + backfill.

-- ============================================================================
-- VERTICALS (category-agnostic root)
-- ============================================================================
create table if not exists public.verticals (
  id            text primary key,          -- 'food' | 'grocery' | 'pharmacy' | ...
  name_en       text not null,
  name_ar       text not null,
  icon          text,                      -- icon name / emoji for the UI
  is_active     boolean not null default false,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

insert into public.verticals (id, name_en, name_ar, icon, is_active, sort_order) values
  ('food',     'Food',     'طعام',   'utensils',     true,  10),
  ('grocery',  'Groceries','بقالة',  'shopping-cart',false, 20),
  ('pharmacy', 'Pharmacy', 'صيدلية', 'pill',         false, 30)
on conflict (id) do nothing;

alter table public.verticals enable row level security;
create policy "verticals_public_read"
  on public.verticals for select using (is_active = true);

-- ============================================================================
-- RESTAURANTS (= the polymorphic MERCHANT): vertical + fulfillment + payments
-- ============================================================================
alter table public.restaurants
  add column if not exists vertical_id      text references public.verticals(id) default 'food',
  add column if not exists fulfillment_type text not null default 'platform',     -- 'platform' | 'self_delivery'
  add column if not exists commission_pct   numeric(5,2) not null default 12.0,   -- platform's cut (LOI offer = 12%)
  add column if not exists accepts_cash     boolean not null default true,        -- COD allowed
  add column if not exists accepts_card     boolean not null default true;        -- Paymob card allowed

-- Backfill existing rows to the food vertical explicitly.
update public.restaurants set vertical_id = 'food' where vertical_id is null;

-- Guard rails on the new enum-like text columns.
alter table public.restaurants
  add constraint restaurants_fulfillment_type_chk
    check (fulfillment_type in ('platform', 'self_delivery')) not valid;
alter table public.restaurants validate constraint restaurants_fulfillment_type_chk;

create index if not exists restaurants_vertical_idx on public.restaurants (vertical_id);

-- ============================================================================
-- CATALOG ITEMS: vertical-flex columns (food works now; grocery/pharmacy later)
-- ============================================================================
-- menu_items already has: name, description, price_egp, image, flags, is_available.
-- Add SKU/unit/barcode (grocery) + prescription flag (pharmacy) as nullable —
-- food simply leaves them null. No new table needed.
alter table public.menu_items
  add column if not exists sku                   text,
  add column if not exists barcode               text,
  add column if not exists unit                  text default 'each',  -- 'each' | 'kg' | 'pack' | ...
  add column if not exists requires_prescription boolean not null default false;

comment on table public.verticals is
  'Category-agnostic root. Food active at launch; grocery/pharmacy inactive rows. Adding a vertical later = flip is_active + insert merchants (no DDL).';
comment on column public.restaurants.vertical_id is
  'Which vertical this merchant belongs to. ''food'' now; ''grocery''/''pharmacy'' use the SAME table later.';
comment on column public.restaurants.fulfillment_type is
  'Hybrid fleet: ''platform'' (our drivers, dispatched) or ''self_delivery'' (merchant''s own driver). Default copied onto each order, frozen there.';
comment on column public.restaurants.commission_pct is
  'Platform commission %. Founding-cohort LOI offers 12% (vs Twista 18-22%).';
comment on column public.menu_items.unit is
  'Sale unit. ''each'' for food/most items; ''kg''/''pack'' for grocery weights. price_egp is per-unit.';
comment on column public.menu_items.requires_prescription is
  'Pharmacy: item needs a prescription. Enforced in place_order for vertical=pharmacy (later).';


-- ─────────────────────────────────────────────────────────────
-- 007_roles_merchant_staff.sql
-- ─────────────────────────────────────────────────────────────
-- 007_roles_merchant_staff.sql
-- Identity & roles for the four-surface app on one database.
--
-- Role model (the RLS foundation):
--   * users.role          -> COARSE role, one per user (a driver isn't a merchant).
--   * merchant_staff       -> which merchant a merchant_staff user belongs to.
--   * drivers (mig 008)    -> driver identity/availability.
--
-- auth_role() is a SECURITY DEFINER helper that reads the caller's role WITHOUT
-- triggering RLS recursion (it bypasses RLS on users), with a pinned search_path
-- for safety. RLS policies in 012 use it to gate admin/dispatcher access.
--
-- Non-destructive: new enum, ADD COLUMN with default, new table, new function.

-- ============================================================================
-- app_role enum + users.role
-- ============================================================================
do $$ begin
  create type app_role as enum ('customer','driver','merchant_staff','dispatcher','admin');
exception when duplicate_object then null;
end $$;

alter table public.users
  add column if not exists role app_role not null default 'customer';

create index if not exists users_role_idx on public.users (role) where role <> 'customer';

-- ============================================================================
-- merchant_staff (links a staff profile to ONE merchant; gates merchant RLS)
-- ============================================================================
create table if not exists public.merchant_staff (
  profile_id    uuid not null references public.users(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  staff_role    text not null default 'staff',  -- 'owner' | 'manager' | 'staff'
  created_at    timestamptz not null default now(),
  primary key (profile_id, restaurant_id)
);

create index if not exists merchant_staff_restaurant_idx on public.merchant_staff (restaurant_id);
create index if not exists merchant_staff_profile_idx on public.merchant_staff (profile_id);

alter table public.merchant_staff enable row level security;

-- ============================================================================
-- auth_role() — recursion-safe role lookup for policies
-- ============================================================================
create or replace function public.auth_role()
returns app_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.users where id = auth.uid();
$$;

-- Helper: is the current user staff of a given merchant?
create or replace function public.is_merchant_staff(p_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.merchant_staff
    where profile_id = auth.uid() and restaurant_id = p_restaurant_id
  );
$$;

-- Helper: set of merchant ids the current user staffs (for IN (...) policies).
create or replace function public.my_merchant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select restaurant_id from public.merchant_staff where profile_id = auth.uid();
$$;

-- ============================================================================
-- Update the signup trigger to honor a role hint in metadata (defaults customer)
-- ============================================================================
create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.users (id, phone, display_name, locale, preferred_currency, role)
  values (
    new.id,
    coalesce(new.phone, ''),
    coalesce(new.raw_user_meta_data->>'display_name', 'Guest'),
    coalesce((new.raw_user_meta_data->>'locale')::locale_type, 'ar'),
    coalesce((new.raw_user_meta_data->>'preferred_currency')::currency_type, 'EGP'),
    coalesce((new.raw_user_meta_data->>'role')::app_role, 'customer')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

comment on table public.merchant_staff is
  'Links a merchant_staff user to the merchant(s) they operate. The merchant RLS gate: a staffer can only see orders/menus where restaurant_id IN my_merchant_ids().';
comment on function public.auth_role is
  'Recursion-safe (SECURITY DEFINER, pinned search_path) lookup of the caller''s coarse role. Used by RLS policies for admin/dispatcher gating.';


-- ─────────────────────────────────────────────────────────────
-- 008_fleet.sql
-- ─────────────────────────────────────────────────────────────
-- 008_fleet.sql
-- The fleet: drivers, live status/location, assignments, earnings.
--
-- Design choice: KEEP the existing `riders` table (orders.rider JSONB snapshots
-- reference its shape and must not break) and ADD a richer operational `drivers`
-- table for live fleet management (availability, GPS, dispatch). They reconcile
-- via drivers.legacy_rider_id. `drivers` is the source of truth for dispatch.
--
-- Manual dispatch now (admin assigns via order_assignments); the same model is
-- auto-ready: nearest_drivers (mig 011) reads drivers.current_geo.
--
-- Non-destructive: new tables + new columns on orders.

-- ============================================================================
-- DRIVERS (operational fleet record)
-- ============================================================================
create table if not exists public.drivers (
  id               uuid primary key default gen_random_uuid(),
  profile_id       uuid unique references public.users(id) on delete set null,
  legacy_rider_id  uuid references public.riders(id) on delete set null,
  name             text not null,
  photo            text not null default '',
  phone            text not null default '',
  vehicle          vehicle_type not null default 'scooter',
  plate            text not null default '',
  status           text not null default 'offline',          -- 'offline' | 'online' | 'on_job'
  is_verified      boolean not null default false,
  is_active        boolean not null default true,
  rating           numeric(2,1) not null default 5.0 check (rating >= 0 and rating <= 5),
  current_geo      geography(Point, 4326),                    -- last known position (hot column)
  last_ping_at     timestamptz,
  home_zone        zone_type references public.zones(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint drivers_status_chk check (status in ('offline','online','on_job'))
);

create index if not exists drivers_status_idx on public.drivers (status) where status <> 'offline';
create index if not exists drivers_geo_gix on public.drivers using gist (current_geo);
create index if not exists drivers_home_zone_idx on public.drivers (home_zone);

create trigger drivers_touch_updated_at before update on public.drivers
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- ORDER ASSIGNMENTS (the dispatch record; manual now, auto later)
-- ============================================================================
create table if not exists public.order_assignments (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.orders(id) on delete cascade,
  driver_id      uuid not null references public.drivers(id) on delete cascade,
  status         text not null default 'offered',            -- offered|accepted|rejected|completed|reassigned
  assigned_by    text not null default 'dispatcher',         -- 'dispatcher' | 'auto' | 'self_accept'
  assigned_by_id uuid references public.users(id) on delete set null,
  assigned_at    timestamptz not null default now(),
  responded_at   timestamptz,
  constraint order_assignments_status_chk
    check (status in ('offered','accepted','rejected','completed','reassigned')),
  constraint order_assignments_assigned_by_chk
    check (assigned_by in ('dispatcher','auto','self_accept'))
);

create index if not exists order_assignments_order_idx on public.order_assignments (order_id);
create index if not exists order_assignments_driver_idx on public.order_assignments (driver_id, status);
-- At most one ACTIVE (offered/accepted) assignment per order.
create unique index if not exists order_assignments_one_active_per_order
  on public.order_assignments (order_id)
  where status in ('offered','accepted');

-- ============================================================================
-- DRIVER EARNINGS (one row per completed delivery; feeds COD reconciliation)
-- ============================================================================
create table if not exists public.driver_earnings (
  id                  uuid primary key default gen_random_uuid(),
  driver_id           uuid not null references public.drivers(id) on delete restrict,
  order_id            uuid not null references public.orders(id) on delete restrict,
  delivery_fee_share  int not null default 0,    -- EGP the driver earns from the delivery fee
  tip                 int not null default 0,
  bonus               int not null default 0,
  cod_collected       int not null default 0,    -- cash the driver took from the customer (owed to platform)
  total               int not null default 0,    -- delivery_fee_share + tip + bonus
  payout_batch_id     uuid,                       -- nullable; weekly settlement grouping (later)
  created_at          timestamptz not null default now(),
  unique (order_id)
);

create index if not exists driver_earnings_driver_idx on public.driver_earnings (driver_id, created_at desc);

-- ============================================================================
-- ORDERS: dispatch fields
-- ============================================================================
alter table public.orders
  add column if not exists assigned_driver_id uuid references public.drivers(id) on delete set null,
  add column if not exists dispatch_mode      text;  -- 'manual' | 'auto' (how it was/should be dispatched)

create index if not exists orders_assigned_driver_idx on public.orders (assigned_driver_id)
  where assigned_driver_id is not null;

alter table public.drivers       enable row level security;
alter table public.order_assignments enable row level security;
alter table public.driver_earnings   enable row level security;

comment on table public.drivers is
  'Operational fleet record (live status, GPS, dispatch). Source of truth for dispatch. orders.rider keeps a JSONB snapshot for the customer card; legacy_rider_id reconciles to the old riders table.';
comment on column public.drivers.current_geo is
  'Last known driver position (WGS84). Updated by a throttled RPC (~20-30s) so nearest_drivers + the admin board stay fresh WITHOUT per-GPS-ping writes (live tracking uses Realtime Broadcast instead).';
comment on table public.order_assignments is
  'Dispatch record. Manual: a dispatcher creates an ''offered'' row (assign_driver). Driver accepts/rejects (driver_respond). Auto later: assigned_by=''auto''.';
comment on column public.driver_earnings.cod_collected is
  'Cash the driver collected on a COD order — owed back to the platform. Admin reconciliation nets (cod_collected - earnings) per driver.';


-- ─────────────────────────────────────────────────────────────
-- 009_order_items.sql
-- ─────────────────────────────────────────────────────────────
-- 009_order_items.sql
-- Real line items + append-only status audit + payment/fulfillment fields.
--
-- The existing schema stuffs line items into orders.items (JSONB) — fine for a
-- mock, wrong for a platform (no per-line queries, no proper modifier snapshot,
-- can't refund one line). We ADD a real order_items table that snapshots
-- captured price + selected modifiers at order time, so later menu edits never
-- rewrite history. orders.items JSONB STAYS as a compatibility shim; place_order
-- writes BOTH during transition, then the UI cuts over to order_items.
--
-- Also extends order_status_type (+picked_up, +rejected) and adds the
-- payment-method / payment-status / fulfillment-type / dropoff_geo columns the
-- hybrid + dual-payment model needs.
--
-- Non-destructive: enum ADD VALUE, new tables, new columns with safe defaults.

-- ============================================================================
-- Extend order_status_type to match the shared state machine
-- (placed→accepted→preparing→ready→picked_up→out_for_delivery→delivered,
--  + cancelled, + rejected)
-- ============================================================================
alter type order_status_type add value if not exists 'picked_up' after 'ready';
alter type order_status_type add value if not exists 'rejected'  after 'cancelled';

-- ============================================================================
-- ORDERS: payment + fulfillment + geo
-- ============================================================================
alter table public.orders
  add column if not exists payment_method   text not null default 'cash_on_delivery', -- 'card' | 'cash_on_delivery'
  add column if not exists payment_status   text not null default 'pending',          -- pending|paid|failed|refunded
  add column if not exists fulfillment_type text not null default 'platform',          -- 'platform' | 'self_delivery'
  add column if not exists dropoff_geo      geography(Point, 4326),
  add column if not exists zone             zone_type references public.zones(id),
  add column if not exists paymob_order_ref text,
  add column if not exists cancel_reason    text,
  add column if not exists ready_at         timestamptz,
  add column if not exists picked_up_at     timestamptz,
  add column if not exists accepted_at      timestamptz;

alter table public.orders
  add constraint orders_payment_method_chk
    check (payment_method in ('card','cash_on_delivery')) not valid;
alter table public.orders validate constraint orders_payment_method_chk;

alter table public.orders
  add constraint orders_payment_status_chk
    check (payment_status in ('pending','paid','failed','refunded')) not valid;
alter table public.orders validate constraint orders_payment_status_chk;

alter table public.orders
  add constraint orders_fulfillment_type_chk
    check (fulfillment_type in ('platform','self_delivery')) not valid;
alter table public.orders validate constraint orders_fulfillment_type_chk;

create index if not exists orders_payment_status_idx on public.orders (payment_status)
  where payment_status <> 'paid';
create index if not exists orders_dropoff_geo_gix on public.orders using gist (dropoff_geo);

-- ============================================================================
-- ORDER_ITEMS (real line items with snapshots)
-- ============================================================================
create table if not exists public.order_items (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null references public.orders(id) on delete cascade,
  catalog_item_id      uuid references public.menu_items(id) on delete restrict,
  name_snapshot        text not null,
  unit_price_snapshot  int not null check (unit_price_snapshot >= 0),   -- base price at order time (EGP)
  quantity             int not null check (quantity > 0),
  modifiers_snapshot   jsonb not null default '[]'::jsonb,              -- [{modifierName,optionName,priceDeltaEgp}]
  line_total           int not null check (line_total >= 0),            -- (unit_price + modifier deltas) * qty
  notes                text,
  created_at           timestamptz not null default now()
);

create index if not exists order_items_order_idx on public.order_items (order_id);

-- ============================================================================
-- ORDER_STATUS_EVENTS (append-only audit; drives the customer timeline)
-- ============================================================================
create table if not exists public.order_status_events (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  status      order_status_type not null,
  actor_role  app_role,
  actor_id    uuid references public.users(id) on delete set null,
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists order_status_events_order_idx on public.order_status_events (order_id, created_at);

alter table public.order_items         enable row level security;
alter table public.order_status_events enable row level security;

comment on table public.order_items is
  'Real per-line order rows with price + modifier SNAPSHOTS frozen at order time. orders.items JSONB stays as a compat shim until the UI fully cuts over.';
comment on table public.order_status_events is
  'Append-only status history. The only writer is advance_order_status (mig 011). Drives the customer tracking timeline and ops audit.';
comment on column public.orders.payment_method is
  '''card'' (Paymob hosted checkout) or ''cash_on_delivery'' (no gateway; flips to paid on delivery via mark_cod_collected).';
comment on column public.orders.payment_status is
  'card: webhook-driven pending->paid. COD: pending until delivery, then paid. Card orders are hidden from the merchant queue until paid.';


-- ─────────────────────────────────────────────────────────────
-- 010_zones_config.sql
-- ─────────────────────────────────────────────────────────────
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


-- ─────────────────────────────────────────────────────────────
-- 011_rpcs.sql
-- ─────────────────────────────────────────────────────────────
-- 011_rpcs.sql
-- Server-side AUTHORITY: every money/status/dispatch decision lives here.
--
-- Ported from the Go Sharm `book_excursion_guest` pattern:
--   * SECURITY DEFINER set search_path = public, pg_temp
--   * FOR UPDATE row locking
--   * price recomputed from DB values (NEVER trust client totals)
--   * qualify columns vs RETURNS TABLE OUT params (Postgres 42702)
--   * raise exception ... using errcode = 'check_violation' for validation
--
-- Functions:
--   resolve_zone(geo)                      -> zone_type        (PostGIS)
--   quote_delivery_fee(merchant, geo)      -> int              (fee estimate + authority)
--   place_order(...)                       -> (id, short_code, total)   [the heart]
--   advance_order_status(order, status)    -> void             (legal state machine + audit)
--   assign_driver(order, driver)           -> void             (manual dispatch)
--   driver_respond(assignment, accept)     -> void
--   mark_cod_collected(order, amount)      -> void             (COD settlement)
--   driver_ping(geo)                       -> void             (throttled current_geo update)
--   nearest_drivers(geo, radius, limit)    -> setof            (PostGIS; read-only now, auto later)
--   validate_promo(code, subtotal)         -> int              (discount EGP)

-- ============================================================================
-- resolve_zone: dropoff point -> zone (ST_Contains if polygons exist, else nearest centroid)
-- ============================================================================
create or replace function public.resolve_zone(p_geo geography)
returns zone_type
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select id from public.zones
  where boundary is not null and st_contains(boundary::geometry, p_geo::geometry)
  limit 1;
$$;

create or replace function public.resolve_zone_nearest(p_geo geography)
returns zone_type
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select coalesce(
    (select id from public.zones
       where boundary is not null and st_contains(boundary::geometry, p_geo::geometry)
       limit 1),
    (select id from public.zones
       where centroid is not null and is_active
       order by st_distance(centroid, p_geo) asc
       limit 1)
  );
$$;

-- ============================================================================
-- quote_delivery_fee: zone-based fee for a merchant + dropoff (estimate + authority)
-- ============================================================================
create or replace function public.quote_delivery_fee(
  p_restaurant_id uuid,
  p_dropoff geography,
  p_subtotal int default 0
)
returns int
language plpgsql
stable
security definer set search_path = public, pg_temp
as $$
declare
  v_zone   zone_type;
  v_rule   public.delivery_fee_rules;
  v_fee    int;
begin
  v_zone := public.resolve_zone_nearest(p_dropoff);

  -- Prefer a (zone, food-vertical) rule; fall back to (zone, null vertical).
  select * into v_rule from public.delivery_fee_rules
   where zone_id = v_zone and (vertical_id = 'food' or vertical_id is null)
   order by vertical_id nulls last
   limit 1;

  if not found then
    return 30;  -- safe default if no rule configured
  end if;

  -- MVP: flat base (per_km_fee defaults 0). Free over threshold honored.
  if v_rule.free_over is not null and p_subtotal >= v_rule.free_over then
    return 0;
  end if;
  v_fee := greatest(v_rule.base_fee, v_rule.min_fee);
  return v_fee;
end;
$$;

-- ============================================================================
-- validate_promo: returns discount in EGP for a code against a subtotal
-- (placeholder — promo_codes table not yet defined; returns 0 safely)
-- ============================================================================
create or replace function public.validate_promo(p_code text, p_subtotal int)
returns int
language plpgsql
stable
security definer set search_path = public, pg_temp
as $$
begin
  -- No promo_codes table at MVP; always 0. Wire real logic when promos ship.
  return 0;
end;
$$;

-- ============================================================================
-- place_order — THE TRANSACTIONAL HEART
-- Recomputes every line from live DB prices + modifier deltas, computes the
-- delivery fee server-side, validates promo, inserts orders + order_items +
-- first status event atomically. Returns the new ref. Client total is IGNORED.
--
-- p_cart shape (jsonb array):
--   [{ "item_id": uuid, "quantity": int,
--      "modifier_option_ids": [uuid, ...],   -- selected modifier_options
--      "notes": text }]
-- ============================================================================
create or replace function public.place_order(
  p_restaurant_id uuid,
  p_address_id    uuid,
  p_cart          jsonb,
  p_payment_method text,                 -- 'card' | 'cash_on_delivery'
  p_tip           int default 0,
  p_kitchen_notes text default null,
  p_promo_code    text default null,
  p_scheduled_for timestamptz default null
)
returns table (id uuid, short_code text, total_egp int)
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_user        uuid := auth.uid();
  v_rest        public.restaurants;
  v_addr        public.addresses;
  v_line        jsonb;
  v_item        public.menu_items;
  v_opt_ids     uuid[];
  v_mod_delta   int;
  v_qty         int;
  v_line_total  int;
  v_subtotal    int := 0;
  v_delivery    int;
  v_discount    int := 0;
  v_tax         int := 0;
  v_total       int;
  v_zone        zone_type;
  v_order_id    uuid;
  v_short       text;
  v_pay_status  text;
  v_mods_snap   jsonb;
  v_addr_snap   jsonb;
begin
  -- Auth + basic validation (server-trusted).
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;
  if p_payment_method not in ('card','cash_on_delivery') then
    raise exception 'INVALID_PAYMENT_METHOD' using errcode = 'check_violation';
  end if;
  if p_cart is null or jsonb_typeof(p_cart) <> 'array' or jsonb_array_length(p_cart) = 0 then
    raise exception 'EMPTY_CART' using errcode = 'check_violation';
  end if;

  -- Lock the merchant row; must exist, be active & open.
  select * into v_rest from public.restaurants
   where restaurants.id = p_restaurant_id for update;
  if not found then raise exception 'MERCHANT_NOT_FOUND' using errcode = 'check_violation'; end if;
  if not v_rest.is_active or not v_rest.is_open then
    raise exception 'MERCHANT_CLOSED' using errcode = 'check_violation';
  end if;
  if p_payment_method = 'cash_on_delivery' and not v_rest.accepts_cash then
    raise exception 'CASH_NOT_ACCEPTED' using errcode = 'check_violation';
  end if;
  if p_payment_method = 'card' and not v_rest.accepts_card then
    raise exception 'CARD_NOT_ACCEPTED' using errcode = 'check_violation';
  end if;

  -- Address must belong to the caller.
  select * into v_addr from public.addresses
   where addresses.id = p_address_id and addresses.user_id = v_user;
  if not found then raise exception 'ADDRESS_NOT_FOUND' using errcode = 'check_violation'; end if;

  -- Recompute each line from DB prices + modifier deltas. Build order_items rows.
  -- We defer inserting items until the order exists (need order_id), so collect.
  create temporary table _lines (
    item_id uuid, name text, unit_price int, qty int, mods jsonb, line_total int, notes text
  ) on commit drop;

  for v_line in select * from jsonb_array_elements(p_cart)
  loop
    v_qty := coalesce((v_line->>'quantity')::int, 0);
    if v_qty < 1 then raise exception 'INVALID_QTY' using errcode = 'check_violation'; end if;

    select * into v_item from public.menu_items
     where menu_items.id = (v_line->>'item_id')::uuid
       and menu_items.restaurant_id = p_restaurant_id;
    if not found then raise exception 'ITEM_NOT_FOUND' using errcode = 'check_violation'; end if;
    if not v_item.is_available then
      raise exception 'ITEM_UNAVAILABLE' using errcode = 'check_violation';
    end if;

    -- Selected modifier options -> sum of deltas + snapshot, validated to this item.
    v_opt_ids := coalesce(
      (select array_agg((x)::uuid) from jsonb_array_elements_text(coalesce(v_line->'modifier_option_ids','[]'::jsonb)) as x),
      '{}'::uuid[]
    );

    select coalesce(sum(mo.price_delta_egp), 0),
           coalesce(jsonb_agg(jsonb_build_object(
             'modifierName', m.name, 'optionName', mo.name, 'priceDeltaEgp', mo.price_delta_egp
           )), '[]'::jsonb)
      into v_mod_delta, v_mods_snap
      from public.modifier_options mo
      join public.modifiers m on m.id = mo.modifier_id
     where mo.id = any(v_opt_ids) and m.item_id = v_item.id;

    v_line_total := (v_item.price_egp + coalesce(v_mod_delta,0)) * v_qty;
    v_subtotal := v_subtotal + v_line_total;

    insert into _lines values (
      v_item.id, v_item.name, v_item.price_egp, v_qty,
      coalesce(v_mods_snap,'[]'::jsonb), v_line_total, v_line->>'notes'
    );
  end loop;

  if v_rest.min_order_egp > 0 and v_subtotal < v_rest.min_order_egp then
    raise exception 'BELOW_MIN_ORDER' using errcode = 'check_violation';
  end if;

  -- Server-side delivery fee, promo, tax, total. Client total is never used.
  v_delivery := public.quote_delivery_fee(p_restaurant_id, v_addr.geo, v_subtotal);
  v_discount := public.validate_promo(p_promo_code, v_subtotal);
  v_tax := 0;  -- tax-inclusive at launch
  v_total := greatest(0, v_subtotal + v_delivery + v_tax + greatest(0,coalesce(p_tip,0)) - v_discount);

  v_zone := public.resolve_zone_nearest(v_addr.geo);
  v_pay_status := 'pending';  -- card flips to paid on webhook; COD on delivery

  -- Address snapshot (orders.address_snapshot is jsonb not null).
  v_addr_snap := to_jsonb(v_addr);

  insert into public.orders (
    user_id, restaurant_id, restaurant_name, address_id, address_snapshot,
    items, subtotal_egp, delivery_fee_egp, tax_egp, tip_egp, total_egp,
    payment_method_kind, payment_label, payment_method, payment_status,
    fulfillment_type, dispatch_mode, dropoff_geo, zone,
    status, history, eta_at, sla_minutes, kitchen_notes, scheduled_for
  ) values (
    v_user, p_restaurant_id, v_rest.name, p_address_id, v_addr_snap,
    coalesce((select jsonb_agg(jsonb_build_object(
        'itemId', item_id, 'name', name, 'basePriceEgp', unit_price,
        'quantity', qty, 'modifierChoices', mods, 'notes', notes, 'lineTotalEgp', line_total
      )) from _lines), '[]'::jsonb),
    v_subtotal, v_delivery, v_tax, greatest(0,coalesce(p_tip,0)), v_total,
    -- legacy payment_method_kind expects payment_kind_type; map card/cod onto it
    (case when p_payment_method = 'card' then 'card' else 'cash' end)::payment_kind_type,
    (case when p_payment_method = 'card' then 'Card' else 'Cash on delivery' end),
    p_payment_method, v_pay_status,
    v_rest.fulfillment_type,
    (select (value #>> '{}') from public.platform_settings where key = 'dispatch_mode'),
    v_addr.geo, v_zone,
    'placed', '[]'::jsonb,
    now() + (v_rest.prep_time_high || ' minutes')::interval, v_rest.prep_time_high,
    p_kitchen_notes, p_scheduled_for
  )
  returning orders.id, orders.short_code into v_order_id, v_short;

  -- Real order_items rows (snapshots).
  insert into public.order_items (order_id, catalog_item_id, name_snapshot, unit_price_snapshot, quantity, modifiers_snapshot, line_total, notes)
  select v_order_id, item_id, name, unit_price, qty, mods, line_total, notes from _lines;

  -- First status event.
  insert into public.order_status_events (order_id, status, actor_role, actor_id, note)
  values (v_order_id, 'placed', 'customer', v_user, 'Order placed');

  id := v_order_id; short_code := v_short; total_egp := v_total;
  return next;
end;
$$;

grant execute on function public.place_order(uuid, uuid, jsonb, text, int, text, text, timestamptz) to authenticated;
grant execute on function public.quote_delivery_fee(uuid, geography, int) to authenticated, anon;
grant execute on function public.resolve_zone(geography) to authenticated, anon;
grant execute on function public.resolve_zone_nearest(geography) to authenticated, anon;
grant execute on function public.validate_promo(text, int) to authenticated, anon;

-- ============================================================================
-- advance_order_status — the ONLY writer of orders.status. Enforces the legal
-- state machine (mirrors packages/shared/src/order-status.ts) per actor role.
-- ============================================================================
create or replace function public.advance_order_status(
  p_order_id uuid,
  p_new_status order_status_type,
  p_note text default null
)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_user   uuid := auth.uid();
  v_role   app_role := public.auth_role();
  v_order  public.orders;
  v_ok     boolean := false;
  v_actor  text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;

  select * into v_order from public.orders where orders.id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'check_violation'; end if;

  -- Authorize the actor for THIS order.
  --   merchant_staff of the order's restaurant, the assigned driver, or admin/dispatcher.
  if v_role in ('admin','dispatcher') then
    v_ok := true; v_actor := v_role::text;
  elsif v_role = 'merchant_staff' and public.is_merchant_staff(v_order.restaurant_id) then
    v_ok := true; v_actor := 'merchant';
  elsif v_role = 'driver' and exists (
      select 1 from public.drivers d
       where d.id = v_order.assigned_driver_id and d.profile_id = v_user) then
    v_ok := true; v_actor := 'driver';
  elsif v_role = 'customer' and v_order.user_id = v_user then
    v_ok := true; v_actor := 'customer';
  end if;

  if not v_ok then raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation'; end if;

  -- Legal transition check (mirror of the shared state machine).
  v_ok := case
    -- forward path
    when v_order.status = 'placed'           and p_new_status = 'accepted'         and v_actor in ('merchant','admin','dispatcher') then true
    when v_order.status = 'accepted'         and p_new_status = 'preparing'        and v_actor in ('merchant','admin','dispatcher') then true
    when v_order.status = 'preparing'        and p_new_status = 'ready'            and v_actor in ('merchant','admin','dispatcher') then true
    when v_order.status = 'ready'            and p_new_status = 'picked_up'        and v_actor in ('driver','merchant','admin','dispatcher') then true
    when v_order.status = 'picked_up'        and p_new_status = 'out_for_delivery' and v_actor in ('driver','merchant','admin','dispatcher') then true
    when v_order.status = 'out_for_delivery' and p_new_status = 'delivered'        and v_actor in ('driver','merchant','admin','dispatcher') then true
    -- cancel / reject (conservative; admin override broad)
    when v_order.status = 'placed'           and p_new_status = 'rejected'         and v_actor in ('merchant','admin','dispatcher') then true
    when v_order.status = 'accepted'         and p_new_status = 'rejected'         and v_actor in ('merchant','admin','dispatcher') then true
    when v_order.status = 'placed'           and p_new_status = 'cancelled'        and v_actor in ('customer','admin','dispatcher') then true
    when p_new_status = 'cancelled'          and v_actor in ('admin','dispatcher')
         and v_order.status not in ('delivered','cancelled','rejected') then true
    else false
  end;

  if not v_ok then
    raise exception 'ILLEGAL_TRANSITION: % -> %', v_order.status, p_new_status using errcode = 'check_violation';
  end if;

  -- Apply: set status + matching timestamp.
  update public.orders set
    status = p_new_status,
    accepted_at   = case when p_new_status = 'accepted'         then now() else accepted_at end,
    ready_at      = case when p_new_status = 'ready'            then now() else ready_at end,
    picked_up_at  = case when p_new_status = 'picked_up'        then now() else picked_up_at end,
    delivered_at  = case when p_new_status = 'delivered'        then now() else delivered_at end,
    cancel_reason = case when p_new_status in ('cancelled','rejected') then coalesce(p_note, cancel_reason) else cancel_reason end
   where id = p_order_id;

  insert into public.order_status_events (order_id, status, actor_role, actor_id, note)
  values (p_order_id, p_new_status, v_role, v_user, p_note);
end;
$$;

grant execute on function public.advance_order_status(uuid, order_status_type, text) to authenticated;

-- ============================================================================
-- assign_driver — manual dispatch (dispatcher/admin only)
-- ============================================================================
create or replace function public.assign_driver(p_order_id uuid, p_driver_id uuid)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_role app_role := public.auth_role();
  v_user uuid := auth.uid();
begin
  if v_role not in ('admin','dispatcher') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.drivers where id = p_driver_id and is_active) then
    raise exception 'DRIVER_NOT_FOUND' using errcode = 'check_violation';
  end if;

  -- Reassign: mark any prior active assignment reassigned.
  update public.order_assignments
     set status = 'reassigned', responded_at = now()
   where order_id = p_order_id and status in ('offered','accepted');

  insert into public.order_assignments (order_id, driver_id, status, assigned_by, assigned_by_id)
  values (p_order_id, p_driver_id, 'offered', 'dispatcher', v_user);

  update public.orders set assigned_driver_id = p_driver_id where id = p_order_id;
end;
$$;
grant execute on function public.assign_driver(uuid, uuid) to authenticated;

-- ============================================================================
-- driver_respond — accept/reject an offered assignment (the assigned driver)
-- ============================================================================
create or replace function public.driver_respond(p_assignment_id uuid, p_accept boolean)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_asg  public.order_assignments;
  v_drv  public.drivers;
begin
  select * into v_asg from public.order_assignments where id = p_assignment_id for update;
  if not found then raise exception 'ASSIGNMENT_NOT_FOUND' using errcode = 'check_violation'; end if;

  select * into v_drv from public.drivers where id = v_asg.driver_id;
  if v_drv.profile_id is distinct from v_user then
    raise exception 'NOT_YOUR_ASSIGNMENT' using errcode = 'check_violation';
  end if;
  if v_asg.status <> 'offered' then
    raise exception 'ALREADY_RESPONDED' using errcode = 'check_violation';
  end if;

  if p_accept then
    update public.order_assignments set status = 'accepted', responded_at = now() where id = p_assignment_id;
    update public.drivers set status = 'on_job' where id = v_asg.driver_id;
  else
    update public.order_assignments set status = 'rejected', responded_at = now() where id = p_assignment_id;
    update public.orders set assigned_driver_id = null where id = v_asg.order_id;
  end if;
end;
$$;
grant execute on function public.driver_respond(uuid, boolean) to authenticated;

-- ============================================================================
-- mark_cod_collected — COD settlement (the assigned driver, on delivery)
-- ============================================================================
create or replace function public.mark_cod_collected(p_order_id uuid, p_amount int)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_user  uuid := auth.uid();
  v_order public.orders;
  v_drv   public.drivers;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'check_violation'; end if;
  if v_order.payment_method <> 'cash_on_delivery' then
    raise exception 'NOT_A_COD_ORDER' using errcode = 'check_violation';
  end if;

  -- Only the assigned driver (or admin) may settle.
  select * into v_drv from public.drivers where id = v_order.assigned_driver_id;
  if public.auth_role() <> 'admin'
     and (v_drv.profile_id is distinct from v_user) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;

  update public.orders set payment_status = 'paid' where id = p_order_id;

  insert into public.driver_earnings (driver_id, order_id, delivery_fee_share, tip, cod_collected, total)
  values (v_order.assigned_driver_id, p_order_id, v_order.delivery_fee_egp, v_order.tip_egp, coalesce(p_amount, v_order.total_egp), v_order.delivery_fee_egp + v_order.tip_egp)
  on conflict (order_id) do update set cod_collected = excluded.cod_collected;
end;
$$;
grant execute on function public.mark_cod_collected(uuid, int) to authenticated;

-- ============================================================================
-- driver_ping — throttled authoritative position update (drivers call ~20-30s)
-- ============================================================================
create or replace function public.driver_ping(p_lng double precision, p_lat double precision, p_status text default null)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare v_user uuid := auth.uid();
begin
  update public.drivers set
    current_geo = st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
    last_ping_at = now(),
    status = coalesce(nullif(p_status,''), status)
   where profile_id = v_user;
end;
$$;
grant execute on function public.driver_ping(double precision, double precision, text) to authenticated;

-- ============================================================================
-- nearest_drivers — PostGIS nearest available drivers (read-only now; auto later)
-- ============================================================================
create or replace function public.nearest_drivers(p_geo geography, p_radius_m int default 4000, p_limit int default 10)
returns table (driver_id uuid, name text, vehicle vehicle_type, distance_m double precision, status text)
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select d.id, d.name, d.vehicle, st_distance(d.current_geo, p_geo) as distance_m, d.status
  from public.drivers d
  where d.is_active and d.is_verified and d.status = 'online'
    and d.current_geo is not null
    and st_dwithin(d.current_geo, p_geo, p_radius_m)
  order by st_distance(d.current_geo, p_geo) asc
  limit p_limit;
$$;
grant execute on function public.nearest_drivers(geography, int, int) to authenticated;

comment on function public.place_order is
  'Transactional order creation. Recomputes all prices from DB (client total ignored), validates merchant/address/items, writes orders + order_items + first status event atomically. Returns (id, short_code, total).';
comment on function public.advance_order_status is
  'The ONLY writer of orders.status. Enforces the legal state machine per actor role and appends an audit event. Mirrors packages/shared/src/order-status.ts.';


-- ─────────────────────────────────────────────────────────────
-- 012_rls_super_app.sql
-- ─────────────────────────────────────────────────────────────
-- 012_rls_super_app.sql
-- Row Level Security for the four-role super-app. Written/locked LAST so dev
-- iterates fast, then hardened before any real customer data.
--
-- CORE PRINCIPLE — authority by ABSENCE + controlled RPC:
--   The authority columns (orders.status, payment_status, total_egp,
--   assigned_driver_id) get NO direct UPDATE policy for ANY client role. With
--   RLS enabled, "no permissive policy" = deny. Clients mutate orders ONLY via
--   the SECURITY DEFINER RPCs (advance_order_status, assign_driver, ...), which
--   bypass RLS but enforce the state machine + role checks. DO NOT add a
--   permissive UPDATE policy on orders for merchants/drivers/customers — that
--   would let them tamper with status/payment directly.
--
-- Roles: customer | driver | merchant_staff | dispatcher | admin
--   (users.role + merchant_staff link + drivers.profile_id; auth_role() helper)

-- ============================================================================
-- CATALOG (public read already on restaurants/menus/zones/hotels from mig 002).
-- Add: merchant_staff WRITE on their own merchant's catalog; admin all.
-- ============================================================================
-- Restaurants: merchant can update own; admin all.
create policy "restaurants_merchant_update"
  on public.restaurants for update
  using (public.is_merchant_staff(id) or public.auth_role() = 'admin')
  with check (public.is_merchant_staff(id) or public.auth_role() = 'admin');

create policy "restaurants_admin_insert"
  on public.restaurants for insert
  with check (public.auth_role() = 'admin');

-- Menu sections / items / modifiers / options: merchant manages own, admin all.
do $$
declare t text;
begin
  foreach t in array array['menu_sections','menu_items'] loop
    execute format($f$
      create policy "%1$s_merchant_write" on public.%1$I
        for all
        using (public.is_merchant_staff(restaurant_id) or public.auth_role() = 'admin')
        with check (public.is_merchant_staff(restaurant_id) or public.auth_role() = 'admin');
    $f$, t);
  end loop;
end $$;

-- modifiers / modifier_options hang off menu_items (no restaurant_id) — gate via item ownership.
create policy "modifiers_merchant_write"
  on public.modifiers for all
  using (exists (select 1 from public.menu_items mi
                 where mi.id = modifiers.item_id
                   and (public.is_merchant_staff(mi.restaurant_id) or public.auth_role() = 'admin')))
  with check (exists (select 1 from public.menu_items mi
                 where mi.id = modifiers.item_id
                   and (public.is_merchant_staff(mi.restaurant_id) or public.auth_role() = 'admin')));

create policy "modifier_options_merchant_write"
  on public.modifier_options for all
  using (exists (select 1 from public.modifiers m
                 join public.menu_items mi on mi.id = m.item_id
                 where m.id = modifier_options.modifier_id
                   and (public.is_merchant_staff(mi.restaurant_id) or public.auth_role() = 'admin')))
  with check (exists (select 1 from public.modifiers m
                 join public.menu_items mi on mi.id = m.item_id
                 where m.id = modifier_options.modifier_id
                   and (public.is_merchant_staff(mi.restaurant_id) or public.auth_role() = 'admin')));

-- ============================================================================
-- ORDERS — SELECT scoped per role. NO direct UPDATE policy (see CORE PRINCIPLE).
-- Insert is via place_order RPC (definer); we also keep the legacy owner-insert
-- for compatibility but place_order is the real path.
-- ============================================================================
-- Customer already has owner select/insert from mig 002. Add other roles' SELECT.
create policy "orders_merchant_select"
  on public.orders for select
  using (public.is_merchant_staff(restaurant_id));

create policy "orders_driver_select"
  on public.orders for select
  using (exists (select 1 from public.drivers d
                 where d.id = orders.assigned_driver_id and d.profile_id = auth.uid())
         or exists (select 1 from public.order_assignments oa
                 join public.drivers d on d.id = oa.driver_id
                 where oa.order_id = orders.id and d.profile_id = auth.uid()
                   and oa.status in ('offered','accepted')));

create policy "orders_staff_admin_select"
  on public.orders for select
  using (public.auth_role() in ('admin','dispatcher'));

-- ============================================================================
-- ORDER_ITEMS / ORDER_STATUS_EVENTS — readable by anyone who can read the order.
-- ============================================================================
create policy "order_items_select_via_order"
  on public.order_items for select
  using (exists (select 1 from public.orders o where o.id = order_items.order_id and (
            o.user_id = auth.uid()
            or public.is_merchant_staff(o.restaurant_id)
            or public.auth_role() in ('admin','dispatcher')
            or exists (select 1 from public.drivers d where d.id = o.assigned_driver_id and d.profile_id = auth.uid())
         )));

create policy "order_status_events_select_via_order"
  on public.order_status_events for select
  using (exists (select 1 from public.orders o where o.id = order_status_events.order_id and (
            o.user_id = auth.uid()
            or public.is_merchant_staff(o.restaurant_id)
            or public.auth_role() in ('admin','dispatcher')
            or exists (select 1 from public.drivers d where d.id = o.assigned_driver_id and d.profile_id = auth.uid())
         )));

-- ============================================================================
-- DRIVERS — own profile read/update; public-safe info via a VIEW; admin all.
-- ============================================================================
create policy "drivers_self_select"
  on public.drivers for select
  using (profile_id = auth.uid() or public.auth_role() in ('admin','dispatcher'));

create policy "drivers_self_update"
  on public.drivers for update
  using (profile_id = auth.uid() or public.auth_role() = 'admin')
  with check (profile_id = auth.uid() or public.auth_role() = 'admin');

create policy "drivers_admin_insert"
  on public.drivers for insert
  with check (public.auth_role() = 'admin');

-- Public driver card (customer tracking) — name/photo/vehicle/rating only, never phone/earnings.
create or replace view public.public_drivers as
  select id, name, photo, vehicle, rating from public.drivers where is_active;

grant select on public.public_drivers to anon, authenticated;

-- ============================================================================
-- ORDER_ASSIGNMENTS — driver sees own; dispatcher/admin all. Writes via RPC.
-- ============================================================================
create policy "order_assignments_driver_select"
  on public.order_assignments for select
  using (exists (select 1 from public.drivers d where d.id = order_assignments.driver_id and d.profile_id = auth.uid())
         or public.auth_role() in ('admin','dispatcher'));

-- ============================================================================
-- DRIVER_EARNINGS — driver sees own; admin all.
-- ============================================================================
create policy "driver_earnings_self_select"
  on public.driver_earnings for select
  using (exists (select 1 from public.drivers d where d.id = driver_earnings.driver_id and d.profile_id = auth.uid())
         or public.auth_role() = 'admin');

-- ============================================================================
-- MERCHANT_STAFF — staffer sees own links; admin all.
-- ============================================================================
create policy "merchant_staff_self_select"
  on public.merchant_staff for select
  using (profile_id = auth.uid() or public.auth_role() = 'admin');

create policy "merchant_staff_admin_write"
  on public.merchant_staff for all
  using (public.auth_role() = 'admin')
  with check (public.auth_role() = 'admin');

-- ============================================================================
-- CONFIG — fee rules + platform settings: read by staff/admin; write by admin.
-- ============================================================================
create policy "delivery_fee_rules_read"
  on public.delivery_fee_rules for select using (true);  -- safe to read (used by quote)
create policy "delivery_fee_rules_admin_write"
  on public.delivery_fee_rules for all
  using (public.auth_role() = 'admin') with check (public.auth_role() = 'admin');

create policy "platform_settings_read"
  on public.platform_settings for select using (true);   -- dispatch_mode etc. are non-sensitive
create policy "platform_settings_admin_write"
  on public.platform_settings for all
  using (public.auth_role() = 'admin') with check (public.auth_role() = 'admin');

comment on view public.public_drivers is
  'Public-safe driver columns for the customer tracking card. Excludes phone, earnings, current_geo. Use this in client reads; never select drivers directly as a customer.';


-- ─────────────────────────────────────────────────────────────
-- 013_realtime_publication.sql
-- ─────────────────────────────────────────────────────────────
-- 013_realtime_publication.sql
-- Realtime: which tables broadcast Postgres changes to subscribed clients.
--
-- orders is already in supabase_realtime (mig 002). Add the new tables that the
-- dashboards subscribe to:
--   * order_status_events -> the customer tracking timeline + merchant queue feel
--   * order_assignments   -> the driver app (new offers) + admin dispatch board
--
-- NOTE: live driver GPS does NOT go through Realtime postgres_changes (that would
-- be thousands of throwaway writes). It uses Realtime BROADCAST on a per-order
-- channel (order:{id}:driver_loc), which needs no table and no publication entry.
-- See the live-tracking design in the plan.

do $$
begin
  -- order_status_events
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'order_status_events'
  ) then
    alter publication supabase_realtime add table public.order_status_events;
  end if;

  -- order_assignments
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'order_assignments'
  ) then
    alter publication supabase_realtime add table public.order_assignments;
  end if;
end $$;

-- Ensure REPLICA IDENTITY FULL on tables whose UPDATEs we filter/track, so
-- subscribers receive old + new row values on update (needed for some filters).
alter table public.orders            replica identity full;
alter table public.order_assignments replica identity full;


-- ─────────────────────────────────────────────────────────────
-- 014_push_tokens.sql
-- ─────────────────────────────────────────────────────────────
-- 014_push_tokens.sql
-- Expo push tokens for status notifications (customer + driver apps).
--
-- One row per (user, device token). The expo-push edge function reads this to
-- fan out order notifications. Users register their token on app launch.
--
-- Non-destructive: new table + RLS.

create table if not exists public.push_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  token       text not null,
  platform    text,                          -- 'ios' | 'android' | 'web'
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, token)
);

create index if not exists push_tokens_user_idx on public.push_tokens (user_id);

create trigger push_tokens_touch_updated_at before update on public.push_tokens
  for each row execute function public.touch_updated_at();

alter table public.push_tokens enable row level security;

-- Users manage their own tokens.
create policy "push_tokens_owner_all"
  on public.push_tokens for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table public.push_tokens is
  'Expo push tokens per user/device. expo-push edge function reads this (service-role) to deliver order status notifications.';


-- ─────────────────────────────────────────────────────────────
-- 015_fix_self_delivery_cod.sql
-- ─────────────────────────────────────────────────────────────
-- 015_fix_self_delivery_cod.sql
-- Fix: self-delivery merchants could deliver a COD order but never settle it.
--
-- The original mark_cod_collected (mig 011) authorized ONLY the assigned driver
-- or an admin, and always inserted a driver_earnings row. Self-delivery orders
-- have assigned_driver_id = NULL and no driver, so:
--   (a) a self-delivering merchant got NOT_AUTHORIZED → payment_status stuck
--       'pending' forever, and
--   (b) the driver_earnings insert would violate its NOT NULL driver_id FK.
--
-- This migration replaces mark_cod_collected so that:
--   * the assigned driver OR an admin can settle (unchanged), AND
--   * for self_delivery orders, a merchant_staff member of the order's
--     restaurant can settle, AND
--   * driver_earnings is written ONLY when a driver was actually assigned
--     (platform orders). Self-delivery keeps 100% of the cash at the merchant;
--     the platform cut is taken via restaurants.commission_pct at reconciliation,
--     which is NOT a driver-earnings concern.
--
-- The platform/driver COD path is unchanged (verified working: SE-2UGM5S settled
-- with fee_share=30, tip=15).

create or replace function public.mark_cod_collected(p_order_id uuid, p_amount int)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_user   uuid := auth.uid();
  v_order  public.orders;
  v_drv    public.drivers;
  v_role   app_role := public.auth_role();
  v_is_self boolean;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'check_violation'; end if;
  if v_order.payment_method <> 'cash_on_delivery' then
    raise exception 'NOT_A_COD_ORDER' using errcode = 'check_violation';
  end if;

  v_is_self := (v_order.fulfillment_type = 'self_delivery');

  -- The assigned driver (if any) — used both for authz and the earnings branch.
  select * into v_drv from public.drivers where id = v_order.assigned_driver_id;

  -- Authorize the settler:
  --   admin always; the assigned driver; OR (self_delivery) staff of the
  --   order's restaurant.
  if v_role = 'admin' then
    null;  -- ok
  elsif v_drv.id is not null and v_drv.profile_id is not distinct from v_user then
    null;  -- ok: the assigned driver
  elsif v_is_self and public.is_merchant_staff(v_order.restaurant_id) then
    null;  -- ok: self-delivery merchant settling their own order
  else
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;

  -- Settle payment for ALL fulfillment types.
  update public.orders set payment_status = 'paid' where id = p_order_id;

  -- Driver-earnings ledger ONLY when an actual driver delivered (platform).
  -- Self-delivery has no driver row, and driver_earnings.driver_id is NOT NULL,
  -- so we intentionally skip it; merchant settlement happens via commission_pct.
  if v_order.assigned_driver_id is not null then
    insert into public.driver_earnings (driver_id, order_id, delivery_fee_share, tip, cod_collected, total)
    values (
      v_order.assigned_driver_id, p_order_id,
      v_order.delivery_fee_egp, v_order.tip_egp,
      coalesce(p_amount, v_order.total_egp),
      v_order.delivery_fee_egp + v_order.tip_egp
    )
    on conflict (order_id) do update set cod_collected = excluded.cod_collected;
  end if;
end;
$$;

grant execute on function public.mark_cod_collected(uuid, int) to authenticated;

comment on function public.mark_cod_collected is
  'COD settlement. Authorized: admin, the assigned driver, or (self_delivery) staff of the order''s restaurant. Writes driver_earnings only when a driver was assigned; self-delivery cash is reconciled via restaurants.commission_pct.';

-- ─────────────────────────────────────────────────────────────
-- 016_modifier_presentation.sql
-- ─────────────────────────────────────────────────────────────
-- 016_modifier_presentation.sql
-- Add the presentation columns the customer app's rich item UI relies on.
--
-- The app's TypeScript Modifier/ModifierOption types (apps/customer/src/data/
-- types.ts) carry `style`, `subtitle`, `step` (modifier) and `icon`, `subtitle`,
-- `popular`, `image`, `adds_flags` (option) — these drive the size pills,
-- ingredient chips ("No onions"), and add-on cards. But migration 002 only
-- created the bare modifier columns, so in live mode every group fell back to
-- the default 'list' style and the rich UI was lost.
--
-- These columns are additive and nullable; existing rows/RPCs are unaffected.
-- place_order does not read them (it sums price_delta_egp + snapshots name), so
-- pricing/authority is unchanged.

alter table public.modifiers
  add column if not exists style    text,            -- 'list'|'ingredients'|'addons'|'builder'|'size' (null => 'list')
  add column if not exists subtitle text,            -- helper line under the group title
  add column if not exists step     int;             -- builder-flow step order

alter table public.modifiers
  add constraint modifiers_style_chk
    check (style is null or style in ('list','ingredients','addons','builder','size')) not valid;
alter table public.modifiers validate constraint modifiers_style_chk;

alter table public.modifier_options
  add column if not exists icon      text,           -- emoji/icon for add-on cards ('🧀','🥓')
  add column if not exists subtitle  text,           -- tagline under the option name
  add column if not exists popular   boolean not null default false,  -- highlight a recommended option
  add column if not exists image     text,           -- optional thumbnail URL
  add column if not exists adds_flags item_flag_type[];            -- flags this option adds (e.g. bacon → contains_pork)

comment on column public.modifiers.style is
  'Presentation hint for the item modal: list (default radio/checkbox), ingredients (tap-to-remove chips), addons (cards), builder (labeled step), size (segmented pills).';
comment on column public.modifier_options.popular is
  'When true, the add-on card shows a ★ Popular badge.';


-- ─────────────────────────────────────────────────────────────
-- 017_zone_centroids_tuning.sql
-- ─────────────────────────────────────────────────────────────
-- 017_zone_centroids_tuning.sql
-- Tune zone centroids to real Sharm el-Sheikh geography.
--
-- The mig 005 centroids placed Soho (34.3270, 27.9170) almost on top of Naama
-- (34.3300, 27.9100) — ~400m apart — so resolve_zone_nearest() (nearest-centroid)
-- was ambiguous for pins near Naama (a Naama pin resolved to 'soho' in testing).
--
-- These coordinates are corrected to the actual neighborhoods (lng, lat order),
-- well-separated so nearest-centroid resolves correctly until precise `boundary`
-- polygons are added (resolution already prefers ST_Contains when boundary is set).
--
-- Reference anchors (real): Sharm centre 34.3299/27.9158; Naama Bay 34.3267/27.9133;
-- Ras Um El Sid (Hadaba) 34.3104/27.8482. North→south along the coast:
-- Nabq (far north, by airport) → Sharks Bay → Soho/White Knight → Naama Bay →
-- Hadaba/Old Market (south headland) → inland residential (El Salam, Mubarak 7,
-- Rowaisat, Hay El Nour).

-- Tourist coastal strip (north → south)
update public.zones set centroid = st_setsrid(st_makepoint(34.4250, 27.9750), 4326)::geography where id = 'nabq';        -- far north, near airport
update public.zones set centroid = st_setsrid(st_makepoint(34.3560, 27.9200), 4326)::geography where id = 'sharks_bay';  -- north of Naama
update public.zones set centroid = st_setsrid(st_makepoint(34.3470, 27.9270), 4326)::geography where id = 'soho';        -- Soho/White Knight, NE of Naama (was overlapping Naama)
update public.zones set centroid = st_setsrid(st_makepoint(34.3267, 27.9133), 4326)::geography where id = 'naama';       -- Naama Bay (real coords)

-- Southern headland / old town
update public.zones set centroid = st_setsrid(st_makepoint(34.3050, 27.8560), 4326)::geography where id = 'hadaba';      -- Hadaba / Ras Um El Sid plateau
update public.zones set centroid = st_setsrid(st_makepoint(34.2920, 27.8520), 4326)::geography where id = 'old_market';  -- Old Market (south)

-- Inland residential belt (west of the coast, spread so they don't collide)
update public.zones set centroid = st_setsrid(st_makepoint(34.3180, 27.8880), 4326)::geography where id = 'el_salam';
update public.zones set centroid = st_setsrid(st_makepoint(34.3120, 27.8700), 4326)::geography where id = 'mubarak_7';
update public.zones set centroid = st_setsrid(st_makepoint(34.3260, 27.8950), 4326)::geography where id = 'el_rowaisat';
update public.zones set centroid = st_setsrid(st_makepoint(34.3050, 27.8820), 4326)::geography where id = 'hay_el_nour';
update public.zones set centroid = st_setsrid(st_makepoint(34.2980, 27.8640), 4326)::geography where id = 'el_hadaba_residential';

