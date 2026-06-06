-- =============================================================
-- Sharm Eats — apply the two fixes + 3-restaurant menus.
-- Paste into Supabase SQL Editor and Run (one shot, ordered).
--   1) 015 self-delivery COD settlement fix
--   2) 016 modifier presentation columns
--   3) menus for Trattoria / Sushi Roku / Burger Boutique
-- Idempotent. Safe to re-run.
-- =============================================================

-- ===== 015 ==================================================
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

-- ===== 016 ==================================================
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

-- ===== 3-restaurant menus ===================================
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

