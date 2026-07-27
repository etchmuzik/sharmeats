-- Assertions for migration 145 (prepare_cart).
--
-- Run inside a rolled-back transaction:
--   BEGIN; \i supabase/migrations/145_prepare_cart.sql
--          \i supabase/tests/145_prepare_cart.test.sql
--   ROLLBACK;
--
-- The functional cases build their own fixture inside the transaction, so they
-- do not depend on which restaurants happen to exist in production and cannot
-- leave anything behind.

\set ON_ERROR_STOP on

do $$
declare
  v_fail  text[] := '{}';
  v_n     int;
  v_rest  uuid;
  v_item  uuid;
  v_item2 uuid;
  v_gone  uuid;
  v_mod   uuid;
  v_opt   uuid;
  v_other_opt uuid;
  v_row   record;
  v_codes text[];
begin
  -- ---------------------------------------------------------------- shape --
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'prepare_cart';
  if v_n <> 1 then
    v_fail := v_fail || ('expected exactly 1 prepare_cart overload, found ' || v_n)::text;
  end if;

  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'prepare_cart'
     and p.prosecdef
     and array_to_string(coalesce(p.proconfig, '{}'), ',') like '%search_path%';
  if v_n <> 1 then
    v_fail := v_fail || 'prepare_cart must be SECURITY DEFINER with a pinned search_path'::text;
  end if;

  -- ------------------------------------------------------------- security --
  if has_function_privilege('anon', 'public.prepare_cart(uuid, jsonb)', 'EXECUTE') then
    v_fail := v_fail || 'anon can EXECUTE prepare_cart'::text;
  end if;
  if has_function_privilege('public', 'public.prepare_cart(uuid, jsonb)', 'EXECUTE') then
    v_fail := v_fail || 'PUBLIC can EXECUTE prepare_cart'::text;
  end if;
  if not has_function_privilege('authenticated', 'public.prepare_cart(uuid, jsonb)', 'EXECUTE') then
    v_fail := v_fail || 'authenticated cannot EXECUTE prepare_cart'::text;
  end if;

  -- No auth.uid() in this session, so it must refuse (the anon-key case).
  begin
    perform * from public.prepare_cart(gen_random_uuid(), '[]'::jsonb);
    v_fail := v_fail || 'prepare_cart did NOT refuse an unauthenticated caller'::text;
  exception
    when sqlstate '23514' then null;  -- AUTH_REQUIRED. Correct.
    when others then
      v_fail := v_fail || ('unexpected error from unauthenticated call: ' || sqlerrm)::text;
  end;

  if array_length(v_fail, 1) > 0 then
    raise exception E'MIG 145 SHAPE/SECURITY FAILED (%):\n  - %',
      array_length(v_fail, 1), array_to_string(v_fail, E'\n  - ');
  end if;
  raise notice 'MIG 145 shape + security assertions PASSED';
end $$;


-- ---------------------------------------------------------------------------
-- Functional behaviour.
--
-- auth.uid() reads the `request.jwt.claims` GUC (verified against the deployed
-- definition), so a real authenticated session is simulated by setting that GUC
-- LOCALly -- no stub function, no shadowing of auth.uid, and it disappears with
-- the transaction. This exercises the very same code path PostgREST uses.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000aa"}';

do $$
declare
  v_fail  text[] := '{}';
  v_rest  uuid := gen_random_uuid();
  v_item  uuid := gen_random_uuid();
  v_gone  uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_mod   uuid := gen_random_uuid();
  v_opt   uuid := gen_random_uuid();
  v_omod  uuid := gen_random_uuid();
  v_oopt  uuid := gen_random_uuid();
  v_sect  uuid := gen_random_uuid();
  v_shut  uuid := gen_random_uuid();
  v_sitem uuid := gen_random_uuid();
  v_ssect uuid := gen_random_uuid();
  v_row   record;
  v_codes text[];
begin
  -- NOT NULL columns without defaults, checked against the live schema:
  -- restaurants needs slug/cover_image/zone, menu_items needs section_id.
  insert into public.restaurants (id, slug, name, cover_image, zone, is_active, is_open, min_order_egp)
  values (v_rest, '_t145-fixture', '_t145 fixture', '', 'naama', true, true, 100);

  insert into public.menu_sections (id, restaurant_id, name)
  values (v_sect, v_rest, '_t145 section');

  insert into public.menu_items (id, restaurant_id, section_id, name, price_egp, is_available)
  values (v_item,  v_rest, v_sect, 'Koshary', 50, true),
         (v_gone,  v_rest, v_sect, 'Sold out dish', 40, false),
         (v_other, v_rest, v_sect, 'Other dish', 30, true);

  -- A modifier on v_item, and one on v_other (to prove the cross-item join).
  insert into public.modifiers (id, item_id, name, required, sort_order)
  values (v_mod,  v_item,  'Size',  false, 0),
         (v_omod, v_other, 'Sauce', false, 0);
  insert into public.modifier_options (id, modifier_id, name, price_delta_egp, sort_order)
  values (v_opt,  v_mod,  'Large', 15, 0),
         (v_oopt, v_omod, 'Extra', 5,  0);

  -- 1. A clean line reprices from the LIVE item and its live option delta.
  select * into v_row from public.prepare_cart(
    v_rest,
    jsonb_build_array(jsonb_build_object(
      'item_id', v_item, 'quantity', 2,
      'modifier_option_ids', jsonb_build_array(v_opt),
      'notes', 'no onions'))
  );
  if v_row.subtotal_egp <> (50 + 15) * 2 then
    v_fail := v_fail || format('clean line subtotal was %s, expected 130', v_row.subtotal_egp);
  end if;
  if jsonb_array_length(v_row.issues) <> 0 then
    v_fail := v_fail || format('clean line reported issues: %s', v_row.issues::text);
  end if;
  if v_row.prepared_items->0->>'notes' is distinct from 'no onions' then
    v_fail := v_fail || 'customer notes were not preserved'::text;
  end if;
  if (v_row.prepared_items->0->>'quantity')::int <> 2 then
    v_fail := v_fail || 'quantity was not preserved'::text;
  end if;

  -- 2. Restaurant state the client cannot see for itself.
  if not v_row.restaurant_open then
    v_fail := v_fail || 'open restaurant reported as closed'::text;
  end if;
  if v_row.minimum_order_egp <> 100 then
    v_fail := v_fail || format('minimum_order_egp was %s, expected 100', v_row.minimum_order_egp);
  end if;

  -- 3. Unavailable item is EXCLUDED from the basket and reported.
  select * into v_row from public.prepare_cart(
    v_rest, jsonb_build_array(jsonb_build_object('item_id', v_gone, 'quantity', 1)));
  if jsonb_array_length(v_row.prepared_items) <> 0 then
    v_fail := v_fail || 'unavailable item was kept in the prepared basket'::text;
  end if;
  if v_row.issues->0->>'code' is distinct from 'ITEM_UNAVAILABLE' then
    v_fail := v_fail || format('expected ITEM_UNAVAILABLE, got %s', v_row.issues::text);
  end if;
  if v_row.subtotal_egp <> 0 then
    v_fail := v_fail || 'unavailable item contributed to the subtotal'::text;
  end if;

  -- 4. An option belonging to ANOTHER item: place_order silently drops it
  --    (join on m.item_id), so the dish must survive WITHOUT it and the loss
  --    must be reported rather than swallowed.
  select * into v_row from public.prepare_cart(
    v_rest,
    jsonb_build_array(jsonb_build_object(
      'item_id', v_item, 'quantity', 1,
      'modifier_option_ids', jsonb_build_array(v_oopt))));
  if jsonb_array_length(v_row.prepared_items) <> 1 then
    v_fail := v_fail || 'a foreign modifier option dropped the whole dish'::text;
  end if;
  if v_row.subtotal_egp <> 50 then
    v_fail := v_fail || format('foreign option leaked into the price: subtotal %s, expected 50',
                               v_row.subtotal_egp);
  end if;
  select array_agg(x->>'code') into v_codes from jsonb_array_elements(v_row.issues) x;
  if not ('MODIFIER_GONE' = any(coalesce(v_codes, '{}'))) then
    v_fail := v_fail || format('expected MODIFIER_GONE, got %s', coalesce(v_codes, '{}')::text);
  end if;

  -- 5. An item from a different restaurant cannot be smuggled in.
  select * into v_row from public.prepare_cart(
    v_rest, jsonb_build_array(jsonb_build_object('item_id', gen_random_uuid(), 'quantity', 1)));
  if v_row.issues->0->>'code' is distinct from 'ITEM_NOT_FOUND' then
    v_fail := v_fail || format('expected ITEM_NOT_FOUND, got %s', v_row.issues::text);
  end if;

  -- 6. Bad quantity is reported, and does NOT abort the rest of the basket --
  --    a customer must see every problem at once, not one per attempt.
  select * into v_row from public.prepare_cart(
    v_rest,
    jsonb_build_array(
      jsonb_build_object('item_id', v_item, 'quantity', 0),
      jsonb_build_object('item_id', v_item, 'quantity', 1)));
  if jsonb_array_length(v_row.prepared_items) <> 1 then
    v_fail := v_fail || 'a bad quantity aborted the remaining lines'::text;
  end if;
  if v_row.issues->0->>'code' is distinct from 'INVALID_QTY' then
    v_fail := v_fail || format('expected INVALID_QTY, got %s', v_row.issues::text);
  end if;

  -- 7. A closed restaurant still returns a viewable basket (the spec requires
  --    viewing with checkout blocked, not an empty screen).
  --
  -- Inserted CLOSED rather than updated: mig 136's restaurants_guard_privileged
  -- _columns() trigger refuses an is_open UPDATE from a non-manager, and this
  -- session carries a plain customer JWT. The guard firing here is correct
  -- behaviour, so the fixture works with it instead of around it.
  insert into public.restaurants (id, slug, name, cover_image, zone, is_active, is_open, min_order_egp)
  values (v_shut, '_t145-closed', '_t145 closed', '', 'naama', true, false, 0);
  insert into public.menu_sections (id, restaurant_id, name)
  values (v_ssect, v_shut, '_t145 closed section');
  insert into public.menu_items (id, restaurant_id, section_id, name, price_egp, is_available)
  values (v_sitem, v_shut, v_ssect, 'Late night koshary', 45, true);

  select * into v_row from public.prepare_cart(
    v_shut, jsonb_build_array(jsonb_build_object('item_id', v_sitem, 'quantity', 1)));
  if v_row.restaurant_open then
    v_fail := v_fail || 'closed restaurant reported as open'::text;
  end if;
  if jsonb_array_length(v_row.prepared_items) <> 1 then
    v_fail := v_fail || 'closed restaurant returned no prepared items'::text;
  end if;

  -- 8. An empty cart is valid input and returns an empty basket, not an error:
  --    a saved preset whose every item is gone must render as "all gone".
  select * into v_row from public.prepare_cart(v_rest, '[]'::jsonb);
  if jsonb_array_length(v_row.prepared_items) <> 0 or v_row.subtotal_egp <> 0 then
    v_fail := v_fail || 'empty cart did not return an empty basket'::text;
  end if;

  -- 9. Oversized basket is refused before doing the work.
  begin
    perform * from public.prepare_cart(
      v_rest,
      (select jsonb_agg(jsonb_build_object('item_id', v_item, 'quantity', 1))
         from generate_series(1, 101)));
    v_fail := v_fail || 'a 101-line cart was not refused'::text;
  exception when sqlstate '23514' then null;
  end;

  if array_length(v_fail, 1) > 0 then
    raise exception E'MIG 145 FUNCTIONAL FAILED (%):\n  - %',
      array_length(v_fail, 1), array_to_string(v_fail, E'\n  - ');
  end if;
  raise notice 'MIG 145 functional assertions PASSED';
end $$;
