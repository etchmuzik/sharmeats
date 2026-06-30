-- 036_place_order_unique_violation_guard.sql
-- Make place_order's unique_violation handler idempotency-key-aware so a
-- short_code collision can no longer be silently swallowed into a phantom
-- "success" of all-NULLs.
--
-- THE BUG THIS FIXES (regression introduced by mig 031)
-- In mig 031, place_order wraps its INSERT in
--   begin ... exception when unique_violation ...
-- The handler assumes the ONLY unique_violation possible is the idempotency-key
-- race, and "recovers" by selecting the existing row for
--   (user_id = v_user and idempotency_key = p_idempotency_key).
--
-- But orders.short_code is also `not null unique` (002_app_schema.sql), filled by
-- a random 6-char generator (generate_order_short_code). A short_code collision
-- ALSO raises unique_violation and lands in the SAME handler. In that case:
--   - for keyless calls (p_idempotency_key is null) the recovery predicate
--     `idempotency_key = null` is never true, so nothing is found;
--   - even for keyed calls, the failing INSERT was rolled back to the block's
--     implicit savepoint, so no matching row exists yet.
-- The select finds nothing, v_existing stays NULL, and the function happily
-- RETURNs a row of all NULLs (id=NULL, short_code=NULL, total_egp=NULL) — no
-- order was created, but the caller sees "success". That is a regression vs the
-- pre-031 behaviour, where a short_code collision propagated as a retryable
-- error.
--
-- THE FIX
-- CREATE OR REPLACE place_order with the SAME body as mig 031, changing ONLY the
-- exception handler to be key-aware:
--   - if p_idempotency_key is null  -> re-raise (genuine collision, retryable);
--   - else look up the existing (user, key) row; if NOT FOUND -> re-raise
--     (it wasn't the idempotency race — e.g. a short_code collision);
--   - else return the existing row (the real idempotency-race recovery).
-- This preserves idempotency recovery while letting genuine short_code collisions
-- (and any other non-idempotency unique violation) propagate, restoring pre-031
-- behaviour.
--
-- Non-destructive: the 10-arg signature is unchanged, so a plain CREATE OR
-- REPLACE FUNCTION suffices (no DROP needed). Execute is re-granted to
-- authenticated at the end to keep the migration idempotent.

create or replace function public.place_order(
  p_restaurant_id uuid,
  p_address_id    uuid,
  p_cart          jsonb,
  p_payment_method text,
  p_tip           int        default 0,
  p_kitchen_notes text       default null,
  p_promo_code    text       default null,
  p_scheduled_for timestamptz default null,
  p_customer_phone text      default null,
  p_idempotency_key uuid     default null   -- [031] backward-compatible
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
  v_existing    public.orders;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;

  -- [031] Idempotency fast-path: if this (user, key) already produced an order,
  -- return it unchanged instead of creating a duplicate.
  if p_idempotency_key is not null then
    select * into v_existing from public.orders
     where user_id = v_user and idempotency_key = p_idempotency_key;
    if found then
      id := v_existing.id; short_code := v_existing.short_code; total_egp := v_existing.total_egp;
      return next;
      return;
    end if;
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

  begin
    insert into public.orders (
      user_id, restaurant_id, restaurant_name, address_id, address_snapshot,
      items, subtotal_egp, delivery_fee_egp, tax_egp, tip_egp, total_egp,
      discount_egp, promo_code,
      payment_method_kind, payment_label, payment_method, payment_status,
      fulfillment_type, dispatch_mode, dropoff_geo, zone,
      status, history, eta_at, sla_minutes, kitchen_notes, scheduled_for,
      customer_phone,
      idempotency_key                                                 -- [031]
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
      nullif(btrim(coalesce(p_customer_phone,'')), ''),
      p_idempotency_key                                               -- [031]
    )
    returning orders.id, orders.short_code into v_order_id, v_short;
  exception when unique_violation then
    -- [036] Key-aware recovery. The 031 handler assumed the only possible
    -- unique_violation was the idempotency-key race and returned a row of
    -- all-NULLs when the lookup found nothing (e.g. a short_code collision,
    -- or any keyless call). Now:
    --   - keyless calls re-raise (genuine, retryable collision);
    --   - keyed calls look up the (user, key) winner; if there isn't one, the
    --     violation wasn't the idempotency race, so re-raise.
    if p_idempotency_key is null then
      raise;
    end if;
    select * into v_existing from public.orders
     where user_id = v_user and idempotency_key = p_idempotency_key;
    if not found then
      raise;
    end if;
    id := v_existing.id; short_code := v_existing.short_code; total_egp := v_existing.total_egp;
    return next;
    return;
  end;

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

-- Re-grant on the (unchanged) 10-arg signature to keep this migration idempotent.
grant execute on function public.place_order(uuid, uuid, jsonb, text, int, text, text, timestamptz, text, uuid) to authenticated;
