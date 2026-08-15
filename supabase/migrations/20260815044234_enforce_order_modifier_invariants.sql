-- Reject malformed/stale modifier selections at the database authority without
-- copying place_order's large, frequently hardened implementation.
--
-- The latest public function (migration 214) is moved intact into the private
-- schema. A same-signature public wrapper validates only the cart/modifier
-- contract, then delegates every pricing, lifecycle, idempotency and authority
-- decision to that exact existing function body.

alter function public.place_order(
  uuid, uuid, jsonb, text, integer, text, text, timestamp with time zone,
  text, uuid, public.dropoff_preference, text, public.allergy_key_type[]
) set schema private;

-- The moved implementation must not become an alternate PostgREST endpoint.
revoke all on function private.place_order(
  uuid, uuid, jsonb, text, integer, text, text, timestamp with time zone,
  text, uuid, public.dropoff_preference, text, public.allergy_key_type[]
) from public, anon, authenticated, service_role;

create function private.assert_order_modifier_invariants(p_restaurant_id uuid, p_cart jsonb)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $validator$
declare
  v_user uuid := auth.uid();
  v_line jsonb;
  v_item_id uuid;
  v_option_ids uuid[];
  v_option_count integer;
  v_distinct_count integer;
  v_matching_count integer;
  v_group record;
  v_selected integer;
  v_effective_min integer;
begin
  -- Preserve place_order's existing AUTH_REQUIRED/EMPTY_CART/type errors. This
  -- helper owns only modifier semantics; the delegated implementation remains
  -- authoritative for all other request validation.
  if v_user is null or p_restaurant_id is null
     or p_cart is null or jsonb_typeof(p_cart) <> 'array' then
    return;
  end if;

  for v_line in
    select value from jsonb_array_elements(p_cart)
  loop
    -- Invalid/missing item IDs retain the delegated implementation's existing
    -- error behaviour. A real catalog item is needed before modifier ownership
    -- can be evaluated meaningfully.
    begin
      v_item_id := (v_line ->> 'item_id')::uuid;
    exception
      when invalid_text_representation then
        continue;
    end;

    -- Only evaluate a line the delegate itself would reach modifier pricing
    -- for: the item must belong to THIS merchant, be available, and the
    -- merchant must be active and visible to the ORDER'S CUSTOMER (the same
    -- predicate as menu_items_read, mig 153, asked about v_user because this
    -- runs under the definer). Anything else falls through so the delegate
    -- raises its existing, deliberately collapsed MERCHANT_NOT_FOUND /
    -- ITEM_NOT_FOUND / ITEM_UNAVAILABLE. Without this, a caller could probe
    -- hidden-vertical or foreign items by their modifier error — the
    -- existence oracle migs 153/162 closed.
    if v_item_id is null
       or not exists (
         select 1
           from public.menu_items mi
           join public.restaurants r on r.id = mi.restaurant_id
          where mi.id = v_item_id
            and mi.restaurant_id = p_restaurant_id
            and mi.is_available
            and r.is_active
            and public.user_can_view_vertical(v_user, r.vertical_id)
       )
    then
      continue;
    end if;

    select coalesce(array_agg(raw.option_id order by raw.ordinality), '{}'::uuid[])
      into v_option_ids
      from (
        select option_text::uuid as option_id, ordinality
          from jsonb_array_elements_text(
                 coalesce(v_line -> 'modifier_option_ids', '[]'::jsonb)
               ) with ordinality as selected(option_text, ordinality)
      ) raw;

    v_option_count := cardinality(v_option_ids);
    select count(distinct option_id)
      into v_distinct_count
      from unnest(v_option_ids) as option_id;

    if v_option_count <> v_distinct_count then
      raise exception 'DUPLICATE_MODIFIER_OPTION'
        using errcode = 'check_violation';
    end if;

    -- Count every supplied option against this exact item. This single equality
    -- rejects deleted/stale UUIDs and options copied from another item instead
    -- of silently omitting them from the snapshot and total.
    select count(*)
      into v_matching_count
      from public.modifier_options mo
      join public.modifiers m on m.id = mo.modifier_id
     where mo.id = any(v_option_ids)
       and m.item_id = v_item_id;

    if v_matching_count <> v_option_count then
      raise exception 'INVALID_MODIFIER_OPTION'
        using errcode = 'check_violation';
    end if;

    for v_group in
      select m.id, m.required, m.min_select, m.max_select
        from public.modifiers m
       where m.item_id = v_item_id
       order by m.id
    loop
      select count(*)
        into v_selected
        from public.modifier_options mo
       where mo.modifier_id = v_group.id
         and mo.id = any(v_option_ids);

      -- `required` is never allowed to mean zero, even if legacy catalog data
      -- has min_select=0. Optional groups may be omitted; once the customer
      -- starts one, its configured minimum applies.
      v_effective_min := case
        when v_group.required then greatest(1, v_group.min_select)
        when v_selected > 0 then greatest(0, v_group.min_select)
        else 0
      end;

      if v_selected < v_effective_min then
        raise exception 'MODIFIER_MIN_SELECTION'
          using errcode = 'check_violation';
      end if;
      if v_selected > v_group.max_select then
        raise exception 'MODIFIER_MAX_SELECTION'
          using errcode = 'check_violation';
      end if;
    end loop;
  end loop;
end;
$validator$;

revoke all on function private.assert_order_modifier_invariants(uuid, jsonb)
  from public, anon, authenticated, service_role;

create function public.place_order(
  p_restaurant_id uuid,
  p_address_id uuid,
  p_cart jsonb,
  p_payment_method text,
  p_tip integer default 0,
  p_kitchen_notes text default null,
  p_promo_code text default null,
  p_scheduled_for timestamp with time zone default null,
  p_customer_phone text default null,
  p_idempotency_key uuid default null,
  p_dropoff_preference public.dropoff_preference default null,
  p_dropoff_note text default null,
  p_aggregate_allergens public.allergy_key_type[] default null
)
returns table(id uuid, short_code text, total_egp integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $wrapper$
begin
  perform private.assert_order_modifier_invariants(p_restaurant_id, p_cart);

  return query
    select placed.id, placed.short_code, placed.total_egp
      from private.place_order(
        p_restaurant_id,
        p_address_id,
        p_cart,
        p_payment_method,
        p_tip,
        p_kitchen_notes,
        p_promo_code,
        p_scheduled_for,
        p_customer_phone,
        p_idempotency_key,
        p_dropoff_preference,
        p_dropoff_note,
        p_aggregate_allergens
      ) placed;
end;
$wrapper$;

revoke all on function public.place_order(
  uuid, uuid, jsonb, text, integer, text, text, timestamp with time zone,
  text, uuid, public.dropoff_preference, text, public.allergy_key_type[]
) from public, anon, authenticated, service_role;
grant execute on function public.place_order(
  uuid, uuid, jsonb, text, integer, text, text, timestamp with time zone,
  text, uuid, public.dropoff_preference, text, public.allergy_key_type[]
) to authenticated, service_role;

comment on function public.place_order(
  uuid, uuid, jsonb, text, integer, text, text, timestamp with time zone,
  text, uuid, public.dropoff_preference, text, public.allergy_key_type[]
) is
  'Validated order-placement entrypoint. Enforces modifier ownership, uniqueness and min/max selection before delegating unchanged pricing/lifecycle authority to private.place_order. Migration 20260815044234.';
