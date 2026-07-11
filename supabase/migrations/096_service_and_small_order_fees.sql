-- 096_service_and_small_order_fees.sql
-- Revenue levers (2026-07-10). ONE migration restating place_order once (the
-- mig 041/080 lesson: never create-or-replace with a changed arg count -> new
-- overload; this keeps the SAME 12-arg signature, one overload only).
--
-- Adds two fees, both server-computed inside place_order (un-bypassable):
--   1. SERVICE FEE: round(subtotal * service_fee_pct / 100), no cap.
--      Seeded LIVE at 3% (owner decision 2026-07-10). Flip to 0 to disable.
--   2. SMALL-ORDER FEE: a flat small_order_fee_egp charged INSTEAD of the hard
--      BELOW_MIN_ORDER block, ONLY when small_order_fee_mode = 'fee'. Default
--      mode 'block' keeps the current hard-block behavior -> ships DARK.
--
-- Both fees get their own orders columns (added here) so financials/settlement
-- and the customer receipt can show them explicitly; total math folds them in.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS; settings upsert via ON CONFLICT;
-- CREATE OR REPLACE FUNCTION with identical signature. Rollback note at bottom.

-- 1. Fee columns (default 0 so every existing row reads as 'no fee') ----------
alter table public.orders add column if not exists service_fee_egp     integer not null default 0;
alter table public.orders add column if not exists small_order_fee_egp integer not null default 0;

-- 2. Config keys -------------------------------------------------------------
-- service_fee_pct already exists (seeded 0 in mig 010). SHIP DARK at 0 so the
-- structure goes live with ZERO customer-facing change: the fee only appears
-- once the owner flips this to 3 (decided rate) AFTER the customer app update
-- that displays the service-fee row has shipped — otherwise installed apps
-- would under-show the total vs what place_order charges (the N2 lesson).
-- To activate:  update platform_settings set value = to_jsonb(3) where key = 'service_fee_pct';
insert into public.platform_settings (key, value)
values ('service_fee_pct', to_jsonb(0))
on conflict (key) do nothing;

-- small-order fee: mode gate ('block' = current hard block; 'fee' = charge the
-- flat fee instead) + the flat amount. Ship dark: mode defaults to 'block'.
insert into public.platform_settings (key, value)
values ('small_order_fee_mode', to_jsonb('block'::text))
on conflict (key) do nothing;
insert into public.platform_settings (key, value)
values ('small_order_fee_egp', to_jsonb(10))
on conflict (key) do nothing;

-- 3. place_order — SAME signature, fees folded in ----------------------------
create or replace function public.place_order(
  p_restaurant_id uuid,
  p_address_id uuid,
  p_cart jsonb,
  p_payment_method text,
  p_tip integer default 0,
  p_kitchen_notes text default null,
  p_promo_code text default null,
  p_scheduled_for timestamptz default null,
  p_customer_phone text default null,
  p_idempotency_key uuid default null,
  p_dropoff_preference dropoff_preference default null,
  p_dropoff_note text default null
)
returns table (id uuid, short_code text, total_egp integer)
language plpgsql
security definer set search_path = public, pg_temp
as $$
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
  v_service_fee int := 0;         -- [096]
  v_small_order_fee int := 0;     -- [096]
  v_service_pct int;              -- [096]
  v_small_fee_mode text;          -- [096]
  v_small_fee_amount int;         -- [096]
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

  -- [082] serialize this user's concurrent checkouts under an advisory lock.
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

  -- [065] COD fraud caps
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

  -- [096] Below-minimum handling: mode 'fee' charges a flat small-order fee
  -- instead of the hard block. Default mode 'block' preserves prior behavior.
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

  -- [096] Service fee: round(subtotal * pct / 100), no cap. On subtotal (pre-
  -- delivery/tip) so it doesn't compound the delivery fee. 0 pct => 0 fee.
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
$$;

-- Harden the grant posture. place_order still carries the DEFAULT PUBLIC EXECUTE
-- grant (never revoked anywhere in the chain — every prior grant was `to
-- authenticated`, which does NOT remove PUBLIC; anon inherits via PUBLIC). This
-- is the house `supabase-definer-rpc-anon-grant` trap; mig 081 fixed it for the
-- dispatch RPCs but place_order was omitted. Revoke from PUBLIC (covers anon)
-- and re-grant to authenticated only. Body already fail-closes on AUTH_REQUIRED,
-- so this is defense-in-depth, but the transport layer should match intent.
revoke execute on function public.place_order(uuid, uuid, jsonb, text, integer, text, text, timestamptz, text, uuid, dropoff_preference, text) from public, anon;
grant execute on function public.place_order(uuid, uuid, jsonb, text, integer, text, text, timestamptz, text, uuid, dropoff_preference, text) to authenticated;

-- Rollback note: re-apply mig 082's place_order body (drops the two fee terms),
-- set service_fee_pct back to 0, and optionally drop the two orders columns.
-- The columns are additive/defaulted so leaving them is harmless.
