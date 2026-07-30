-- 20260730162500_atomic_merchant_menu_import.sql
--
-- Atomic, append-only CSV menu import for merchant-web.
--
-- A browser cannot safely create sections and their FK-bound items with two
-- direct table writes: the section insert can commit before an item insert
-- fails. This narrow RPC validates every row, then performs all writes in the
-- one transaction PostgREST gives a function call. Any exception rolls back
-- every section and item created by the call.
--
-- Existing sections are reused by case-insensitive name. Existing items are
-- never updated: a same-name item in the same section rejects the WHOLE import.
-- This makes a retry after an ambiguous network response safe—it fails closed
-- instead of silently duplicating or overwriting menu data.
--
-- Authorization is manager+ only, matching migration 136's structural/price
-- write policy. No migration-owned table is needed.

-- One semantic lock namespace for every menu mutation path. The key is
-- deliberately independent of this migration's filename/version: a future
-- replacement must contend with an in-flight call using today's function.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

drop function if exists private.acquire_merchant_menu_locks(uuid[]);
create function private.acquire_merchant_menu_locks(
  p_restaurant_ids uuid[]
)
returns void
language plpgsql
set search_path = pg_catalog
as $lock$
declare
  v_ids uuid[];
  v_id uuid;
begin
  select coalesce(array_agg(distinct candidate order by candidate), '{}'::uuid[])
    into v_ids
    from unnest(coalesce(p_restaurant_ids, '{}'::uuid[])) as candidate
   where candidate is not null;

  if cardinality(v_ids) = 0 then
    raise exception 'CSV_IMPORT_INVALID: a restaurant id is required'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Canonical lock order: all involved merchant rows in UUID order, then all
  -- semantic advisory keys in the same order. FOR UPDATE makes opposite
  -- cross-merchant moves serialize rather than deadlock, and makes restaurant
  -- deletion/vertical reassignment wait before this transaction holds the menu
  -- advisory key.
  perform r.id
    from public.restaurants r
   where r.id = any (v_ids)
   order by r.id
   for update;

  foreach v_id in array v_ids loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('merchant-menu:' || v_id::text, 0)
    );
  end loop;
end;
$lock$;

revoke all on function private.acquire_merchant_menu_locks(uuid[])
  from public, anon, authenticated;

comment on function private.acquire_merchant_menu_locks(uuid[]) is
  'Internal menu-write serializer. Locks existing merchant rows, then stable semantic advisory keys, in UUID order. Called only by definer RPCs/triggers; clients have no schema/function privilege.';

-- Bind the lock to EVERY table mutation, including Data API writes and future
-- clients. The append RPCs below additionally calculate ordering on the server;
-- this guard repairs a colliding sort_order from a legacy direct INSERT and
-- prevents new case-insensitive duplicate names after it owns the lock.
create or replace function public.merchant_menu_mutation_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $guard$
declare
  v_restaurant_ids uuid[];
  v_may_write boolean;
begin
  if tg_op = 'INSERT' then
    v_restaurant_ids := array[new.restaurant_id];
  elsif tg_op = 'DELETE' then
    v_restaurant_ids := array[old.restaurant_id];
  else
    v_restaurant_ids := array[old.restaurant_id, new.restaurant_id];
  end if;

  -- Does this caller have any write authority over EVERY restaurant involved?
  --
  -- This trigger is SECURITY DEFINER and BEFORE ROW, and PostgreSQL evaluates
  -- an INSERT's RLS WITH CHECK only AFTER before-row triggers run. Without
  -- this gate the definer-privileged duplicate-name lookups below execute for
  -- any authenticated caller, and their 'name "X" already exists' message --
  -- distinguishable from the generic RLS rejection, and echoing the name --
  -- turns a failing INSERT into a confirmation oracle for the hidden menu of
  -- an unapproved or private-vertical merchant.
  --
  -- Exemptions mirror migration 136: a context with NO request JWT
  -- (service_role, psql, migrations, seeds) and admin both pass through.
  if auth.uid() is null
     or coalesce(public.auth_role()::text, '') = 'admin'  -- house rule 4: fail closed
  then
    v_may_write := true;
  else
    select bool_and(public.is_merchant_staff(candidate))
      into v_may_write
      from unnest(v_restaurant_ids) as candidate
     where candidate is not null;
    v_may_write := coalesce(v_may_write, false);
  end if;

  perform private.acquire_merchant_menu_locks(v_restaurant_ids);

  if tg_table_name = 'menu_sections' and tg_op <> 'DELETE' then
    -- Normalize and bound-check the name ONLY when this statement actually
    -- writes it. Two reasons, both load-bearing:
    --   1. Unconditionally assigning NEW.name makes mig 136's to_jsonb(NEW) vs
    --      to_jsonb(OLD) diff see `name` as changed on an unrelated UPDATE
    --      (this trigger is named aaa_ so it runs first), so a staff-tier
    --      availability toggle on a legacy untrimmed row is rejected with
    --      MANAGER_REQUIRED mid-shift.
    --   2. Rows predating this migration have no length/trim guarantee, so an
    --      unconditional bound check makes an over-long legacy name
    --      permanently un-updatable through every path, manager included.
    -- Names that are being written are still fully normalized and validated.
    if tg_op = 'INSERT' or old.name is distinct from new.name then
      new.name := btrim(new.name);
      if new.name = '' or length(new.name) > 120 then
        raise exception 'CSV_IMPORT_INVALID: section name must contain 1 to 120 characters'
          using errcode = 'invalid_parameter_value';
      end if;
    end if;

    -- btrim both sides: NEW.name is only normalized above when it is written,
    -- so an untouched legacy name can still carry whitespace here.
    --
    -- v_may_write gates the lookup, not the outcome: an unauthorized caller
    -- simply skips it and is rejected by RLS with its uniform error, so a
    -- correct guess is indistinguishable from a wrong one. The write cannot
    -- succeed either way.
    if v_may_write and (
      tg_op = 'INSERT'
      or old.restaurant_id is distinct from new.restaurant_id
      or lower(btrim(old.name)) is distinct from lower(btrim(new.name))
    ) and exists (
      select 1
        from public.menu_sections ms
       where ms.restaurant_id = new.restaurant_id
         and lower(btrim(ms.name)) = lower(btrim(new.name))
         and ms.id is distinct from new.id
    ) then
      raise exception 'CSV_IMPORT_INVALID: section name "%" already exists', new.name
        using errcode = 'invalid_parameter_value';
    end if;

    if tg_op = 'INSERT' and exists (
      select 1
        from public.menu_sections ms
       where ms.restaurant_id = new.restaurant_id
         and ms.sort_order = new.sort_order
    ) then
      select coalesce(max(ms.sort_order) + 1, 0)
        into new.sort_order
        from public.menu_sections ms
       where ms.restaurant_id = new.restaurant_id;
    end if;
  elsif tg_table_name = 'menu_items' and tg_op <> 'DELETE' then
    -- Conditional for the same two reasons as menu_sections above: an
    -- unconditional NEW.name assignment breaks the staff availability toggle
    -- via mig 136's column diff, and an unconditional bound check strands
    -- legacy rows whose names predate these limits.
    if tg_op = 'INSERT' or old.name is distinct from new.name then
      new.name := btrim(new.name);
      if new.name = '' or length(new.name) > 160 then
        raise exception 'CSV_IMPORT_INVALID: item name must contain 1 to 160 characters'
          using errcode = 'invalid_parameter_value';
      end if;
    end if;

    if not exists (
      select 1
        from public.menu_sections ms
       where ms.id = new.section_id
         and ms.restaurant_id = new.restaurant_id
    ) then
      raise exception 'CSV_IMPORT_INVALID: section does not belong to this restaurant'
        using errcode = 'invalid_parameter_value';
    end if;

    -- btrim both sides, and gate on v_may_write, for the same reasons as the
    -- section branch above.
    if v_may_write and (
      tg_op = 'INSERT'
      or old.restaurant_id is distinct from new.restaurant_id
      or old.section_id is distinct from new.section_id
      or lower(btrim(old.name)) is distinct from lower(btrim(new.name))
    ) and exists (
      select 1
        from public.menu_items mi
       where mi.restaurant_id = new.restaurant_id
         and mi.section_id = new.section_id
         and lower(btrim(mi.name)) = lower(btrim(new.name))
         and mi.id is distinct from new.id
    ) then
      raise exception 'CSV_IMPORT_INVALID: item name "%" already exists in this section', new.name
        using errcode = 'invalid_parameter_value';
    end if;

    if tg_op = 'INSERT' and exists (
      select 1
        from public.menu_items mi
       where mi.section_id = new.section_id
         and mi.sort_order = new.sort_order
    ) then
      select coalesce(max(mi.sort_order) + 1, 0)
        into new.sort_order
        from public.menu_items mi
       where mi.section_id = new.section_id;
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$guard$;

revoke all on function public.merchant_menu_mutation_guard()
  from public, anon, authenticated;

drop trigger if exists aaa_merchant_menu_mutation_guard on public.menu_sections;
create trigger aaa_merchant_menu_mutation_guard
  before insert or update or delete on public.menu_sections
  for each row execute function public.merchant_menu_mutation_guard();

drop trigger if exists aaa_merchant_menu_mutation_guard on public.menu_items;
create trigger aaa_merchant_menu_mutation_guard
  before insert or update or delete on public.menu_items
  for each row execute function public.merchant_menu_mutation_guard();

comment on function public.merchant_menu_mutation_guard() is
  'Every menu section/item INSERT, UPDATE or DELETE acquires the restaurant menu lock. New/renamed nodes cannot introduce normalized-name duplicates, item tenancy is checked, and stale direct-INSERT sort collisions append safely.';

-- Small append RPCs replace the merchant-web create paths. Their purpose is
-- not to bypass RLS; it is to place lock acquisition and max(sort_order)+1 in
-- one transaction so a client never submits a stale list-length sort value.
drop function if exists public.append_merchant_menu_section(uuid, text);
create function public.append_merchant_menu_section(
  p_restaurant_id uuid,
  p_name text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $append_section$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_sort integer;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTHENTICATION_REQUIRED: sign in before changing a menu'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.is_merchant_manager(p_restaurant_id)
     and coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'MANAGER_REQUIRED: only an owner or manager can change menu structure'
      using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.restaurants r where r.id = p_restaurant_id) then
    raise exception 'CSV_IMPORT_INVALID: restaurant does not exist'
      using errcode = 'invalid_parameter_value';
  end if;
  if v_name = '' or length(v_name) > 120 then
    raise exception 'CSV_IMPORT_INVALID: section name must contain 1 to 120 characters'
      using errcode = 'invalid_parameter_value';
  end if;

  perform private.acquire_merchant_menu_locks(array[p_restaurant_id]);
  select coalesce(max(ms.sort_order) + 1, 0)
    into v_sort
    from public.menu_sections ms
   where ms.restaurant_id = p_restaurant_id;

  insert into public.menu_sections (restaurant_id, name, sort_order)
  values (p_restaurant_id, v_name, v_sort)
  returning id into v_id;
  return v_id;
end;
$append_section$;

revoke all on function public.append_merchant_menu_section(uuid, text)
  from public, anon, authenticated;
grant execute on function public.append_merchant_menu_section(uuid, text)
  to authenticated;

drop function if exists public.append_merchant_menu_item(
  uuid, uuid, text, text, integer, text, public.item_flag_type[], boolean
);
create function public.append_merchant_menu_item(
  p_restaurant_id uuid,
  p_section_id uuid,
  p_name text,
  p_description text,
  p_price_egp integer,
  p_image text,
  p_flags public.item_flag_type[],
  p_is_available boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $append_item$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_description text := btrim(coalesce(p_description, ''));
  v_image text := btrim(coalesce(p_image, ''));
  v_flags public.item_flag_type[] := coalesce(p_flags, '{}'::public.item_flag_type[]);
  v_sort integer;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTHENTICATION_REQUIRED: sign in before changing a menu'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.is_merchant_manager(p_restaurant_id)
     and coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'MANAGER_REQUIRED: only an owner or manager can add menu items'
      using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.restaurants r where r.id = p_restaurant_id) then
    raise exception 'CSV_IMPORT_INVALID: restaurant does not exist'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_section_id is null then
    raise exception 'CSV_IMPORT_INVALID: section is required'
      using errcode = 'invalid_parameter_value';
  end if;
  if v_name = '' or length(v_name) > 160 then
    raise exception 'CSV_IMPORT_INVALID: item name must contain 1 to 160 characters'
      using errcode = 'invalid_parameter_value';
  end if;
  if length(v_description) > 1000 then
    raise exception 'CSV_IMPORT_INVALID: description exceeds 1000 characters'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_price_egp is null or p_price_egp < 1 or p_price_egp > 10000 then
    raise exception 'CSV_IMPORT_INVALID: price must be between 1 and 10000 EGP'
      using errcode = 'invalid_parameter_value';
  end if;
  if length(v_image) > 2048
     or (v_image <> '' and v_image !~* '^https?://[^[:space:]]+$') then
    raise exception 'CSV_IMPORT_INVALID: image must be empty or an http(s) URL up to 2048 characters'
      using errcode = 'invalid_parameter_value';
  end if;
  if array_position(v_flags, null) is not null or cardinality(v_flags) > 8 then
    raise exception 'CSV_IMPORT_INVALID: flags must contain at most 8 non-null values'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_is_available is null then
    raise exception 'CSV_IMPORT_INVALID: availability is required'
      using errcode = 'invalid_parameter_value';
  end if;

  perform private.acquire_merchant_menu_locks(array[p_restaurant_id]);
  if not exists (
    select 1
      from public.menu_sections ms
     where ms.id = p_section_id
       and ms.restaurant_id = p_restaurant_id
  ) then
    raise exception 'CSV_IMPORT_INVALID: section does not belong to this restaurant'
      using errcode = 'invalid_parameter_value';
  end if;

  select coalesce(max(mi.sort_order) + 1, 0)
    into v_sort
    from public.menu_items mi
   where mi.section_id = p_section_id;

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
    p_restaurant_id,
    p_section_id,
    v_name,
    v_description,
    p_price_egp,
    v_image,
    v_flags,
    p_is_available,
    v_sort
  )
  returning id into v_id;
  return v_id;
end;
$append_item$;

revoke all on function public.append_merchant_menu_item(
  uuid, uuid, text, text, integer, text, public.item_flag_type[], boolean
) from public, anon, authenticated;
grant execute on function public.append_merchant_menu_item(
  uuid, uuid, text, text, integer, text, public.item_flag_type[], boolean
) to authenticated;

drop function if exists public.import_merchant_menu(uuid, jsonb);

create function public.import_merchant_menu(
  p_restaurant_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_row_count integer;
  v_index integer;
  v_line jsonb;
  v_section_name text;
  v_item_name text;
  v_description text;
  v_image text;
  v_price_text text;
  v_price integer;
  v_available boolean;
  v_flags_text text[];
  v_flags public.item_flag_type[];
  v_flag text;
  v_section_id uuid;
  v_existing_section_ids uuid[];
  v_section_key text;
  v_item_key text;
  v_seen_item_keys text[] := '{}'::text[];
  v_new_section_keys text[] := '{}'::text[];
  v_reused_section_keys text[] := '{}'::text[];
  v_sections_created integer := 0;
  v_sections_reused integer := 0;
  v_items_created integer := 0;
  v_next_section_sort integer;
  v_next_item_sort integer;
begin
  if auth.uid() is null then
    raise exception 'AUTHENTICATION_REQUIRED: sign in before importing a menu'
      using errcode = 'insufficient_privilege';
  end if;

  if not public.is_merchant_manager(p_restaurant_id)
     and coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'MANAGER_REQUIRED: only an owner or manager can import a menu'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1
      from public.restaurants r
     where r.id = p_restaurant_id
  ) then
    raise exception 'CSV_IMPORT_INVALID: restaurant does not exist'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'CSV_IMPORT_INVALID: rows must be a JSON array'
      using errcode = 'invalid_parameter_value';
  end if;

  if octet_length(p_rows::text) > 2097152 then
    raise exception 'CSV_IMPORT_INVALID: import payload must not exceed 2 MB'
      using errcode = 'invalid_parameter_value';
  end if;

  v_row_count := jsonb_array_length(p_rows);
  if v_row_count < 1 or v_row_count > 500 then
    raise exception 'CSV_IMPORT_INVALID: import must contain between 1 and 500 items'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Same lock as direct table writes and the single-node append RPCs.
  perform private.acquire_merchant_menu_locks(array[p_restaurant_id]);

  select coalesce(max(ms.sort_order) + 1, 0)
    into v_next_section_sort
    from public.menu_sections ms
   where ms.restaurant_id = p_restaurant_id;

  for v_index in 0..v_row_count - 1 loop
    v_line := p_rows->v_index;

    if jsonb_typeof(v_line) <> 'object' then
      raise exception 'CSV_IMPORT_INVALID: row % must be an object', v_index + 2
        using errcode = 'invalid_parameter_value';
    end if;

    if exists (
      select 1
        from jsonb_object_keys(v_line) as supplied(key)
       where not (supplied.key = any (array[
         'section_name', 'item_name', 'description', 'price_egp',
         'image', 'flags', 'is_available'
       ]::text[]))
    ) then
      raise exception 'CSV_IMPORT_INVALID: row % contains unsupported fields', v_index + 2
        using errcode = 'invalid_parameter_value';
    end if;

    if jsonb_typeof(v_line->'section_name') is distinct from 'string'
       or jsonb_typeof(v_line->'item_name') is distinct from 'string'
       or jsonb_typeof(v_line->'description') is distinct from 'string'
       or jsonb_typeof(v_line->'price_egp') is distinct from 'number'
       or jsonb_typeof(v_line->'image') is distinct from 'string'
       or jsonb_typeof(v_line->'flags') is distinct from 'array'
       or jsonb_typeof(v_line->'is_available') is distinct from 'boolean' then
      raise exception 'CSV_IMPORT_INVALID: row % has missing or incorrectly typed fields', v_index + 2
        using errcode = 'invalid_parameter_value';
    end if;

    v_section_name := btrim(v_line->>'section_name');
    v_item_name := btrim(v_line->>'item_name');
    v_description := btrim(v_line->>'description');
    v_image := btrim(v_line->>'image');

    if v_section_name = '' or length(v_section_name) > 120 then
      raise exception 'CSV_IMPORT_INVALID: row % section_name must contain 1 to 120 characters', v_index + 2
        using errcode = 'invalid_parameter_value';
    end if;
    if v_item_name = '' or length(v_item_name) > 160 then
      raise exception 'CSV_IMPORT_INVALID: row % item_name must contain 1 to 160 characters', v_index + 2
        using errcode = 'invalid_parameter_value';
    end if;
    if length(v_description) > 1000 then
      raise exception 'CSV_IMPORT_INVALID: row % description exceeds 1000 characters', v_index + 2
        using errcode = 'invalid_parameter_value';
    end if;
    if length(v_image) > 2048
       or (v_image <> '' and v_image !~* '^https?://[^[:space:]]+$') then
      raise exception 'CSV_IMPORT_INVALID: row % image must be empty or an http(s) URL up to 2048 characters', v_index + 2
        using errcode = 'invalid_parameter_value';
    end if;
    v_price_text := v_line->>'price_egp';
    if v_price_text !~ '^[0-9]+$' or length(v_price_text) > 5 then
      raise exception 'CSV_IMPORT_INVALID: row % price_egp must be a whole number', v_index + 2
        using errcode = 'invalid_parameter_value';
    end if;

    -- Length is bounded before the cast, so a hostile 10,000-digit JSON number
    -- cannot escape validation via integer-overflow before our own error.
    v_price := v_price_text::integer;
    if v_price < 1 or v_price > 10000 then
      raise exception 'CSV_IMPORT_INVALID: row % price_egp must be between 1 and 10000', v_index + 2
        using errcode = 'invalid_parameter_value';
    end if;
    v_available := (v_line->>'is_available')::boolean;

    if exists (
      select 1
        from jsonb_array_elements(v_line->'flags') as f(value)
       where jsonb_typeof(f.value) <> 'string'
    ) then
      raise exception 'CSV_IMPORT_INVALID: row % flags must contain only strings', v_index + 2
        using errcode = 'invalid_parameter_value';
    end if;

    if jsonb_array_length(v_line->'flags') > 7 then
      raise exception 'CSV_IMPORT_INVALID: row % may contain at most 7 flags', v_index + 2
        using errcode = 'invalid_parameter_value';
    end if;

    select coalesce(array_agg(distinct f.value), '{}'::text[])
      into v_flags_text
      from jsonb_array_elements_text(v_line->'flags') as f(value);

    foreach v_flag in array v_flags_text loop
      if not (v_flag = any (array[
        'vegetarian', 'vegan', 'contains_pork', 'contains_alcohol',
        'contains_nuts', 'spicy', 'glutenfree'
      ]::text[])) then
        raise exception 'CSV_IMPORT_INVALID: row % contains unknown flag "%"', v_index + 2, v_flag
          using errcode = 'invalid_parameter_value';
      end if;
    end loop;

    select coalesce(array_agg(f::public.item_flag_type), '{}'::public.item_flag_type[])
      into v_flags
      from unnest(v_flags_text) as f;

    v_section_key := lower(v_section_name);
    v_item_key := v_section_key || chr(31) || lower(v_item_name);

    if v_item_key = any (v_seen_item_keys) then
      raise exception 'CSV_IMPORT_INVALID: row % duplicates another item in this import', v_index + 2
        using errcode = 'invalid_parameter_value';
    end if;
    v_seen_item_keys := array_append(v_seen_item_keys, v_item_key);

    select array_agg(ms.id order by ms.sort_order, ms.id)
      into v_existing_section_ids
      from public.menu_sections ms
     where ms.restaurant_id = p_restaurant_id
       and lower(btrim(ms.name)) = v_section_key;

    if cardinality(v_existing_section_ids) > 1 then
      raise exception 'CSV_IMPORT_INVALID: row % section name "%" is ambiguous because multiple existing sections match', v_index + 2, v_section_name
        using errcode = 'invalid_parameter_value';
    end if;

    v_section_id := v_existing_section_ids[1];

    if v_section_id is null then
      insert into public.menu_sections (restaurant_id, name, sort_order)
      values (p_restaurant_id, v_section_name, v_next_section_sort)
      returning id into v_section_id;

      v_next_section_sort := v_next_section_sort + 1;
      v_sections_created := v_sections_created + 1;
      v_new_section_keys := array_append(v_new_section_keys, v_section_key);
    elsif not (v_section_key = any (v_new_section_keys))
          and not (v_section_key = any (v_reused_section_keys)) then
      v_sections_reused := v_sections_reused + 1;
      v_reused_section_keys := array_append(v_reused_section_keys, v_section_key);
    end if;

    if exists (
      select 1
        from public.menu_items mi
       where mi.restaurant_id = p_restaurant_id
         and mi.section_id = v_section_id
         and lower(btrim(mi.name)) = lower(v_item_name)
    ) then
      raise exception 'CSV_IMPORT_INVALID: row % item already exists in section "%"', v_index + 2, v_section_name
        using errcode = 'invalid_parameter_value';
    end if;

    select coalesce(max(mi.sort_order) + 1, 0)
      into v_next_item_sort
      from public.menu_items mi
     where mi.section_id = v_section_id;

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
      p_restaurant_id,
      v_section_id,
      v_item_name,
      v_description,
      v_price,
      v_image,
      v_flags,
      v_available,
      v_next_item_sort
    );

    v_items_created := v_items_created + 1;
  end loop;

  return jsonb_build_object(
    'items_created', v_items_created,
    'sections_created', v_sections_created,
    'sections_reused', v_sections_reused
  );
end;
$function$;

revoke all on function public.import_merchant_menu(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.import_merchant_menu(uuid, jsonb)
  to authenticated;

comment on function public.import_merchant_menu(uuid, jsonb) is
  'Manager-only, atomic append menu import (20260730162500). Validates a <=2 MB payload of 1..500 exact-shape rows, reuses one unambiguous case-insensitive section name, rejects ambiguous sections and existing/duplicate item names, and creates all sections/items in one transaction. Never overwrites menu data. SECURITY DEFINER is required for transaction authority; auth is checked explicitly with is_merchant_manager(), PUBLIC/anon are revoked, search_path is pinned, and every menu mutation shares a stable per-restaurant lock.';
