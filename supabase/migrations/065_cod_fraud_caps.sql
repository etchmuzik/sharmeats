-- 065_cod_fraud_caps.sql
-- COD fraud controls (Phase-0 bleeding item from the 2026-07-03 gap-analysis).
--
-- THE OPEN SURFACE
-- The customer app allows guest checkout via anonymous Supabase auth, and
-- cash-on-delivery is the launch payment method with NO cap on how many orders
-- a user can place. A bad actor (especially a brand-new / guest account) can
-- place unlimited fake COD orders that burn restaurant food cost and driver
-- time, and there was not even a flag to block a known-bad customer.
--
-- THE CONTROLS (three layers, all enforced inside place_order — the single
-- SECURITY DEFINER entry point, so the caps cannot be bypassed by the client)
--   1. Block flag: users.is_blocked lets an admin hard-stop a known-bad customer.
--   2. Concurrent-COD cap: at most cod_max_active_orders_per_user COD orders may
--      be open (not delivered/cancelled/rejected) at once — throttles a burst.
--   3. New-user COD cap: an account younger than 24h (covers guests and freshly
--      minted accounts) may place at most cod_max_orders_new_user_24h COD orders
--      in its first 24h — throttles churn-and-burn signup abuse.
-- All three caps are configurable via platform_settings (house key/value knobs).
--
-- CORRECTNESS: the idempotency early-return stays FIRST — a retried order with
-- the same key must return the existing order, never be rejected by a cap. The
-- new guards run AFTER that early-return and AFTER payment-method validation,
-- BEFORE the cart loop. Card orders skip caps 2 and 3 (COD-only). Everything
-- else in place_order is byte-identical to mig 057 (the current live body).
-- Non-destructive: one additive column + additive settings + CREATE OR REPLACE.

-- ============================================================================
-- 1. Customer block flag (admin-settable). Additive + idempotent.
-- ============================================================================
alter table public.users
  add column if not exists is_blocked boolean not null default false;

comment on column public.users.is_blocked is
  'Admin hard-stop for a known-bad customer. When true, place_order rejects with USER_BLOCKED. COD fraud control (mig 065).';

-- ============================================================================
-- 2. Configurable COD caps (house key/value knobs; keep them tunable in prod).
-- ============================================================================
insert into public.platform_settings (key, value) values
  ('cod_max_active_orders_per_user', to_jsonb(3)),   -- max simultaneously-open COD orders per user
  ('cod_max_orders_new_user_24h',    to_jsonb(5))    -- max COD orders in an account's first 24h (guests/new users)
on conflict (key) do nothing;

-- ============================================================================
-- 3. place_order: same signature/language/security/search_path as mig 057.
--    Body is 057 verbatim + THREE new guards (blocked-user, active-COD cap,
--    new-user 24h COD cap) inserted after the idempotency early-return and the
--    payment-method validation, before the cart loop.
-- ============================================================================
create or replace function public.place_order(
  p_restaurant_id uuid, p_address_id uuid, p_cart jsonb, p_payment_method text,
  p_tip integer default 0, p_kitchen_notes text default null, p_promo_code text default null,
  p_scheduled_for timestamp with time zone default null, p_customer_phone text default null,
  p_idempotency_key uuid default null
)
returns table(id uuid, short_code text, total_egp integer)
language plpgsql
security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user uuid := auth.uid(); v_rest public.restaurants; v_addr public.addresses;
  v_line jsonb; v_item public.menu_items; v_opt_ids uuid[]; v_mod_delta int;
  v_qty int; v_line_total int; v_subtotal int := 0; v_delivery int; v_discount int := 0;
  v_tax int := 0; v_total int; v_zone zone_type; v_order_id uuid; v_short text;
  v_pay_status text; v_mods_snap jsonb; v_addr_snap jsonb; v_existing public.orders;
  -- [065] COD fraud-cap locals
  v_is_blocked boolean; v_user_created_at timestamptz;
  v_max_active_cod int; v_max_new_user_24h int; v_cod_count int;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;
  if p_idempotency_key is not null then
    select * into v_existing from public.orders where user_id = v_user and idempotency_key = p_idempotency_key;
    if found then id := v_existing.id; short_code := v_existing.short_code; total_egp := v_existing.total_egp; return next; return; end if;
  end if;
  if p_payment_method not in ('card','cash_on_delivery') then raise exception 'INVALID_PAYMENT_METHOD' using errcode = 'check_violation'; end if;
  -- [065] COD fraud controls. Run AFTER the idempotency early-return (a retried
  -- order must return the existing row, not be rejected) and AFTER payment-method
  -- validation, BEFORE the cart loop. Read the caller's block flag + created_at.
  select u.is_blocked, u.created_at into v_is_blocked, v_user_created_at from public.users u where u.id = v_user;
  -- (a) blocked customer: hard stop.
  if coalesce(v_is_blocked, false) then raise exception 'USER_BLOCKED' using errcode = 'check_violation'; end if;
  if p_payment_method = 'cash_on_delivery' then
    -- (b) too many simultaneously-open COD orders.
    select coalesce((value #>> '{}')::int, 3) into v_max_active_cod from public.platform_settings where key = 'cod_max_active_orders_per_user';
    select count(*) into v_cod_count from public.orders
     where user_id = v_user and payment_method = 'cash_on_delivery'
       and status not in ('delivered','cancelled','rejected');
    if v_cod_count >= v_max_active_cod then raise exception 'TOO_MANY_ACTIVE_ORDERS' using errcode = 'check_violation'; end if;
    -- (c) new account (<24h old, covers guests): cap COD orders in the first 24h.
    if v_user_created_at is not null and v_user_created_at > now() - interval '24 hours' then
      select coalesce((value #>> '{}')::int, 5) into v_max_new_user_24h from public.platform_settings where key = 'cod_max_orders_new_user_24h';
      select count(*) into v_cod_count from public.orders
       where user_id = v_user and payment_method = 'cash_on_delivery'
         and placed_at > now() - interval '24 hours';
      if v_cod_count >= v_max_new_user_24h then raise exception 'NEW_USER_ORDER_LIMIT' using errcode = 'check_violation'; end if;
    end if;
  end if;
  if p_cart is null or jsonb_typeof(p_cart) <> 'array' or jsonb_array_length(p_cart) = 0 then raise exception 'EMPTY_CART' using errcode = 'check_violation'; end if;
  select * into v_rest from public.restaurants where restaurants.id = p_restaurant_id for update;
  if not found then raise exception 'MERCHANT_NOT_FOUND' using errcode = 'check_violation'; end if;
  if not v_rest.is_active or not v_rest.is_open then raise exception 'MERCHANT_CLOSED' using errcode = 'check_violation'; end if;
  if p_payment_method = 'cash_on_delivery' and not v_rest.accepts_cash then raise exception 'CASH_NOT_ACCEPTED' using errcode = 'check_violation'; end if;
  if p_payment_method = 'card' and not v_rest.accepts_card then raise exception 'CARD_NOT_ACCEPTED' using errcode = 'check_violation'; end if;
  select * into v_addr from public.addresses where addresses.id = p_address_id and addresses.user_id = v_user;
  if not found then raise exception 'ADDRESS_NOT_FOUND' using errcode = 'check_violation'; end if;
  create temporary table _lines (item_id uuid, name text, unit_price int, qty int, mods jsonb, line_total int, notes text) on commit drop;
  for v_line in select * from jsonb_array_elements(p_cart) loop
    v_qty := coalesce((v_line->>'quantity')::int, 0);
    if v_qty < 1 then raise exception 'INVALID_QTY' using errcode = 'check_violation'; end if;
    select * into v_item from public.menu_items where menu_items.id = (v_line->>'item_id')::uuid and menu_items.restaurant_id = p_restaurant_id;
    if not found then raise exception 'ITEM_NOT_FOUND' using errcode = 'check_violation'; end if;
    if not v_item.is_available then raise exception 'ITEM_UNAVAILABLE' using errcode = 'check_violation'; end if;
    v_opt_ids := coalesce((select array_agg((x)::uuid) from jsonb_array_elements_text(coalesce(v_line->'modifier_option_ids','[]'::jsonb)) as x), '{}'::uuid[]);
    -- [055] snapshot carries optionId + modifierId so reorder can re-resolve modifiers.
    select coalesce(sum(mo.price_delta_egp), 0),
           coalesce(jsonb_agg(jsonb_build_object(
             'optionId', mo.id, 'modifierId', m.id,
             'modifierName', m.name, 'optionName', mo.name, 'priceDeltaEgp', mo.price_delta_egp
           )), '[]'::jsonb)
      into v_mod_delta, v_mods_snap
      from public.modifier_options mo join public.modifiers m on m.id = mo.modifier_id
     where mo.id = any(v_opt_ids) and m.item_id = v_item.id;
    v_line_total := (v_item.price_egp + coalesce(v_mod_delta,0)) * v_qty;
    v_subtotal := v_subtotal + v_line_total;
    insert into _lines values (v_item.id, v_item.name, v_item.price_egp, v_qty, coalesce(v_mods_snap,'[]'::jsonb), v_line_total, v_line->>'notes');
  end loop;
  if v_rest.min_order_egp > 0 and v_subtotal < v_rest.min_order_egp then raise exception 'BELOW_MIN_ORDER' using errcode = 'check_violation'; end if;
  v_delivery := public.quote_delivery_fee(p_restaurant_id, v_addr.geo, v_subtotal);
  v_discount := public.validate_promo(p_promo_code, v_subtotal);
  v_tax := 0;
  v_total := greatest(0, v_subtotal + v_delivery + v_tax + greatest(0,coalesce(p_tip,0)) - v_discount);
  v_zone := public.resolve_zone_nearest(v_addr.geo);
  v_pay_status := 'pending';
  -- [057] include usable lat/lng in the snapshot (geo is opaque WKB otherwise) so
  -- the customer tracking map can place the real destination pin.
  v_addr_snap := to_jsonb(v_addr) || jsonb_build_object(
    'lat', st_y(v_addr.geo::geometry),
    'lng', st_x(v_addr.geo::geometry)
  );
  begin
    insert into public.orders (
      user_id, restaurant_id, restaurant_name, address_id, address_snapshot,
      items, subtotal_egp, delivery_fee_egp, tax_egp, tip_egp, total_egp, discount_egp, promo_code,
      payment_method_kind, payment_label, payment_method, payment_status,
      fulfillment_type, dispatch_mode, dropoff_geo, zone,
      status, history, eta_at, sla_minutes, kitchen_notes, scheduled_for, customer_phone, idempotency_key
    ) values (
      v_user, p_restaurant_id, v_rest.name, p_address_id, v_addr_snap,
      coalesce((select jsonb_agg(jsonb_build_object(
          'itemId', item_id, 'name', name, 'basePriceEgp', unit_price,
          'quantity', qty, 'modifierChoices', mods, 'notes', notes, 'lineTotalEgp', line_total
        )) from _lines), '[]'::jsonb),
      v_subtotal, v_delivery, v_tax, greatest(0,coalesce(p_tip,0)), v_total, v_discount,
      case when v_discount > 0 then upper(btrim(p_promo_code)) else null end,
      (case when p_payment_method = 'card' then 'card' else 'cash' end)::payment_kind_type,
      (case when p_payment_method = 'card' then 'Card' else 'Cash on delivery' end),
      p_payment_method, v_pay_status, v_rest.fulfillment_type,
      (select (value #>> '{}') from public.platform_settings where key = 'dispatch_mode'),
      v_addr.geo, v_zone, 'placed', '[]'::jsonb,
      now() + (v_rest.prep_time_high || ' minutes')::interval, v_rest.prep_time_high,
      p_kitchen_notes, p_scheduled_for, nullif(btrim(coalesce(p_customer_phone,'')), ''), p_idempotency_key
    ) returning orders.id, orders.short_code into v_order_id, v_short;
  exception when unique_violation then
    if p_idempotency_key is null then raise; end if;
    select * into v_existing from public.orders where user_id = v_user and idempotency_key = p_idempotency_key;
    if not found then raise; end if;
    id := v_existing.id; short_code := v_existing.short_code; total_egp := v_existing.total_egp; return next; return;
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
  id := v_order_id; short_code := v_short; total_egp := v_total; return next;
end;
$function$;
