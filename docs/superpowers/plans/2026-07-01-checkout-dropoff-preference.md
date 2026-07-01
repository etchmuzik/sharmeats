# Checkout Dropoff Preference + Visual Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a structured, driver-facing dropoff-preference field to checkout (Hand to me / Leave at door / Meet outside / Don't ring bell / Call on arrival), display it prominently on the driver's job screen (today's `kitchen_notes` never renders there — dead data), and restyle checkout with a progress stepper and a dedicated dropoff card whose "quiet" chip selections trigger an inline contactless-confirmation banner instead of a separate toggle.

**Architecture:** New Postgres enum `dropoff_preference` + two new nullable columns on `public.orders` (migration 041, `create or replace function` on `place_order`'s existing 10-arg signature to add 2 more). Client-side: a new `DropoffPreference` string-literal union type threaded through `CreateOrderInput` → both order-repo adapters (mock + Supabase) → `Order`. New `DropoffPreferenceCard` component on the customer checkout screen (mirrors the existing `KitchenBriefing` component pattern) plus a slim static `CheckoutStepper` component. Driver side: extend the existing `Job` type/select/mapper in `apps/driver/src/jobs.ts`, add a new `DropoffPreferenceCard` component (mirrors the existing `HotelHandoffCard` pattern) rendered in `apps/driver/app/job/[id].tsx`.

**Tech Stack:** Expo/React Native (customer + driver apps), Supabase Postgres (RPC-based writes via `place_order`), i18next-style flat-dot-key JSON i18n (customer app only; driver app is English-only, no i18n directory).

## Global Constraints

- Enum values (exact, from the approved spec): `hand_to_me`, `leave_at_door`, `meet_outside`, `no_bell`, `call_on_arrival`.
- Migration file: `supabase/migrations/041_dropoff_preference.sql` (039 is taken by an in-progress merchant-push-notification migration (already on disk, touches a trigger function only — no conflict with orders schema or place_order, but the filename slot is occupied)).
- `place_order`'s current ground-truth signature (verified from migration `036_place_order_unique_violation_guard.sql`, the last `create or replace function`) is 10 positional args ending in `p_customer_phone text default null, p_idempotency_key uuid default null`. New params `p_dropoff_preference dropoff_preference default null, p_dropoff_note text default null` MUST be appended after `p_idempotency_key` to preserve positional-call compatibility with any caller using positional args (none currently do — all client calls use named args — but appending at the end is still the safe convention this codebase follows, per 031/036's own additive pattern).
- `leave_at_door` chip is hidden for `address.kind === 'hotel'` and `address.kind === 'beach_pin'` (only shown for `'street'`). `meet_outside` is shown for all kinds (useful everywhere, not just hotel/beach). The other three chips (`hand_to_me`, `no_bell`, `call_on_arrival`) show for all address kinds.
- Selecting `leave_at_door` or `no_bell` shows the inline contactless banner. Selecting `hand_to_me`, `meet_outside`, or `call_on_arrival` shows no banner.
- Single-select chip row (only one preference active at a time, like the existing tip-amount chips in checkout.tsx), deselectable by tapping the active chip again (clears to `null`).
- All 5 customer-app locales (`en`, `ar`, `ru`, `de`, `it`) get the new i18n keys. Driver app has no i18n directory — hardcode English strings there, matching `HotelHandoffCard.tsx`'s existing pattern.
- No changes to `kitchen_notes` / `KitchenBriefing` component behavior — dropoff preference is a fully separate field and UI card.
- Local SQL validation before touching prod: use the shimmed-Homebrew-Postgres recipe (Postgres 18, `LANG=C LC_ALL=C`, shim `geography`/`st_*`/`auth`/`cron`/roles, preprocess migrations to strip `create extension`/gist indexes, apply `supabase/migrations/0*.sql` in order with `-v ON_ERROR_STOP=1`). Do not apply to prod/remote until this passes.
- Reuse existing haptics: `selection()` from `apps/customer/src/haptics` for chip taps (already imported in checkout.tsx).
- Reuse existing `Icon` component (`apps/customer/src/components/Icon.tsx`) — `bell` and `phone` icon names already exist; use plain emoji for the others to match `KitchenBriefing`'s existing emoji-in-Text pattern (👩‍🍳) rather than adding new Icon entries, since the chip labels need paired glyphs (🤝🚪🚶🔕📞) that aren't all in the Icon set.

---

## File Structure

| File | Change |
|---|---|
| `supabase/migrations/041_dropoff_preference.sql` | **Create.** New enum, 2 new `orders` columns, `place_order` redefinition. |
| `apps/customer/src/data/types.ts` | **Modify.** Add `DropoffPreference` type; add 2 fields to `Order`. |
| `apps/customer/src/data/repositories/orders.ts` | **Modify.** Add 2 fields to `CreateOrderInput`. |
| `apps/customer/src/data/mock/orders.ts` | **Modify.** Store the 2 new fields on the mock-created `Order`. |
| `apps/customer/src/data/supabase/orders.ts` | **Modify.** Pass 2 new RPC params in `place_order` call. |
| `apps/customer/src/data/supabase/mappers.ts` | **Modify.** Add 2 fields to `OrderRow` + `rowToOrder`. |
| `apps/customer/src/components/CheckoutStepper.tsx` | **Create.** Static 3-step progress indicator. |
| `apps/customer/src/components/DropoffPreferenceCard.tsx` | **Create.** Chip row + conditional contactless banner. |
| `apps/customer/app/checkout.tsx` | **Modify.** Render stepper + new card; wire state; pass to `db.orders.create`. |
| `apps/customer/src/i18n/locales/en.json` | **Modify.** Add 9 new `checkout.*` keys. |
| `apps/customer/src/i18n/locales/ar.json` | **Modify.** Add same 9 keys, Arabic. |
| `apps/customer/src/i18n/locales/ru.json` | **Modify.** Add same 9 keys, Russian. |
| `apps/customer/src/i18n/locales/de.json` | **Modify.** Add same 9 keys, German. |
| `apps/customer/src/i18n/locales/it.json` | **Modify.** Add same 9 keys, Italian. |
| `apps/driver/src/jobs.ts` | **Modify.** Add `dropoff_preference`/`dropoff_note` to `Job`, `JOB_SELECT`, `toJob`. |
| `apps/driver/src/components/DropoffPreferenceCard.tsx` | **Create.** Driver-facing instruction banner, mirrors `HotelHandoffCard.tsx`. |
| `apps/driver/app/job/[id].tsx` | **Modify.** Render the new card. |

---

### Task 1: Migration 041 — enum, columns, `place_order` extension

**Files:**
- Create: `supabase/migrations/041_dropoff_preference.sql`

**Interfaces:**
- Produces: SQL enum `public.dropoff_preference` with values `'hand_to_me' | 'leave_at_door' | 'meet_outside' | 'no_bell' | 'call_on_arrival'`; columns `public.orders.dropoff_preference` (nullable enum) and `public.orders.dropoff_note` (nullable text); `place_order(p_restaurant_id uuid, p_address_id uuid, p_cart jsonb, p_payment_method text, p_tip int, p_kitchen_notes text, p_promo_code text, p_scheduled_for timestamptz, p_customer_phone text, p_idempotency_key uuid, p_dropoff_preference public.dropoff_preference default null, p_dropoff_note text default null) returns table(id uuid, short_code text, total_egp int)`.

- [ ] **Step 1: Write the migration file**

```sql
-- 041_dropoff_preference.sql
-- Structured, driver-facing dropoff instruction (leave at door, don't ring
-- bell, etc.) separate from kitchen_notes (which is prep-facing and shown to
-- the restaurant, not the driver). Today the only outlet for this is the
-- free-text kitchen_notes field, and the driver app doesn't even render
-- kitchen_notes on the job screen — this instruction currently reaches no one.
--
-- Non-destructive: both new columns are nullable, no backfill needed.
-- place_order gets a CREATE OR REPLACE on its current 10-arg signature (see
-- 036_place_order_unique_violation_guard.sql for the ground-truth prior
-- body), appending 2 new trailing default-null params so no existing caller
-- (all of which use named args) breaks.

create type public.dropoff_preference as enum (
  'hand_to_me',
  'leave_at_door',
  'meet_outside',
  'no_bell',
  'call_on_arrival'
);

alter table public.orders
  add column dropoff_preference public.dropoff_preference,
  add column dropoff_note text;

comment on column public.orders.dropoff_preference is
  'Customer-selected handoff instruction, shown to the driver on the job screen. Separate from kitchen_notes (prep-facing, shown to the restaurant).';
comment on column public.orders.dropoff_note is
  'Optional free-text elaboration on dropoff_preference (e.g. "gate code 4821").';

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
  p_idempotency_key uuid     default null,
  p_dropoff_preference public.dropoff_preference default null,
  p_dropoff_note  text       default null
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
      idempotency_key,
      dropoff_preference, dropoff_note
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
      p_idempotency_key,
      p_dropoff_preference, nullif(btrim(coalesce(p_dropoff_note,'')), '')
    )
    returning orders.id, orders.short_code into v_order_id, v_short;
  exception when unique_violation then
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

grant execute on function public.place_order(
  uuid, uuid, jsonb, text, int, text, text, timestamptz, text, uuid,
  public.dropoff_preference, text
) to authenticated;
```

- [ ] **Step 2: Validate locally with the shimmed-Postgres recipe**

Run (adjust paths if the recipe's shim script needs regenerating — see the
project memory `sharmeats-local-sql-validation` for the full shim contents):

```bash
export LANG=C LC_ALL=C
export PATH="/opt/homebrew/opt/postgresql@18/bin:$PATH"
DBDIR=/tmp/sharmeats_pg_040_$(date +%s)
initdb -D "$DBDIR" -U postgres --auth=trust --locale=C --encoding=UTF8
pg_ctl -D "$DBDIR" -o "-p 55432 -k /tmp" -l "$DBDIR/log" start
sleep 2
createdb -h /tmp -p 55432 -U postgres sharmeats_test_040
# apply the shims (geography/geometry/st_*/auth/cron/roles/publication) per
# the sharmeats-local-sql-validation memory recipe, then:
for f in /Users/etch/Downloads/sharmeats/supabase/migrations/0*.sql; do
  psql -h /tmp -p 55432 -U postgres -d sharmeats_test_040 -v ON_ERROR_STOP=1 -f "$f" || { echo "FAILED: $f"; break; }
done
```

Expected: every migration including `041_dropoff_preference.sql` applies with
no error. If `036`'s original body was transcribed incorrectly, this step
will surface a plpgsql syntax error immediately — do not skip it.

- [ ] **Step 3: Smoke-test `place_order` with the new params**

```sql
-- inside the psql session, after applying all migrations and seeding a
-- minimal user/restaurant/address/menu_item fixture (reuse whatever fixture
-- pattern the sharmeats_dispatch_test.sql / sharmeats_referral_test.sql
-- scripts used, per the local-validation memory):
select set_config('request.jwt.claim.sub', '<test-user-uuid>', false);
select * from public.place_order(
  p_restaurant_id := '<test-restaurant-uuid>',
  p_address_id    := '<test-address-uuid>',
  p_cart          := '[{"item_id":"<test-item-uuid>","quantity":1,"modifier_option_ids":[],"notes":null}]'::jsonb,
  p_payment_method := 'cash_on_delivery',
  p_dropoff_preference := 'no_bell',
  p_dropoff_note  := 'Baby sleeping, thanks!'
);
select dropoff_preference, dropoff_note from public.orders order by placed_at desc limit 1;
```

Expected: `place_order` returns a row with a valid `id`/`short_code`/`total_egp`,
and the follow-up select shows `dropoff_preference = 'no_bell'` and
`dropoff_note = 'Baby sleeping, thanks!'` on the inserted row.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/041_dropoff_preference.sql
git commit -m "feat(db): add dropoff_preference enum + place_order params"
```

---

### Task 2: Customer-app types — `DropoffPreference`, `CreateOrderInput`, `Order`

**Files:**
- Modify: `apps/customer/src/data/types.ts:172` (after `AddressKind`), `:298-301` (Order interface)
- Modify: `apps/customer/src/data/repositories/orders.ts:78-100` (`CreateOrderInput`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `export type DropoffPreference = 'hand_to_me' | 'leave_at_door' | 'meet_outside' | 'no_bell' | 'call_on_arrival';` exported from `apps/customer/src/data/types.ts`. `CreateOrderInput.dropoffPreference?: DropoffPreference` and `CreateOrderInput.dropoffNote?: string`. `Order.dropoffPreference?: DropoffPreference` and `Order.dropoffNote?: string`.

- [ ] **Step 1: Add the `DropoffPreference` type to `types.ts`**

In `apps/customer/src/data/types.ts`, immediately after the `AddressKind` line
(currently line 172: `export type AddressKind = 'hotel' | 'street' | 'beach_pin';`),
insert:

```typescript
export type DropoffPreference =
  | 'hand_to_me'
  | 'leave_at_door'
  | 'meet_outside'
  | 'no_bell'
  | 'call_on_arrival';
```

- [ ] **Step 2: Add fields to the `Order` interface**

In `apps/customer/src/data/types.ts`, in the `Order` interface (the block
containing `kitchenNotes?: string; aggregateAllergens?: AllergyKey[]; scheduledFor?: number;`),
add two lines directly after `aggregateAllergens?: AllergyKey[];`:

```typescript
  kitchenNotes?: string;
  aggregateAllergens?: AllergyKey[];
  /** Driver-facing handoff instruction (separate from kitchenNotes, which is prep-facing). */
  dropoffPreference?: DropoffPreference;
  /** Optional free-text elaboration on dropoffPreference (e.g. gate code). */
  dropoffNote?: string;
  scheduledFor?: number;
```

- [ ] **Step 3: Add fields to `CreateOrderInput`**

In `apps/customer/src/data/repositories/orders.ts`, in the `CreateOrderInput`
interface, add two lines directly after `kitchenNotes?: string;`:

```typescript
  kitchenNotes?: string;
  /** Driver-facing handoff instruction, distinct from kitchenNotes. */
  dropoffPreference?: DropoffPreference;
  /** Optional free-text elaboration on dropoffPreference. */
  dropoffNote?: string;
  aggregateAllergens?: AllergyKey[];
```

Also update the import line at the top of the file — it currently reads:

```typescript
import type {
  Address,
  AllergyKey,
  CartItem,
  Order,
  OrderStatus,
  PaymentMethodKind,
} from '../types';
```

Change it to:

```typescript
import type {
  Address,
  AllergyKey,
  CartItem,
  DropoffPreference,
  Order,
  OrderStatus,
  PaymentMethodKind,
} from '../types';
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/customer && npx tsc --noEmit -p .`
Expected: no new errors (the two new optional fields are additive; nothing
consumes them yet so nothing should break).

- [ ] **Step 5: Commit**

```bash
git add apps/customer/src/data/types.ts apps/customer/src/data/repositories/orders.ts
git commit -m "feat(customer): add DropoffPreference type to Order/CreateOrderInput"
```

---

### Task 3: Mock + Supabase order-repo adapters thread the new fields

**Files:**
- Modify: `apps/customer/src/data/mock/orders.ts:116-144` (the `Order` object literal inside `ordersRepo.create`)
- Modify: `apps/customer/src/data/supabase/orders.ts:56-69` (`place_order` RPC call)
- Modify: `apps/customer/src/data/supabase/mappers.ts:280-303` (`OrderRow` interface), `:305-350` (`rowToOrder`)

**Interfaces:**
- Consumes: `CreateOrderInput.dropoffPreference`, `CreateOrderInput.dropoffNote` (Task 2). `Order.dropoffPreference`, `Order.dropoffNote` (Task 2).
- Produces: both adapters populate `Order.dropoffPreference`/`Order.dropoffNote` on every created/read order.

- [ ] **Step 1: Mock repo — store the fields on the created order**

In `apps/customer/src/data/mock/orders.ts`, inside `ordersRepo.create`, the
`Order` object literal currently has:

```typescript
      kitchenNotes: input.kitchenNotes,
      aggregateAllergens: input.aggregateAllergens,
```

Change to:

```typescript
      kitchenNotes: input.kitchenNotes,
      dropoffPreference: input.dropoffPreference,
      dropoffNote: input.dropoffNote,
      aggregateAllergens: input.aggregateAllergens,
```

- [ ] **Step 2: Supabase repo — pass the new RPC params**

In `apps/customer/src/data/supabase/orders.ts`, the `sb.rpc('place_order', {...})`
call currently ends with:

```typescript
      p_customer_phone: input.customerPhone?.trim() || null,
      // [031] Idempotency: a retried/duplicated checkout with the same key
      // returns the existing order instead of creating a second one.
      p_idempotency_key: input.idempotencyKey ?? null,
    });
```

Change to:

```typescript
      p_customer_phone: input.customerPhone?.trim() || null,
      // [031] Idempotency: a retried/duplicated checkout with the same key
      // returns the existing order instead of creating a second one.
      p_idempotency_key: input.idempotencyKey ?? null,
      p_dropoff_preference: input.dropoffPreference ?? null,
      p_dropoff_note: input.dropoffNote?.trim() || null,
    });
```

- [ ] **Step 3: Mapper — add the two columns to `OrderRow` and `rowToOrder`**

In `apps/customer/src/data/supabase/mappers.ts`, `OrderRow` currently has:

```typescript
  kitchen_notes: string | null;
  aggregate_allergens: string[] | null;
  scheduled_for: string | null;
}
```

Change to:

```typescript
  kitchen_notes: string | null;
  dropoff_preference: Order['dropoffPreference'] | null;
  dropoff_note: string | null;
  aggregate_allergens: string[] | null;
  scheduled_for: string | null;
}
```

And `rowToOrder` currently has:

```typescript
    kitchenNotes: o.kitchen_notes ?? undefined,
    aggregateAllergens: (o.aggregate_allergens ?? undefined) as Order['aggregateAllergens'],
    scheduledFor: tsToMs(o.scheduled_for),
  };
}
```

Change to:

```typescript
    kitchenNotes: o.kitchen_notes ?? undefined,
    dropoffPreference: o.dropoff_preference ?? undefined,
    dropoffNote: o.dropoff_note ?? undefined,
    aggregateAllergens: (o.aggregate_allergens ?? undefined) as Order['aggregateAllergens'],
    scheduledFor: tsToMs(o.scheduled_for),
  };
}
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/customer && npx tsc --noEmit -p .`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add apps/customer/src/data/mock/orders.ts apps/customer/src/data/supabase/orders.ts apps/customer/src/data/supabase/mappers.ts
git commit -m "feat(customer): thread dropoff preference through order-repo adapters"
```

---

### Task 4: `DropoffPreferenceCard` component (customer)

**Files:**
- Create: `apps/customer/src/components/DropoffPreferenceCard.tsx`
- Modify: `apps/customer/src/i18n/locales/en.json` (add 9 keys after line 170, i.e. after `checkout.kitchenBriefingDesc`)

**Interfaces:**
- Consumes: `DropoffPreference` type (Task 2), `AddressKind` type (existing), `useT`/`useDirection` hooks (existing, same as used in `checkout.tsx` and `KitchenBriefing.tsx`), `colors`/`font`/`radius`/`shadow` theme tokens (existing, same import path as `KitchenBriefing.tsx`), `selection()` haptic (existing, `apps/customer/src/haptics`).
- Produces: `DropoffPreferenceCard` component with props `{ addressKind: AddressKind | undefined; value: DropoffPreference | null; onChange: (next: DropoffPreference | null) => void }`.

- [ ] **Step 1: Add the 9 i18n keys to `en.json`**

In `apps/customer/src/i18n/locales/en.json`, directly after line 170
(`"checkout.kitchenBriefingDesc": "Aggregated from your cart. Add anything else they should know.",`),
insert:

```json
  "checkout.dropoffTitle": "Dropoff preference",
  "checkout.dropoffHandToMe": "Hand to me",
  "checkout.dropoffLeaveAtDoor": "Leave at door",
  "checkout.dropoffMeetOutside": "Meet outside",
  "checkout.dropoffNoBell": "Don't ring bell",
  "checkout.dropoffCallOnArrival": "Call on arrival",
  "checkout.dropoffQuietBanner": "Quiet dropoff — driver won't ring the bell or knock.",
  "checkout.stepperCart": "Cart",
  "checkout.stepperDetails": "Details",
  "checkout.stepperPayment": "Payment",
```

- [ ] **Step 2: Write `DropoffPreferenceCard.tsx`**

```typescript
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, radius, shadow } from '../theme';
import { useT } from '../i18n';
import { useDirection } from '../lib/direction';
import { selection } from '../haptics';
import type { AddressKind, DropoffPreference } from '../data/types';

interface Props {
  addressKind: AddressKind | undefined;
  value: DropoffPreference | null;
  onChange: (next: DropoffPreference | null) => void;
}

interface ChipDef {
  value: DropoffPreference;
  icon: string;
  labelKey:
    | 'checkout.dropoffHandToMe'
    | 'checkout.dropoffLeaveAtDoor'
    | 'checkout.dropoffMeetOutside'
    | 'checkout.dropoffNoBell'
    | 'checkout.dropoffCallOnArrival';
  hideForAddressKinds: AddressKind[];
}

const CHIPS: ChipDef[] = [
  { value: 'hand_to_me', icon: '🤝', labelKey: 'checkout.dropoffHandToMe', hideForAddressKinds: [] },
  { value: 'leave_at_door', icon: '🚪', labelKey: 'checkout.dropoffLeaveAtDoor', hideForAddressKinds: ['hotel', 'beach_pin'] },
  { value: 'meet_outside', icon: '🚶', labelKey: 'checkout.dropoffMeetOutside', hideForAddressKinds: [] },
  { value: 'no_bell', icon: '🔕', labelKey: 'checkout.dropoffNoBell', hideForAddressKinds: [] },
  { value: 'call_on_arrival', icon: '📞', labelKey: 'checkout.dropoffCallOnArrival', hideForAddressKinds: [] },
];

const QUIET_VALUES: DropoffPreference[] = ['leave_at_door', 'no_bell'];

export function DropoffPreferenceCard({ addressKind, value, onChange }: Props) {
  const t = useT();
  const dir = useDirection();
  const visibleChips = CHIPS.filter(
    (c) => !addressKind || !c.hideForAddressKinds.includes(addressKind),
  );
  const showQuietBanner = value !== null && QUIET_VALUES.includes(value);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t('checkout.dropoffTitle')}</Text>
      <View style={[styles.chipRow, dir.row]}>
        {visibleChips.map((chip) => {
          const active = value === chip.value;
          return (
            <Pressable
              key={chip.value}
              onPress={() => {
                selection();
                onChange(active ? null : chip.value);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={t(chip.labelKey)}
              style={[styles.chip, active && styles.chipActive]}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {chip.icon} {t(chip.labelKey)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {showQuietBanner && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>🤫 {t('checkout.dropoffQuietBanner')}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.xl,
    padding: 14,
    marginBottom: 12,
    ...shadow.soft,
  },
  title: { fontSize: font.sizes['2xl'], fontWeight: font.weights.bold, color: colors.ink },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
  },
  chipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontSize: font.sizes.md, color: colors.ink, fontWeight: font.weights.bold },
  chipTextActive: { color: colors.white },
  banner: {
    marginTop: 10,
    padding: 10,
    borderRadius: radius.md,
    backgroundColor: '#fff4e8',
    borderWidth: 1,
    borderColor: '#f3d9b8',
  },
  bannerText: { fontSize: font.sizes.sm, color: '#8a5a1c', lineHeight: 18 },
});
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/customer && npx tsc --noEmit -p .`
Expected: no new errors. (This step will fail if `useDirection`, `useT`,
`selection`, or the theme token names don't match — cross-check against
`apps/customer/app/checkout.tsx`'s existing imports if so, since this
component intentionally mirrors those exact import paths.)

- [ ] **Step 4: Commit**

```bash
git add apps/customer/src/components/DropoffPreferenceCard.tsx apps/customer/src/i18n/locales/en.json
git commit -m "feat(customer): add DropoffPreferenceCard component"
```

---

### Task 5: `CheckoutStepper` component (customer)

**Files:**
- Create: `apps/customer/src/components/CheckoutStepper.tsx`

**Interfaces:**
- Consumes: `useT` hook, `colors`/`font` theme tokens.
- Produces: `CheckoutStepper` component, no props (static — always shows Cart done, Details active, Payment pending, matching checkout.tsx's position in the existing cart → checkout → payment flow).

- [ ] **Step 1: Write `CheckoutStepper.tsx`**

```typescript
import { StyleSheet, Text, View } from 'react-native';
import { colors, font } from '../theme';
import { useT } from '../i18n';

/**
 * Static progress indicator. Checkout IS the "Details" step — Cart and
 * Payment are the prior/next screens in the existing flow. Purely visual;
 * carries no navigation or state of its own.
 */
export function CheckoutStepper() {
  const t = useT();
  return (
    <View style={styles.row}>
      <Step label={t('checkout.stepperCart')} state="done" />
      <View style={styles.line} />
      <Step label={t('checkout.stepperDetails')} state="active" />
      <View style={styles.line} />
      <Step label={t('checkout.stepperPayment')} state="pending" />
    </View>
  );
}

function Step({ label, state }: { label: string; state: 'done' | 'active' | 'pending' }) {
  const filled = state !== 'pending';
  return (
    <View style={styles.step}>
      <View style={[styles.dot, filled ? styles.dotFilled : styles.dotEmpty]} />
      <Text style={[styles.label, filled ? styles.labelFilled : styles.labelEmpty]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: colors.bgSoft,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  step: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotFilled: { backgroundColor: colors.accent ?? colors.ink },
  dotEmpty: { backgroundColor: colors.line },
  label: { fontSize: font.sizes.xs, marginLeft: 2 },
  labelFilled: { color: colors.ink2, fontWeight: font.weights.bold },
  labelEmpty: { color: colors.ink3 },
  line: { width: 16, height: 1, backgroundColor: colors.line, marginHorizontal: 6 },
});
```

- [ ] **Step 2: Verify `colors.accent` exists (fallback check)**

Run: `grep -n "accent:" apps/customer/src/theme.ts`
If `colors.accent` is not defined in the customer app's theme (only the driver
app's theme was confirmed to have `accentDark`/`accentSoft` during planning),
replace `colors.accent ?? colors.ink` in the `dotFilled` style with just
`colors.ink` (drop the `??` fallback entirely, since `??` on a missing object
property is still valid TS but is unnecessary indirection once you know the
answer).

- [ ] **Step 3: Typecheck**

Run: `cd apps/customer && npx tsc --noEmit -p .`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add apps/customer/src/components/CheckoutStepper.tsx
git commit -m "feat(customer): add CheckoutStepper progress indicator"
```

---

### Task 6: Wire both components into `checkout.tsx`

**Files:**
- Modify: `apps/customer/app/checkout.tsx`

**Interfaces:**
- Consumes: `CheckoutStepper` (Task 5), `DropoffPreferenceCard` (Task 4), `DropoffPreference` type (Task 2).
- Produces: checkout screen renders the stepper under the header and the dropoff card after the "Deliver to" card; `dropoffPreference`/`dropoffNote` state is passed into `db.orders.create`.

- [ ] **Step 1: Add imports**

In `apps/customer/app/checkout.tsx`, the import block currently includes:

```typescript
import { BackButton } from '../src/components/BackButton';
import { PrimaryButton } from '../src/components/PrimaryButton';
import { KitchenBriefing } from '../src/components/KitchenBriefing';
```

Change to:

```typescript
import { BackButton } from '../src/components/BackButton';
import { PrimaryButton } from '../src/components/PrimaryButton';
import { KitchenBriefing } from '../src/components/KitchenBriefing';
import { CheckoutStepper } from '../src/components/CheckoutStepper';
import { DropoffPreferenceCard } from '../src/components/DropoffPreferenceCard';
```

And the type import line:

```typescript
import type { Address, AllergyKey, PaymentMethod, Restaurant } from '../src/data/types';
```

Change to:

```typescript
import type { Address, AllergyKey, DropoffPreference, PaymentMethod, Restaurant } from '../src/data/types';
```

- [ ] **Step 2: Add state**

In the state block (currently starting `const [address, setAddress] = useState<Address | null>(null);`),
add after `const [kitchenNotes, setKitchenNotes] = useState('');`:

```typescript
  const [kitchenNotes, setKitchenNotes] = useState('');
  const [dropoffPreference, setDropoffPreference] = useState<DropoffPreference | null>(null);
  const [dropoffNote, setDropoffNote] = useState('');
```

(`dropoffNote` state is included per the `Order`/`CreateOrderInput` type
already supporting it from Task 2, but per the approved spec the checkout UI
in this pass only exposes the chip row — no separate free-text input for
`dropoffNote` is rendered. It stays `''` and is passed through as `undefined`
in the `place()` call below. This keeps the field available for a future
"add a note" affordance without expanding this pass's UI scope.)

- [ ] **Step 3: Render the stepper**

The render currently starts:

```tsx
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="dark" />
      <View style={[styles.head, { paddingTop: insets.top + 12 }]}>
        <BackButton />
        <Text style={styles.title}>{t('checkout.title')}</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 200 }}>
```

Change to:

```tsx
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="dark" />
      <View style={[styles.head, { paddingTop: insets.top + 12 }]}>
        <BackButton />
        <Text style={styles.title}>{t('checkout.title')}</Text>
        <View style={{ width: 38 }} />
      </View>
      <CheckoutStepper />

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 200 }}>
```

- [ ] **Step 4: Render the dropoff card after the address card**

The address card's closing `</View>` is immediately followed by the contact
number card's opening comment:

```tsx
        </View>

        {/* Contact number — the driver calls this. Required to place the order. */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('checkout.contactTitle')}</Text>
```

Change to:

```tsx
        </View>

        <DropoffPreferenceCard
          addressKind={address?.kind}
          value={dropoffPreference}
          onChange={setDropoffPreference}
        />

        {/* Contact number — the driver calls this. Required to place the order. */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('checkout.contactTitle')}</Text>
```

- [ ] **Step 5: Pass the fields into `db.orders.create`**

In the `place` function, the `db.orders.create({...})` call currently
includes:

```typescript
        kitchenNotes: kitchenNotes.trim() || undefined,
        aggregateAllergens: aggregateAllergens.length > 0 ? aggregateAllergens : undefined,
```

Change to:

```typescript
        kitchenNotes: kitchenNotes.trim() || undefined,
        dropoffPreference: dropoffPreference ?? undefined,
        dropoffNote: dropoffNote.trim() || undefined,
        aggregateAllergens: aggregateAllergens.length > 0 ? aggregateAllergens : undefined,
```

- [ ] **Step 6: Typecheck**

Run: `cd apps/customer && npx tsc --noEmit -p .`
Expected: no new errors.

- [ ] **Step 7: Manual check in Expo (mock mode)**

Run: `cd apps/customer && npx expo start` (or the project's existing dev-server
skill/command if one exists — check for a `run` skill first).
Navigate: Home → pick a restaurant → add an item → cart → checkout.
Expected: stepper renders under the header showing Cart/Details/Payment;
after the "Deliver to" card, a "Dropoff preference" card shows chips
(street address → 4 chips including "Leave at door"; hotel/beach address →
"Leave at door" is hidden). Tapping "Don't ring bell" or "Leave at door"
shows the amber contactless banner; tapping any other chip does not; tapping
the active chip again deselects it and clears the banner. Placing an order
succeeds (mock mode always succeeds).

- [ ] **Step 8: Commit**

```bash
git add apps/customer/app/checkout.tsx
git commit -m "feat(customer): wire CheckoutStepper + DropoffPreferenceCard into checkout screen"
```

---

### Task 7: Remaining 4 locale files (ar, ru, de, it)

**Files:**
- Modify: `apps/customer/src/i18n/locales/ar.json`
- Modify: `apps/customer/src/i18n/locales/ru.json`
- Modify: `apps/customer/src/i18n/locales/de.json`
- Modify: `apps/customer/src/i18n/locales/it.json`

**Interfaces:**
- Consumes: the 9 key names introduced in Task 4 Step 1 (`checkout.dropoffTitle`, `checkout.dropoffHandToMe`, `checkout.dropoffLeaveAtDoor`, `checkout.dropoffMeetOutside`, `checkout.dropoffNoBell`, `checkout.dropoffCallOnArrival`, `checkout.dropoffQuietBanner`, `checkout.stepperCart`, `checkout.stepperDetails`, `checkout.stepperPayment`).
- Produces: all 5 locale files now define the same 9 keys (checked by Step 3's parity script).

- [ ] **Step 1: Find the matching insertion point in each locale file**

Run: `grep -n "checkout.kitchenBriefingDesc" apps/customer/src/i18n/locales/ar.json apps/customer/src/i18n/locales/ru.json apps/customer/src/i18n/locales/de.json apps/customer/src/i18n/locales/it.json`

This gives the line number in each file to insert after (mirroring exactly
where the keys were inserted in `en.json` in Task 4 Step 1).

- [ ] **Step 2: Insert the 9 keys into each file**

Insert directly after the `checkout.kitchenBriefingDesc` line in each file
(same key order as `en.json`):

`ar.json`:
```json
  "checkout.dropoffTitle": "تفضيل التسليم",
  "checkout.dropoffHandToMe": "سلمها لي",
  "checkout.dropoffLeaveAtDoor": "اتركها عند الباب",
  "checkout.dropoffMeetOutside": "قابلني في الخارج",
  "checkout.dropoffNoBell": "لا تدق الجرس",
  "checkout.dropoffCallOnArrival": "اتصل عند الوصول",
  "checkout.dropoffQuietBanner": "توصيل هادئ — السائق لن يدق الجرس أو يطرق الباب.",
  "checkout.stepperCart": "السلة",
  "checkout.stepperDetails": "التفاصيل",
  "checkout.stepperPayment": "الدفع",
```

`ru.json`:
```json
  "checkout.dropoffTitle": "Способ доставки",
  "checkout.dropoffHandToMe": "Передать мне лично",
  "checkout.dropoffLeaveAtDoor": "Оставить у двери",
  "checkout.dropoffMeetOutside": "Встретить снаружи",
  "checkout.dropoffNoBell": "Не звонить в звонок",
  "checkout.dropoffCallOnArrival": "Позвонить по прибытии",
  "checkout.dropoffQuietBanner": "Тихая доставка — курьер не будет звонить в звонок или стучать.",
  "checkout.stepperCart": "Корзина",
  "checkout.stepperDetails": "Детали",
  "checkout.stepperPayment": "Оплата",
```

`de.json`:
```json
  "checkout.dropoffTitle": "Zustellwunsch",
  "checkout.dropoffHandToMe": "Persönlich übergeben",
  "checkout.dropoffLeaveAtDoor": "Vor der Tür ablegen",
  "checkout.dropoffMeetOutside": "Draußen treffen",
  "checkout.dropoffNoBell": "Nicht klingeln",
  "checkout.dropoffCallOnArrival": "Bei Ankunft anrufen",
  "checkout.dropoffQuietBanner": "Leise Zustellung — der Fahrer klingelt oder klopft nicht.",
  "checkout.stepperCart": "Warenkorb",
  "checkout.stepperDetails": "Details",
  "checkout.stepperPayment": "Zahlung",
```

`it.json`:
```json
  "checkout.dropoffTitle": "Preferenza di consegna",
  "checkout.dropoffHandToMe": "Consegna a me",
  "checkout.dropoffLeaveAtDoor": "Lascia alla porta",
  "checkout.dropoffMeetOutside": "Incontriamoci fuori",
  "checkout.dropoffNoBell": "Non suonare il campanello",
  "checkout.dropoffCallOnArrival": "Chiama all'arrivo",
  "checkout.dropoffQuietBanner": "Consegna silenziosa — il driver non suonerà né busserà.",
  "checkout.stepperCart": "Carrello",
  "checkout.stepperDetails": "Dettagli",
  "checkout.stepperPayment": "Pagamento",
```

- [ ] **Step 3: Verify key parity across all 5 locale files**

Run:

```bash
cd apps/customer/src/i18n/locales
python3 -c "
import json
files = ['en.json', 'ar.json', 'ru.json', 'de.json', 'it.json']
keysets = {f: set(json.load(open(f)).keys()) for f in files}
base = keysets['en.json']
for f in files[1:]:
    missing = base - keysets[f]
    extra = keysets[f] - base
    new_keys = {k for k in missing if k.startswith('checkout.dropoff') or k.startswith('checkout.stepper')}
    if new_keys:
        print(f'{f} missing:', new_keys)
print('OK — all 9 new keys present in every locale' if not any(
    (base - keysets[f]) & {'checkout.dropoffTitle','checkout.dropoffHandToMe','checkout.dropoffLeaveAtDoor','checkout.dropoffMeetOutside','checkout.dropoffNoBell','checkout.dropoffCallOnArrival','checkout.dropoffQuietBanner','checkout.stepperCart','checkout.stepperDetails','checkout.stepperPayment'}
    for f in files[1:]
) else 'MISSING KEYS FOUND')
"
```

Expected output: `OK — all 9 new keys present in every locale`

- [ ] **Step 4: Validate JSON syntax**

Run: `for f in apps/customer/src/i18n/locales/*.json; do python3 -m json.tool "$f" > /dev/null && echo "$f OK" || echo "$f INVALID"; done`
Expected: all 5 files print `OK`.

- [ ] **Step 5: Commit**

```bash
git add apps/customer/src/i18n/locales/ar.json apps/customer/src/i18n/locales/ru.json apps/customer/src/i18n/locales/de.json apps/customer/src/i18n/locales/it.json
git commit -m "i18n: add dropoff preference + stepper strings for ar/ru/de/it"
```

---

### Task 8: Driver app — extend `Job` type and query to include dropoff fields

**Files:**
- Modify: `apps/driver/src/jobs.ts`

**Interfaces:**
- Consumes: nothing new (extends the existing `Job` interface / `JOB_SELECT` string / `toJob` function already in this file).
- Produces: `Job.dropoff_preference: string | null` and `Job.dropoff_note: string | null`, populated from the DB.

- [ ] **Step 1: Add fields to the `Job` interface**

In `apps/driver/src/jobs.ts`, the `Job` interface currently ends:

```typescript
  /** Customer contact phone (mig 028) — the driver calls this to complete delivery. */
  customer_phone: string | null;
  /** Per-order delivery/prep note from the customer. */
  kitchen_notes: string | null;
  assigned_driver_id: string | null;
}
```

Change to:

```typescript
  /** Customer contact phone (mig 028) — the driver calls this to complete delivery. */
  customer_phone: string | null;
  /** Per-order delivery/prep note from the customer. */
  kitchen_notes: string | null;
  /** Driver-facing handoff instruction (mig 041) — e.g. 'no_bell', 'leave_at_door'. */
  dropoff_preference: string | null;
  /** Optional free-text elaboration on dropoff_preference. */
  dropoff_note: string | null;
  assigned_driver_id: string | null;
}
```

- [ ] **Step 2: Add the columns to `JOB_SELECT`**

Currently:

```typescript
const JOB_SELECT =
  'id, short_code, restaurant_name, status, payment_method, payment_status, ' +
  'total_egp, subtotal_egp, delivery_fee_egp, tip_egp, items, dropoff_geo, ' +
  'address_snapshot, customer_phone, kitchen_notes, assigned_driver_id, restaurants(geo)';
```

Change to:

```typescript
const JOB_SELECT =
  'id, short_code, restaurant_name, status, payment_method, payment_status, ' +
  'total_egp, subtotal_egp, delivery_fee_egp, tip_egp, items, dropoff_geo, ' +
  'address_snapshot, customer_phone, kitchen_notes, dropoff_preference, dropoff_note, ' +
  'assigned_driver_id, restaurants(geo)';
```

- [ ] **Step 3: Map the fields in `toJob`**

Currently:

```typescript
    customer_phone: (row.customer_phone as string | null) ?? null,
    kitchen_notes: (row.kitchen_notes as string | null) ?? null,
    assigned_driver_id: (row.assigned_driver_id as string | null) ?? null,
  };
}
```

Change to:

```typescript
    customer_phone: (row.customer_phone as string | null) ?? null,
    kitchen_notes: (row.kitchen_notes as string | null) ?? null,
    dropoff_preference: (row.dropoff_preference as string | null) ?? null,
    dropoff_note: (row.dropoff_note as string | null) ?? null,
    assigned_driver_id: (row.assigned_driver_id as string | null) ?? null,
  };
}
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/driver && npx tsc --noEmit -p .`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add apps/driver/src/jobs.ts
git commit -m "feat(driver): read dropoff_preference/dropoff_note into Job"
```

---

### Task 9: Driver-facing `DropoffPreferenceCard` component + wire into job screen

**Files:**
- Create: `apps/driver/src/components/DropoffPreferenceCard.tsx`
- Modify: `apps/driver/app/job/[id].tsx`

**Interfaces:**
- Consumes: `Job.dropoff_preference`, `Job.dropoff_note` (Task 8); `colors`/`font`/`radius`/`spacing` theme tokens (existing, same import path as `HotelHandoffCard.tsx`); `Icon` component (existing).
- Produces: `DropoffPreferenceCard` component with props `{ preference: string | null; note?: string | null }`, rendered on the job detail screen whenever `preference` is non-null.

- [ ] **Step 1: Write `DropoffPreferenceCard.tsx`**

```typescript
import { Text, View } from 'react-native';
import { colors, font, radius, spacing } from '../theme';

const COPY: Record<string, { icon: string; title: string }> = {
  hand_to_me: { icon: '🤝', title: 'Hand to the guest' },
  leave_at_door: { icon: '🚪', title: "Leave at the door — don't wait" },
  meet_outside: { icon: '🚶', title: 'Guest will meet you outside' },
  no_bell: { icon: '🔕', title: "Don't ring the bell or knock" },
  call_on_arrival: { icon: '📞', title: 'Call the guest on arrival' },
};

interface Props {
  preference: string | null;
  note?: string | null;
}

/**
 * Driver-facing dropoff instruction, mirrors HotelHandoffCard's prominent
 * amber-accented treatment so a customer's handoff request (e.g. "don't ring
 * the bell") is impossible to miss before the driver knocks/rings anyway.
 */
export function DropoffPreferenceCard({ preference, note }: Props) {
  if (!preference) return null;
  const copy = COPY[preference];
  if (!copy) return null;

  return (
    <View
      style={{
        marginTop: spacing.md,
        backgroundColor: colors.amberSoft,
        borderWidth: 1,
        borderColor: colors.amber,
        borderRadius: radius.xl,
        padding: spacing.lg,
      }}
    >
      <Text style={{ fontSize: font.sizes.lg, fontWeight: '800', color: colors.amber }}>
        {copy.icon} {copy.title}
      </Text>
      {note ? (
        <Text style={{ fontSize: font.sizes.sm, color: colors.ink2, marginTop: 4 }}>{note}</Text>
      ) : null}
    </View>
  );
}
```

- [ ] **Step 2: Wire it into the job screen**

In `apps/driver/app/job/[id].tsx`, the hotel/street handoff block currently
ends and is immediately followed by the order-items card:

```tsx
        ) : (
          <View style={{ marginTop: spacing.md, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: radius.xl, padding: spacing.lg }}>
            <Text style={{ fontSize: font.sizes.xs, color: colors.ink3, fontWeight: '700', textTransform: 'uppercase' }}>
              Deliver to
            </Text>
            <Text style={{ fontSize: font.sizes.lg, color: colors.ink, marginTop: 4 }}>{addrLine}</Text>
            {addr?.landmark ? (
              <Text style={{ color: colors.ink2, fontSize: font.sizes.sm, marginTop: 2 }}>Landmark: {addr.landmark}</Text>
            ) : null}
          </View>
        )}

        {/* Order items — so the driver can verify the bag before leaving the restaurant. */}
```

Change to:

```tsx
        ) : (
          <View style={{ marginTop: spacing.md, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: radius.xl, padding: spacing.lg }}>
            <Text style={{ fontSize: font.sizes.xs, color: colors.ink3, fontWeight: '700', textTransform: 'uppercase' }}>
              Deliver to
            </Text>
            <Text style={{ fontSize: font.sizes.lg, color: colors.ink, marginTop: 4 }}>{addrLine}</Text>
            {addr?.landmark ? (
              <Text style={{ color: colors.ink2, fontSize: font.sizes.sm, marginTop: 2 }}>Landmark: {addr.landmark}</Text>
            ) : null}
          </View>
        )}

        <DropoffPreferenceCard preference={job.dropoff_preference} note={job.dropoff_note} />

        {/* Order items — so the driver can verify the bag before leaving the restaurant. */}
```

And add the import — the existing import block has:

```typescript
import { HotelHandoffCard } from '../../src/components/HotelHandoffCard';
```

Change to:

```typescript
import { HotelHandoffCard } from '../../src/components/HotelHandoffCard';
import { DropoffPreferenceCard } from '../../src/components/DropoffPreferenceCard';
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/driver && npx tsc --noEmit -p .`
Expected: no new errors.

- [ ] **Step 4: Manual check in Expo (driver app, mock/dev mode)**

Run the driver app's dev server (check for a `run` skill first; otherwise
`cd apps/driver && npx expo start`). Open a job whose order has
`dropoff_preference = 'no_bell'` set (use the SQL from Task 1 Step 3, or
place a real test order end-to-end after Task 6 is deployed to a dev/staging
Supabase project). Expected: an amber card reading "🔕 Don't ring the bell or
knock" appears between the address card and the items card. For a job with
`dropoff_preference = null`, confirm no empty/blank card renders (the
component returns `null`).

- [ ] **Step 5: Commit**

```bash
git add apps/driver/src/components/DropoffPreferenceCard.tsx apps/driver/app/job/\[id\].tsx
git commit -m "feat(driver): surface dropoff preference on the job screen"
```

---

## Self-Review Notes (already applied above)

- **Spec coverage:** enum/columns (Task 1), chip set + address-kind filtering
  (Task 4), contactless banner (Task 4), stepper (Task 5), checkout wiring
  (Task 6), i18n all 5 locales (Task 4 + Task 7), driver-side surfacing
  (Task 8 + Task 9) — every spec section has a task.
- **Placeholder scan:** no TBD/TODO; every code step has complete code,
  including the full `place_order` body (transcribed verbatim from migration
  036, the verified ground-truth signature, not the stale 011 original).
- **Type consistency:** `DropoffPreference` string-literal union is defined
  once (Task 2) and reused verbatim in `CreateOrderInput`, `Order`,
  `DropoffPreferenceCard` (customer), and referenced by string in the driver
  app's `Job.dropoff_preference: string | null` (deliberately loose-typed
  there, matching how `Job.address_snapshot.handoff` and
  `HotelHandoffCard`'s `handoff?: string` prop are already loosely typed for
  the same reason: `address_snapshot`/order rows are denormalized JSON from
  the DB and should degrade gracefully on an unexpected value rather than
  throw a type error at the boundary).
- **Out-of-scope items respected:** no changes to `kitchen_notes`/
  `KitchenBriefing`, no merchant-web changes, no push notification changes,
  no tracking-screen rendering beyond the type carrying the field (Task 2
  adds the field to `Order` but no task renders it back to the customer
  post-order — intentional, matches the spec's explicit "Out of scope" list).
