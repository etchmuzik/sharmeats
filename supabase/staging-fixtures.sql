-- ============================================================================
-- staging-fixtures.sql — STAGING ONLY. NEVER APPLY TO PROD.
-- ============================================================================
-- Fixtures for the Maestro customer cash-on-delivery E2E flow
-- (.maestro/customer-order-cod.yaml — contract in .maestro/README.md).
-- Applied by scripts/staging-local-up.sh AFTER all migrations + seed.sql +
-- seed_menus_3restaurants.sql, against the LOCAL supabase stack only
-- (127.0.0.1:54322). It inserts a synthetic auth user, mutates the catalog
-- for test determinism, and cancels the fixture account's open orders — all
-- of which would corrupt a production database.
--
-- Idempotent: fixed UUIDs + on-conflict upserts; safe to re-run before every
-- Maestro run (it also performs the per-run hygiene the README demands:
-- no active order, empty server cart).
--
-- Fixture values (must match the exports printed by staging-local-up.sh):
--   phone                 +201000000000  (config.toml [auth.sms.test_otp]
--                                         key 201000000000 = "000000";
--                                         GoTrue stores phone WITHOUT '+')
--   OTP                   000000
--   user id               e2e00000-0000-4000-8000-000000000001
--   hotel id              e2e00000-0000-4000-8000-000000000002
--   address id            e2e00000-0000-4000-8000-000000000003  (CUSTOMER_E2E_ADDRESS_ID)
--   restaurant id         e2e00000-0000-4000-8000-000000000010  ('Fixture Restaurant')
--   menu section id       e2e00000-0000-4000-8000-000000000011
--   menu item id          e2e00000-0000-4000-8000-000000000012  ('Fixture Item', 120 EGP)
--
-- place_order (latest body: mig 214) validations and how each is satisfied:
--   AUTH_REQUIRED            caller signs in via test OTP as the fixture user
--   USER_BLOCKED             users.is_blocked = false
--   TOO_MANY_ACTIVE_ORDERS   hygiene block cancels the fixture user's open COD orders
--   NEW_USER_ORDER_LIMIT     users.created_at backdated 30 days (branch never engages)
--   EMPTY_CART               flow adds 1 item
--   MERCHANT_NOT_FOUND       fixture restaurant row exists; vertical 'food' is
--                            is_active + launch_stage 'public' (migs 006/152), so
--                            user_can_view_vertical() passes for any user
--   MERCHANT_CLOSED          is_active = true, is_open = true (is_open_24h = true so
--                            client-side hour gates can never hide it either)
--   CASH_NOT_ACCEPTED        accepts_cash = true
--   ADDRESS_NOT_FOUND        fixture address belongs to the fixture user
--   OUT_OF_RANGE             delivery_feasibility: restaurant geo ~55 m from the
--                            address geo (both in Naama, well under the 8 km
--                            max_delivery_radius_m default)
--   ITEM_NOT_FOUND/UNAVAILABLE  'Fixture Item' belongs to the restaurant, is_available
--   BELOW_MIN_ORDER          item 120 EGP >= min_order_egp 50
--   zone pricing             resolve_zone_nearest(address.geo) = 'naama', priced in
--                            delivery_fee_rules ('naama','food', 30 EGP) since mig 010
--   terms consent (client)   users.terms_accepted_version = '2026-07-11'
--                            (apps/customer/src/legal.ts CURRENT_TERMS_VERSION)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Staging auth user (fixed uuid, phone-OTP shaped the way GoTrue expects).
--    GoTrue's test-OTP verify looks the user up by phone WITHOUT the '+'
--    ('201000000000'); it must find THIS row and log into it — a mismatch
--    would make GoTrue sign up a brand-new user (sms signup is enabled) whose
--    id would not own the fixture address.
-- ----------------------------------------------------------------------------

-- Fail loudly if some other auth user already holds the test phone: GoTrue
-- would log into THAT account and the fixture address would not be selectable.
do $$
begin
  if exists (
    select 1 from auth.users
     where phone = '201000000000'
       and id <> 'e2e00000-0000-4000-8000-000000000001'::uuid
  ) then
    raise exception 'staging-fixtures: phone 201000000000 is held by a different auth user. '
                    'Wipe the local stack (supabase stop --no-backup) and re-run staging-local-up.sh.';
  end if;
end $$;

-- NOTE: confirmed_at is a GENERATED column (from email/phone_confirmed_at) —
-- never insert it. The ''-instead-of-NULL token columns are deliberate:
-- GoTrue scans them into Go strings and errors on NULL.
insert into auth.users (
  instance_id, id, aud, role,
  email, encrypted_password,
  phone, phone_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, last_sign_in_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  is_sso_user, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000',
  'e2e00000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated',
  null, '',
  '201000000000', now(),
  '{"provider":"phone","providers":["phone"]}'::jsonb,
  '{"display_name":"E2E Fixture"}'::jsonb,
  now() - interval '30 days', now(), null,
  '', '', '', '',
  false, false
)
on conflict (id) do update set
  phone              = excluded.phone,
  phone_confirmed_at = coalesce(auth.users.phone_confirmed_at, now()),
  raw_app_meta_data  = excluded.raw_app_meta_data,
  updated_at         = now();

-- Phone identity, as GoTrue creates for phone signups (provider_id = user id).
insert into auth.identities (
  id, provider_id, user_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
) values (
  'e2e00000-0000-4000-8000-0000000000aa',
  'e2e00000-0000-4000-8000-000000000001',
  'e2e00000-0000-4000-8000-000000000001',
  jsonb_build_object(
    'sub',            'e2e00000-0000-4000-8000-000000000001',
    'phone',          '201000000000',
    'phone_verified', true,
    'email_verified', false
  ),
  'phone',
  null, now(), now()
)
on conflict (provider_id, provider) do nothing;

-- ----------------------------------------------------------------------------
-- 2) public.users row. The on_auth_user_created trigger (mig 002) creates it
--    on the INSERT path above, but on re-runs (conflict-update) it does not
--    fire — so upsert explicitly and make the row deterministic either way.
--    created_at is backdated so place_order's new-user 24h COD branch never
--    engages; terms acceptance matches CURRENT_TERMS_VERSION so the
--    TermsConsentGate never covers the catalog (README contract).
-- ----------------------------------------------------------------------------
insert into public.users (id, phone, display_name, locale, preferred_currency, created_at)
values (
  'e2e00000-0000-4000-8000-000000000001',
  '+201000000000', 'E2E Fixture', 'en', 'EGP',
  now() - interval '30 days'
)
on conflict (id) do update set
  phone        = excluded.phone,
  display_name = excluded.display_name,
  locale       = excluded.locale,
  created_at   = excluded.created_at;

update public.users
   set terms_accepted_version = '2026-07-11',  -- apps/customer/src/legal.ts CURRENT_TERMS_VERSION
       terms_accepted_at      = coalesce(terms_accepted_at, now()),
       is_blocked             = false
 where id = 'e2e00000-0000-4000-8000-000000000001';

-- ----------------------------------------------------------------------------
-- 3) Verified fixture hotel in a priced zone (naama: delivery_fee_rules row
--    ('naama','food') seeded by mig 010).
-- ----------------------------------------------------------------------------
insert into public.hotels (id, name, brand, zone, reception_phone, verified)
values (
  'e2e00000-0000-4000-8000-000000000002',
  'Fixture Hotel', null, 'naama', '+201000000000', true
)
on conflict (id) do update set
  name = excluded.name, zone = excluded.zone,
  reception_phone = excluded.reception_phone, verified = true;

-- ----------------------------------------------------------------------------
-- 4) Hotel-kind default address for the fixture user (this uuid is
--    CUSTOMER_E2E_ADDRESS_ID — the flow taps testID address-option-<uuid>).
--    geo sits ~55 m from the fixture restaurant, inside the naama zone
--    centroid radius and the Sharm service bbox.
-- ----------------------------------------------------------------------------
-- Partial unique index addresses_one_default_per_user: clear any other default first.
update public.addresses
   set is_default = false
 where user_id = 'e2e00000-0000-4000-8000-000000000001'
   and id <> 'e2e00000-0000-4000-8000-000000000003'
   and is_default;

insert into public.addresses (
  id, user_id, kind, label,
  hotel_id, hotel_name, room_number, handoff,
  is_default, geo
) values (
  'e2e00000-0000-4000-8000-000000000003',
  'e2e00000-0000-4000-8000-000000000001',
  'hotel', 'Fixture Hotel',
  'e2e00000-0000-4000-8000-000000000002', 'Fixture Hotel', '101', 'reception',
  true,
  st_setsrid(st_makepoint(34.3310, 27.9105), 4326)::geography
)
on conflict (id) do update set
  user_id = excluded.user_id, kind = excluded.kind, label = excluded.label,
  hotel_id = excluded.hotel_id, hotel_name = excluded.hotel_name,
  room_number = excluded.room_number, handoff = excluded.handoff,
  is_default = true, geo = excluded.geo;

update public.users
   set default_address_id = 'e2e00000-0000-4000-8000-000000000003'
 where id = 'e2e00000-0000-4000-8000-000000000001';

-- ----------------------------------------------------------------------------
-- 5) 'Fixture Restaurant' — open 24h, COD-only, food vertical, naama, geo next
--    to the hotel. Columns later migrations added NOT NULL all carry defaults
--    (fulfillment_type/commission_pct/accepts_* mig 006, onboarding_status
--    mig 123, merchant_type mig 126) — the load-bearing ones are set
--    explicitly anyway. cuisines must not contain grocery/pharmacy
--    (restaurants_cuisines_food_only, mig 20260730162600).
-- ----------------------------------------------------------------------------
insert into public.restaurants (
  id, slug, name, description, cuisines, cuisine_label, cover_image, zone,
  rating, rating_count, prep_time_low, prep_time_high,
  delivery_fee_egp, min_order_egp, distance_meters, tourist_safe,
  is_open, is_open_24h, featured, is_active,
  vertical_id, fulfillment_type, commission_pct, accepts_cash, accepts_card, geo
) values (
  'e2e00000-0000-4000-8000-000000000010',
  'fixture-restaurant', 'Fixture Restaurant',
  'Staging fixture for the Maestro COD smoke. Never enable in production.',
  array['egyptian']::cuisine_type[], 'E2E fixture', '', 'naama',
  5.0, 9999, 10, 15,
  25, 50, 100, true,
  true, true, true, true,
  'food', 'platform', 15.0, true, false,
  st_setsrid(st_makepoint(34.3305, 27.9107), 4326)::geography
)
on conflict (id) do update set
  slug = excluded.slug, name = excluded.name, zone = excluded.zone,
  rating = excluded.rating, rating_count = excluded.rating_count,
  min_order_egp = excluded.min_order_egp, delivery_fee_egp = excluded.delivery_fee_egp,
  is_open = true, is_open_24h = true, featured = true, is_active = true,
  vertical_id = 'food', fulfillment_type = 'platform',
  accepts_cash = true, accepts_card = false,
  busy_until = null, busy_extra_minutes = 0,  -- NOT NULL default 0 (mig 186)
  geo = excluded.geo;

-- DETERMINISM (staging-only): the Maestro flow asserts the restaurant name is
-- visible WITHOUT scrolling (extendedWaitUntil/tapOn do not scroll), and
-- seed.sql activates ~40 real-directory venues that would push the fixture
-- below the fold. Hide everything except the fixture. Re-running seed.sql
-- reactivates them; this file re-hides them — the pair is stable per run.
update public.restaurants
   set is_active = false
 where id <> 'e2e00000-0000-4000-8000-000000000010'
   and is_active;

insert into public.menu_sections (id, restaurant_id, name, sort_order)
values (
  'e2e00000-0000-4000-8000-000000000011',
  'e2e00000-0000-4000-8000-000000000010',
  'Fixture Menu', 1
)
on conflict (id) do update set
  restaurant_id = excluded.restaurant_id, name = excluded.name;

-- One available item, no modifiers, price (120) comfortably above min order (50)
-- and within menu_items_price_bounds_chk 1..10000 (mig 132).
insert into public.menu_items (
  id, restaurant_id, section_id, name, description, price_egp,
  image, flags, is_available, sort_order
) values (
  'e2e00000-0000-4000-8000-000000000012',
  'e2e00000-0000-4000-8000-000000000010',
  'e2e00000-0000-4000-8000-000000000011',
  'Fixture Item', 'One deterministic item for the COD smoke.', 120,
  '', array[]::item_flag_type[], true, 1
)
on conflict (id) do update set
  restaurant_id = excluded.restaurant_id, section_id = excluded.section_id,
  name = excluded.name, price_egp = excluded.price_egp, is_available = true;

-- Contract: NO modifiers on the fixture item (the item sheet must be a plain
-- add-to-cart). Defensive delete in case someone attached one by hand.
delete from public.modifiers where item_id = 'e2e00000-0000-4000-8000-000000000012';

-- ----------------------------------------------------------------------------
-- 6) Per-run hygiene (README: start each run with no active order and an
--    empty server cart). Cancelling matches the platform's own semantics —
--    orders are financial records and are never deleted.
-- ----------------------------------------------------------------------------
update public.orders
   set status = 'cancelled'
 where user_id = 'e2e00000-0000-4000-8000-000000000001'
   and status not in ('delivered','cancelled','rejected');

delete from public.customer_carts
 where user_id = 'e2e00000-0000-4000-8000-000000000001';

-- ----------------------------------------------------------------------------
-- 7) Sanity assertions — raise if the fixture triple violates anything the
--    COD flow (and place_order, mig 214) depends on.
-- ----------------------------------------------------------------------------

-- Auth wiring: GoTrue must find this exact user by the test-OTP phone.
do $$
declare u auth.users;
begin
  select * into u from auth.users where id = 'e2e00000-0000-4000-8000-000000000001';
  assert found, 'fixture auth user missing';
  assert u.phone = '201000000000', 'auth phone must be 201000000000 (no +) to match [auth.sms.test_otp]';
  assert u.phone_confirmed_at is not null, 'auth phone must be confirmed';
  assert u.aud = 'authenticated' and u.role = 'authenticated', 'auth aud/role wrong';
end $$;

-- App user: unblocked, current terms accepted, old enough to skip new-user caps.
do $$
declare u public.users;
begin
  select * into u from public.users where id = 'e2e00000-0000-4000-8000-000000000001';
  assert found, 'fixture public.users row missing';
  assert coalesce(u.is_blocked, false) = false, 'fixture user is blocked';
  assert u.terms_accepted_version = '2026-07-11',
    'terms_accepted_version must equal CURRENT_TERMS_VERSION (apps/customer/src/legal.ts)';
  assert u.created_at < now() - interval '25 hours', 'user must predate the 24h new-user COD cap window';
end $$;

-- Restaurant: open + active + cash + 24h + live food vertical.
do $$
declare r public.restaurants;
begin
  select * into r from public.restaurants where id = 'e2e00000-0000-4000-8000-000000000010';
  assert found, 'fixture restaurant missing';
  assert r.name = 'Fixture Restaurant', 'restaurant name drifted from the Maestro contract';
  assert r.is_active and r.is_open and coalesce(r.is_open_24h, false), 'restaurant must be active/open/24h';
  assert r.accepts_cash, 'restaurant must accept cash (COD flow)';
  assert r.vertical_id = 'food', 'restaurant must be food vertical';
  assert public.vertical_effective_stage('food') = 'public',
    'food vertical must be public (user_can_view_vertical gate in place_order)';
  assert r.geo is not null, 'restaurant geo required for delivery_feasibility';
end $$;

-- Item: available, no modifiers, meets the minimum order on its own.
do $$
declare i public.menu_items; r public.restaurants; n int;
begin
  select * into i from public.menu_items where id = 'e2e00000-0000-4000-8000-000000000012';
  assert found, 'fixture item missing';
  assert i.name = 'Fixture Item', 'item name drifted from the Maestro contract';
  assert i.is_available, 'fixture item must be available';
  assert i.restaurant_id = 'e2e00000-0000-4000-8000-000000000010', 'item belongs to the wrong restaurant';
  select * into r from public.restaurants where id = i.restaurant_id;
  assert i.price_egp >= r.min_order_egp, 'single item must meet the restaurant minimum order';
  select count(*) into n from public.modifiers where item_id = i.id;
  assert n = 0, 'fixture item must have NO modifiers';
end $$;

-- Address: belongs to the user, hotel kind at a VERIFIED hotel, default, has geo.
do $$
declare a public.addresses; h public.hotels;
begin
  select * into a from public.addresses where id = 'e2e00000-0000-4000-8000-000000000003';
  assert found, 'fixture address missing';
  assert a.user_id = 'e2e00000-0000-4000-8000-000000000001', 'address must belong to the fixture user';
  assert a.kind = 'hotel' and a.room_number is not null, 'address must be hotel kind with a room';
  assert a.is_default, 'address must be the default';
  assert a.geo is not null, 'address geo required for radius/zone checks';
  select * into h from public.hotels where id = a.hotel_id;
  assert found and h.verified, 'fixture hotel must exist and be verified';
end $$;

-- Geometry: in range per the real RPC, and the resolved zone is priced.
do $$
declare
  a_geo geography; v_in boolean; v_eta int; v_zone zone_type; v_fee int;
begin
  select geo into a_geo from public.addresses where id = 'e2e00000-0000-4000-8000-000000000003';

  select f.in_range, f.eta_minutes into v_in, v_eta
    from public.delivery_feasibility('e2e00000-0000-4000-8000-000000000010'::uuid, a_geo) f;
  assert coalesce(v_in, false), 'delivery_feasibility says OUT_OF_RANGE for the fixture pair';
  assert v_eta is not null and v_eta > 0, 'delivery_feasibility returned no ETA';

  v_zone := public.resolve_zone_nearest(a_geo);
  assert v_zone is not null, 'address resolves to no service zone (mig 128 guard)';
  assert exists (
    select 1 from public.delivery_fee_rules
     where zone_id = v_zone and (vertical_id = 'food' or vertical_id is null)
  ), 'resolved zone has no delivery_fee_rules pricing';

  v_fee := public.quote_delivery_fee('e2e00000-0000-4000-8000-000000000010'::uuid, a_geo, 120);
  assert v_fee is not null and v_fee >= 0, 'quote_delivery_fee returned nothing';
end $$;

-- Clean-slate: no active order, no server cart (README per-run contract).
do $$
declare n int;
begin
  select count(*) into n from public.orders
   where user_id = 'e2e00000-0000-4000-8000-000000000001'
     and status not in ('delivered','cancelled','rejected');
  assert n = 0, 'fixture user still has active orders after hygiene pass';
  select count(*) into n from public.customer_carts
   where user_id = 'e2e00000-0000-4000-8000-000000000001';
  assert n = 0, 'fixture user still has a server cart after hygiene pass';
end $$;
