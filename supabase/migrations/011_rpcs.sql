-- 011_rpcs.sql
-- Server-side AUTHORITY: every money/status/dispatch decision lives here.
--
-- Ported from the Go Sharm `book_excursion_guest` pattern:
--   * SECURITY DEFINER set search_path = public, pg_temp
--   * FOR UPDATE row locking
--   * price recomputed from DB values (NEVER trust client totals)
--   * qualify columns vs RETURNS TABLE OUT params (Postgres 42702)
--   * raise exception ... using errcode = 'check_violation' for validation
--
-- Functions:
--   resolve_zone(geo)                      -> zone_type        (PostGIS)
--   quote_delivery_fee(merchant, geo)      -> int              (fee estimate + authority)
--   place_order(...)                       -> (id, short_code, total)   [the heart]
--   advance_order_status(order, status)    -> void             (legal state machine + audit)
--   assign_driver(order, driver)           -> void             (manual dispatch)
--   driver_respond(assignment, accept)     -> void
--   mark_cod_collected(order, amount)      -> void             (COD settlement)
--   driver_ping(geo)                       -> void             (throttled current_geo update)
--   nearest_drivers(geo, radius, limit)    -> setof            (PostGIS; read-only now, auto later)
--   validate_promo(code, subtotal)         -> int              (discount EGP)

-- ============================================================================
-- resolve_zone: dropoff point -> zone (ST_Contains if polygons exist, else nearest centroid)
-- ============================================================================
create or replace function public.resolve_zone(p_geo geography)
returns zone_type
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select id from public.zones
  where boundary is not null and st_contains(boundary::geometry, p_geo::geometry)
  limit 1;
$$;

create or replace function public.resolve_zone_nearest(p_geo geography)
returns zone_type
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select coalesce(
    (select id from public.zones
       where boundary is not null and st_contains(boundary::geometry, p_geo::geometry)
       limit 1),
    (select id from public.zones
       where centroid is not null and is_active
       order by st_distance(centroid, p_geo) asc
       limit 1)
  );
$$;

-- ============================================================================
-- quote_delivery_fee: zone-based fee for a merchant + dropoff (estimate + authority)
-- ============================================================================
create or replace function public.quote_delivery_fee(
  p_restaurant_id uuid,
  p_dropoff geography,
  p_subtotal int default 0
)
returns int
language plpgsql
stable
security definer set search_path = public, pg_temp
as $$
declare
  v_zone   zone_type;
  v_rule   public.delivery_fee_rules;
  v_fee    int;
begin
  v_zone := public.resolve_zone_nearest(p_dropoff);

  -- Prefer a (zone, food-vertical) rule; fall back to (zone, null vertical).
  select * into v_rule from public.delivery_fee_rules
   where zone_id = v_zone and (vertical_id = 'food' or vertical_id is null)
   order by vertical_id nulls last
   limit 1;

  if not found then
    return 30;  -- safe default if no rule configured
  end if;

  -- MVP: flat base (per_km_fee defaults 0). Free over threshold honored.
  if v_rule.free_over is not null and p_subtotal >= v_rule.free_over then
    return 0;
  end if;
  v_fee := greatest(v_rule.base_fee, v_rule.min_fee);
  return v_fee;
end;
$$;

-- ============================================================================
-- validate_promo: returns discount in EGP for a code against a subtotal
-- (placeholder — promo_codes table not yet defined; returns 0 safely)
-- ============================================================================
create or replace function public.validate_promo(p_code text, p_subtotal int)
returns int
language plpgsql
stable
security definer set search_path = public, pg_temp
as $$
begin
  -- No promo_codes table at MVP; always 0. Wire real logic when promos ship.
  return 0;
end;
$$;

-- ============================================================================
-- place_order — THE TRANSACTIONAL HEART
-- Recomputes every line from live DB prices + modifier deltas, computes the
-- delivery fee server-side, validates promo, inserts orders + order_items +
-- first status event atomically. Returns the new ref. Client total is IGNORED.
--
-- p_cart shape (jsonb array):
--   [{ "item_id": uuid, "quantity": int,
--      "modifier_option_ids": [uuid, ...],   -- selected modifier_options
--      "notes": text }]
-- ============================================================================
create or replace function public.place_order(
  p_restaurant_id uuid,
  p_address_id    uuid,
  p_cart          jsonb,
  p_payment_method text,                 -- 'card' | 'cash_on_delivery'
  p_tip           int default 0,
  p_kitchen_notes text default null,
  p_promo_code    text default null,
  p_scheduled_for timestamptz default null
)
returns table (id uuid, short_code text, total_egp int)
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_user        uuid := auth.uid();
  v_rest        public.restaurants;
  v_addr        public.addresses;
  v_line        jsonb;
  v_item        public.menu_items;
  v_opt_ids     uuid[];
  v_mod_delta   int;
  v_qty         int;
  v_line_total  int;
  v_subtotal    int := 0;
  v_delivery    int;
  v_discount    int := 0;
  v_tax         int := 0;
  v_total       int;
  v_zone        zone_type;
  v_order_id    uuid;
  v_short       text;
  v_pay_status  text;
  v_mods_snap   jsonb;
  v_addr_snap   jsonb;
begin
  -- Auth + basic validation (server-trusted).
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;
  if p_payment_method not in ('card','cash_on_delivery') then
    raise exception 'INVALID_PAYMENT_METHOD' using errcode = 'check_violation';
  end if;
  if p_cart is null or jsonb_typeof(p_cart) <> 'array' or jsonb_array_length(p_cart) = 0 then
    raise exception 'EMPTY_CART' using errcode = 'check_violation';
  end if;

  -- Lock the merchant row; must exist, be active & open.
  select * into v_rest from public.restaurants
   where restaurants.id = p_restaurant_id for update;
  if not found then raise exception 'MERCHANT_NOT_FOUND' using errcode = 'check_violation'; end if;
  if not v_rest.is_active or not v_rest.is_open then
    raise exception 'MERCHANT_CLOSED' using errcode = 'check_violation';
  end if;
  if p_payment_method = 'cash_on_delivery' and not v_rest.accepts_cash then
    raise exception 'CASH_NOT_ACCEPTED' using errcode = 'check_violation';
  end if;
  if p_payment_method = 'card' and not v_rest.accepts_card then
    raise exception 'CARD_NOT_ACCEPTED' using errcode = 'check_violation';
  end if;

  -- Address must belong to the caller.
  select * into v_addr from public.addresses
   where addresses.id = p_address_id and addresses.user_id = v_user;
  if not found then raise exception 'ADDRESS_NOT_FOUND' using errcode = 'check_violation'; end if;

  -- Recompute each line from DB prices + modifier deltas. Build order_items rows.
  -- We defer inserting items until the order exists (need order_id), so collect.
  create temporary table _lines (
    item_id uuid, name text, unit_price int, qty int, mods jsonb, line_total int, notes text
  ) on commit drop;

  for v_line in select * from jsonb_array_elements(p_cart)
  loop
    v_qty := coalesce((v_line->>'quantity')::int, 0);
    if v_qty < 1 then raise exception 'INVALID_QTY' using errcode = 'check_violation'; end if;

    select * into v_item from public.menu_items
     where menu_items.id = (v_line->>'item_id')::uuid
       and menu_items.restaurant_id = p_restaurant_id;
    if not found then raise exception 'ITEM_NOT_FOUND' using errcode = 'check_violation'; end if;
    if not v_item.is_available then
      raise exception 'ITEM_UNAVAILABLE' using errcode = 'check_violation';
    end if;

    -- Selected modifier options -> sum of deltas + snapshot, validated to this item.
    v_opt_ids := coalesce(
      (select array_agg((x)::uuid) from jsonb_array_elements_text(coalesce(v_line->'modifier_option_ids','[]'::jsonb)) as x),
      '{}'::uuid[]
    );

    select coalesce(sum(mo.price_delta_egp), 0),
           coalesce(jsonb_agg(jsonb_build_object(
             'modifierName', m.name, 'optionName', mo.name, 'priceDeltaEgp', mo.price_delta_egp
           )), '[]'::jsonb)
      into v_mod_delta, v_mods_snap
      from public.modifier_options mo
      join public.modifiers m on m.id = mo.modifier_id
     where mo.id = any(v_opt_ids) and m.item_id = v_item.id;

    v_line_total := (v_item.price_egp + coalesce(v_mod_delta,0)) * v_qty;
    v_subtotal := v_subtotal + v_line_total;

    insert into _lines values (
      v_item.id, v_item.name, v_item.price_egp, v_qty,
      coalesce(v_mods_snap,'[]'::jsonb), v_line_total, v_line->>'notes'
    );
  end loop;

  if v_rest.min_order_egp > 0 and v_subtotal < v_rest.min_order_egp then
    raise exception 'BELOW_MIN_ORDER' using errcode = 'check_violation';
  end if;

  -- Server-side delivery fee, promo, tax, total. Client total is never used.
  v_delivery := public.quote_delivery_fee(p_restaurant_id, v_addr.geo, v_subtotal);
  v_discount := public.validate_promo(p_promo_code, v_subtotal);
  v_tax := 0;  -- tax-inclusive at launch
  v_total := greatest(0, v_subtotal + v_delivery + v_tax + greatest(0,coalesce(p_tip,0)) - v_discount);

  v_zone := public.resolve_zone_nearest(v_addr.geo);
  v_pay_status := 'pending';  -- card flips to paid on webhook; COD on delivery

  -- Address snapshot (orders.address_snapshot is jsonb not null).
  v_addr_snap := to_jsonb(v_addr);

  insert into public.orders (
    user_id, restaurant_id, restaurant_name, address_id, address_snapshot,
    items, subtotal_egp, delivery_fee_egp, tax_egp, tip_egp, total_egp,
    payment_method_kind, payment_label, payment_method, payment_status,
    fulfillment_type, dispatch_mode, dropoff_geo, zone,
    status, history, eta_at, sla_minutes, kitchen_notes, scheduled_for
  ) values (
    v_user, p_restaurant_id, v_rest.name, p_address_id, v_addr_snap,
    coalesce((select jsonb_agg(jsonb_build_object(
        'itemId', item_id, 'name', name, 'basePriceEgp', unit_price,
        'quantity', qty, 'modifierChoices', mods, 'notes', notes, 'lineTotalEgp', line_total
      )) from _lines), '[]'::jsonb),
    v_subtotal, v_delivery, v_tax, greatest(0,coalesce(p_tip,0)), v_total,
    -- legacy payment_method_kind expects payment_kind_type; map card/cod onto it
    (case when p_payment_method = 'card' then 'card' else 'cash' end)::payment_kind_type,
    (case when p_payment_method = 'card' then 'Card' else 'Cash on delivery' end),
    p_payment_method, v_pay_status,
    v_rest.fulfillment_type,
    (select (value #>> '{}') from public.platform_settings where key = 'dispatch_mode'),
    v_addr.geo, v_zone,
    'placed', '[]'::jsonb,
    now() + (v_rest.prep_time_high || ' minutes')::interval, v_rest.prep_time_high,
    p_kitchen_notes, p_scheduled_for
  )
  returning orders.id, orders.short_code into v_order_id, v_short;

  -- Real order_items rows (snapshots).
  insert into public.order_items (order_id, catalog_item_id, name_snapshot, unit_price_snapshot, quantity, modifiers_snapshot, line_total, notes)
  select v_order_id, item_id, name, unit_price, qty, mods, line_total, notes from _lines;

  -- First status event.
  insert into public.order_status_events (order_id, status, actor_role, actor_id, note)
  values (v_order_id, 'placed', 'customer', v_user, 'Order placed');

  id := v_order_id; short_code := v_short; total_egp := v_total;
  return next;
end;
$$;

grant execute on function public.place_order(uuid, uuid, jsonb, text, int, text, text, timestamptz) to authenticated;
grant execute on function public.quote_delivery_fee(uuid, geography, int) to authenticated, anon;
grant execute on function public.resolve_zone(geography) to authenticated, anon;
grant execute on function public.resolve_zone_nearest(geography) to authenticated, anon;
grant execute on function public.validate_promo(text, int) to authenticated, anon;

-- ============================================================================
-- advance_order_status — the ONLY writer of orders.status. Enforces the legal
-- state machine (mirrors packages/shared/src/order-status.ts) per actor role.
-- ============================================================================
create or replace function public.advance_order_status(
  p_order_id uuid,
  p_new_status order_status_type,
  p_note text default null
)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_user   uuid := auth.uid();
  v_role   app_role := public.auth_role();
  v_order  public.orders;
  v_ok     boolean := false;
  v_actor  text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;

  select * into v_order from public.orders where orders.id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'check_violation'; end if;

  -- Authorize the actor for THIS order.
  --   merchant_staff of the order's restaurant, the assigned driver, or admin/dispatcher.
  if v_role in ('admin','dispatcher') then
    v_ok := true; v_actor := v_role::text;
  elsif v_role = 'merchant_staff' and public.is_merchant_staff(v_order.restaurant_id) then
    v_ok := true; v_actor := 'merchant';
  elsif v_role = 'driver' and exists (
      select 1 from public.drivers d
       where d.id = v_order.assigned_driver_id and d.profile_id = v_user) then
    v_ok := true; v_actor := 'driver';
  elsif v_role = 'customer' and v_order.user_id = v_user then
    v_ok := true; v_actor := 'customer';
  end if;

  if not v_ok then raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation'; end if;

  -- Legal transition check (mirror of the shared state machine).
  v_ok := case
    -- forward path
    when v_order.status = 'placed'           and p_new_status = 'accepted'         and v_actor in ('merchant','admin','dispatcher') then true
    when v_order.status = 'accepted'         and p_new_status = 'preparing'        and v_actor in ('merchant','admin','dispatcher') then true
    when v_order.status = 'preparing'        and p_new_status = 'ready'            and v_actor in ('merchant','admin','dispatcher') then true
    when v_order.status = 'ready'            and p_new_status = 'picked_up'        and v_actor in ('driver','merchant','admin','dispatcher') then true
    when v_order.status = 'picked_up'        and p_new_status = 'out_for_delivery' and v_actor in ('driver','merchant','admin','dispatcher') then true
    when v_order.status = 'out_for_delivery' and p_new_status = 'delivered'        and v_actor in ('driver','merchant','admin','dispatcher') then true
    -- cancel / reject (conservative; admin override broad)
    when v_order.status = 'placed'           and p_new_status = 'rejected'         and v_actor in ('merchant','admin','dispatcher') then true
    when v_order.status = 'accepted'         and p_new_status = 'rejected'         and v_actor in ('merchant','admin','dispatcher') then true
    when v_order.status = 'placed'           and p_new_status = 'cancelled'        and v_actor in ('customer','admin','dispatcher') then true
    when p_new_status = 'cancelled'          and v_actor in ('admin','dispatcher')
         and v_order.status not in ('delivered','cancelled','rejected') then true
    else false
  end;

  if not v_ok then
    raise exception 'ILLEGAL_TRANSITION: % -> %', v_order.status, p_new_status using errcode = 'check_violation';
  end if;

  -- Apply: set status + matching timestamp.
  update public.orders set
    status = p_new_status,
    accepted_at   = case when p_new_status = 'accepted'         then now() else accepted_at end,
    ready_at      = case when p_new_status = 'ready'            then now() else ready_at end,
    picked_up_at  = case when p_new_status = 'picked_up'        then now() else picked_up_at end,
    delivered_at  = case when p_new_status = 'delivered'        then now() else delivered_at end,
    cancel_reason = case when p_new_status in ('cancelled','rejected') then coalesce(p_note, cancel_reason) else cancel_reason end
   where id = p_order_id;

  insert into public.order_status_events (order_id, status, actor_role, actor_id, note)
  values (p_order_id, p_new_status, v_role, v_user, p_note);
end;
$$;

grant execute on function public.advance_order_status(uuid, order_status_type, text) to authenticated;

-- ============================================================================
-- assign_driver — manual dispatch (dispatcher/admin only)
-- ============================================================================
create or replace function public.assign_driver(p_order_id uuid, p_driver_id uuid)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_role app_role := public.auth_role();
  v_user uuid := auth.uid();
begin
  if v_role not in ('admin','dispatcher') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.drivers where id = p_driver_id and is_active) then
    raise exception 'DRIVER_NOT_FOUND' using errcode = 'check_violation';
  end if;

  -- Reassign: mark any prior active assignment reassigned.
  update public.order_assignments
     set status = 'reassigned', responded_at = now()
   where order_id = p_order_id and status in ('offered','accepted');

  insert into public.order_assignments (order_id, driver_id, status, assigned_by, assigned_by_id)
  values (p_order_id, p_driver_id, 'offered', 'dispatcher', v_user);

  update public.orders set assigned_driver_id = p_driver_id where id = p_order_id;
end;
$$;
grant execute on function public.assign_driver(uuid, uuid) to authenticated;

-- ============================================================================
-- driver_respond — accept/reject an offered assignment (the assigned driver)
-- ============================================================================
create or replace function public.driver_respond(p_assignment_id uuid, p_accept boolean)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_asg  public.order_assignments;
  v_drv  public.drivers;
begin
  select * into v_asg from public.order_assignments where id = p_assignment_id for update;
  if not found then raise exception 'ASSIGNMENT_NOT_FOUND' using errcode = 'check_violation'; end if;

  select * into v_drv from public.drivers where id = v_asg.driver_id;
  if v_drv.profile_id is distinct from v_user then
    raise exception 'NOT_YOUR_ASSIGNMENT' using errcode = 'check_violation';
  end if;
  if v_asg.status <> 'offered' then
    raise exception 'ALREADY_RESPONDED' using errcode = 'check_violation';
  end if;

  if p_accept then
    update public.order_assignments set status = 'accepted', responded_at = now() where id = p_assignment_id;
    update public.drivers set status = 'on_job' where id = v_asg.driver_id;
  else
    update public.order_assignments set status = 'rejected', responded_at = now() where id = p_assignment_id;
    update public.orders set assigned_driver_id = null where id = v_asg.order_id;
  end if;
end;
$$;
grant execute on function public.driver_respond(uuid, boolean) to authenticated;

-- ============================================================================
-- mark_cod_collected — COD settlement (the assigned driver, on delivery)
-- ============================================================================
create or replace function public.mark_cod_collected(p_order_id uuid, p_amount int)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_user  uuid := auth.uid();
  v_order public.orders;
  v_drv   public.drivers;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'check_violation'; end if;
  if v_order.payment_method <> 'cash_on_delivery' then
    raise exception 'NOT_A_COD_ORDER' using errcode = 'check_violation';
  end if;

  -- Only the assigned driver (or admin) may settle.
  select * into v_drv from public.drivers where id = v_order.assigned_driver_id;
  if public.auth_role() <> 'admin'
     and (v_drv.profile_id is distinct from v_user) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;

  update public.orders set payment_status = 'paid' where id = p_order_id;

  insert into public.driver_earnings (driver_id, order_id, delivery_fee_share, tip, cod_collected, total)
  values (v_order.assigned_driver_id, p_order_id, v_order.delivery_fee_egp, v_order.tip_egp, coalesce(p_amount, v_order.total_egp), v_order.delivery_fee_egp + v_order.tip_egp)
  on conflict (order_id) do update set cod_collected = excluded.cod_collected;
end;
$$;
grant execute on function public.mark_cod_collected(uuid, int) to authenticated;

-- ============================================================================
-- driver_ping — throttled authoritative position update (drivers call ~20-30s)
-- ============================================================================
create or replace function public.driver_ping(p_lng double precision, p_lat double precision, p_status text default null)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare v_user uuid := auth.uid();
begin
  update public.drivers set
    current_geo = st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
    last_ping_at = now(),
    status = coalesce(nullif(p_status,''), status)
   where profile_id = v_user;
end;
$$;
grant execute on function public.driver_ping(double precision, double precision, text) to authenticated;

-- ============================================================================
-- nearest_drivers — PostGIS nearest available drivers (read-only now; auto later)
-- ============================================================================
create or replace function public.nearest_drivers(p_geo geography, p_radius_m int default 4000, p_limit int default 10)
returns table (driver_id uuid, name text, vehicle vehicle_type, distance_m double precision, status text)
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select d.id, d.name, d.vehicle, st_distance(d.current_geo, p_geo) as distance_m, d.status
  from public.drivers d
  where d.is_active and d.is_verified and d.status = 'online'
    and d.current_geo is not null
    and st_dwithin(d.current_geo, p_geo, p_radius_m)
  order by st_distance(d.current_geo, p_geo) asc
  limit p_limit;
$$;
grant execute on function public.nearest_drivers(geography, int, int) to authenticated;

comment on function public.place_order is
  'Transactional order creation. Recomputes all prices from DB (client total ignored), validates merchant/address/items, writes orders + order_items + first status event atomically. Returns (id, short_code, total).';
comment on function public.advance_order_status is
  'The ONLY writer of orders.status. Enforces the legal state machine per actor role and appends an audit event. Mirrors packages/shared/src/order-status.ts.';
