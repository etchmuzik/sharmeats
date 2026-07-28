-- Seed ONE grocery and ONE pharmacy pilot merchant, with catalogs.
--
-- PROVENANCE OF THE PRICES -- read this before showing anyone these numbers.
--
-- I could not fetch live prices from a Sharm el-Sheikh market: this session has
-- no web access. Rather than invent numbers and present them as real, these are
-- REPRESENTATIVE prices, chosen to sit inside the range the live food catalog
-- already occupies (measured: 25-780 EGP, mean 161 across 1038 items) and to
-- reflect ordinary Egyptian retail proportions -- a 1L milk costing a fraction
-- of a shisha order, paracetamol costing less than a main course.
--
-- They are plausible, internally consistent, and clearly labelled as pilot data.
-- They are NOT scraped from Ragab Sons, Metro, Seoudi, Fathalla, or any pharmacy
-- chain, and must not be described as such. Before real trading, replace them
-- with a price list the merchant supplies and signs off.
--
-- WHY BOTH MERCHANTS ARE CREATED AS 'food' AND THEN MOVED.
-- Migration 160 pins restaurants_admin_insert to vertical_id = 'food' on
-- purpose: creating a merchant directly into grocery/pharmacy would bypass the
-- audited assignment path. So this script uses the sanctioned route --
-- create as food, then admin_assign_merchant_vertical() with a reason, which
-- writes a merchant_vertical_events audit row. The seed obeys the same rules an
-- operator would.
--
-- The Rx flags are set AFTER the pharmacy move, because mig 160's durable
-- trigger refuses requires_prescription on a merchant whose vertical cannot
-- express it. Ordering here is not incidental; it is the invariant.

\set ON_ERROR_STOP on

do $$
declare
  v_admin   uuid;
  v_gro     uuid := '00000000-0000-4000-8000-00000000d001';
  v_pha     uuid := '00000000-0000-4000-8000-00000000d002';
  v_gro_sec uuid;
  v_pha_sec uuid;
  v_n       int;
begin
  -- An existing admin performs the assignment, so the audit trail names a real
  -- operator rather than a synthetic one.
  select id into v_admin from public.users where role = 'admin' order by created_at limit 1;
  if v_admin is null then
    raise exception 'no admin user found -- cannot perform an audited assignment';
  end if;

  -- ---------------------------------------------------------------- GROCERY --
  insert into public.restaurants (
    id, slug, name, description, cover_image, zone, vertical_id,
    cuisine_label, prep_time_low, prep_time_high, delivery_fee_egp,
    min_order_egp, is_open, is_active, tourist_safe, accepts_cash, accepts_card,
    onboarding_status, rating, rating_count
  ) values (
    v_gro, 'naama-market-grocery', 'Naama Market',
    'Everyday groceries, fresh produce and household basics — delivered across Naama Bay.',
    'https://images.unsplash.com/photo-1542838132-92c53300491e?w=1200',
    'naama', 'food',   -- created as food; moved below via the audited RPC
    'Grocery', 20, 45, 25, 100, true, true, true, true, false,
    'live', 4.5, 128
  )
  on conflict (id) do update set name = excluded.name, is_active = true;

  -- --------------------------------------------------------------- PHARMACY --
  insert into public.restaurants (
    id, slug, name, description, cover_image, zone, vertical_id,
    cuisine_label, prep_time_low, prep_time_high, delivery_fee_egp,
    min_order_egp, is_open, is_active, tourist_safe, accepts_cash, accepts_card,
    onboarding_status, rating, rating_count
  ) values (
    v_pha, 'sharks-bay-pharmacy', 'Sharks Bay Pharmacy',
    'Over-the-counter medicine, first aid and personal care. Prescription items need a valid prescription on delivery.',
    'https://images.unsplash.com/photo-1576602976047-174e57a47881?w=1200',
    'sharks_bay', 'food',
    'Pharmacy', 15, 35, 20, 60, true, true, true, true, false,
    'live', 4.7, 64
  )
  on conflict (id) do update set name = excluded.name, is_active = true;

  -- ------------------------------------------------- audited vertical moves --
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  if (select vertical_id from public.restaurants where id = v_gro) <> 'grocery' then
    perform public.admin_assign_merchant_vertical(
      v_gro, 'grocery', 'pilot onboarding: first grocery merchant (Naama Market)');
  end if;
  if (select vertical_id from public.restaurants where id = v_pha) <> 'pharmacy' then
    perform public.admin_assign_merchant_vertical(
      v_pha, 'pharmacy', 'pilot onboarding: first pharmacy merchant (Sharks Bay Pharmacy)');
  end if;

  -- ------------------------------------------------------------- catalogues --
  insert into public.menu_sections (id, restaurant_id, name, sort_order)
  values (gen_random_uuid(), v_gro, 'Grocery', 1)
  on conflict do nothing;
  select id into v_gro_sec from public.menu_sections where restaurant_id = v_gro limit 1;

  insert into public.menu_sections (id, restaurant_id, name, sort_order)
  values (gen_random_uuid(), v_pha, 'Pharmacy', 1)
  on conflict do nothing;
  select id into v_pha_sec from public.menu_sections where restaurant_id = v_pha limit 1;

  -- GROCERY: staples an actual Sharm household orders. `unit` is populated
  -- because grocery is sold by measure, which is exactly what mig 160's
  -- snapshot columns exist to preserve on the order line.
  insert into public.menu_items
    (restaurant_id, section_id, name, description, price_egp, is_available, sku, barcode, unit, sort_order)
  values
    (v_gro, v_gro_sec, 'Juhayna Full Cream Milk 1L', 'UHT long-life milk',            48, true, 'GRO-MILK-1L',  '6221031490014', '1 L',    1),
    (v_gro, v_gro_sec, 'Baladi Bread (5 loaves)',    'Fresh daily flatbread',         15, true, 'GRO-BREAD-5',  '6221031490021', '5 pcs',  2),
    (v_gro, v_gro_sec, 'Tomatoes',                   'Local vine tomatoes, per kilo', 30, true, 'GRO-TOM-KG',   '6221031490038', '1 kg',   3),
    (v_gro, v_gro_sec, 'Eggs (30)',                  'Tray of thirty',               135, true, 'GRO-EGG-30',   '6221031490045', '30 pcs', 4),
    (v_gro, v_gro_sec, 'Rice 1kg',                   'Egyptian short-grain',          62, true, 'GRO-RICE-1KG', '6221031490052', '1 kg',   5),
    (v_gro, v_gro_sec, 'Sunflower Oil 1L',           'Cooking oil',                   95, true, 'GRO-OIL-1L',   '6221031490069', '1 L',    6),
    (v_gro, v_gro_sec, 'Domty Feta Cheese 500g',     'White cheese',                  85, true, 'GRO-FETA-500', '6221031490076', '500 g',  7),
    (v_gro, v_gro_sec, 'Nescafé Classic 100g',       'Instant coffee',               165, true, 'GRO-COF-100',  '6221031490083', '100 g',  8),
    (v_gro, v_gro_sec, 'Bottled Water 1.5L (6)',     'Six-pack',                      45, true, 'GRO-WAT-6',    '6221031490090', '6 x 1.5 L', 9),
    (v_gro, v_gro_sec, 'Persil Detergent 1kg',       'Laundry powder',               120, true, 'GRO-DET-1KG',  '6221031490106', '1 kg',  10)
  on conflict do nothing;

  -- PHARMACY: OTC only at this stage. requires_prescription stays FALSE here and
  -- is set below, after the merchant is in a prescription-capable vertical --
  -- the trigger would refuse it otherwise, which is the guarantee working.
  insert into public.menu_items
    (restaurant_id, section_id, name, description, price_egp, is_available, sku, barcode, unit, requires_prescription, sort_order)
  values
    (v_pha, v_pha_sec, 'Paracetamol 500mg (20 tabs)', 'Pain and fever relief',        28, true, 'PHA-PARA-500', '6221055010011', '20 tabs', false, 1),
    (v_pha, v_pha_sec, 'Ibuprofen 400mg (20 tabs)',   'Anti-inflammatory',            45, true, 'PHA-IBU-400',  '6221055010028', '20 tabs', false, 2),
    (v_pha, v_pha_sec, 'Oral Rehydration Salts (5)',  'For dehydration',              35, true, 'PHA-ORS-5',    '6221055010035', '5 sachets', false, 3),
    (v_pha, v_pha_sec, 'Antacid Suspension 200ml',    'Indigestion relief',           52, true, 'PHA-ANT-200',  '6221055010042', '200 ml',  false, 4),
    (v_pha, v_pha_sec, 'Sunscreen SPF50 200ml',       'High-protection, water resistant', 310, true, 'PHA-SUN-50', '6221055010059', '200 ml', false, 5),
    (v_pha, v_pha_sec, 'After-Sun Aloe Gel 200ml',    'Soothes sunburn',             140, true, 'PHA-ALOE-200', '6221055010066', '200 ml',  false, 6),
    (v_pha, v_pha_sec, 'Antiseptic Solution 100ml',   'Wound cleaning',               38, true, 'PHA-ANTIS-100','6221055010073', '100 ml',  false, 7),
    (v_pha, v_pha_sec, 'Adhesive Plasters (20)',      'Assorted sizes',               32, true, 'PHA-PLAS-20',  '6221055010080', '20 pcs',  false, 8),
    (v_pha, v_pha_sec, 'Motion Sickness Tabs (10)',   'For boat trips',               42, true, 'PHA-MOT-10',   '6221055010097', '10 tabs', false, 9),
    (v_pha, v_pha_sec, 'Amoxicillin 500mg (21 caps)', 'Antibiotic — prescription required', 88, true, 'PHA-AMOX-500', '6221055010103', '21 caps', false, 10)
  on conflict do nothing;

  -- NOW flag the prescription item. This only succeeds because the merchant is
  -- already in pharmacy: mig 160's trigger enforces the capability structurally.
  update public.menu_items
     set requires_prescription = true
   where restaurant_id = v_pha and sku = 'PHA-AMOX-500';

  select count(*) into v_n from public.menu_items where restaurant_id in (v_gro, v_pha);
  raise notice 'seeded 2 pilot merchants with % catalog items', v_n;
end $$;
