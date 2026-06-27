-- 028_customer_phone.sql
-- Capture the customer's contact phone on the order so the DRIVER can call them.
--
-- THE PROBLEM THIS FIXES
-- Every order reaches the driver as "Guest" with NO phone number: the app's
-- phone/OTP screen is cosmetic (it only sets a local Zustand flag, never saves
-- the number to public.users), and place_order neither accepted nor stored a
-- customer phone. A courier delivering to a tourist at a hotel/beach has no way
-- to call "I'm at the lobby, which room?" — a critical gap for a delivery app.
--
-- THE FIX
-- 1) Add orders.customer_phone (text, nullable).
-- 2) Re-create place_order with a trailing p_customer_phone param (default null,
--    so the old 8-arg call site keeps working) that writes it onto the order.
--    The driver app reads orders.customer_phone for the call button.
--
-- Non-destructive: new nullable column + CREATE OR REPLACE of place_order with a
-- backward-compatible appended parameter.

-- ============================================================================
-- Column: the customer's contact number for THIS order (snapshot, like address).
-- ============================================================================
alter table public.orders
  add column if not exists customer_phone text;

comment on column public.orders.customer_phone is
  'Customer contact phone captured at checkout so the assigned driver can call them. Per-order snapshot (the user row may have no phone).';

-- ============================================================================
-- place_order — same body as deployed (mig 019) + p_customer_phone passthrough.
--
-- Drop the old 8-arg signature first: a 9-arg version with a defaulted last
-- param would otherwise make an 8-arg call AMBIGUOUS (both overloads match).
-- The app always passes the phone arg, so the single 9-arg function is correct.
-- ============================================================================
drop function if exists public.place_order(uuid, uuid, jsonb, text, int, text, text, timestamptz);

create or replace function public.place_order(
  p_restaurant_id uuid,
  p_address_id    uuid,
  p_cart          jsonb,
  p_payment_method text,
  p_tip           int        default 0,
  p_kitchen_notes text       default null,
  p_promo_code    text       default null,
  p_scheduled_for timestamptz default null,
  p_customer_phone text      default null   -- [028] NEW, backward-compatible
)
returns table(id uuid, short_code text, total_egp int)
language plpgsql
security definer set search_path = public, pg_temp
as $function$
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
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;
  if p_payment_method not in ('card','cash_on_delivery') then
    raise exception 'INVALID_PAYMENT_METHOD' using errcode = 'check_violation';
  end if;
  if p_cart is null or jsonb_typeof(p_cart) <> 'array' or jsonb_array_length(p_cart) = 0 then
    raise exception 'EMPTY_CART' using errcode = 'check_violation';
  end if;

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

  select * into v_addr from public.addresses
   where addresses.id = p_address_id and addresses.user_id = v_user;
  if not found then raise exception 'ADDRESS_NOT_FOUND' using errcode = 'check_violation'; end if;

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

  v_delivery := public.quote_delivery_fee(p_restaurant_id, v_addr.geo, v_subtotal);
  v_discount := public.validate_promo(p_promo_code, v_subtotal);
  v_tax := 0;
  v_total := greatest(0, v_subtotal + v_delivery + v_tax + greatest(0,coalesce(p_tip,0)) - v_discount);

  v_zone := public.resolve_zone_nearest(v_addr.geo);
  v_pay_status := 'pending';

  v_addr_snap := to_jsonb(v_addr);

  insert into public.orders (
    user_id, restaurant_id, restaurant_name, address_id, address_snapshot,
    items, subtotal_egp, delivery_fee_egp, tax_egp, tip_egp, total_egp,
    discount_egp, promo_code,
    payment_method_kind, payment_label, payment_method, payment_status,
    fulfillment_type, dispatch_mode, dropoff_geo, zone,
    status, history, eta_at, sla_minutes, kitchen_notes, scheduled_for,
    customer_phone                                                  -- [028]
  ) values (
    v_user, p_restaurant_id, v_rest.name, p_address_id, v_addr_snap,
    coalesce((select jsonb_agg(jsonb_build_object(
        'itemId', item_id, 'name', name, 'basePriceEgp', unit_price,
        'quantity', qty, 'modifierChoices', mods, 'notes', notes, 'lineTotalEgp', line_total
      )) from _lines), '[]'::jsonb),
    v_subtotal, v_delivery, v_tax, greatest(0,coalesce(p_tip,0)), v_total,
    v_discount,
    case when v_discount > 0 then upper(btrim(p_promo_code)) else null end,
    (case when p_payment_method = 'card' then 'card' else 'cash' end)::payment_kind_type,
    (case when p_payment_method = 'card' then 'Card' else 'Cash on delivery' end),
    p_payment_method, v_pay_status,
    v_rest.fulfillment_type,
    (select (value #>> '{}') from public.platform_settings where key = 'dispatch_mode'),
    v_addr.geo, v_zone,
    'placed', '[]'::jsonb,
    now() + (v_rest.prep_time_high || ' minutes')::interval, v_rest.prep_time_high,
    p_kitchen_notes, p_scheduled_for,
    nullif(btrim(coalesce(p_customer_phone,'')), '')                -- [028]
  )
  returning orders.id, orders.short_code into v_order_id, v_short;

  insert into public.order_items (order_id, catalog_item_id, name_snapshot, unit_price_snapshot, quantity, modifiers_snapshot, line_total, notes)
  select v_order_id, item_id, name, unit_price, qty, mods, line_total, notes from _lines;

  if v_discount > 0 and p_promo_code is not null then
    insert into public.promo_redemptions (promo_id, user_id, order_id, code, discount_egp)
    select pc.id, v_user, v_order_id, upper(btrim(p_promo_code)), v_discount
      from public.promo_codes pc
     where upper(pc.code) = upper(btrim(p_promo_code))
     on conflict (order_id) do nothing;
  end if;

  insert into public.order_status_events (order_id, status, actor_role, actor_id, note)
  values (v_order_id, 'placed', 'customer', v_user, 'Order placed');

  id := v_order_id; short_code := v_short; total_egp := v_total;
  return next;
end;
$function$;

-- Re-grant on the new 9-arg signature.
grant execute on function public.place_order(uuid, uuid, jsonb, text, int, text, text, timestamptz, text) to authenticated;
