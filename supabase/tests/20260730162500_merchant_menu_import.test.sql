-- Durable regression assertions for the atomic merchant menu importer.
--
-- Scratch/full-schema usage:
--   BEGIN;
--   \i supabase/migrations/20260730162500_atomic_merchant_menu_import.sql
--   \i supabase/tests/20260730162500_merchant_menu_import.test.sql
--   ROLLBACK;
--
-- The local standalone verification may instead load
-- 136_staff_role_fixture.sql + migration 136 before this migration. The actor
-- UUIDs below are those fixture identities, so the same assertions exercise
-- the real manager/admin/cross-tenant contract without replacing auth helpers.

\set ON_ERROR_STOP on

do $shape$
declare
  v_fail text[] := '{}';
  v_definition text;
  v_events text;
begin
  if has_function_privilege(
       'anon',
       'private.acquire_merchant_menu_locks(uuid[])',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'private.acquire_merchant_menu_locks(uuid[])',
       'EXECUTE'
     ) then
    v_fail := v_fail || 'the internal advisory-lock helper is client-callable'::text;
  end if;

  select pg_get_functiondef(
           'private.acquire_merchant_menu_locks(uuid[])'::regprocedure
         )
    into v_definition;
  if position('merchant-menu:' in v_definition) = 0 then
    v_fail := v_fail || 'the advisory key is not stable and semantic'::text;
  end if;

  select pg_get_functiondef(
           'public.import_merchant_menu(uuid,jsonb)'::regprocedure
         )
    into v_definition;
  if position('private.acquire_merchant_menu_locks' in v_definition) = 0 then
    v_fail := v_fail || 'bulk import does not acquire the shared menu lock'::text;
  end if;

  select pg_get_functiondef(
           'public.merchant_menu_mutation_guard()'::regprocedure
         )
    into v_definition;
  if position('private.acquire_merchant_menu_locks' in v_definition) = 0 then
    v_fail := v_fail || 'direct table mutation guard does not acquire the shared menu lock'::text;
  end if;

  select pg_get_functiondef(
           'public.append_merchant_menu_section(uuid,text)'::regprocedure
         )
    into v_definition;
  if position('private.acquire_merchant_menu_locks' in v_definition) = 0
     or position('max(ms.sort_order)' in v_definition) = 0 then
    v_fail := v_fail || 'section append does not lock before server-side ordering'::text;
  end if;

  select pg_get_functiondef(
           'public.append_merchant_menu_item(uuid,uuid,text,text,integer,text,public.item_flag_type[],boolean)'::regprocedure
         )
    into v_definition;
  if position('private.acquire_merchant_menu_locks' in v_definition) = 0
     or position('max(mi.sort_order)' in v_definition) = 0 then
    v_fail := v_fail || 'item append does not lock before server-side ordering'::text;
  end if;

  select string_agg(event_manipulation, ',' order by event_manipulation)
    into v_events
    from information_schema.triggers
   where event_object_schema = 'public'
     and event_object_table = 'menu_sections'
     and trigger_name = 'aaa_merchant_menu_mutation_guard';
  if v_events is distinct from 'DELETE,INSERT,UPDATE' then
    v_fail := v_fail || format(
      'menu_sections lock trigger events are %L, expected DELETE,INSERT,UPDATE',
      v_events
    );
  end if;

  select string_agg(event_manipulation, ',' order by event_manipulation)
    into v_events
    from information_schema.triggers
   where event_object_schema = 'public'
     and event_object_table = 'menu_items'
     and trigger_name = 'aaa_merchant_menu_mutation_guard';
  if v_events is distinct from 'DELETE,INSERT,UPDATE' then
    v_fail := v_fail || format(
      'menu_items lock trigger events are %L, expected DELETE,INSERT,UPDATE',
      v_events
    );
  end if;

  if has_function_privilege(
       'anon',
       'public.import_merchant_menu(uuid,jsonb)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.append_merchant_menu_section(uuid,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.append_merchant_menu_item(uuid,uuid,text,text,integer,text,public.item_flag_type[],boolean)',
       'EXECUTE'
     ) then
    v_fail := v_fail || 'anon can execute a merchant menu mutation RPC'::text;
  end if;

  if not has_function_privilege(
       'authenticated',
       'public.import_merchant_menu(uuid,jsonb)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.append_merchant_menu_section(uuid,text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.append_merchant_menu_item(uuid,uuid,text,text,integer,text,public.item_flag_type[],boolean)',
       'EXECUTE'
     ) then
    v_fail := v_fail || 'authenticated lacks a required merchant menu RPC grant'::text;
  end if;

  if array_length(v_fail, 1) > 0 then
    raise exception E'MENU IMPORT SHAPE FAILED (%):\n  - %',
      array_length(v_fail, 1),
      array_to_string(v_fail, E'\n  - ');
  end if;
  raise notice 'MENU IMPORT shape assertions PASSED';
end;
$shape$;

do $behaviour$
declare
  v_fail text[] := '{}';
  v_section uuid;
  v_baseline_item uuid;
  v_direct_item uuid;
  v_item uuid;
  v_n integer;
  v_expected_sort integer;
  v_sort integer;
begin
  -- Manager succeeds on their own restaurant.
  perform set_config(
    'request.jwt.claim.sub',
    'aaaaaaaa-0000-0000-0000-000000000003',
    true
  );
  select coalesce(max(ms.sort_order) + 1, 0)
    into v_expected_sort
    from public.menu_sections ms
   where ms.restaurant_id = 'bbbbbbbb-0000-0000-0000-000000000001';
  v_section := public.append_merchant_menu_section(
    'bbbbbbbb-0000-0000-0000-000000000001',
    'Locked append'
  );
  select sort_order into v_sort
    from public.menu_sections
   where id = v_section;
  if v_sort <> v_expected_sort then
    v_fail := v_fail || format(
      'manager section append got sort_order %s, expected %s',
      v_sort,
      v_expected_sort
    );
  end if;

  v_baseline_item := public.append_merchant_menu_item(
    'bbbbbbbb-0000-0000-0000-000000000001',
    v_section,
    'Ordering baseline',
    '',
    100,
    '',
    '{}'::public.item_flag_type[],
    true
  );
  update public.menu_items
     set sort_order = 41
   where id = v_baseline_item;

  insert into public.menu_items (
    restaurant_id,
    section_id,
    name,
    description,
    price_egp,
    image,
    flags,
    is_available,
    sort_order
  )
  values (
    'bbbbbbbb-0000-0000-0000-000000000001',
    v_section,
    'Direct ordered item',
    '',
    125,
    '',
    '{}'::public.item_flag_type[],
    true,
    41
  )
  returning id into v_direct_item;
  select sort_order into v_sort
    from public.menu_items
   where id = v_direct_item;
  if v_sort <> 42 then
    v_fail := v_fail || format(
      'colliding direct item insert got sort_order %s, expected 42',
      v_sort
    );
  end if;

  v_item := public.append_merchant_menu_item(
    'bbbbbbbb-0000-0000-0000-000000000001',
    v_section,
    'Server ordered item',
    '',
    150,
    '',
    '{}'::public.item_flag_type[],
    true
  );
  select sort_order into v_sort
    from public.menu_items
   where id = v_item;
  if v_sort <> 43 then
    v_fail := v_fail || format(
      'manager item append got sort_order %s, expected 43',
      v_sort
    );
  end if;

  begin
    insert into public.menu_items (
      restaurant_id,
      section_id,
      name,
      description,
      price_egp,
      image,
      flags,
      is_available,
      sort_order
    )
    values (
      'bbbbbbbb-0000-0000-0000-000000000001',
      v_section,
      ' server ORDERED item ',
      '',
      125,
      '',
      '{}'::public.item_flag_type[],
      true,
      0
    );
    v_fail := v_fail || 'direct normalized duplicate item insert succeeded'::text;
  exception when invalid_parameter_value then
    null;
  end;

  -- A staff-tier user is denied even on their own restaurant.
  perform set_config(
    'request.jwt.claim.sub',
    'aaaaaaaa-0000-0000-0000-000000000002',
    true
  );
  begin
    perform public.import_merchant_menu(
      'bbbbbbbb-0000-0000-0000-000000000001',
      '[{"section_name":"Mains","item_name":"Staff write","description":"","price_egp":100,"image":"","flags":[],"is_available":true}]'::jsonb
    );
    v_fail := v_fail || 'staff imported a menu'::text;
  exception when insufficient_privilege then
    null;
  end;

  -- A manager cannot target another restaurant.
  perform set_config(
    'request.jwt.claim.sub',
    'aaaaaaaa-0000-0000-0000-000000000003',
    true
  );
  begin
    perform public.import_merchant_menu(
      'bbbbbbbb-0000-0000-0000-000000000002',
      '[{"section_name":"R2 Mains","item_name":"Cross tenant","description":"","price_egp":100,"image":"","flags":[],"is_available":true}]'::jsonb
    );
    v_fail := v_fail || 'manager imported into another tenant'::text;
  exception when insufficient_privilege then
    null;
  end;

  -- An admin may operate across tenants.
  perform set_config(
    'request.jwt.claim.sub',
    'aaaaaaaa-0000-0000-0000-000000000009',
    true
  );
  perform public.import_merchant_menu(
    'bbbbbbbb-0000-0000-0000-000000000002',
    '[{"section_name":"R2 Mains","item_name":"Admin item","description":"","price_egp":100,"image":"","flags":[],"is_available":true}]'::jsonb
  );
  select count(*) into v_n
    from public.menu_items
   where restaurant_id = 'bbbbbbbb-0000-0000-0000-000000000002'
     and name = 'Admin item';
  if v_n <> 1 then
    v_fail := v_fail || 'admin cross-tenant import did not create exactly one item'::text;
  end if;

  -- Row two fails after row one writes. The exception subtransaction must
  -- restore both tables to their pre-call state.
  perform set_config(
    'request.jwt.claim.sub',
    'aaaaaaaa-0000-0000-0000-000000000001',
    true
  );
  begin
    perform public.import_merchant_menu(
      'bbbbbbbb-0000-0000-0000-000000000001',
      '[
        {"section_name":"Rollback section","item_name":"Temporary item","description":"","price_egp":100,"image":"","flags":[],"is_available":true},
        {"section_name":"Locked append","item_name":"Server ordered item","description":"","price_egp":100,"image":"","flags":[],"is_available":true}
      ]'::jsonb
    );
    v_fail := v_fail || 'invalid two-row import unexpectedly succeeded'::text;
  exception when invalid_parameter_value then
    null;
  end;

  select count(*) into v_n
    from public.menu_sections
   where restaurant_id = 'bbbbbbbb-0000-0000-0000-000000000001'
     and name = 'Rollback section';
  if v_n <> 0 then
    v_fail := v_fail || 'failed batch left its first section behind'::text;
  end if;
  select count(*) into v_n
    from public.menu_items
   where restaurant_id = 'bbbbbbbb-0000-0000-0000-000000000001'
     and name = 'Temporary item';
  if v_n <> 0 then
    v_fail := v_fail || 'failed batch left its first item behind'::text;
  end if;

  -- Legacy rows predate this migration's name normalization and bounds. The
  -- guard must not normalize or bound-check a name the statement does not
  -- write: mig 136 diffs to_jsonb(NEW) against to_jsonb(OLD) and this trigger
  -- sorts first (aaa_), so an unconditional `new.name := btrim(new.name)`
  -- reads as a privileged name write and rejects the staff availability
  -- toggle that is the defining kitchen action, while an unconditional length
  -- check strands over-long legacy rows for every role including manager.
  alter table public.menu_items disable trigger aaa_merchant_menu_mutation_guard;
  insert into public.menu_items (
    id, restaurant_id, section_id, name, price_egp, is_available, sort_order
  )
  values
    (
      'dddddddd-0000-0000-0000-00000000f001',
      'bbbbbbbb-0000-0000-0000-000000000001',
      v_section,
      '  Legacy untrimmed  ',
      100,
      true,
      901
    ),
    (
      'dddddddd-0000-0000-0000-00000000f002',
      'bbbbbbbb-0000-0000-0000-000000000001',
      v_section,
      repeat('x', 165),
      100,
      true,
      902
    );
  alter table public.menu_items enable trigger aaa_merchant_menu_mutation_guard;

  -- Staff tier: both toggles must succeed.
  perform set_config(
    'request.jwt.claim.sub',
    'aaaaaaaa-0000-0000-0000-000000000002',
    true
  );
  begin
    update public.menu_items
       set is_available = false
     where id = 'dddddddd-0000-0000-0000-00000000f001';
  exception when others then
    v_fail := v_fail
      || ('staff could not toggle a legacy untrimmed item: ' || sqlerrm)::text;
  end;
  begin
    update public.menu_items
       set is_available = false
     where id = 'dddddddd-0000-0000-0000-00000000f002';
  exception when others then
    v_fail := v_fail
      || ('staff could not toggle an over-length legacy item: ' || sqlerrm)::text;
  end;

  -- The untouched name must not be silently rewritten by an unrelated update.
  select count(*) into v_n
    from public.menu_items
   where id = 'dddddddd-0000-0000-0000-00000000f001'
     and name = '  Legacy untrimmed  ';
  if v_n <> 1 then
    v_fail := v_fail
      || 'an unrelated update rewrote a stored menu item name'::text;
  end if;

  -- Writing the name still normalizes and still enforces the bounds.
  perform set_config(
    'request.jwt.claim.sub',
    'aaaaaaaa-0000-0000-0000-000000000003',
    true
  );
  update public.menu_items
     set name = '   Renamed legacy   '
   where id = 'dddddddd-0000-0000-0000-00000000f001';
  select count(*) into v_n
    from public.menu_items
   where id = 'dddddddd-0000-0000-0000-00000000f001'
     and name = 'Renamed legacy';
  if v_n <> 1 then
    v_fail := v_fail || 'an explicit name write was not trimmed'::text;
  end if;
  begin
    update public.menu_items
       set name = repeat('z', 200)
     where id = 'dddddddd-0000-0000-0000-00000000f001';
    v_fail := v_fail || 'an over-length name write was accepted'::text;
  exception when invalid_parameter_value then
    null;
  end;

  if array_length(v_fail, 1) > 0 then
    raise exception E'MENU IMPORT BEHAVIOUR FAILED (%):\n  - %',
      array_length(v_fail, 1),
      array_to_string(v_fail, E'\n  - ');
  end if;
  raise notice 'MENU IMPORT behaviour assertions PASSED';
end;
$behaviour$;
