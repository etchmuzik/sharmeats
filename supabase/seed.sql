-- seed.sql — Sharm Eats dev/pilot seed (food vertical).
--
-- Idempotent: safe to run multiple times. Mirrors the customer app's mock data
-- (same restaurant ids/names/zones) so flipping EXPO_PUBLIC_USE_SUPABASE=true
-- shows identical content. Adds real Sharm GEO coordinates so dispatch + zone
-- resolution are testable, plus test drivers and an admin.
--
-- Run AFTER migrations 001-024 (024 adds the phone/address/website/place_id
-- columns the real-restaurant block below depends on).
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
-- REAL RESTAURANTS (Google Maps / TripAdvisor / Restaurant Guru — verified)
-- ----------------------------------------------------------------------------
-- The 5 fictional pilot restaurants above are kept (their demo menus FK them)
-- but DEACTIVATED so only the real, directory-sourced venues show in the app.
-- Source data: supabase/data/real-restaurants.json. Requires migration 024.
-- ============================================================================
update public.restaurants set is_active = false
  where id::text like '11111111-0000-0000-0000-%';

-- Real Sharm el-Sheikh restaurants (sourced + verified from Google Maps / TripAdvisor / Restaurant Guru).
-- Generated from supabase/data/real-restaurants.json. `featured` is the
-- catalog's editorial intent, so mirror it into featured_manual explicitly
-- rather than relying on migration 222's legacy INSERT compatibility path.
insert into public.restaurants
  (id, slug, name, description, cuisines, cuisine_label, cover_image, zone,
   rating, rating_count, tourist_safe, is_open, is_active, featured,
   vertical_id, fulfillment_type, phone, address, website, place_id, geo,
   featured_manual)
select v.*, v.featured
from (
values
  ('0d0bcac1-51e7-55a5-9f3b-9f7d212ef8ea', 'dananeer-seafood-steak-house', 'Dananeer Seafood & Steak House', 'Independent seafood & steakhouse operating since 1996; located upstairs by McDonald''s overlooking Movenpick',
   array['seafood','egyptian']::cuisine_type[], 'Seafood · Egyptian', 'https://images.unsplash.com/photo-1559339352-11d035aa65de?w=900&q=70&auto=format&fit=crop', 'naama',
   4.7, 1214, true, true, true, false,
   'food', 'platform', '+20 127 543 4743', 'Shamandora Mall, King of Bahrein Street, Naama Bay, Sharm El Sheikh', 'https://welovesharm.com/dananeer', 'https://www.tripadvisor.com/Restaurant_Review-g297555-d779891-Reviews-Dananeer_Seafood_Steak_House-Sharm_El_Sheikh_South_Sinai_Red_Sea_and_Sinai.html',
   st_setsrid(st_makepoint(34.325806, 27.910904), 4326)::geography),
  ('fc4b1a7a-a18a-5c79-9d7e-705238b1886d', 'mahony-restaurant', 'Mahony Restaurant', 'Independent seafood + steakhouse in a cave-style setting; 2025 TripAdvisor Travelers'' Choice, ranked #41 of 381',
   array['seafood','egyptian']::cuisine_type[], 'Seafood · Egyptian', 'https://images.unsplash.com/photo-1559339352-11d035aa65de?w=900&q=70&auto=format&fit=crop', 'naama',
   4.5, 489, true, true, true, false,
   'food', 'platform', '+20 110 010 0031', 'Naama Bay, Mall Number 6 (behind Pyramid Mall, Peace Road, next to New Duty Free), Sharm El Sheikh 46619', null, 'https://www.tripadvisor.com/Restaurant_Review-g297555-d1405806-Reviews-Mahony_Restaurant-Sharm_El_Sheikh_South_Sinai_Red_Sea_and_Sinai.html',
   st_setsrid(st_makepoint(34.321293, 27.911375), 4326)::geography),
  ('6263f1a9-e6bd-5126-a313-be3b59fe2ba1', 'da-franco-naama-bay', 'Da Franco Naama Bay', 'Primarily Italian/pizza but offers seafood dishes (seafood risotto, frutti di mare)',
   array['italian','seafood','pizza']::cuisine_type[], 'Italian · Seafood · Pizza', 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=900&q=70&auto=format&fit=crop', 'naama',
   3.6, 55, true, true, true, false,
   'food', 'platform', '+20 69 360 0155', 'El Salam St., Naama Bay, Inside Ghazala Beach Hotel, Sharm El Sheikh', null, 'https://www.tripadvisor.com/Restaurant_Review-g297555-d1636109-Reviews-Da_Franco_Naama_Bay-Sharm_El_Sheikh_South_Sinai_Red_Sea_and_Sinai.html',
   st_setsrid(st_makepoint(34.327785, 27.912357), 4326)::geography),
  ('ced8b02d-7048-562a-9080-9e4d0405e92f', 'pomodoro', 'Pomodoro', 'Independent Italian restaurant in the heart of Naama Bay''s pedestrian area, part of the long-running Camel Dive Club & Boutique Hotel',
   array['italian','pizza','breakfast']::cuisine_type[], 'Italian · Pizza · Breakfast', 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=900&q=70&auto=format&fit=crop', 'naama',
   4.6, 1511, true, true, true, false,
   'food', 'platform', '+20 100 000 3173', 'King of Bahrain Street, Camel Dive Club & Hotel, Naama Bay, Sharm El Sheikh 46619', 'https://www.cameldive.com/food-and-drinks-pomodoro-restaurant/', 'https://www.tripadvisor.com/Restaurant_Review-g297555-d805137-Reviews-Pomodoro-Sharm_El_Sheikh_South_Sinai_Red_Sea_and_Sinai.html',
   st_setsrid(st_makepoint(34.325097, 27.91), 4326)::geography),
  ('c87c908f-bb25-5aef-959b-d0aced9c4891', 'hard-rock-cafe-sharm-el-sheikh', 'Hard Rock Cafe Sharm El Sheikh', 'International chain (American cuisine/bar) in the center of Naama Bay with the iconic rooftop guitar; turns into a music venue at night',
   array['burgers','late_night']::cuisine_type[], 'Burgers · Late night', 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=900&q=70&auto=format&fit=crop', 'naama',
   4.3, 2582, true, true, true, false,
   'food', 'platform', '+20 109 702 2750', 'El Soultan Qabous Street, Na''ama Bay, Sharm El Sheikh, South Sinai, Egypt', 'https://cafe.hardrock.com/sharm-el-sheikh/', 'https://www.tripadvisor.com/Restaurant_Review-g297555-d1216421-Reviews-Hard_Rock_Cafe_Sharm_El_Sheikh-Sharm_El_Sheikh_South_Sinai_Red_Sea_and_Sinai.html',
   st_setsrid(st_makepoint(34.323844, 27.909282), 4326)::geography),
  ('0a86073f-8220-5e91-bb18-d0b1c5e23f6d', 'da-mauro-solo-pasta-pizza', 'Da Mauro "Solo Pasta & Pizza"', 'Highly-rated (4',
   array['italian','pizza','seafood']::cuisine_type[], 'Italian · Pizza · Seafood', 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=900&q=70&auto=format&fit=crop', 'old_market',
   4.8, 943, true, true, true, false,
   'food', 'platform', '+20 106 513 2569', 'Peace Road, Kennedy Mall No. 6, Sharm El Sheikh 46628', 'http://damauropastaepizza.it', 'https://www.tripadvisor.com/Restaurant_Review-g297555-d8548925-Reviews-Da_Mauro_Solo_Pasta_Pizza-Sharm_El_Sheikh_South_Sinai_Red_Sea_and_Sinai.html',
   st_setsrid(st_makepoint(34.2994, 27.866547), 4326)::geography),
  ('70d3bfd2-79e2-5380-b25f-39e09ab4d98a', 'vanilla-italian-ice-cream', 'Vanilla Italian Ice Cream', 'Italian gelato / dessert cafe (16+ flavours), juices, iced coffees and milkshakes, with terrace overlooking the Naama Bay promenade',
   array['sweets','cafe','italian']::cuisine_type[], 'Sweets · Cafe · Italian', 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=900&q=70&auto=format&fit=crop', 'naama',
   4.7, 51, true, true, true, false,
   'food', 'platform', '+20 100 000 3173', 'Camel Dive Club & Hotel, Centre of Naama Bay, Sharm El Sheikh 46619', 'https://www.cameldive.com/food-and-drinks-vanilla-cafe/', 'https://www.tripadvisor.com/Restaurant_Review-g297555-d6886506-Reviews-Vanilla_Italian_Ice_Cream-Sharm_El_Sheikh_South_Sinai_Red_Sea_and_Sinai.html',
   st_setsrid(st_makepoint(34.325254, 27.90965), 4326)::geography),
  ('b380ecf4-7ed7-5097-a05f-b3de1c3a7240', 'julia-ice-cream-italian-gelato-china-town-restaurant', 'Julia Ice Cream Italian Gelato & China Town Restaurant', 'Italian/Polish gelato parlour and dessert spot on the main Naama Bay street, also serving cakes, crepes, waffles, milkshakes and coffee (China Town is an attached Asian restaurant)',
   array['sweets','cafe','asian']::cuisine_type[], 'Sweets · Cafe · Asian', 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=900&q=70&auto=format&fit=crop', 'naama',
   4.5, 22, true, true, true, false,
   'food', 'platform', '+20 100 782 9987', 'El-Amir Abd Allah Street (Naama Bay Touristic Avenue), Naama Bay, Sharm El Sheikh', 'https://www.instagram.com/juliaicecreamandrestaurant/', 'https://www.tripadvisor.com/Restaurant_Review-g297555-d17739095-Reviews-Julia_Ice_Cream_Italian_Gelato_China_Town_Restaurant-Sharm_El_Sheikh_South_Sinai.html',
   st_setsrid(st_makepoint(34.32083, 27.91178), 4326)::geography),
  ('fcffa048-ec03-56e8-aa26-e10878889793', 'gelato-it-gelatopuntoit', 'Gelato.IT (#gelatopuntoit)', 'Independent, Italian-owned artisanal gelateria (also Belgian waffles and coffee)',
   array['sweets','cafe','italian']::cuisine_type[], 'Sweets · Cafe · Italian', 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=900&q=70&auto=format&fit=crop', 'hadaba',
   4.8, 45, true, true, true, false,
   'food', 'platform', '+20 101 457 6120', 'Pyramids Mall, El Mercato (Il Mercato), next to Vodafone, Hadaba, Sharm El Sheikh', null, 'https://www.tripadvisor.com/Restaurant_Review-g297555-d8674822-Reviews-Gelato_IT_gelatopuntoit-Sharm_El_Sheikh_South_Sinai_Red_Sea_and_Sinai.html',
   st_setsrid(st_makepoint(34.31034, 27.8625), 4326)::geography),
  ('41a2bdf9-5ca4-55cb-b7a4-8795325b60e1', 'fares-seafood-il-mercato', 'Fares Seafood - IL Mercato', 'Hadaba branch of the well-known Fares seafood family (the original Fares Traditional is in the Old Market)',
   array['seafood','egyptian']::cuisine_type[], 'Seafood · Egyptian', 'https://images.unsplash.com/photo-1559339352-11d035aa65de?w=900&q=70&auto=format&fit=crop', 'hadaba',
   4.3, 6111, true, true, true, true,
   'food', 'platform', '+20 111 111 4748', 'Sharm Elysees Street, IL Mercato, Hadaba, Sharm El Sheikh 8762511, Egypt', null, 'https://www.tripadvisor.com/Restaurant_Review-g297555-d3607814-Reviews-Fares_Seafood_IL_Mercato-Sharm_El_Sheikh_South_Sinai_Red_Sea_and_Sinai.html',
   st_setsrid(st_makepoint(34.3038, 27.86304), 4326)::geography),
  ('04641d29-dc28-5f43-9400-3fbce70863c9', 'el-fanar', 'El Fanar', 'Clifftop beach restaurant at the Umm El Sid / Ras Um Sid headland in Hadaba, near the lighthouse',
   array['egyptian','seafood','pizza']::cuisine_type[], 'Egyptian · Seafood · Pizza', 'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=900&q=70&auto=format&fit=crop', 'hadaba',
   4.4, 225, true, true, true, false,
   'food', 'platform', '+20 100 249 5110', 'El Fanar St., beside El Fanar Hotel, El Fanar Beach, Ras Um Sid (Umm El Sid Hill), Hadaba, Sharm El Sheikh 46628, Egypt', 'https://www.facebook.com/Elfanarbeach/', 'https://www.tripadvisor.com/Restaurant_Review-g297555-d6378183-Reviews-El_Fanar-Sharm_El_Sheikh_South_Sinai_Red_Sea_and_Sinai.html',
   st_setsrid(st_makepoint(34.31544, 27.84769), 4326)::geography),
  ('a7fc3b66-568d-5172-bfa8-713030bc086b', 'ebn-hamido-seafood-sharm', 'Ebn Hamido Seafood Sharm', 'Local Egyptian seafood restaurant in Al Barka Mall, Hadaba; open ~11:00-03:00 daily',
   array['seafood','egyptian']::cuisine_type[], 'Seafood · Egyptian', 'https://images.unsplash.com/photo-1559339352-11d035aa65de?w=900&q=70&auto=format&fit=crop', 'hadaba',
   4.8, 1194, true, true, true, true,
   'food', 'platform', '+20 10 8089 0038', 'Al Barka Mall, Hadaba, Sharm El Sheikh, South Sinai Governorate, Egypt', 'https://www.facebook.com/ebnhamido.seafood/', 'https://www.tripadvisor.com/Restaurant_Review-g297555-d32899939-Reviews-Ebn_Hamido_Seafood_Sharm-Sharm_El_Sheikh_South_Sinai_Red_Sea_and_Sinai.html',
   st_setsrid(st_makepoint(34.304587, 27.861618), 4326)::geography),
  ('5040b5f6-5d30-5854-bde6-c55803ab048f', 'tejano-s-grill-house', 'Tejano''s Grill House', 'TexMex grill house: signature burgers, steaks, brisket, fajitas',
   array['burgers','egyptian']::cuisine_type[], 'Burgers · Egyptian', 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=900&q=70&auto=format&fit=crop', 'hadaba',
   4.4, 604, true, true, true, false,
   'food', 'platform', '+20 100 032 1551', 'Il Mercato Street, in front of McDonald''s, El Hadaba, Sharm El Sheikh 46619', null, 'https://restaurantguru.com/Grill-House-Sharm-El-Sheikh-2',
   st_setsrid(st_makepoint(34.309317, 27.862561), 4326)::geography),
  ('ab56e3ac-439d-5954-b92f-efe887ec502a', 'sadiki-cafe', 'Sadiki Cafe', 'Casual outdoor cafe/restaurant in Hadaba known for the ''Sadiki Burger'', pizza and chicken; sea view, open late (9 AM-2:30 AM)',
   array['burgers','cafe','pizza','late_night']::cuisine_type[], 'Burgers · Cafe · Pizza', 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=900&q=70&auto=format&fit=crop', 'hadaba',
   4.2, 536, true, true, true, false,
   'food', 'platform', '+20 69 366 2362', 'Al Reyadat Al Bahareya (Sea Street), El Hadaba, Sharm El Sheikh', null, 'https://restaurantguru.com/Sadiki-Cafe-Sharm-El-Sheikh',
   st_setsrid(st_makepoint(34.306025, 27.848589), 4326)::geography),
  ('ad1c651b-756a-51f3-8cd1-d1c5c3ed8793', 'onions-restaurant-cafe', 'Onions Restaurant & Cafe', 'Casual dining restaurant & cafe at Il Mercato Hadaba (Italian/seafood/Egyptian, outdoor seating)',
   array['italian','seafood','cafe','egyptian']::cuisine_type[], 'Italian · Seafood · Cafe', 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=900&q=70&auto=format&fit=crop', 'hadaba',
   4.2, 319, true, true, true, false,
   'food', 'platform', '+20 69 360 0050', 'Hadaba Il Mercato, El Hadaba (Um El Sid Hill), Sharm El Sheikh 41669, Egypt', null, 'https://www.tripadvisor.com/Restaurant_Review-g297555-d1210546-Reviews-Onions-Sharm_El_Sheikh_South_Sinai_Red_Sea_and_Sinai.html',
   st_setsrid(st_makepoint(34.311153, 27.863497), 4326)::geography),
  ('e21350f5-6915-5e2b-a211-f09d89152449', 'my-burger', 'My Burger', 'Independent burger eat-in/takeaway spot',
   array['burgers','late_night']::cuisine_type[], 'Burgers · Late night', 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=900&q=70&auto=format&fit=crop', 'old_market',
   4.7, 23, true, true, true, false,
   'food', 'platform', '+20 128 276 6603', 'Gastec Station, Old Market, Restaurant No.3, Sharm El Sheikh, Egypt', null, 'https://www.tripadvisor.com/Restaurant_Review-g297555-d26447853-Reviews-My_Burger-Sharm_El_Sheikh_South_Sinai_Red_Sea_and_Sinai.html',
   st_setsrid(st_makepoint(34.295784, 27.86532), 4326)::geography),
  ('ac3f0bbd-25cc-58ce-b2cb-93019b29aebe', 'fares-seafood-old-market', 'Fares Seafood (Old Market)', 'Original Fares branch, opened 1994 in the Old Market; the most famous seafood spot in old Sharm',
   array['seafood','egyptian']::cuisine_type[], 'Seafood · Egyptian', 'https://images.unsplash.com/photo-1559339352-11d035aa65de?w=900&q=70&auto=format&fit=crop', 'old_market',
   4.4, 181, true, true, true, false,
   'food', 'platform', '+20 69 3664270', 'The Old Market, Sharm El Maya, Sharm El-Sheikh, South Sinai Governorate, Egypt', 'https://faresseafood.com', 'https://restaurantguru.com/Fares-Seafood-Sharm-El-Sheikh',
   st_setsrid(st_makepoint(34.293249, 27.866415), 4326)::geography),
  ('79a4da1b-5633-592d-8765-71523b26a380', 'el-hossieny-restaurant', 'El Hossieny Restaurant', 'Independent family-run Egyptian grill (25+ years) in the heart of the Old Market; known for grilled meats, kofta/kebab, koshary and molokhia',
   array['egyptian','street_food']::cuisine_type[], 'Egyptian · Street food', 'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=900&q=70&auto=format&fit=crop', 'old_market',
   4.8, 106, true, true, true, false,
   'food', 'platform', '+20 69 3666260', 'Old Market (Malek El Bahrein St), No. 94, Sharm El Maya, Sharm El-Sheikh, South Sinai Governorate, Egypt', 'https://elhossienyrestaurant.com/en', 'https://elhossienyrestaurant.com/en',
   st_setsrid(st_makepoint(34.293528, 27.867213), 4326)::geography),
  ('e9a8a727-5c76-5c4b-adaa-45de12ff27c4', 'sinai-star', 'Sinai Star', 'Veteran Old Market seafood and Egyptian restaurant operating since 1985',
   array['seafood','egyptian']::cuisine_type[], 'Seafood · Egyptian', 'https://images.unsplash.com/photo-1559339352-11d035aa65de?w=900&q=70&auto=format&fit=crop', 'old_market',
   4.3, 243, true, true, true, false,
   'food', 'platform', '+20 69 3660323', 'Near Sharm Papyrus Museum, Old Market, Sharm El Maya, Sharm El-Sheikh, South Sinai Governorate, Egypt', null, 'https://www.tripadvisor.com/Restaurant_Review-g297555-d803112-Reviews-Sinai_star-Sharm_El_Sheikh_South_Sinai_Red_Sea_and_Sinai.html',
   st_setsrid(st_makepoint(34.294131, 27.865851), 4326)::geography),
  ('775cda31-3ff1-55ed-a448-76b802873575', 'abo-ali-restaurant-cafe', 'Abo Ali Restaurant & Cafe', 'Egyptian · Street food · Cafe in Hay El Nour (edge of Old Market / Old Sharm).',
   array['egyptian','street_food','cafe']::cuisine_type[], 'Egyptian · Street food · Cafe', 'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=900&q=70&auto=format&fit=crop', 'hay_el_nour',
   3.9, 7922, true, true, true, true,
   'food', 'platform', '+20 10 94442418', 'Hay El Nour, Sharm El-Sheikh, South Sinai Governorate, Egypt', null, 'https://restaurantguru.com/Abo-ali-restaurant-and-cafe-Sharm-El-Sheikh',
   st_setsrid(st_makepoint(34.29987, 27.885524), 4326)::geography),
  ('4c28e736-70ab-5b47-8220-71c5c9d00d0b', 'fisherman', 'Fisherman', 'Seafood/Mediterranean restaurant listed among the top spots near the Old Market on TripAdvisor (4',
   array['seafood']::cuisine_type[], 'Seafood', 'https://images.unsplash.com/photo-1559339352-11d035aa65de?w=900&q=70&auto=format&fit=crop', 'old_market',
   4.3, 182, true, true, true, false,
   'food', 'platform', '+20 100 547 9028', 'Commercial Market, Old Sharm (Sharm El Maya), Sharm El Sheikh, South Sinai 46619, Egypt', null, 'https://www.tripadvisor.com/RestaurantsNear-g297555-d669886-Old_Market-Sharm_El_Sheikh_South_Sinai_Red_Sea_and_Sinai.html',
   st_setsrid(st_makepoint(34.292791, 27.863756), 4326)::geography),
  ('c2486061-c266-5ab6-a8ca-d0f3e3001f8a', 'umbi-sharks-bay-restaurant-lounge', 'Umbi Sharks Bay Restaurant & Lounge', 'Independent Bedouin-owned beachfront seafood restaurant inside the historic Umbi Sharks Bay Diving Village (one of Sharm''s oldest dive centres)',
   array['seafood','egyptian']::cuisine_type[], 'Seafood · Egyptian', 'https://images.unsplash.com/photo-1559339352-11d035aa65de?w=900&q=70&auto=format&fit=crop', 'sharks_bay',
   4.4, 59, true, true, true, false,
   'food', 'platform', '+20 120 000 1558', 'Umbi Sharks Bay Diving Village, Sharks Bay, Qesm Sharm Ash Sheikh, Sharm El Sheikh, South Sinai, Egypt', 'https://sharksbay.com/', 'https://www.tripadvisor.com/Restaurant_Review-g297555-d8052432-Reviews-Umbi_Sharks_Bay_Restaurant-Sharm_El_Sheikh_South_Sinai_Red_Sea_and_Sinai.html',
   st_setsrid(st_makepoint(34.384396, 27.952241), 4326)::geography),
  ('82a58476-38c2-5e56-b13f-c0ab117606f3', 'koutouki', 'Koutouki', 'Greek/Mediterranean seafood taverna in the Soho Square entertainment complex (which sits in the Sharks Bay area, in front of Savoy Resort)',
   array['seafood','asian']::cuisine_type[], 'Seafood · Asian', 'https://images.unsplash.com/photo-1559339352-11d035aa65de?w=900&q=70&auto=format&fit=crop', 'soho',
   4.8, 1521, true, true, true, true,
   'food', 'platform', '+20 100 0109109', 'SOHO Square, Sharks Bay, Sharm El Sheikh 46628, South Sinai, Egypt', 'https://www.soho-sharm.com/koutouki1', 'https://www.tripadvisor.com/Restaurant_Review-g297555-d4025312-Reviews-Koutouki-Sharm_El_Sheikh_South_Sinai_Red_Sea_and_Sinai.html',
   st_setsrid(st_makepoint(34.393704, 27.962457), 4326)::geography),
  ('6562f0be-71f8-5e3b-98bd-0feba132d354', 'cafe-chino', 'Café Chino', 'All-night Lebanese coffee shop / casual eatery in the Soho Square complex (Sharks Bay area)',
   array['cafe','late_night']::cuisine_type[], 'Cafe · Late night', 'https://images.unsplash.com/photo-1453614512568-c4024d13c247?w=900&q=70&auto=format&fit=crop', 'soho',
   4.3, 1252, true, true, true, false,
   'food', 'platform', '+20 100 0109109', 'SOHO Square, Sharks Bay, Sharm El Sheikh 46628, South Sinai, Egypt', 'https://www.soho-sharm.com/cafe-chino', 'https://www.tripadvisor.com/Restaurant_Review-g297555-d3606105-Reviews-Cafe_Chino-Sharm_El_Sheikh_South_Sinai_Red_Sea_and_Sinai.html',
   st_setsrid(st_makepoint(34.394503, 27.96286), 4326)::geography),
  ('5b74a3fa-d466-5db3-ae93-7dea1349f839', 'akuna-matata', 'Akuna Matata', 'Multi-cuisine food court within Soho Square with several outlets: fresh fish, pizza, Chinese noodles, BBQ, Moroccan, Mexican, and Egyptian feteer/falafel',
   array['pizza','seafood','street_food','egyptian']::cuisine_type[], 'Pizza · Seafood · Street food', 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=900&q=70&auto=format&fit=crop', 'soho',
   4.5, 275, true, true, true, false,
   'food', 'platform', '+201000109109', 'Soho Square, Sharks Bay, Sharm El Sheikh 12444, Egypt', 'https://www.soho-sharm.com/soho-restaurants', 'https://www.tripadvisor.com/Restaurant_Review-g297555-d4010907-Reviews-Akuna_Matata-Sharm_El_Sheikh_South_Sinai_Red_Sea_and_Sinai.html',
   st_setsrid(st_makepoint(34.393673, 27.963194), 4326)::geography),
  ('47cecdd2-de2f-5c0d-9aa5-5da57add0ef3', 'casa-mia', 'Casa Mia', 'Highly-rated a-la-carte Italian restaurant (TripAdvisor 4',
   array['italian','pizza']::cuisine_type[], 'Italian · Pizza', 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=900&q=70&auto=format&fit=crop', 'sharks_bay',
   4.9, 1632, true, true, true, true,
   'food', 'platform', '+20 69 3602130', 'Sultan Gardens Resort, Sharks Bay, Sharm El Sheikh, South Sinai, Egypt', 'https://www.facebook.com/CasaMiaSGR/', 'https://www.tripadvisor.com/Restaurant_Review-g297555-d6415753-Reviews-Casa_Mia-Sharm_El_Sheikh_South_Sinai_Red_Sea_and_Sinai.html',
   st_setsrid(st_makepoint(34.379948, 27.943995), 4326)::geography),
  ('583b0499-05b4-5d93-9a48-aca709708edc', 'mazzika-cafe-steak-house', 'Mazzika Cafe & Steak House', 'Independent restaurant inside La Strada Mall, Nabq Bay',
   array['egyptian','seafood','pizza','cafe']::cuisine_type[], 'Egyptian · Seafood · Pizza', 'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=900&q=70&auto=format&fit=crop', 'nabq',
   4.6, 180, true, true, true, false,
   'food', 'platform', '+20 106 057 4480', 'La Strada Mall, Nabq Bay, Sharm El Sheikh, Egypt', 'https://www.facebook.com/mazikkacafeandsteakhouse/', 'https://wanderlog.com/place/details/3407564/mazzika-cafe-steak-house',
   st_setsrid(st_makepoint(34.429457, 28.044813), 4326)::geography),
  ('afca4c18-ea3c-5ed2-9086-ebcdf2952467', 'al-mayass-lebanese-restaurant', 'Al Mayass Lebanese Restaurant', 'Independent Lebanese/Mediterranean/Egyptian restaurant on Peace Road',
   array['egyptian','seafood']::cuisine_type[], 'Egyptian · Seafood', 'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=900&q=70&auto=format&fit=crop', 'nabq',
   3.4, 5, true, true, true, false,
   'food', 'platform', '+20 10 96320424', 'Peace Road (Peace Road / El Salam St area), Nabq Bay, Sharm El Sheikh, Egypt', null, 'https://www.tripadvisor.com/Restaurant_Review-g303855-d26870479-Reviews-Al_mayass_Lebanese_restaurant-Nabq_Bay_Sharm_El_Sheikh_South_Sinai_Red_Sea_and_S.html',
   st_setsrid(st_makepoint(34.327503, 27.91447), 4326)::geography),
  ('f9c217f5-e664-5e93-aabb-dbe81e312761', 'sanafir-seafood-restaurant', 'Sanafir - Seafood Restaurant', 'A la carte seafood restaurant located within the Steigenberger Alcazar hotel in Nabq Bay - a hotel restaurant, not independent; likely guest-focused',
   array['seafood']::cuisine_type[], 'Seafood', 'https://images.unsplash.com/photo-1559339352-11d035aa65de?w=900&q=70&auto=format&fit=crop', 'nabq',
   5.0, 223, true, true, true, false,
   'food', 'platform', '+20 69 3710950', 'Steigenberger Alcazar, Nabq Bay, Sharm El Sheikh, Egypt', null, 'https://www.tripadvisor.in/Restaurant_Review-g297555-d33238617-Reviews-Sanafir_Seafood_Restaurant-Sharm_El_Sheikh_South_Sinai_Red_Sea_and_Sinai.html',
   st_setsrid(st_makepoint(34.32995, 27.91582), 4326)::geography),
  ('14eef92b-e389-5e83-921b-a3012a09a487', 'sushi-lounge', 'Sushi Lounge', 'Japanese/sushi conveyor-belt restaurant inside the SOHO Square entertainment complex (Savoy Group)',
   array['sushi','asian']::cuisine_type[], 'Sushi · Asian', 'https://images.unsplash.com/photo-1579584425555-c3ce17fd4351?w=900&q=70&auto=format&fit=crop', 'sharks_bay',
   4.8, 740, true, true, true, false,
   'food', 'platform', '+201000109109', 'SOHO Square, White Knight Bay, Sharm El Sheikh, Egypt', 'https://www.soho-sharm.com/', 'https://www.tripadvisor.com/Restaurant_Review-g297555-d4066755-Reviews-Sushi_Lounge-Sharm_El_Sheikh_South_Sinai_Red_Sea_and_Sinai.html',
   st_setsrid(st_makepoint(34.377307, 27.977453), 4326)::geography),
  ('6b4a4181-14c4-5a10-86ab-6190e7e9dc23', 'fairuz-finest-lebanese-cuisine', 'Fairuz Finest Lebanese Cuisine', 'Independent Lebanese/Middle Eastern restaurant (est',
   array['egyptian','cafe']::cuisine_type[], 'Egyptian · Cafe', 'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=900&q=70&auto=format&fit=crop', 'naama',
   4.5, 755, true, true, true, false,
   'food', 'platform', '+201020311388', 'Na''ama Center, 2nd floor, King of Bahrain Street, Naama Bay, Sharm El Sheikh, Egypt', 'https://www.fairuzrestaurantsharm.com/', 'https://www.tripadvisor.com/Restaurant_Review-g297555-d1761181-Reviews-Fairuz_Finest_Lebanese_Cuisine-Sharm_El_Sheikh_South_Sinai_Red_Sea_and_Sinai.html',
   st_setsrid(st_makepoint(34.32505, 27.908977), 4326)::geography),
  ('77ad0b58-c239-5870-9957-b9cbc1794089', 'zen-chinese-restaurant', 'Zen Chinese Restaurant', 'Cantonese/Chinese restaurant inside the SOHO Square complex (Savoy Group)',
   array['asian']::cuisine_type[], 'Asian', 'https://images.unsplash.com/photo-1552611052-33e04de081de?w=900&q=70&auto=format&fit=crop', 'sharks_bay',
   4.5, 528, true, true, true, false,
   'food', 'platform', '+201000109109', 'SOHO Square, White Knight Bay, Sharks Bay, Sharm El Sheikh, South Sinai Governorate, Egypt', 'https://www.soho-sharm.com/', 'https://www.tripadvisor.com/Restaurant_Review-g297555-d1827388-Reviews-Zen_Chinese_Restaurant-Sharm_El_Sheikh_South_Sinai_Red_Sea_and_Sinai.html',
   st_setsrid(st_makepoint(34.393461, 27.962244), 4326)::geography),
  ('315ad23e-e7a7-5d57-afd3-b3324809cad3', 'sala-thai-restaurant', 'Sala Thai Restaurant', 'Award-winning Thai fine-dining restaurant located INSIDE the Hyatt Regency Sharm El Sheikh resort (Gardens Bay headland, Hadaba peninsula)',
   array['asian']::cuisine_type[], 'Asian', 'https://images.unsplash.com/photo-1552611052-33e04de081de?w=900&q=70&auto=format&fit=crop', 'hadaba',
   4.6, 289, true, true, true, false,
   'food', 'platform', '+20693601234', 'Hyatt Regency Sharm El Sheikh, Gardens Bay, Sharm El Sheikh, Egypt', null, 'https://www.tripadvisor.com/Restaurant_Review-g297555-d1218365-Reviews-Sala_Thai_Restaurant-Sharm_El_Sheikh_South_Sinai_Red_Sea_and_Sinai.html',
   st_setsrid(st_makepoint(34.3473, 27.9172), 4326)::geography),
  ('c84f8596-2469-5ded-843a-5004c225eead', 'l-entrecote-steak-house', 'L''Entrecote Steak House', 'French-style steakhouse inside the Soho Square complex (Savoy Group)',
   array['seafood']::cuisine_type[], 'Seafood', 'https://images.unsplash.com/photo-1559339352-11d035aa65de?w=900&q=70&auto=format&fit=crop', 'soho',
   4.7, 1313, true, true, true, false,
   'food', 'platform', '+201000109109', 'Soho Square, White Knight Beach, Sharm El Sheikh 46628, Egypt', 'https://www.soho-sharm.com/soho-restaurants', 'https://www.tripadvisor.com/Restaurant_Review-g297555-d1827386-Reviews-L_Entrecote_Steak_House-Sharm_El_Sheikh_South_Sinai_Red_Sea_and_Sinai.html',
   st_setsrid(st_makepoint(34.394356, 27.964123), 4326)::geography),
  ('4beef3c8-4a2e-5ba1-bdfc-38166779705c', 'bombay', 'Bombay', 'Indian fine-dining restaurant in Soho Square with a Delhi chef and tandoori oven',
   array['asian']::cuisine_type[], 'Asian', 'https://images.unsplash.com/photo-1552611052-33e04de081de?w=900&q=70&auto=format&fit=crop', 'soho',
   4.7, 1444, true, true, true, true,
   'food', 'platform', '+201000109109', 'Soho Square, Sharm El Sheikh 46628, Egypt', 'https://www.soho-sharm.com/bombay', 'https://www.tripadvisor.com/Restaurant_Review-g297555-d1827574-Reviews-Bombay-Sharm_El_Sheikh_South_Sinai_Red_Sea_and_Sinai.html',
   st_setsrid(st_makepoint(34.393078, 27.961945), 4326)::geography),
  ('5462ba96-1292-51d8-9871-a3617239ba56', 'flamango-fresh-juice', 'Flamango Fresh Juice', 'Fresh juice / smoothie bar tagged Cafe + Healthy on TripAdvisor; also serves waffles and kunafa',
   array['healthy','cafe','sweets']::cuisine_type[], 'Healthy · Cafe · Sweets', 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=900&q=70&auto=format&fit=crop', 'naama',
   4.9, 121, true, true, true, false,
   'food', 'platform', '+20 114 222 4011', 'Shop 34, El-Salam Road, New Touristic Walkway, Sharm El Sheikh', null, 'https://www.tripadvisor.com/Restaurant_Review-g297555-d27707128-Reviews-Flamango_Fresh_Juice-Sharm_El_Sheikh_South_Sinai_Red_Sea_and_Sinai.html',
   st_setsrid(st_makepoint(34.31301, 27.905348), 4326)::geography),
  ('ddf571d4-7ba1-572a-8f30-2c12e5ee15f6', 'ju-co', 'Ju & Co', 'Popular health-leaning cafe in Soho Square (juices, fresh breakfasts, salads, sandwiches)',
   array['cafe','healthy','breakfast']::cuisine_type[], 'Cafe · Healthy · Breakfast', 'https://images.unsplash.com/photo-1453614512568-c4024d13c247?w=900&q=70&auto=format&fit=crop', 'soho',
   4.8, 337, true, true, true, false,
   'food', 'platform', '+20 100 010 9109', 'Soho Square, Savoy Resort, White Knight Bay, Sharm El Sheikh', 'https://www.soho-sharm.com/sharm-cafe/ju-co/', 'https://www.tripadvisor.com/Restaurant_Review-g297555-d6779646-Reviews-Ju_Co-Sharm_El_Sheikh_South_Sinai_Red_Sea_and_Sinai.html',
   st_setsrid(st_makepoint(34.3776, 27.9774), 4326)::geography),
  ('b36c5136-6d4f-538b-9ab5-70fdbd22677f', 'bus-stop-naama-bay', 'Bus Stop Naama Bay', 'Healthy · Cafe · Late night in Naama Bay (at Sanafir Hotel).',
   array['healthy','cafe','late_night','breakfast']::cuisine_type[], 'Healthy · Cafe · Late night', 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=900&q=70&auto=format&fit=crop', 'naama',
   4.5, 16, true, true, true, false,
   'food', 'platform', '+20 128 042 8428', 'El Sheikh Hamad Ibn Essa St (Sanafir Hotel), Naama Bay, Sharm El Sheikh 46911', 'https://busstopegypt.com', 'https://www.happycow.net/reviews/bus-stop-naama-bay-sharm-el-sheikh-343577',
   st_setsrid(st_makepoint(34.325237, 27.909971), 4326)::geography),
  ('359d40d6-ce99-59d1-bc3a-83364fde7ce7', 'el-masrien-grill-restaurant', 'El Masrien Grill Restaurant', 'Egyptian · Street food in Old Market (Sharm El Maya).',
   array['egyptian','street_food']::cuisine_type[], 'Egyptian · Street food', 'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=900&q=70&auto=format&fit=crop', 'old_market',
   4.1, 2673, true, true, true, false,
   'food', 'platform', '+201026699636', 'Al-Souk Al-Tegari (Old Market / Commercial Market), Sharm El Maya, Sharm El Sheikh', null, 'https://restaurantguru.com/El-Masrien-Restaurant-Sharm-El-Sheikh',
   st_setsrid(st_makepoint(34.293636, 27.865722), 4326)::geography),
  ('87e32d17-d499-589a-bb94-d1d1172ad141', 'koshary-zaman', 'Koshary Zaman (كشري زمان)', 'Local koshary chain (''Egypt''s national dish served to perfection'') with several Sharm branches; open 12:00-02:00',
   array['egyptian','street_food']::cuisine_type[], 'Egyptian · Street food', 'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=900&q=70&auto=format&fit=crop', 'old_market',
   3.9, 256, true, true, true, false,
   'food', 'platform', '+201006762770', 'Delta Sharm Resort area, Sharm El Sheikh (also branches in Old Market and Mall of Ahmed Omar)', null, 'https://restaurantguru.com/koshari-Sharm-El-Sheikh-m8905',
   st_setsrid(st_makepoint(34.30398, 27.88674), 4326)::geography),
  ('6ae06220-7959-5354-966f-f15589e4e8b3', 'tam-tam-restaurant', 'Tam Tam Restaurant', 'Casual Egyptian restaurant on the Naama Bay promenade, praised for affordable authentic local food and especially its falafel/taameya',
   array['egyptian','street_food']::cuisine_type[], 'Egyptian · Street food', 'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=900&q=70&auto=format&fit=crop', 'naama',
   4.1, 172, true, true, true, false,
   'food', 'platform', '+20693600150', 'Pedestrian Road, in front of Ghazala Garden Hotel, Naama Bay, Sharm El Sheikh 8763120', null, 'https://www.tripadvisor.com/Restaurant_Review-g297555-d1488286-Reviews-Tam_Tam_Restaurant-Sharm_El_Sheikh_South_Sinai_Red_Sea_and_Sinai.html',
   st_setsrid(st_makepoint(34.327843, 27.912548), 4326)::geography)
) as v (
  id, slug, name, description, cuisines, cuisine_label, cover_image, zone,
  rating, rating_count, tourist_safe, is_open, is_active, featured,
  vertical_id, fulfillment_type, phone, address, website, place_id, geo
)
where true
on conflict (slug) do update set
  name = excluded.name, description = excluded.description, cuisines = excluded.cuisines,
  cuisine_label = excluded.cuisine_label, cover_image = excluded.cover_image, zone = excluded.zone,
  rating = excluded.rating, rating_count = excluded.rating_count, tourist_safe = excluded.tourist_safe,
  is_open = excluded.is_open, is_active = excluded.is_active,
  featured = excluded.featured, featured_manual = excluded.featured_manual,
  phone = excluded.phone, address = excluded.address, website = excluded.website,
  place_id = excluded.place_id, geo = excluded.geo;

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

-- ============================================================================
-- ADDED: menus for the 3 remaining restaurants (Trattoria, Sushi, Burger)
-- Requires migration 016 (modifier presentation columns). See
-- supabase/seed_menus_3restaurants.sql (identical content, standalone).
-- ============================================================================
-- TRATTORIA DEL MARE  (id ...0001) — Italian · wood-fire pizza · seafood
-- ════════════════════════════════════════════════════════════════════════════
insert into public.menu_sections (id, restaurant_id, name, sort_order) values
  ('22222222-0000-0000-0000-000000000101', '11111111-0000-0000-0000-000000000001', 'Wood-fire Pizza', 1),
  ('22222222-0000-0000-0000-000000000102', '11111111-0000-0000-0000-000000000001', 'Pasta', 2),
  ('22222222-0000-0000-0000-000000000103', '11111111-0000-0000-0000-000000000001', 'From the Sea', 3),
  ('22222222-0000-0000-0000-000000000104', '11111111-0000-0000-0000-000000000001', 'Dolci', 4)
on conflict (id) do nothing;

insert into public.menu_items
  (id, restaurant_id, section_id, name, description, price_egp, image, flags, is_available, sort_order)
values
  ('33333333-0000-0000-0000-000000000101', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000101',
   'Margherita', 'San Marzano tomato, fior di latte, basil, EVOO.', 160, '', array['vegetarian']::item_flag_type[], true, 1),
  ('33333333-0000-0000-0000-000000000102', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000101',
   'Diavola', 'Spicy salame piccante, tomato, mozzarella, chili.', 195, '', array['spicy']::item_flag_type[], true, 2),
  ('33333333-0000-0000-0000-000000000103', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000101',
   'Frutti di Mare', 'Shrimp, calamari, mussels, garlic, parsley.', 240, '', array['contains_nuts']::item_flag_type[], true, 3),
  ('33333333-0000-0000-0000-000000000104', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000102',
   'Spaghetti alle Vongole', 'Fresh clams, white wine, garlic, chili.', 210, '', array[]::item_flag_type[], true, 1),
  ('33333333-0000-0000-0000-000000000105', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000102',
   'Tagliatelle al Tartufo', 'House egg pasta, black truffle, parmigiano.', 230, '', array['vegetarian']::item_flag_type[], true, 2),
  ('33333333-0000-0000-0000-000000000106', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000103',
   'Grilled Sea Bass', 'Whole branzino, lemon, rosemary, sea salt.', 260, '', array['glutenfree']::item_flag_type[], true, 1),
  ('33333333-0000-0000-0000-000000000107', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000104',
   'Tiramisù', 'Mascarpone, espresso, cocoa. Made daily.', 90, '', array['vegetarian']::item_flag_type[], true, 1)
on conflict (id) do nothing;

-- Pizza size (style 'size') on Margherita + Diavola.
insert into public.modifiers (id, item_id, name, required, min_select, max_select, sort_order) values
  ('44444444-0000-0000-0000-000000000101', '33333333-0000-0000-0000-000000000101', 'Size', true, 1, 1, 1),
  ('44444444-0000-0000-0000-000000000102', '33333333-0000-0000-0000-000000000101', 'Extra toppings', false, 0, 4, 2),
  ('44444444-0000-0000-0000-000000000103', '33333333-0000-0000-0000-000000000102', 'Size', true, 1, 1, 1)
on conflict (id) do nothing;
insert into public.modifier_options (id, modifier_id, name, price_delta_egp, is_default, sort_order) values
  -- Margherita size
  ('55555555-0000-0000-0000-000000000101', '44444444-0000-0000-0000-000000000101', 'Personal 24cm', 0, true, 1),
  ('55555555-0000-0000-0000-000000000102', '44444444-0000-0000-0000-000000000101', 'Classic 32cm', 60, false, 2),
  ('55555555-0000-0000-0000-000000000103', '44444444-0000-0000-0000-000000000101', 'Family 40cm', 120, false, 3),
  -- Margherita extra toppings (style 'addons')
  ('55555555-0000-0000-0000-000000000111', '44444444-0000-0000-0000-000000000102', 'Buffalo mozzarella', 45, false, 1),
  ('55555555-0000-0000-0000-000000000112', '44444444-0000-0000-0000-000000000102', 'Parma ham', 60, false, 2),
  ('55555555-0000-0000-0000-000000000113', '44444444-0000-0000-0000-000000000102', 'Rocket & shaved parmesan', 35, false, 3),
  ('55555555-0000-0000-0000-000000000114', '44444444-0000-0000-0000-000000000102', 'Truffle oil', 40, false, 4),
  -- Diavola size
  ('55555555-0000-0000-0000-000000000121', '44444444-0000-0000-0000-000000000103', 'Personal 24cm', 0, true, 1),
  ('55555555-0000-0000-0000-000000000122', '44444444-0000-0000-0000-000000000103', 'Classic 32cm', 60, false, 2),
  ('55555555-0000-0000-0000-000000000123', '44444444-0000-0000-0000-000000000103', 'Family 40cm', 120, false, 3)
on conflict (id) do nothing;
update public.modifiers set style='size'   where id in ('44444444-0000-0000-0000-000000000101','44444444-0000-0000-0000-000000000103');
update public.modifiers set style='addons', subtitle='Make it yours' where id='44444444-0000-0000-0000-000000000102';

-- ════════════════════════════════════════════════════════════════════════════
-- SUSHI ROKU  (id ...0003) — Japanese · omakase · card-only
-- ════════════════════════════════════════════════════════════════════════════
insert into public.menu_sections (id, restaurant_id, name, sort_order) values
  ('22222222-0000-0000-0000-000000000301', '11111111-0000-0000-0000-000000000003', 'Nigiri & Sashimi', 1),
  ('22222222-0000-0000-0000-000000000302', '11111111-0000-0000-0000-000000000003', 'Signature Rolls', 2),
  ('22222222-0000-0000-0000-000000000303', '11111111-0000-0000-0000-000000000003', 'From the Kitchen', 3)
on conflict (id) do nothing;

insert into public.menu_items
  (id, restaurant_id, section_id, name, description, price_egp, image, flags, is_available, sort_order)
values
  ('33333333-0000-0000-0000-000000000301', '11111111-0000-0000-0000-000000000003', '22222222-0000-0000-0000-000000000301',
   'Salmon Nigiri (2 pc)', 'Norwegian salmon, hand-pressed shari.', 95, '', array['glutenfree']::item_flag_type[], true, 1),
  ('33333333-0000-0000-0000-000000000302', '11111111-0000-0000-0000-000000000003', '22222222-0000-0000-0000-000000000301',
   'Bluefin Tuna Sashimi (5 pc)', 'Akami cut, daily catch.', 180, '', array['glutenfree']::item_flag_type[], true, 2),
  ('33333333-0000-0000-0000-000000000303', '11111111-0000-0000-0000-000000000003', '22222222-0000-0000-0000-000000000302',
   'Dragon Roll', 'Eel, cucumber, avocado, unagi glaze.', 165, '', array['contains_nuts']::item_flag_type[], true, 1),
  ('33333333-0000-0000-0000-000000000304', '11111111-0000-0000-0000-000000000003', '22222222-0000-0000-0000-000000000302',
   'Spicy Tuna Roll', 'Tuna, sriracha mayo, tempura crunch, scallion.', 140, '', array['spicy']::item_flag_type[], true, 2),
  ('33333333-0000-0000-0000-000000000305', '11111111-0000-0000-0000-000000000003', '22222222-0000-0000-0000-000000000302',
   'Rainbow Roll', 'California base, five-fish over the top.', 185, '', array[]::item_flag_type[], true, 3),
  ('33333333-0000-0000-0000-000000000306', '11111111-0000-0000-0000-000000000003', '22222222-0000-0000-0000-000000000303',
   'Chicken Katsu', 'Panko-crusted, tonkatsu sauce, shredded cabbage.', 150, '', array[]::item_flag_type[], true, 1),
  ('33333333-0000-0000-0000-000000000307', '11111111-0000-0000-0000-000000000003', '22222222-0000-0000-0000-000000000303',
   'Edamame', 'Steamed, Maldon sea salt.', 60, '', array['vegan','vegetarian','glutenfree']::item_flag_type[], true, 2)
on conflict (id) do nothing;

-- Roll add-ons (style 'addons') + wasabi/ginger toggle (style 'list')
insert into public.modifiers (id, item_id, name, required, min_select, max_select, sort_order) values
  ('44444444-0000-0000-0000-000000000301', '33333333-0000-0000-0000-000000000303', 'Add-ons', false, 0, 3, 1),
  ('44444444-0000-0000-0000-000000000302', '33333333-0000-0000-0000-000000000303', 'On the side', false, 0, 2, 2)
on conflict (id) do nothing;
insert into public.modifier_options (id, modifier_id, name, price_delta_egp, is_default, sort_order) values
  ('55555555-0000-0000-0000-000000000301', '44444444-0000-0000-0000-000000000301', 'Extra eel (2 pc)', 55, false, 1),
  ('55555555-0000-0000-0000-000000000302', '44444444-0000-0000-0000-000000000301', 'Tobiko (flying-fish roe)', 35, false, 2),
  ('55555555-0000-0000-0000-000000000303', '44444444-0000-0000-0000-000000000301', 'Tempura crunch', 20, false, 3),
  ('55555555-0000-0000-0000-000000000311', '44444444-0000-0000-0000-000000000302', 'Extra wasabi', 0, false, 1),
  ('55555555-0000-0000-0000-000000000312', '44444444-0000-0000-0000-000000000302', 'Pickled ginger', 0, true, 2)
on conflict (id) do nothing;
update public.modifiers set style='addons' where id='44444444-0000-0000-0000-000000000301';
update public.modifiers set style='list'   where id='44444444-0000-0000-0000-000000000302';

-- ════════════════════════════════════════════════════════════════════════════
-- BURGER BOUTIQUE  (id ...0005) — smashed-patty burgers, fries, shakes
-- ════════════════════════════════════════════════════════════════════════════
insert into public.menu_sections (id, restaurant_id, name, sort_order) values
  ('22222222-0000-0000-0000-000000000501', '11111111-0000-0000-0000-000000000005', 'Burgers', 1),
  ('22222222-0000-0000-0000-000000000502', '11111111-0000-0000-0000-000000000005', 'Sides', 2),
  ('22222222-0000-0000-0000-000000000503', '11111111-0000-0000-0000-000000000005', 'Shakes', 3)
on conflict (id) do nothing;

insert into public.menu_items
  (id, restaurant_id, section_id, name, description, price_egp, image, flags, is_available, sort_order)
values
  ('33333333-0000-0000-0000-000000000501', '11111111-0000-0000-0000-000000000005', '22222222-0000-0000-0000-000000000501',
   'The Boutique Smash', 'Double smashed patty, American cheese, house sauce, pickles.', 145, '', array[]::item_flag_type[], true, 1),
  ('33333333-0000-0000-0000-000000000502', '11111111-0000-0000-0000-000000000005', '22222222-0000-0000-0000-000000000501',
   'Bacon Jam Burger', 'Single patty, cheddar, bacon jam, crispy onions.', 165, '', array['contains_pork']::item_flag_type[], true, 2),
  ('33333333-0000-0000-0000-000000000503', '11111111-0000-0000-0000-000000000005', '22222222-0000-0000-0000-000000000501',
   'Mushroom Swiss', 'Single patty, sautéed mushrooms, Swiss, truffle mayo.', 155, '', array['vegetarian']::item_flag_type[], true, 3),
  ('33333333-0000-0000-0000-000000000504', '11111111-0000-0000-0000-000000000005', '22222222-0000-0000-0000-000000000501',
   'Falafel Burger', 'Crispy falafel patty, tahini slaw, pickled turnip.', 120, '', array['vegan','vegetarian']::item_flag_type[], true, 4),
  ('33333333-0000-0000-0000-000000000505', '11111111-0000-0000-0000-000000000005', '22222222-0000-0000-0000-000000000502',
   'Hand-cut Fries', 'Skin-on, rosemary salt.', 55, '', array['vegan','vegetarian']::item_flag_type[], true, 1),
  ('33333333-0000-0000-0000-000000000506', '11111111-0000-0000-0000-000000000005', '22222222-0000-0000-0000-000000000502',
   'Truffle Parm Fries', 'Truffle oil, parmesan, parsley.', 85, '', array['vegetarian']::item_flag_type[], true, 2),
  ('33333333-0000-0000-0000-000000000507', '11111111-0000-0000-0000-000000000005', '22222222-0000-0000-0000-000000000503',
   'Oreo Milkshake', 'Vanilla soft-serve, crushed Oreo, whipped cream.', 75, '', array['vegetarian']::item_flag_type[], true, 1)
on conflict (id) do nothing;

-- Burger build: doneness (size-style segmented), remove-ingredients (ingredients
-- style → "No onions"), and paid add-ons (addons style).
insert into public.modifiers (id, item_id, name, required, min_select, max_select, sort_order) values
  ('44444444-0000-0000-0000-000000000501', '33333333-0000-0000-0000-000000000501', 'How do you want it?', true, 1, 1, 1),
  ('44444444-0000-0000-0000-000000000502', '33333333-0000-0000-0000-000000000501', 'Ingredients', false, 0, 5, 2),
  ('44444444-0000-0000-0000-000000000503', '33333333-0000-0000-0000-000000000501', 'Add extras', false, 0, 5, 3)
on conflict (id) do nothing;
insert into public.modifier_options (id, modifier_id, name, price_delta_egp, is_default, sort_order) values
  -- doneness
  ('55555555-0000-0000-0000-000000000501', '44444444-0000-0000-0000-000000000501', 'Medium', 0, true, 1),
  ('55555555-0000-0000-0000-000000000502', '44444444-0000-0000-0000-000000000501', 'Medium well', 0, false, 2),
  ('55555555-0000-0000-0000-000000000503', '44444444-0000-0000-0000-000000000501', 'Well done', 0, false, 3),
  -- ingredients (default-on; tapping removes → "No X")
  ('55555555-0000-0000-0000-000000000511', '44444444-0000-0000-0000-000000000502', 'Pickles', 0, true, 1),
  ('55555555-0000-0000-0000-000000000512', '44444444-0000-0000-0000-000000000502', 'Onions', 0, true, 2),
  ('55555555-0000-0000-0000-000000000513', '44444444-0000-0000-0000-000000000502', 'House sauce', 0, true, 3),
  ('55555555-0000-0000-0000-000000000514', '44444444-0000-0000-0000-000000000502', 'Tomato', 0, true, 4),
  ('55555555-0000-0000-0000-000000000515', '44444444-0000-0000-0000-000000000502', 'Lettuce', 0, true, 5),
  -- paid extras
  ('55555555-0000-0000-0000-000000000521', '44444444-0000-0000-0000-000000000503', 'Extra patty', 45, false, 1),
  ('55555555-0000-0000-0000-000000000522', '44444444-0000-0000-0000-000000000503', 'Cheddar', 15, false, 2),
  ('55555555-0000-0000-0000-000000000523', '44444444-0000-0000-0000-000000000503', 'Crispy onions', 15, false, 3),
  ('55555555-0000-0000-0000-000000000524', '44444444-0000-0000-0000-000000000503', 'Jalapeños', 10, false, 4),
  ('55555555-0000-0000-0000-000000000525', '44444444-0000-0000-0000-000000000503', 'Fried egg', 20, false, 5)
on conflict (id) do nothing;
update public.modifiers set style='size' where id='44444444-0000-0000-0000-000000000501';
update public.modifiers set style='ingredients', subtitle='Tap to remove' where id='44444444-0000-0000-0000-000000000502';
update public.modifiers set style='addons',      subtitle='Stack it up'   where id='44444444-0000-0000-0000-000000000503';
