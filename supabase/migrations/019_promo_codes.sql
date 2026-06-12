-- 019_promo_codes.sql
-- Promo codes, end to end.
--
-- validate_promo() shipped in 011 as a stub returning 0. This migration adds
-- the real tables, the real validation logic, and teaches place_order to
-- persist the discount + record the redemption.
--
-- Security model:
--   * promo_codes / promo_redemptions have RLS ENABLED with NO client
--     policies — clients can neither enumerate codes nor read redemptions.
--     All access goes through SECURITY DEFINER functions (owner bypasses RLS).
--   * validate_promo stays granted to authenticated+anon: it only answers
--     "what would THIS code be worth on THIS subtotal" — a guess-one-code
--     oracle, same exposure class as any coupon field.
--
-- Non-destructive: new tables + new orders columns + function replacements.

-- ============================================================================
-- Tables
-- ============================================================================
create table if not exists public.promo_codes (
  id                uuid primary key default gen_random_uuid(),
  code              text not null,
  kind              text not null check (kind in ('percent','fixed')),
  -- percent: 1-100 (% of subtotal). fixed: flat EGP amount.
  value             int  not null check (value > 0),
  min_subtotal_egp  int,
  max_discount_egp  int,
  valid_from        timestamptz,
  valid_to          timestamptz,
  max_uses          int,            -- global redemption cap (null = unlimited)
  per_user_limit    int,            -- per-customer cap (null = unlimited)
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);

-- Codes are case-insensitive and unique.
create unique index if not exists promo_codes_code_upper_idx
  on public.promo_codes (upper(code));

create table if not exists public.promo_redemptions (
  id           uuid primary key default gen_random_uuid(),
  promo_id     uuid not null references public.promo_codes(id) on delete cascade,
  user_id      uuid references public.users(id) on delete set null,
  order_id     uuid not null references public.orders(id) on delete cascade,
  code         text not null,
  discount_egp int  not null,
  created_at   timestamptz not null default now(),
  unique (order_id)   -- one promo per order
);

create index if not exists promo_redemptions_promo_user_idx
  on public.promo_redemptions (promo_id, user_id);

alter table public.promo_codes enable row level security;
alter table public.promo_redemptions enable row level security;
-- Intentionally NO policies: with RLS on and no permissive policy, every
-- client read/write is denied. SECURITY DEFINER functions are the only path.

-- ============================================================================
-- Orders: persist the discount line (total_egp already nets it out)
-- ============================================================================
alter table public.orders
  add column if not exists discount_egp int not null default 0,
  add column if not exists promo_code   text;

-- ============================================================================
-- validate_promo — the real thing (same signature as the 011 stub)
-- ============================================================================
create or replace function public.validate_promo(p_code text, p_subtotal int)
returns int
language plpgsql
stable
security definer set search_path = public, pg_temp
as $$
declare
  v_user     uuid := auth.uid();
  v_promo    public.promo_codes;
  v_uses     int;
  v_discount int;
begin
  if p_code is null or btrim(p_code) = '' then return 0; end if;

  select * into v_promo from public.promo_codes
   where upper(code) = upper(btrim(p_code)) and is_active;
  if not found then return 0; end if;

  if v_promo.valid_from is not null and now() < v_promo.valid_from then return 0; end if;
  if v_promo.valid_to   is not null and now() > v_promo.valid_to   then return 0; end if;
  if v_promo.min_subtotal_egp is not null and coalesce(p_subtotal,0) < v_promo.min_subtotal_egp then
    return 0;
  end if;

  if v_promo.max_uses is not null then
    select count(*) into v_uses from public.promo_redemptions
     where promo_id = v_promo.id;
    if v_uses >= v_promo.max_uses then return 0; end if;
  end if;

  if v_promo.per_user_limit is not null and v_user is not null then
    select count(*) into v_uses from public.promo_redemptions
     where promo_id = v_promo.id and user_id = v_user;
    if v_uses >= v_promo.per_user_limit then return 0; end if;
  end if;

  if v_promo.kind = 'percent' then
    v_discount := (coalesce(p_subtotal,0) * v_promo.value) / 100;
  else
    v_discount := v_promo.value;
  end if;
  if v_promo.max_discount_egp is not null then
    v_discount := least(v_discount, v_promo.max_discount_egp);
  end if;

  -- Never discount below zero subtotal.
  return greatest(0, least(v_discount, coalesce(p_subtotal,0)));
end;
$$;

-- ============================================================================
-- place_order — same contract as 011, now persisting discount + redemption.
-- (Full replacement; the only changes vs 011 are marked with -- [019].)
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

  -- Server-side delivery fee, promo, tax, total. Client total is never used.
  v_delivery := public.quote_delivery_fee(p_restaurant_id, v_addr.geo, v_subtotal);
  v_discount := public.validate_promo(p_promo_code, v_subtotal);
  v_tax := 0;  -- tax-inclusive at launch
  v_total := greatest(0, v_subtotal + v_delivery + v_tax + greatest(0,coalesce(p_tip,0)) - v_discount);

  v_zone := public.resolve_zone_nearest(v_addr.geo);
  v_pay_status := 'pending';  -- card flips to paid on webhook; COD on delivery

  v_addr_snap := to_jsonb(v_addr);

  insert into public.orders (
    user_id, restaurant_id, restaurant_name, address_id, address_snapshot,
    items, subtotal_egp, delivery_fee_egp, tax_egp, tip_egp, total_egp,
    discount_egp, promo_code,                                       -- [019]
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
    v_discount,                                                     -- [019]
    case when v_discount > 0 then upper(btrim(p_promo_code)) else null end,  -- [019]
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

  -- [019] Record the redemption (feeds max_uses / per_user_limit counters).
  if v_discount > 0 and p_promo_code is not null then
    insert into public.promo_redemptions (promo_id, user_id, order_id, code, discount_egp)
    select pc.id, v_user, v_order_id, upper(btrim(p_promo_code)), v_discount
      from public.promo_codes pc
     where upper(pc.code) = upper(btrim(p_promo_code))
     on conflict (order_id) do nothing;
  end if;

  -- First status event.
  insert into public.order_status_events (order_id, status, actor_role, actor_id, note)
  values (v_order_id, 'placed', 'customer', v_user, 'Order placed');

  id := v_order_id; short_code := v_short; total_egp := v_total;
  return next;
end;
$$;

-- ============================================================================
-- Launch promo: WELCOME10 — 10% off, capped EGP 50, once per customer.
-- ============================================================================
insert into public.promo_codes (code, kind, value, max_discount_egp, per_user_limit, is_active)
select 'WELCOME10', 'percent', 10, 50, 1, true
where not exists (select 1 from public.promo_codes where upper(code) = 'WELCOME10');

comment on table public.promo_codes is
  'Promo/coupon codes. RLS on with no client policies — read/validated only via the validate_promo SECURITY DEFINER function (no code enumeration).';
comment on table public.promo_redemptions is
  'One row per order that redeemed a promo. Drives max_uses and per_user_limit checks in validate_promo.';
