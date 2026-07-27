# Package 02 — second-order engine and saved intent

## Outcome

Turn existing order history, Saved Orders, restaurant favourites and local cart
state into a safe, cross-device repeat-order loop.

Do not rebuild features already present. Complete the correctness and
server-sync gaps around them.

## Current evidence

- `orders.tsx` already exposes Order Again.
- `cart.ts` already has `loadFromOrder`.
- migration 055 snapshots modifier and option IDs for current orders.
- migration 086 plus `savedOrders` repositories and UI already provide named
  Saved Orders.
- `place_order` is server-authoritative, so a stale client price cannot decide
  the charged total; however the customer can still see stale local totals
  before placement.
- restaurant favourites are local-first and mirrored best-effort.
- commit `0173832` now merges never-synced guest/account favorites at OTP and
  startup instead of replacing them.
- there is still no durable removal tombstone: if a previously synced favorite
  is removed while the delete fails offline, a subsequent server read can
  restore it.
- carts live only in AsyncStorage.
- restaurant “Recommended” is global rating order.

## Expected repository surfaces

- additive migrations/RPCs for authoritative cart preparation, favorite items
  and server carts plus generated DB types/security tests;
- customer repository interfaces, Supabase/mock implementations and mappers;
- `apps/customer/src/store/cart.ts`, `src/store/session.ts`, Home, Orders,
  item/restaurant and Saved routes/components;
- customer analytics/event dictionary and five locale files;
- lifecycle producer jobs only after Package 03's outbox exists;
- focused repository/store/RPC/RLS/E2E tests.

## Delivery slices

### Slice A — authoritative cart preparation

Create one reusable server operation for historical orders, Saved Orders and
server-restored carts.

Proposed RPC contract:

```text
prepare_cart(
  p_restaurant_id uuid,
  p_cart jsonb
) -> table (
  restaurant_id uuid,
  restaurant_open boolean,
  minimum_order_egp integer,
  prepared_items jsonb,
  issues jsonb,
  subtotal_egp integer
)
```

Input uses the same identity-only shape as `place_order`:

```json
[
  {
    "item_id": "uuid",
    "quantity": 2,
    "modifier_option_ids": ["uuid"],
    "notes": "..."
  }
]
```

The server:

- validates positive bounded quantities and one restaurant;
- rejects duplicate/foreign modifier IDs;
- reads current item name/image/price/availability;
- reads current modifier names/prices/requirements;
- reports removed/unavailable items and invalid selections;
- reports price/name changes relative to an optional display snapshot;
- computes a display subtotal from current values;
- does not reserve stock or place an order.

Use the latest `place_order` validation logic as the behavioral authority, but
factor shared SQL carefully rather than copying a fourteenth divergent variant.
Do not weaken `place_order`; preparation is advisory and placement revalidates.

Client changes:

- add `db.orders.prepareCart(...)` to mock and Supabase repositories;
- add domain types for `PreparedCart`, `PreparedCartLine` and typed issue codes;
- route Orders-tab reorder, Saved Orders and server-cart restore through it;
- show a review sheet when price, availability or modifiers changed;
- never silently drop a modifier or substitute an item;
- use current server prices in the local cart after preparation;
- preserve notes and quantities when still legal;
- if the restaurant is closed, permit viewing the prepared cart but block
  checkout with the existing closed-state explanation.

Analytics:

- `reorder_prepare_started`
- `reorder_prepare_succeeded`
- `reorder_prepare_changed`
- `reorder_prepare_failed`
- issue codes as bounded properties, never raw notes.

Tests:

- current customized order rebuilds exactly;
- old order without option IDs produces an actionable rebuild issue;
- deleted/unavailable item;
- price/name changed;
- modifier moved to another item;
- required modifier added since the old order;
- mixed-restaurant/malicious input refused;
- cross-user order access is impossible when preparing by order ID;
- `place_order` still revalidates after a successful preparation.

### Slice B — harden guest and offline favourite merge

There are two distinct moments:

1. anonymous user is linked to a phone account while retaining the same
   Supabase identity;
2. a returning account signs in on a device with local guest favourites.

Keep the shipped sign-in merge and add the missing durable mutation semantics:

- capture local favourite IDs before auth transition;
- fetch server favourites;
- union valid never-synced IDs;
- upsert locally added IDs under the resulting user;
- apply explicit local removals from a pending-mutation queue before accepting a
  stale server favorite;
- fetch once more and replace local state with confirmed server state;
- retain pending mutations after network failure and replay on reconnect.

Persist mutation records in AsyncStorage:

```ts
type FavoriteMutation = {
  restaurantId: string;
  on: boolean;
  clientMutationId: string;
  changedAt: string;
};
```

Server writes must be idempotent. A retry cannot duplicate a favourite or
resurrect one after a later removal. If last-write-wins is used, add
`updated_at` and compare server/client timestamps; otherwise serialize the
pending queue in client order.

Files expected:

- `apps/customer/src/lib/favorites.ts`
- `apps/customer/src/store/session.ts`
- `apps/customer/src/data/supabase/user.ts`
- `apps/customer/src/data/supabase/auth.ts`
- focused merge/queue tests.

Acceptance:

- guest favourite survives linking;
- returning-account favourites and local guest favourites become a union;
- an explicit offline removal is not resurrected by the next fetch;
- failed writes retry after reconnect;
- sign-out clears private local state and analytics identity.

### Slice C — menu-item favourites and Saved screen

Migration:

```text
favorite_items
  user_id uuid
  item_id uuid
  created_at timestamptz
  primary key (user_id, item_id)
```

Requirements:

- FK to users cascades on account deletion;
- FK to menu_items follows the deliberate product choice: cascade if a deleted
  catalog item should disappear, or retain a tombstone in a separate snapshot
  if “no longer sold” history is valuable;
- RLS owner-only with explicit grants;
- authenticated/anonymous Supabase sessions may manage only their own rows;
- no client-supplied user ID through a definer function without `auth.uid()`
  enforcement.

Client:

- item heart on item detail and restaurant menu;
- `/saved` route with Restaurant and Items sections;
- unavailable items remain visible but cannot enter a cart;
- tap an available item opens its current detail;
- optimistic local state with the same durable mutation strategy as restaurant
  favourites;
- Home may show a small Saved Items rail only after the Saved screen works.

Analytics:

- `item_favorite_toggled`
- `saved_screen_opened`
- `saved_item_opened`
- `saved_item_unavailable_seen`.

Five-language keys and RTL are required.

### Slice D — server-backed active cart

Data model:

```text
customer_carts
  user_id uuid primary key
  restaurant_id uuid null
  items jsonb not null
  kitchen_notes text null
  version bigint not null
  updated_at timestamptz not null
  expires_at timestamptz not null
```

Store identity/quantity/notes, not trusted prices. Display snapshots may be
included for offline UX but are never authoritative.

Authority and sync:

- owner-only RLS and explicit grants;
- one active cart per Supabase user;
- debounced upsert after local mutation;
- optimistic concurrency using `version`;
- on conflict, do not merge two restaurants; show a clear “use this device’s
  cart or the newer saved cart” choice;
- restore through `prepare_cart`, never load JSON directly into checkout;
- clear server cart only after confirmed order placement or explicit clear;
- TTL cleanup via scheduled job;
- sign-out removes local private state but does not delete the account’s server
  cart.

Analytics:

- `cart_synced`
- `cart_conflict_shown`
- `cart_restored`
- `cart_restore_failed`
- `cart_abandoned_eligible`.

Tests include two-device conflict, offline mutations, account link, expired
cart, unavailable item and successful order clear.

### Slice E — lifecycle reminders and simple recommendations

Depends on Package 03 consent/outbox.

Initial lifecycle jobs:

- cart unchanged for a configured interval;
- delivered order reaches the 7/14-day reorder cadence;
- favourite restaurant reopens;
- saved item changes unavailable → available;
- a real offer is attached to a favourite restaurant/item.

Before enqueue/send:

- marketing consent on;
- outside quiet hours;
- no active order;
- restaurant open and deliverable;
- item/cart still valid;
- per-user/event frequency cap;
- suppression reason stored.

Start recommendations with an explainable RPC, not ML:

1. exact/saved reorder;
2. favourites;
3. previously ordered cuisine;
4. available/deliverable/open now;
5. rating/popularity as tie-breaker.

Return an explanation code (`order_again`, `saved`, `because_you_like`,
`popular_near_you`) and score components. Do not persist a sensitive inferred
profile beyond the order/favourite data already held.

Run as a measured rail alongside the rating baseline. Acceptance requires
incremental conversion, not merely a different sort order.

## Rollout order

1. `prepare_cart` and all three existing repeat-entry points.
2. favourite merge/mutation queue.
3. item favourites and Saved screen.
4. server cart.
5. lifecycle outbox producers.
6. explainable recommendation rail.

## Acceptance gate

- historical/saved carts never show or place a silently corrupted basket;
- current prices/availability are explained before checkout;
- guest/offline favourite intent survives auth and reconnect;
- item favourites sync across devices;
- a cart restores safely across devices and never mixes restaurants;
- every lifecycle reminder is consented, current, capped and attributable;
- the recommendation rail beats or is removed in favor of the rating baseline.
