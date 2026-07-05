# Saved Orders — deliberate, named order presets (IKEA Effect)

Date: 2026-07-05
Status: Approved (brainstorming, text-only)

## Problem

Sharm Eats already has two reorder paths, but both are **replays of history**, not
deliberate curation:

1. **Home "Reorder" rail** (`apps/customer/app/(tabs)/home.tsx`, ~line 292) —
   auto-generated from the last 3 distinct restaurants the user ordered from.
2. **Orders-tab reorder button** (`apps/customer/app/(tabs)/orders.tsx`,
   `reorder()`) — one tap replays a past order's exact `items` into the cart via
   `useCart().loadFromOrder()`.

Neither lets a customer say "this specific build is **mine** — name it and keep
it." That deliberate act of customizing, naming, and choosing to keep something
is what the IKEA Effect describes: users value what they invest effort into.
Replaying last Tuesday's order is zero investment; saving *this exact
configuration, on purpose, with a name* creates psychological ownership and a
stronger repeat-order habit.

The one-tap restaurant heart (`src/lib/favorites.ts`) doesn't fill this gap
either — it favorites a *venue*, not an *order*, and takes a single tap (no
meaningful investment).

## Scope

1. **New `saved_orders` table** — owner-only RLS, jsonb snapshot of `CartItem[]`.
2. **Save trigger** — on the live order-tracking screen (`app/order/[id].tsx`),
   once `order.status === 'delivered'`, show a dismissible "Save this order?"
   card with a name input.
3. **Surfacing** — a new "Saved for you" rail on Home, positioned **above** the
   existing auto-generated Reorder rail, visually distinct from it.
4. **5-per-user cap** — enforced app-side; the 6th save prompts a replace flow.
5. **Reuse existing reorder plumbing** — loading a saved order into the cart uses
   the same `loadFromOrder()` and the same stale-modifier guard already in
   `orders.tsx`.

## Out of scope (YAGNI)

- **No editing a saved order in place.** Re-saving creates a fresh record.
  Editing an old jsonb snapshot against a menu that may have changed since is a
  correctness trap; not worth solving now.
- **No save-from-cart before ordering.** The trigger is strictly post-delivery.
- **No server-side push/notification** nudging users to save. The card is a
  passive, in-screen prompt only.
- **No cross-device "smart" suggestions.** A saved order is exactly what the user
  chose to save, nothing inferred.

## Data model

New table, migration `086` (latest on disk is `085_batching_phase0_shadow.sql`).
Mirrors the `favorites` owner-only RLS pattern (migration `021`).

```sql
-- 086_saved_orders.sql
-- Customer-curated named order presets (IKEA Effect). Owner-only RLS.
-- Non-destructive: new table + RLS only.

create table if not exists public.saved_orders (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name          text not null,
  items         jsonb not null,   -- CartItem[] snapshot; same shape as orders.items
  created_at    timestamptz not null default now()
);

create index if not exists saved_orders_user_idx on public.saved_orders (user_id);

alter table public.saved_orders enable row level security;

create policy "saved_orders_owner_all"
  on public.saved_orders for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table public.saved_orders is
  'Named order presets per customer (IKEA Effect). Owner-only RLS; the app inserts/deletes directly.';
```

Notes:
- `items` reuses the `CartItem[]` shape already persisted in `orders.items`, so no
  new serialization is introduced.
- The 5-per-user cap is enforced in the app (repository layer + UI), not by a DB
  constraint — keeps the migration trivial and the cap easy to tune later.

## Repository / data layer

Add a `savedOrders` repository following the existing `db.user` / `db.orders`
split (mock repo in `src/data/repositories/`, live repo in `src/data/supabase/`):

- `list(): Promise<SavedOrder[]>` — current user's saved orders, newest first.
- `save(input: { restaurantId; restaurantName; name; items: CartItem[] }): Promise<SavedOrder>`
  — rejects with a typed "cap reached" error if the user already has 5.
- `remove(id: string): Promise<void>`.

New `SavedOrder` type in `src/data/types.ts`:

```ts
export interface SavedOrder {
  id: string;
  restaurantId: string;
  restaurantName: string;
  name: string;
  items: CartItem[];
  createdAt: string;
}
```

## Save trigger — order tracking screen, once delivered

`app/order/[id].tsx` is the live tracking screen and stays mounted through
delivery (map, driver, status steps). There is **no separate success modal** to
hook into (`checkout.tsx` navigates straight to `router.replace('/order/${id}')`).

When `order.status === 'delivered'`:

- Render a dismissible **"Save this order?"** card.
- Text input pre-filled with the restaurant name (e.g. "Koshari Al Tahrir") as a
  sensible default the user can overwrite (Smart Defaults — reduces friction on
  the naming step).
- **Save** button calls `db.savedOrders.save(...)`.
- **Stale-modifier guard:** reuse the exact check from `orders.tsx` `reorder()` —
  if any line has `modifierChoices` missing `optionId`, do NOT offer the save
  card (the snapshot would replay wrong/cheaper items later).
- **Cap reached (already 5):** the Save attempt surfaces a lightweight alert
  ("You've saved 5 orders. Remove one from Home to save this.") rather than a
  dedicated replace-picker screen. Removal already lives on the Home rail
  (long-press → Remove), so directing the user there reuses that affordance
  instead of building a second delete surface. The `save()` call throws a typed
  `SavedOrdersCapError` that the card catches to show this message.
- Once saved (or dismissed), the card does not reappear for that order (track via
  local per-order dismissal, same pattern as the home allergy nudge's
  `dismissAllergyNudge`).

## Surfacing — new "Saved for you" Home rail

In `home.tsx`, add a **"Saved for you"** horizontal rail positioned **above** the
existing `reorderRail` section (currently ~line 292).

- Load via `db.savedOrders.list()` in an effect, same as the existing
  `reorderRail` effect (~line 124).
- Each card shows the **custom name** (primary), restaurant name (subtitle), and
  item count — visually distinct from the photo-first restaurant cards in the
  Reorder rail, so "something I chose to keep" reads differently from "somewhere
  I've eaten."
- Tap → `useCart().loadFromOrder({ restaurantId, restaurantName, lines: items })`
  then `router.push('/(tabs)/cart')` — identical to the Orders-tab reorder path.
  Apply the same stale-modifier guard before loading (redirect to the restaurant
  menu if unresolvable, matching `orders.tsx`).
- Long-press or an overflow "⋯" affordance on a card → **Remove**
  (`db.savedOrders.remove(id)`), needed because of the 5 cap.

## i18n

New keys across all 5 locales (`en`, `ar`, `ru`, `de`, `it`), RTL-aware for `ar`:

- `order.saveOrderTitle` — "Save this order?"
- `order.saveOrderPlaceholder` — name field placeholder / default label
- `order.saveOrderCta` — "Save"
- `order.saveOrderCapMsg` — cap-reached / replace prompt
- `home.savedForYou` — rail heading
- `savedOrder.remove` — remove action label

## Testing

- **Unit (cart store):** `loadFromOrder` already tested; add a `savedOrders`
  repository test for the 5-cap rejection and the newest-first ordering.
- **Guard test:** a saved/loaded order with a stale (`optionId`-less) modifier
  line is not offered for save and, if somehow present, redirects on load rather
  than corrupting the cart — mirrors the existing `orders.tsx` guard behavior.
- **RLS:** verify a user cannot read/insert/delete another user's `saved_orders`
  rows (owner-only policy), consistent with the `favorites` table's RLS tests.

## Principle mapping

- **IKEA Effect** (primary) — deliberate customize → name → keep loop.
- **Smart Defaults** (secondary) — name field pre-filled with restaurant name.
- The 5-cap is intentional: scarcity forces curation, reinforcing that saving is
  a considered choice rather than passive hoarding.
