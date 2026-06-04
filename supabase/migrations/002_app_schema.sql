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
