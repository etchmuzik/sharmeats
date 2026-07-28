-- 153_vertical_stage_enforcement.sql
--
-- Package 07 Program A0 (session E0) — enforce the vertical stage on every
-- read and order path. Split from 152 deliberately: 152 adds authority that
-- nothing consults yet, so it is inert and independently revertible; this one
-- changes behaviour.
--
-- EVERY POLICY BELOW IS DERIVED FROM THE DEPLOYED DEFINITION (pg_policies,
-- 2026-07-28) and re-stated with ONE added conjunct. For food this conjunct is
-- unconditionally true (food is backfilled 'public'), so current behaviour is
-- byte-for-byte preserved -- verified by the food-regression assertions.
--
-- THE THREE WIDE-OPEN TABLES. menu_sections, modifiers and modifier_options
-- were `USING (true)`: readable by anyone, for any merchant, regardless of
-- merchant state, availability or vertical. That is not a vertical bug, it is
-- a pre-existing exposure -- a disabled or unlisted merchant's entire menu
-- structure and price modifiers were public. Closing it is in scope here
-- because E1 would otherwise publish a private grocery catalog through it.
--
-- MERCHANT STAFF ARE PRESERVED. A merchant may always read and manage their own
-- catalog, at any stage, including 'disabled' -- the spec's truth table says
-- "manage own draft catalog only". What the stage governs is CUSTOMER
-- visibility and orderability, not the merchant's own workspace.

-- ---------------------------------------------------------------------------
-- 1. Merchant storefront reads.
-- ---------------------------------------------------------------------------
drop policy if exists restaurants_read on public.restaurants;
create policy restaurants_read on public.restaurants
  for select
  using (
    (
      is_active = true
      -- ADDED: the merchant's vertical must be visible to THIS caller.
      -- public -> true for everyone (so food is unchanged);
      -- private -> only a live grant holder;
      -- disabled -> nobody.
      and public.can_view_vertical(vertical_id)
    )
    or public.is_merchant_staff(id)
    or (( select public.auth_role() ) = 'admin'::app_role)
  );

-- ---------------------------------------------------------------------------
-- 2. Catalog reads. All four gated through the owning merchant's vertical.
-- ---------------------------------------------------------------------------
drop policy if exists menu_items_read on public.menu_items;
create policy menu_items_read on public.menu_items
  for select
  using (
    (
      is_available = true
      and exists (
        select 1 from public.restaurants r
         where r.id = menu_items.restaurant_id
           and r.is_active
           and public.can_view_vertical(r.vertical_id)
      )
    )
    or public.is_merchant_staff(restaurant_id)
    or (( select public.auth_role() ) = 'admin'::app_role)
  );

-- menu_sections / modifiers / modifier_options were USING (true). They are now
-- scoped to a merchant the caller may actually see. Food merchants are active
-- and public, so every existing food read still resolves.
drop policy if exists menu_sections_public_read on public.menu_sections;
create policy menu_sections_public_read on public.menu_sections
  for select
  using (
    exists (
      select 1 from public.restaurants r
       where r.id = menu_sections.restaurant_id
         and r.is_active
         and public.can_view_vertical(r.vertical_id)
    )
    or public.is_merchant_staff(restaurant_id)
    or (( select public.auth_role() ) = 'admin'::app_role)
  );

drop policy if exists modifiers_public_read on public.modifiers;
create policy modifiers_public_read on public.modifiers
  for select
  using (
    exists (
      select 1 from public.menu_items mi
      join public.restaurants r on r.id = mi.restaurant_id
       where mi.id = modifiers.item_id
         and r.is_active
         and public.can_view_vertical(r.vertical_id)
    )
    or exists (
      select 1 from public.menu_items mi
       where mi.id = modifiers.item_id and public.is_merchant_staff(mi.restaurant_id)
    )
    or (( select public.auth_role() ) = 'admin'::app_role)
  );

drop policy if exists modifier_options_public_read on public.modifier_options;
create policy modifier_options_public_read on public.modifier_options
  for select
  using (
    exists (
      select 1 from public.modifiers m
      join public.menu_items mi on mi.id = m.item_id
      join public.restaurants r on r.id = mi.restaurant_id
       where m.id = modifier_options.modifier_id
         and r.is_active
         and public.can_view_vertical(r.vertical_id)
    )
    or exists (
      select 1 from public.modifiers m
      join public.menu_items mi on mi.id = m.item_id
       where m.id = modifier_options.modifier_id
         and public.is_merchant_staff(mi.restaurant_id)
    )
    or (( select public.auth_role() ) = 'admin'::app_role)
  );

-- ---------------------------------------------------------------------------
-- 3. place_order and prepare_cart.
--
-- BOTH BODIES ARE THE DEPLOYED DEFINITIONS, taken verbatim from
-- pg_get_functiondef on 2026-07-28, with exactly ONE guard inserted after the
-- merchant is fetched. They were assembled programmatically and asserted to
-- differ from production by that guard alone.
--
-- This is deliberate. A first draft of this migration RETYPED place_order's
-- body and got it materially wrong: it dropped dispatch_mode, history and
-- fulfillment_type, derived the ETA from a constant instead of
-- v_rest.prep_time_high, lost the payment_kind_type cast and the promo-code
-- uppercasing, and omitted the order_items, promo_redemptions and
-- order_status_events inserts entirely. Applying it would have silently broken
-- every order. That is precisely the "re-stating an old body reverts later
-- hardening" trap in house rule 2 -- here it would have reverted the whole
-- function.
--
-- The guard is placed immediately after MERCHANT_NOT_FOUND so it runs under the
-- `for update` lock already held on the merchant row, and it asks
-- user_can_view_vertical(v_user, ...) rather than can_view_vertical(...):
-- these are SECURITY DEFINER, so the caller-scoped variant would evaluate the
-- definer's own access, not the customer's.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.place_order(p_restaurant_id uuid, p_address_id uuid, p_cart jsonb, p_payment_method text, p_tip integer DEFAULT 0, p_kitchen_notes text DEFAULT NULL::text, p_promo_code text DEFAULT NULL::text, p_scheduled_for timestamp with time zone DEFAULT NULL::timestamp with time zone, p_customer_phone text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid, p_dropoff_preference dropoff_preference DEFAULT NULL::dropoff_preference, p_dropoff_note text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, short_code text, total_egp integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user uuid := auth.uid();
  v_rest public.restaurants;
  v_addr public.addresses;
  v_line jsonb;
  v_item public.menu_items;
  v_opt_ids uuid[];
  v_mod_delta int;
  v_qty int;
  v_line_total int;
  v_subtotal int := 0;
  v_delivery int;
  v_discount int := 0;
  v_tax int := 0;
  v_service_fee int := 0;
  v_small_order_fee int := 0;
  v_service_pct int;
  v_small_fee_mode text;
  v_small_fee_amount int;
  v_total int;
  v_zone zone_type;
  v_order_id uuid;
  v_short text;
  v_pay_status text;
  v_mods_snap jsonb;
  v_addr_snap jsonb;
  v_existing public.orders;
  v_is_blocked boolean;
  v_user_created_at timestamptz;
  v_max_active_cod int;
  v_max_new_user_24h int;
  v_cod_count int;
  v_in_range boolean;
  v_eta_minutes int;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  if p_idempotency_key is not null then
    select * into v_existing from public.orders where user_id = v_user and idempotency_key = p_idempotency_key;
    if found then
      id := v_existing.id; short_code := v_existing.short_code; total_egp := v_existing.total_egp;
      return next; return;
    end if;
  end if;

  if p_payment_method not in ('card','cash_on_delivery') then
    raise exception 'INVALID_PAYMENT_METHOD' using errcode = 'check_violation';
  end if;

  select u.is_blocked, u.created_at into v_is_blocked, v_user_created_at from public.users u where u.id = v_user;
  if coalesce(v_is_blocked, false) then raise exception 'USER_BLOCKED' using errcode = 'check_violation'; end if;

  if p_payment_method = 'cash_on_delivery' then
    select coalesce((value #>> '{}')::int, 3) into v_max_active_cod from public.platform_settings where key = 'cod_max_active_orders_per_user';
    select count(*) into v_cod_count from public.orders where user_id = v_user and payment_method = 'cash_on_delivery' and status not in ('delivered','cancelled','rejected');
    if v_cod_count >= v_max_active_cod then raise exception 'TOO_MANY_ACTIVE_ORDERS' using errcode = 'check_violation'; end if;
    if v_user_created_at is not null and v_user_created_at > now() - interval '24 hours' then
      select coalesce((value #>> '{}')::int, 5) into v_max_new_user_24h from public.platform_settings where key = 'cod_max_orders_new_user_24h';
      select count(*) into v_cod_count from public.orders where user_id = v_user and payment_method = 'cash_on_delivery' and placed_at > now() - interval '24 hours';
      if v_cod_count >= v_max_new_user_24h then raise exception 'NEW_USER_ORDER_LIMIT' using errcode = 'check_violation'; end if;
    end if;
  end if;

  if p_cart is null or jsonb_typeof(p_cart) <> 'array' or jsonb_array_length(p_cart) = 0 then
    raise exception 'EMPTY_CART' using errcode = 'check_violation';
  end if;

  select * into v_rest from public.restaurants where restaurants.id = p_restaurant_id for update;
  if not found then raise exception 'MERCHANT_NOT_FOUND' using errcode = 'check_violation'; end if;

  -- CLOSE/REVOKE RACE. The merchant `for update` above does NOT protect this:
  -- a launch close updates public.verticals and a revocation updates
  -- vertical_private_access -- different rows, no lock conflict, so either could
  -- commit between the check below and the INSERT, letting an order land after
  -- closure.
  --
  -- Take a transaction-scoped advisory lock keyed on the VERTICAL. The lifecycle
  -- RPCs take the same lock, so a close and a placement serialise: either the
  -- order commits first, or it re-reads the closed state and fails. Keyed with a
  -- 'vertical:' prefix so it cannot collide with the per-user lock taken at the
  -- top of this function.
  perform pg_advisory_xact_lock(hashtextextended('vertical:' || v_rest.vertical_id, 0));

  -- [152] VERTICAL LAUNCH GATE (mig 153). Re-read inside this transaction, under
  -- the `for update` lock already held on the merchant row, and asked about the
  -- ORDER'S CUSTOMER rather than the caller: this function is SECURITY DEFINER,
  -- so can_view_vertical() would evaluate the definer's own access.
  --
  -- A stale client, old binary, saved cart, deep link and guessed UUID all
  -- arrive here, which is why the check lives at the authority and not only in
  -- a read policy.
  if not public.user_can_view_vertical(v_user, v_rest.vertical_id) then
    raise exception 'VERTICAL_NOT_AVAILABLE' using errcode = 'check_violation';
  end if;
  if not v_rest.is_active or not v_rest.is_open then raise exception 'MERCHANT_CLOSED' using errcode = 'check_violation'; end if;
  if p_payment_method = 'cash_on_delivery' and not v_rest.accepts_cash then raise exception 'CASH_NOT_ACCEPTED' using errcode = 'check_violation'; end if;
  if p_payment_method = 'card' and not v_rest.accepts_card then raise exception 'CARD_NOT_ACCEPTED' using errcode = 'check_violation'; end if;

  select * into v_addr from public.addresses where addresses.id = p_address_id and addresses.user_id = v_user;
  if not found then raise exception 'ADDRESS_NOT_FOUND' using errcode = 'check_violation'; end if;

  select f.in_range, f.eta_minutes into v_in_range, v_eta_minutes from public.delivery_feasibility(p_restaurant_id, v_addr.geo) f;
  if not coalesce(v_in_range, true) then raise exception 'OUT_OF_RANGE' using errcode = 'check_violation'; end if;

  create temporary table _lines (item_id uuid, name text, unit_price int, qty int, mods jsonb, line_total int, notes text) on commit drop;
  for v_line in select * from jsonb_array_elements(p_cart) loop
    v_qty := coalesce((v_line->>'quantity')::int, 0);
    if v_qty < 1 then raise exception 'INVALID_QTY' using errcode = 'check_violation'; end if;
    select * into v_item from public.menu_items where menu_items.id = (v_line->>'item_id')::uuid and menu_items.restaurant_id = p_restaurant_id;
    if not found then raise exception 'ITEM_NOT_FOUND' using errcode = 'check_violation'; end if;
    if not v_item.is_available then raise exception 'ITEM_UNAVAILABLE' using errcode = 'check_violation'; end if;
    v_opt_ids := coalesce((select array_agg((x)::uuid) from jsonb_array_elements_text(coalesce(v_line->'modifier_option_ids','[]'::jsonb)) as x), '{}'::uuid[]);
    select coalesce(sum(mo.price_delta_egp), 0),
           coalesce(jsonb_agg(jsonb_build_object('optionId', mo.id, 'modifierId', m.id, 'modifierName', m.name, 'optionName', mo.name, 'priceDeltaEgp', mo.price_delta_egp)), '[]'::jsonb)
      into v_mod_delta, v_mods_snap
      from public.modifier_options mo join public.modifiers m on m.id = mo.modifier_id
      where mo.id = any(v_opt_ids) and m.item_id = v_item.id;
    v_line_total := (v_item.price_egp + coalesce(v_mod_delta,0)) * v_qty;
    v_subtotal := v_subtotal + v_line_total;
    insert into _lines values (v_item.id, v_item.name, v_item.price_egp, v_qty, coalesce(v_mods_snap,'[]'::jsonb), v_line_total, v_line->>'notes');
  end loop;

  if v_rest.min_order_egp > 0 and v_subtotal < v_rest.min_order_egp then
    select coalesce(value #>> '{}', 'block') into v_small_fee_mode from public.platform_settings where key = 'small_order_fee_mode';
    if coalesce(v_small_fee_mode, 'block') = 'fee' then
      select coalesce((value #>> '{}')::int, 0) into v_small_fee_amount from public.platform_settings where key = 'small_order_fee_egp';
      v_small_order_fee := greatest(0, coalesce(v_small_fee_amount, 0));
    else
      raise exception 'BELOW_MIN_ORDER' using errcode = 'check_violation';
    end if;
  end if;

  v_delivery := public.quote_delivery_fee(p_restaurant_id, v_addr.geo, v_subtotal);
  v_discount := public.validate_promo(p_promo_code, v_subtotal);
  v_tax := 0;

  select coalesce((value #>> '{}')::int, 0) into v_service_pct from public.platform_settings where key = 'service_fee_pct';
  v_service_fee := greatest(0, round(v_subtotal * coalesce(v_service_pct,0) / 100.0))::int;

  v_total := greatest(0, v_subtotal + v_delivery + v_tax + v_service_fee + v_small_order_fee
                         + greatest(0, coalesce(p_tip,0)) - v_discount);

  v_zone := public.resolve_zone_nearest(v_addr.geo);
  v_pay_status := 'pending';
  v_addr_snap := to_jsonb(v_addr) || jsonb_build_object('lat', st_y(v_addr.geo::geometry), 'lng', st_x(v_addr.geo::geometry));

  begin
    insert into public.orders (
      user_id, restaurant_id, restaurant_name, address_id, address_snapshot, items,
      subtotal_egp, delivery_fee_egp, tax_egp, service_fee_egp, small_order_fee_egp,
      tip_egp, total_egp, discount_egp, promo_code,
      payment_method_kind, payment_label, payment_method, payment_status, fulfillment_type,
      dispatch_mode, dropoff_geo, zone, status, history, eta_at, sla_minutes,
      kitchen_notes, scheduled_for, customer_phone, idempotency_key, dropoff_preference, dropoff_note
    ) values (
      v_user, p_restaurant_id, v_rest.name, p_address_id, v_addr_snap,
      coalesce((select jsonb_agg(jsonb_build_object('itemId', item_id, 'name', name, 'basePriceEgp', unit_price, 'quantity', qty, 'modifierChoices', mods, 'notes', notes, 'lineTotalEgp', line_total)) from _lines), '[]'::jsonb),
      v_subtotal, v_delivery, v_tax, v_service_fee, v_small_order_fee,
      greatest(0,coalesce(p_tip,0)), v_total, v_discount,
      case when v_discount > 0 then upper(btrim(p_promo_code)) else null end,
      (case when p_payment_method = 'card' then 'card' else 'cash' end)::payment_kind_type,
      (case when p_payment_method = 'card' then 'Card' else 'Cash on delivery' end),
      p_payment_method, v_pay_status, v_rest.fulfillment_type,
      (select (value #>> '{}') from public.platform_settings where key = 'dispatch_mode'),
      v_addr.geo, v_zone, 'placed', '[]'::jsonb,
      now() + make_interval(mins => coalesce(v_eta_minutes, v_rest.prep_time_high)),
      coalesce(v_eta_minutes, v_rest.prep_time_high),
      p_kitchen_notes, p_scheduled_for, nullif(btrim(coalesce(p_customer_phone,'')), ''),
      p_idempotency_key, p_dropoff_preference, nullif(btrim(coalesce(p_dropoff_note,'')), '')
    ) returning orders.id, orders.short_code into v_order_id, v_short;
  exception when unique_violation then
    if p_idempotency_key is null then raise; end if;
    select * into v_existing from public.orders where user_id = v_user and idempotency_key = p_idempotency_key;
    if not found then raise; end if;
    id := v_existing.id; short_code := v_existing.short_code; total_egp := v_existing.total_egp;
    return next; return;
  end;

  insert into public.order_items (order_id, catalog_item_id, name_snapshot, unit_price_snapshot, quantity, modifiers_snapshot, line_total, notes)
  select v_order_id, item_id, name, unit_price, qty, mods, line_total, notes from _lines;

  if v_discount > 0 and p_promo_code is not null then
    insert into public.promo_redemptions (promo_id, user_id, order_id, code, discount_egp)
    select pc.id, v_user, v_order_id, upper(btrim(p_promo_code)), v_discount
    from public.promo_codes pc where upper(pc.code) = upper(btrim(p_promo_code))
    on conflict (order_id) do nothing;
  end if;

  insert into public.order_status_events (order_id, status, actor_role, actor_id, note)
  values (v_order_id, 'placed', 'customer', v_user, 'Order placed');

  id := v_order_id; short_code := v_short; total_egp := v_total;
  return next;
end;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_cart(p_restaurant_id uuid, p_cart jsonb)
 RETURNS TABLE(restaurant_id uuid, restaurant_open boolean, minimum_order_egp integer, prepared_items jsonb, issues jsonb, subtotal_egp integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user     uuid := auth.uid();
  v_rest     public.restaurants;
  v_line     jsonb;
  v_item     public.menu_items;
  v_opt_ids  uuid[];
  v_mod_delta int;
  v_mods_snap jsonb;
  v_kept_ids uuid[];
  v_qty      int;
  v_idx      int := -1;
  v_line_total int;
  v_subtotal int := 0;
  v_items    jsonb := '[]'::jsonb;
  v_issues   jsonb := '[]'::jsonb;
  v_missing_required text[];
begin
  -- Authenticated callers only. This reads menu data that is otherwise public,
  -- but an unauthenticated caller has no cart to prepare, and requiring a
  -- session keeps the surface consistent with place_order.
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;

  if p_cart is null or jsonb_typeof(p_cart) <> 'array' then
    raise exception 'EMPTY_CART' using errcode = 'check_violation';
  end if;

  -- A basket is capped to keep this bounded: an unbounded array from a client
  -- is a cheap way to make the server do arbitrary work.
  if jsonb_array_length(p_cart) > 100 then
    raise exception 'CART_TOO_LARGE' using errcode = 'check_violation';
  end if;

  select * into v_rest from public.restaurants where restaurants.id = p_restaurant_id;
  if not found then
    raise exception 'MERCHANT_NOT_FOUND' using errcode = 'check_violation';
  end if;

  -- [152] Same gate as place_order (mig 153). Previewing a basket the customer
  -- could never place would leak the existence and pricing of a disabled or
  -- private catalog.
  if not public.user_can_view_vertical(v_user, v_rest.vertical_id) then
    raise exception 'VERTICAL_NOT_AVAILABLE' using errcode = 'check_violation';
  end if;

  for v_line in select * from jsonb_array_elements(p_cart) loop
    v_idx := v_idx + 1;
    v_qty := coalesce((v_line->>'quantity')::int, 0);

    -- place_order raises INVALID_QTY here. Report and skip: the customer can
    -- fix a quantity, and failing the whole basket over one bad line would
    -- hide every other problem in it.
    if v_qty < 1 or v_qty > 99 then
      v_issues := v_issues || jsonb_build_object(
        'code', 'INVALID_QTY', 'index', v_idx,
        'itemId', v_line->>'item_id');
      continue;
    end if;

    -- `restaurant_id = p_restaurant_id` is the cross-restaurant guard: an item
    -- id from another merchant simply does not match, exactly as in place_order.
    select * into v_item
      from public.menu_items
     where menu_items.id = (v_line->>'item_id')::uuid
       and menu_items.restaurant_id = p_restaurant_id;

    if not found then
      v_issues := v_issues || jsonb_build_object(
        'code', 'ITEM_NOT_FOUND', 'index', v_idx,
        'itemId', v_line->>'item_id');
      continue;
    end if;

    if not v_item.is_available then
      v_issues := v_issues || jsonb_build_object(
        'code', 'ITEM_UNAVAILABLE', 'index', v_idx,
        'itemId', v_item.id, 'name', v_item.name);
      continue;
    end if;

    v_opt_ids := coalesce(
      (select array_agg((x)::uuid)
         from jsonb_array_elements_text(coalesce(v_line->'modifier_option_ids', '[]'::jsonb)) as x),
      '{}'::uuid[]);

    -- Identical join to place_order: an option whose modifier belongs to a
    -- DIFFERENT item is not matched, so it contributes no price and vanishes.
    -- place_order does that silently; here it becomes a reported issue.
    select coalesce(sum(mo.price_delta_egp), 0),
           coalesce(jsonb_agg(jsonb_build_object(
             'optionId', mo.id, 'modifierId', m.id,
             'modifierName', m.name, 'optionName', mo.name,
             'priceDeltaEgp', mo.price_delta_egp) order by mo.sort_order), '[]'::jsonb),
           coalesce(array_agg(mo.id), '{}'::uuid[])
      into v_mod_delta, v_mods_snap, v_kept_ids
      from public.modifier_options mo
      join public.modifiers m on m.id = mo.modifier_id
     where mo.id = any(v_opt_ids) and m.item_id = v_item.id;

    if array_length(v_opt_ids, 1) is distinct from array_length(v_kept_ids, 1) then
      v_issues := v_issues || jsonb_build_object(
        'code', 'MODIFIER_GONE', 'index', v_idx,
        'itemId', v_item.id, 'name', v_item.name);
    end if;

    -- Required modifiers with nothing selected. Reported, never blocking --
    -- see the header note: place_order does not enforce this, and preparation
    -- must not be stricter than placement.
    select coalesce(array_agg(m.name order by m.sort_order), '{}'::text[])
      into v_missing_required
      from public.modifiers m
     where m.item_id = v_item.id
       and m.required
       and not exists (
         select 1 from public.modifier_options mo2
          where mo2.modifier_id = m.id and mo2.id = any(v_kept_ids));

    if array_length(v_missing_required, 1) > 0 then
      v_issues := v_issues || jsonb_build_object(
        'code', 'REQUIRED_MODIFIER_MISSING', 'index', v_idx,
        'itemId', v_item.id, 'name', v_item.name,
        'modifiers', to_jsonb(v_missing_required));
    end if;

    v_line_total := (v_item.price_egp + coalesce(v_mod_delta, 0)) * v_qty;
    v_subtotal := v_subtotal + v_line_total;

    -- Display fields come from the LIVE item, so a renamed dish or new photo is
    -- not shown as last month's version. quantity and notes are the customer's
    -- own input and are passed through untouched.
    v_items := v_items || jsonb_build_object(
      'index', v_idx,
      'itemId', v_item.id,
      'name', v_item.name,
      'image', v_item.image,
      'unitPriceEgp', v_item.price_egp,
      'quantity', v_qty,
      'modifierChoices', v_mods_snap,
      'lineTotalEgp', v_line_total,
      'notes', v_line->>'notes');
  end loop;

  -- Restaurant-level state the client could not check for itself. Reported as
  -- fields rather than issues: they describe the STORE, not a line, and the UI
  -- shows the prepared basket either way (the spec asks for a viewable cart
  -- with checkout blocked when closed).
  restaurant_id     := v_rest.id;
  restaurant_open   := v_rest.is_active and v_rest.is_open;
  minimum_order_egp := greatest(0, coalesce(v_rest.min_order_egp, 0));
  prepared_items    := v_items;
  issues            := v_issues;
  subtotal_egp      := v_subtotal;
  return next;
end;
$function$;

-- ACLs are preserved by create-or-replace; re-stated so this migration is
-- self-contained if replayed onto a database where these are new.
revoke all on function public.place_order(uuid, uuid, jsonb, text, integer, text, text, timestamp with time zone, text, uuid, dropoff_preference, text) from public, anon;
grant execute on function public.place_order(uuid, uuid, jsonb, text, integer, text, text, timestamp with time zone, text, uuid, dropoff_preference, text) to authenticated;
revoke all on function public.prepare_cart(uuid, jsonb) from public, anon;
grant execute on function public.prepare_cart(uuid, jsonb) to authenticated;

comment on function public.place_order(uuid, uuid, jsonb, text, integer, text, text, timestamp with time zone, text, uuid, dropoff_preference, text) is
  'Server-authoritative order placement. Since mig 153 it re-reads the merchant''s VERTICAL LAUNCH STAGE inside the transaction, under the merchant lock, and raises VERTICAL_NOT_AVAILABLE when the order''s customer may not see that vertical. Subject-scoped (the customer, not the caller) because this is SECURITY DEFINER. A stale client, old binary, saved cart, deep link or guessed UUID cannot bypass it. Mig 153.';
