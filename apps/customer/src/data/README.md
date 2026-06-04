# Data layer

Everything the app reads or writes flows through **`src/data/index.ts`**:

```ts
import { db } from '@/data';
const restaurants = await db.restaurants.list();
```

The app **never** imports from `data/mock/*` or `data/repositories/*` directly. This is the seam where Supabase swaps in later — see "Swap to Supabase" below.

## Structure

```
src/data/
├── types.ts                    Restaurant, MenuItem, Hotel, Order, etc.
├── index.ts                    exports `db` — the single entrypoint
├── mock/                       in-memory seed data + simulated order progression
│   ├── restaurants.ts
│   ├── hotels.ts
│   ├── menus.ts
│   ├── user.ts
│   └── riders.ts
└── repositories/               each implements one slice of `db.*`
    ├── restaurants.ts          list / get / getBySlug / listFeatured
    ├── menus.ts                forRestaurant / getItem
    ├── hotels.ts               list / search / get
    ├── user.ts                 getMe / update / addresses + payment methods
    └── orders.ts               create / get / list / subscribe / forceDelivered / submitReview
```

## Mock realism

When you place an order through the UI, the `orders` repo schedules a chain of `setTimeout` callbacks that walk the status through `placed → accepted → preparing → ready → out_for_delivery → delivered` over ~90 seconds. The tracking screen subscribes via `db.orders.subscribe(orderId, cb)` and re-renders.

The cart is persisted to AsyncStorage so it survives app reload.
Sessions (signed-in state, locale, currency, selected address) are also persisted to AsyncStorage.

## Swap to Supabase

When the schema is ready:

1. Add `supabase` adapters next to `mock/`:
   ```
   src/data/supabase/
   ├── client.ts          createClient(URL, KEY)
   ├── restaurants.ts     same shape as repositories/restaurants
   ├── menus.ts
   ├── hotels.ts
   ├── user.ts
   └── orders.ts          uses Supabase Realtime for subscribe()
   ```

2. In `src/data/index.ts`, swap the imports:

   ```ts
   // Before (mock)
   import { restaurantsRepo } from './repositories/restaurants';

   // After (Supabase)
   import { restaurantsRepo } from './supabase/restaurants';
   ```

3. The UI is untouched. Each `supabase/*` module exports the same shape — `list()`, `get()`, etc. — so consumers don't care.

4. Realtime in `orders.ts` becomes:
   ```ts
   subscribe(orderId, cb) {
     const channel = supabase
       .channel(`order:${orderId}`)
       .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` }, (p) => cb(p.new as Order))
       .subscribe();
     return () => { channel.unsubscribe(); };
   }
   ```

5. RLS policies live in `/Users/etch/Projects/apps/sharmeats/supabase/migrations/`. The schema for app tables is in plan §5 — add as `002_app_schema.sql` when ready.

6. `.env`:
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=...
   ```

7. Auth swap is in `src/store/session.ts` — replace the mock `signIn()` with `supabase.auth.signInWithOtp({ phone })` and `verifyOtp`.

## Contract

Every repository function:
- Returns `Promise<T>` (async even in mock — keeps the call sites unchanged).
- Throws on hard failures (not implemented in mock yet — add in adapter).
- Never throws on "not found" — returns `null` instead.

If you add a new repository function, add it to **both** `mock/` and (eventually) `supabase/`. Keep the interface in sync via TypeScript — the type of `db` is exported as `DB`.
