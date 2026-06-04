-- seed.sql — Sharm Eats dev/pilot seed (food vertical).
--
-- Idempotent: safe to run multiple times. Mirrors the customer app's mock data
-- (same restaurant ids/names/zones) so flipping EXPO_PUBLIC_USE_SUPABASE=true
-- shows identical content. Adds real Sharm GEO coordinates so dispatch + zone
-- resolution are testable, plus test drivers and an admin.
--
-- Run AFTER migrations 001-014.
--   supabase db reset           (local: applies migrations + this seed)
--   or psql < supabase/seed.sql (against a fresh project)
--
-- Auth note: real users come from auth.users (phone OTP). For dev you can create
-- an admin by signing up then: update public.users set role='admin' where ...;
-- The drivers below are seeded without auth profiles (profile_id null) so the
-- dispatch board has fleet to show; link profile_id when a driver signs up.

-- ============================================================================
-- RESTAURANTS (mirror mock ids; add geo within each zone)
-- ============================================================================
insert into public.restaurants
  (id, slug, name, description, cuisines, cuisine_label, cover_image, zone,
   rating, rating_count, prep_time_low, prep_time_high, delivery_fee_egp,
   min_order_egp, distance_meters, tourist_safe, is_open, is_active,
   vertical_id, fulfillment_type, commission_pct, accepts_cash, accepts_card, geo)
values
  ('11111111-0000-0000-0000-000000000001', 'trattoria-del-mare', 'Trattoria del Mare',
   'Authentic Italian by chef Marco Bellini. Wood-fire oven at 480°C.',
   array['italian','pizza','seafood']::cuisine_type[], 'Italian · Wood-fire pizza',
   'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=900&q=70&auto=format&fit=crop',
   'sharks_bay', 4.7, 284, 25, 30, 30, 120, 1400, true, true, true,
   'food', 'platform', 12.0, true, true,
   st_setsrid(st_makepoint(34.3490, 27.9240), 4326)::geography),

  ('11111111-0000-0000-0000-000000000002', 'abou-el-sid', 'Abou El Sid',
   'Classic Cairene cooking — molokhia, mahshi, kofta, fattah. Halal-certified.',
   array['egyptian']::cuisine_type[], 'Egyptian · Traditional',
   'https://images.unsplash.com/photo-1559339352-11d035aa65de?w=900&q=70&auto=format&fit=crop',
   'naama', 4.8, 1217, 30, 40, 25, 100, 2100, true, true, true,
   'food', 'platform', 12.0, true, true,
   st_setsrid(st_makepoint(34.3310, 27.9105), 4326)::geography),

  ('11111111-0000-0000-0000-000000000003', 'sushi-roku', 'Sushi Roku',
   'Japanese omakase. English menu, allergen flags, full kitchen photos.',
   array['sushi','asian']::cuisine_type[], 'Japanese · Omakase',
   'https://images.unsplash.com/photo-1579584425555-c3ce17fd4351?w=900&q=70&auto=format&fit=crop',
   'naama', 4.6, 189, 35, 45, 45, 200, 1800, true, true, true,
   'food', 'platform', 12.0, false, true,           -- card-only (exercises CARD_NOT/CASH guard)
   st_setsrid(st_makepoint(34.3280, 27.9120), 4326)::geography),

  ('11111111-0000-0000-0000-000000000004', 'koshary-tahrir', 'Koshary El Tahrir',
   'Egypt''s favorite street food. Cash-friendly, fast, resident-loved.',
   array['egyptian','street_food']::cuisine_type[], 'Egyptian · Street food',
   'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=900&q=70&auto=format&fit=crop',
   'hadaba', 4.5, 530, 10, 20, 25, 50, 900, false, true, true,
   'food', 'self_delivery', 12.0, true, false,      -- COD-only + self-delivery (exercises both)
   st_setsrid(st_makepoint(34.3005, 27.8605), 4326)::geography),

  ('11111111-0000-0000-0000-000000000005', 'burger-boutique', 'Burger Boutique',
   'Smashed-patty burgers, hand-cut fries, milkshakes.',
   array['burgers']::cuisine_type[], 'Burgers · American',
   'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=900&q=70&auto=format&fit=crop',
   'soho', 4.4, 412, 20, 30, 30, 90, 1100, true, true, true,
   'food', 'platform', 12.0, true, true,
   st_setsrid(st_makepoint(34.3272, 27.9168), 4326)::geography)
on conflict (id) do update set
  geo = excluded.geo,
  vertical_id = excluded.vertical_id,
  fulfillment_type = excluded.fulfillment_type,
  accepts_cash = excluded.accepts_cash,
  accepts_card = excluded.accepts_card;

-- ============================================================================
-- MENU SECTIONS + ITEMS + MODIFIERS (minimal but real, for two merchants)
-- ============================================================================
-- Abou El Sid menu
insert into public.menu_sections (id, restaurant_id, name, sort_order) values
  ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'Mains', 1),
  ('22222222-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000002', 'Sides', 2)
on conflict (id) do nothing;

insert into public.menu_items
  (id, restaurant_id, section_id, name, description, price_egp, image, flags, is_available, sort_order)
values
  ('33333333-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000001',
   'Molokhia with Rabbit', 'Slow-cooked jute leaves, garlic, fresh rabbit.', 180, '', array['halal']::item_flag_type[], true, 1),
  ('33333333-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000001',
   'Mixed Grill', 'Kofta, shish tawook, lamb chops.', 260, '', array['halal']::item_flag_type[], true, 2),
  ('33333333-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000002',
   'Stuffed Vine Leaves', 'Hand-rolled, lemon, olive oil.', 70, '', array['vegetarian','vegan']::item_flag_type[], true, 1)
on conflict (id) do nothing;

-- A modifier group on the Mixed Grill (size) + options.
insert into public.modifiers (id, item_id, name, required, min_select, max_select, sort_order) values
  ('44444444-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000002', 'Portion', true, 1, 1, 1)
on conflict (id) do nothing;
insert into public.modifier_options (id, modifier_id, name, price_delta_egp, is_default, sort_order) values
  ('55555555-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000001', 'Regular', 0, true, 1),
  ('55555555-0000-0000-0000-000000000002', '44444444-0000-0000-0000-000000000001', 'Large (+2 skewers)', 80, false, 2)
on conflict (id) do nothing;

-- Koshary (single item, COD/self-delivery merchant)
insert into public.menu_sections (id, restaurant_id, name, sort_order) values
  ('22222222-0000-0000-0000-000000000010', '11111111-0000-0000-0000-000000000004', 'Koshary', 1)
on conflict (id) do nothing;
insert into public.menu_items
  (id, restaurant_id, section_id, name, description, price_egp, image, flags, is_available, sort_order)
values
  ('33333333-0000-0000-0000-000000000010', '11111111-0000-0000-0000-000000000004', '22222222-0000-0000-0000-000000000010',
   'Classic Koshary', 'Rice, lentils, pasta, chickpeas, crispy onions, tomato sauce.', 45, '', array['vegetarian','vegan']::item_flag_type[], true, 1),
  ('33333333-0000-0000-0000-000000000011', '11111111-0000-0000-0000-000000000004', '22222222-0000-0000-0000-000000000010',
   'Large Koshary', 'The big bowl. Add extra crispy onions.', 65, '', array['vegetarian','vegan']::item_flag_type[], true, 2)
on conflict (id) do nothing;

-- ============================================================================
-- DRIVERS (test fleet, positioned near Naama for dispatch testing)
-- ============================================================================
insert into public.drivers (id, name, photo, phone, vehicle, plate, status, is_verified, is_active, rating, current_geo, last_ping_at, home_zone) values
  ('66666666-0000-0000-0000-000000000001', 'Ahmed Hassan', '', '+201000000001', 'scooter', 'SH-1234', 'online', true, true, 4.9,
   st_setsrid(st_makepoint(34.3300, 27.9110), 4326)::geography, now(), 'naama'),
  ('66666666-0000-0000-0000-000000000002', 'Mostafa Ali', '', '+201000000002', 'motorbike', 'SH-5678', 'online', true, true, 4.7,
   st_setsrid(st_makepoint(34.3265, 27.9135), 4326)::geography, now(), 'naama'),
  ('66666666-0000-0000-0000-000000000003', 'Karim Said', '', '+201000000003', 'scooter', 'SH-9012', 'offline', true, true, 4.8,
   st_setsrid(st_makepoint(34.3010, 27.8600), 4326)::geography, now() - interval '2 hours', 'hadaba')
on conflict (id) do update set
  current_geo = excluded.current_geo, status = excluded.status, last_ping_at = excluded.last_ping_at;

-- ============================================================================
-- HOW TO FINISH SEEDING (manual, needs real auth users)
-- ============================================================================
-- 1) Sign up an admin in the app (or dashboard), then:
--      update public.users set role='admin' where phone = '<your phone>';
-- 2) Sign up a merchant staffer, then link them:
--      insert into public.merchant_staff (profile_id, restaurant_id, staff_role)
--      values ('<their user id>', '11111111-0000-0000-0000-000000000002', 'owner');
-- 3) Sign up a driver, set role + link to a seeded driver row:
--      update public.users set role='driver' where phone = '<driver phone>';
--      update public.drivers set profile_id='<their user id>'
--        where id='66666666-0000-0000-0000-000000000001';
