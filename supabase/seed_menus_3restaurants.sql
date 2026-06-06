-- seed_menus_3restaurants.sql
-- Adds menus for the 3 restaurants that shipped empty: Trattoria del Mare,
-- Sushi Roku, Burger Boutique. Idempotent (on conflict do nothing / update).
-- Run with the service_role key (SQL Editor) or psql, AFTER the base seed.
--
-- This block is also appended to supabase/seed.sql so a fresh seed is complete.
--
-- ID conventions (avoid collisions with the existing 2-restaurant seed):
--   sections  2222...-<RR><NN>   items 3333...-<RR><NN>
--   modifiers 4444...-<RR><NN>    options 5555...-<RR><NNN>
--   where RR = restaurant suffix (01 Trattoria, 03 Sushi, 05 Burger)
--
-- The app renders modifier groups by `modifiers.style`
-- ('size'|'ingredients'|'addons'|'builder'|'list'); we use a spread of styles to
-- exercise the rich item UI (see apps/customer/src/data/types.ts ModifierStyle).

-- ════════════════════════════════════════════════════════════════════════════
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
