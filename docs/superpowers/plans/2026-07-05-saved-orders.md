# Saved Orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a customer save a delivered order as a named, curated preset ("My usual") and one-tap reload it from a dedicated Home rail (IKEA Effect).

**Architecture:** New `saved_orders` Postgres table (owner-only RLS) + a `savedOrders` repository with mock and Supabase adapters, wired into the existing `db` entry point. UI touch-points: a "Save this order?" card on the delivered order-tracking screen, and a "Saved for you" rail on Home. Loading a saved order reuses the existing `useCart().loadFromOrder()` + stale-modifier guard already used by the Orders-tab reorder button.

**Tech Stack:** React Native / Expo Router, Zustand (cart store), Supabase (Postgres + RLS), Vitest, flat-dotted i18n (en/ar/ru/de/it).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-05-saved-orders-design.md`.
- Migration number: **086** (latest on disk is `085_batching_phase0_shadow.sql`). Non-destructive: new table + RLS only.
- Owner-only RLS, mirroring `favorites` (migration `021`): `using (auth.uid() = user_id) with check (auth.uid() = user_id)`.
- **5-per-user cap**, enforced app-side (repository + UI), not in the DB.
- `items` column is a `jsonb` snapshot of `CartItem[]` — same shape as `orders.items`. No new serialization.
- **Stale-modifier guard (reuse, do not reinvent):** a line is unresolvable when any entry in `modifierChoices` is missing `optionId`. This is the exact check already in `apps/customer/app/(tabs)/orders.tsx` `reorder()`. Never offer save for, or silently load, an unresolvable order.
- All data-layer access goes through `db.savedOrders.*` — never import a repo file directly from a screen.
- i18n keys are **flat dotted strings** (e.g. `"home.savedForYou": "..."`), added to all 5 locale JSONs: `en`, `ar`, `ru`, `de`, `it`. `ar` is RTL — use the existing `useDirection()` helper for layout, not hardcoded left/right.
- Reuse existing keys where they exist: `common.save`, `common.cancel`, `orders.reorderTitle`, `orders.reorderNeedsRebuild`, `orders.reorderOpenMenu`.
- All work happens in `apps/customer/` unless a path says otherwise. The Supabase migration lives in repo-root `supabase/migrations/`.

**Branching:** This plan should be implemented on a fresh branch cut from `main` (e.g. `feat/saved-orders`), NOT stacked on the current `chore/store-submit-v1.0.2` branch. Create it before Task 1.

---

### Task 1: Database migration + `SavedOrder` type

**Files:**
- Create: `supabase/migrations/086_saved_orders.sql`
- Modify: `apps/customer/src/data/types.ts` (add `SavedOrder` interface after the `Order` interface, ~line 320)

**Interfaces:**
- Consumes: existing `CartItem` type (`src/data/types.ts:227`).
- Produces: `interface SavedOrder { id: string; restaurantId: string; restaurantName: string; name: string; items: CartItem[]; createdAt: string }` — consumed by Tasks 2–6.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/086_saved_orders.sql`:

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

- [ ] **Step 2: Validate the migration SQL locally**

Per the "Local SQL validation" memory, run the project's local Postgres shim to apply the migration against a scratch DB and confirm it parses/applies. If that tooling is unavailable in this environment, at minimum verify the file matches the `021_favorites.sql` structure byte-for-byte on the RLS policy shape. Expected: applies with no error; `saved_orders` table + `saved_orders_owner_all` policy exist.

- [ ] **Step 3: Add the `SavedOrder` type**

In `apps/customer/src/data/types.ts`, immediately after the closing brace of the `Order` interface, add:

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

- [ ] **Step 4: Typecheck**

Run: `cd apps/customer && npx tsc --noEmit`
Expected: PASS (no new errors; the type is not yet referenced).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/086_saved_orders.sql apps/customer/src/data/types.ts
git commit -m "feat(saved-orders): add saved_orders table + SavedOrder type"
```

---

### Task 2: `savedOrders` mock repository + cap logic + test

**Files:**
- Create: `apps/customer/src/data/repositories/savedOrders.ts`
- Create: `apps/customer/src/data/repositories/savedOrders.test.ts`

**Interfaces:**
- Consumes: `SavedOrder`, `CartItem` from Task 1.
- Produces: `savedOrdersRepo` with:
  - `list(): Promise<SavedOrder[]>` — newest first
  - `save(input: { restaurantId: string; restaurantName: string; name: string; items: CartItem[] }): Promise<SavedOrder>` — throws `SavedOrdersCapError` if the user already has `SAVED_ORDERS_CAP` (5)
  - `remove(id: string): Promise<void>`
  - exported const `SAVED_ORDERS_CAP = 5`
  - exported class `SavedOrdersCapError extends Error`

- [ ] **Step 1: Write the failing test**

Create `apps/customer/src/data/repositories/savedOrders.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { savedOrdersRepo, SAVED_ORDERS_CAP, SavedOrdersCapError, __resetSavedOrders } from './savedOrders';
import type { CartItem } from '../types';

const line: CartItem = {
  lineId: 'l1',
  itemId: 'i1',
  restaurantId: 'r1',
  name: 'Koshari',
  basePriceEgp: 40,
  image: '',
  quantity: 1,
  modifierChoices: [],
};

const input = (name: string) => ({
  restaurantId: 'r1',
  restaurantName: 'Koshari Al Tahrir',
  name,
  items: [line],
});

describe('savedOrders mock repo', () => {
  beforeEach(() => __resetSavedOrders());

  it('saves and lists newest-first', async () => {
    await savedOrdersRepo.save(input('First'));
    await savedOrdersRepo.save(input('Second'));
    const list = await savedOrdersRepo.list();
    expect(list.map((s) => s.name)).toEqual(['Second', 'First']);
  });

  it('rejects the 6th save with SavedOrdersCapError', async () => {
    for (let i = 0; i < SAVED_ORDERS_CAP; i += 1) {
      await savedOrdersRepo.save(input(`n${i}`));
    }
    await expect(savedOrdersRepo.save(input('overflow'))).rejects.toBeInstanceOf(SavedOrdersCapError);
  });

  it('remove frees a slot', async () => {
    for (let i = 0; i < SAVED_ORDERS_CAP; i += 1) {
      await savedOrdersRepo.save(input(`n${i}`));
    }
    const list = await savedOrdersRepo.list();
    await savedOrdersRepo.remove(list[0].id);
    await expect(savedOrdersRepo.save(input('now-fits'))).resolves.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/customer && npx vitest run src/data/repositories/savedOrders.test.ts`
Expected: FAIL — module `./savedOrders` does not exist.

- [ ] **Step 3: Write the mock repository**

Create `apps/customer/src/data/repositories/savedOrders.ts`:

```ts
import type { CartItem, SavedOrder } from '../types';

export const SAVED_ORDERS_CAP = 5;

export class SavedOrdersCapError extends Error {
  constructor() {
    super(`Cannot save more than ${SAVED_ORDERS_CAP} orders`);
    this.name = 'SavedOrdersCapError';
  }
}

const delay = <T>(value: T, ms = 40): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

// Mutable in-memory store so saves stick during a mock session, mirroring the
// live adapter's contract. Reset between tests via __resetSavedOrders.
let saved: SavedOrder[] = [];

let seq = 0;
function makeId(): string {
  seq += 1;
  return `so-mock-${seq}`;
}

export interface SaveSavedOrderInput {
  restaurantId: string;
  restaurantName: string;
  name: string;
  items: CartItem[];
}

export const savedOrdersRepo = {
  /** Newest first. */
  async list(): Promise<SavedOrder[]> {
    return delay([...saved].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  },

  async save(input: SaveSavedOrderInput): Promise<SavedOrder> {
    if (saved.length >= SAVED_ORDERS_CAP) throw new SavedOrdersCapError();
    // Monotonic timestamp so newest-first ordering is stable even for saves in
    // the same millisecond (test saves two in a row).
    const createdAt = new Date(Date.now() + seq).toISOString();
    const record: SavedOrder = {
      id: makeId(),
      restaurantId: input.restaurantId,
      restaurantName: input.restaurantName,
      name: input.name,
      items: input.items,
      createdAt,
    };
    saved = [record, ...saved];
    return delay(record);
  },

  async remove(id: string): Promise<void> {
    saved = saved.filter((s) => s.id !== id);
    return delay(undefined);
  },
};

/** Test-only: clear the in-memory store. */
export function __resetSavedOrders(): void {
  saved = [];
  seq = 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/customer && npx vitest run src/data/repositories/savedOrders.test.ts`
Expected: PASS (3 passing).

- [ ] **Step 5: Commit**

```bash
git add apps/customer/src/data/repositories/savedOrders.ts apps/customer/src/data/repositories/savedOrders.test.ts
git commit -m "feat(saved-orders): mock repository with 5-item cap"
```

---

### Task 3: `savedOrders` Supabase adapter + wire into `db`

**Files:**
- Create: `apps/customer/src/data/supabase/savedOrders.ts`
- Modify: `apps/customer/src/data/index.ts` (add imports + both branches of `db`)

**Interfaces:**
- Consumes: `SaveSavedOrderInput`, `SAVED_ORDERS_CAP`, `SavedOrdersCapError` from Task 2; `getSupabase` from the existing supabase client module (same import the sibling `supabase/user.ts` uses).
- Produces: `savedOrdersRepoSupabase` with the same shape as `savedOrdersRepo`; `db.savedOrders` available app-wide.

- [ ] **Step 1: Write the Supabase adapter**

The sibling repos import the client as `import { getSupabase } from './client';` (verified in `src/data/supabase/user.ts`). Use that exact path.

Create `apps/customer/src/data/supabase/savedOrders.ts`:

```ts
import { getSupabase } from './client';
import { SAVED_ORDERS_CAP, SavedOrdersCapError } from '../repositories/savedOrders';
import type { SaveSavedOrderInput } from '../repositories/savedOrders';
import type { CartItem, SavedOrder } from '../types';

interface SavedOrderRow {
  id: string;
  restaurant_id: string;
  name: string;
  items: CartItem[];
  created_at: string;
}

function rowToSavedOrder(row: SavedOrderRow, restaurantName: string): SavedOrder {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    restaurantName,
    name: row.name,
    items: row.items,
    createdAt: row.created_at,
  };
}

export const savedOrdersRepoSupabase = {
  /** Owner-scoped by RLS. Newest first. Restaurant name is denormalized from the join. */
  async list(): Promise<SavedOrder[]> {
    const { data, error } = await getSupabase()
      .from('saved_orders')
      .select('id, restaurant_id, name, items, created_at, restaurants(name)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((r: SavedOrderRow & { restaurants: { name: string } | null }) =>
      rowToSavedOrder(r, r.restaurants?.name ?? ''),
    );
  },

  async save(input: SaveSavedOrderInput): Promise<SavedOrder> {
    const sb = getSupabase();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    // App-side cap. A concurrent double-save could momentarily exceed 5; that is
    // acceptable (no correctness/security impact) and the UI gates the common case.
    const { count, error: countErr } = await sb
      .from('saved_orders')
      .select('id', { count: 'exact', head: true });
    if (countErr) throw countErr;
    if ((count ?? 0) >= SAVED_ORDERS_CAP) throw new SavedOrdersCapError();

    const { data, error } = await sb
      .from('saved_orders')
      .insert({
        user_id: user.id,
        restaurant_id: input.restaurantId,
        name: input.name,
        items: input.items,
      })
      .select('id, restaurant_id, name, items, created_at')
      .single();
    if (error) throw error;
    return rowToSavedOrder(data as SavedOrderRow, input.restaurantName);
  },

  async remove(id: string): Promise<void> {
    const { error } = await getSupabase().from('saved_orders').delete().eq('id', id);
    if (error) throw error;
  },
};
```

- [ ] **Step 2: Wire into the `db` entry point**

In `apps/customer/src/data/index.ts`:

Add to the repositories import block:
```ts
import { savedOrdersRepo } from './repositories/savedOrders';
```
Add to the supabase import block:
```ts
import { savedOrdersRepoSupabase } from './supabase/savedOrders';
```
Add `savedOrders: savedOrdersRepoSupabase,` to the `useSupabase ? { ... }` branch and `savedOrders: savedOrdersRepo,` to the `: { ... }` branch (place each alongside `user:` for readability).

- [ ] **Step 3: Typecheck**

Run: `cd apps/customer && npx tsc --noEmit`
Expected: PASS. If the `getSupabase` import path was wrong, tsc will error on it — fix to match the sibling file.

- [ ] **Step 4: Commit**

```bash
git add apps/customer/src/data/supabase/savedOrders.ts apps/customer/src/data/index.ts
git commit -m "feat(saved-orders): supabase adapter + wire into db"
```

---

### Task 4: i18n keys (5 locales)

**Files:**
- Modify: `apps/customer/src/i18n/locales/en.json`, `ar.json`, `ru.json`, `de.json`, `it.json`

**Interfaces:**
- Produces: i18n keys `order.saveOrderTitle`, `order.saveOrderCta`, `order.saveOrderCapMsg`, `order.saveOrderDefaultName`, `home.savedForYou`, `savedOrder.remove`, `savedOrder.removeConfirm` — consumed by Tasks 5–6.

- [ ] **Step 1: Add keys to `en.json`**

Add these flat keys (place `order.*` near existing `order.` keys, `home.savedForYou` near `home.reorder`, `savedOrder.*` anywhere consistent):

```json
"order.saveOrderTitle": "Save this order?",
"order.saveOrderCta": "Save order",
"order.saveOrderDefaultName": "My {restaurant} order",
"order.saveOrderCapMsg": "You've saved 5 orders. Remove one from Home to save this.",
"home.savedForYou": "Saved for you",
"savedOrder.remove": "Remove",
"savedOrder.removeConfirm": "Remove this saved order?"
```

- [ ] **Step 2: Add translated keys to the other four locales**

`ar.json`:
```json
"order.saveOrderTitle": "حفظ هذا الطلب؟",
"order.saveOrderCta": "حفظ الطلب",
"order.saveOrderDefaultName": "طلبي من {restaurant}",
"order.saveOrderCapMsg": "لقد حفظت 5 طلبات. احذف واحداً من الصفحة الرئيسية لحفظ هذا.",
"home.savedForYou": "محفوظ لك",
"savedOrder.remove": "إزالة",
"savedOrder.removeConfirm": "إزالة هذا الطلب المحفوظ؟"
```

`ru.json`:
```json
"order.saveOrderTitle": "Сохранить этот заказ?",
"order.saveOrderCta": "Сохранить заказ",
"order.saveOrderDefaultName": "Мой заказ из {restaurant}",
"order.saveOrderCapMsg": "Вы сохранили 5 заказов. Удалите один на главной, чтобы сохранить этот.",
"home.savedForYou": "Сохранённое для вас",
"savedOrder.remove": "Удалить",
"savedOrder.removeConfirm": "Удалить этот сохранённый заказ?"
```

`de.json`:
```json
"order.saveOrderTitle": "Diese Bestellung speichern?",
"order.saveOrderCta": "Bestellung speichern",
"order.saveOrderDefaultName": "Meine {restaurant}-Bestellung",
"order.saveOrderCapMsg": "Du hast 5 Bestellungen gespeichert. Entferne eine auf der Startseite, um diese zu speichern.",
"home.savedForYou": "Für dich gespeichert",
"savedOrder.remove": "Entfernen",
"savedOrder.removeConfirm": "Diese gespeicherte Bestellung entfernen?"
```

`it.json`:
```json
"order.saveOrderTitle": "Salvare questo ordine?",
"order.saveOrderCta": "Salva ordine",
"order.saveOrderDefaultName": "Il mio ordine da {restaurant}",
"order.saveOrderCapMsg": "Hai salvato 5 ordini. Rimuovine uno dalla Home per salvare questo.",
"home.savedForYou": "Salvati per te",
"savedOrder.remove": "Rimuovi",
"savedOrder.removeConfirm": "Rimuovere questo ordine salvato?"
```

- [ ] **Step 3: Verify JSON validity + key parity across locales**

Run:
```bash
cd apps/customer && node -e "
const ks = ['order.saveOrderTitle','order.saveOrderCta','order.saveOrderDefaultName','order.saveOrderCapMsg','home.savedForYou','savedOrder.remove','savedOrder.removeConfirm'];
for (const l of ['en','ar','ru','de','it']) {
  const j = require('./src/i18n/locales/'+l+'.json');
  const missing = ks.filter(k => !(k in j));
  if (missing.length) { console.error(l, 'MISSING', missing); process.exit(1); }
}
console.log('all locales OK');
"
```
Expected: `all locales OK` (also confirms every file is valid JSON — `require` throws on a parse error).

- [ ] **Step 4: Commit**

```bash
git add apps/customer/src/i18n/locales/*.json
git commit -m "feat(saved-orders): i18n keys across 5 locales"
```

---

### Task 5: "Save this order?" card on the delivered tracking screen

**Files:**
- Modify: `apps/customer/app/order/[id].tsx`

**Interfaces:**
- Consumes: `db.savedOrders.save`, `SAVED_ORDERS_CAP`/`SavedOrdersCapError` (imported from `../../src/data/repositories/savedOrders`), the stale-modifier guard predicate, i18n keys from Task 4, `success`/`tap` haptics, `track` analytics.
- Produces: no exports; a self-contained `<SaveOrderCard>` rendered when `order.status === 'delivered'`.

- [ ] **Step 1: Add the unresolvable-modifier predicate**

At the top of `app/order/[id].tsx` (module scope, below imports), add — matching the guard in `orders.tsx`:

```ts
function hasUnresolvableMods(items: { modifierChoices?: { optionId?: string }[] }[]): boolean {
  return items.some((it) => (it.modifierChoices ?? []).some((c) => !c.optionId));
}
```

Add imports near the existing data import:
```ts
import { db } from '../../src/data';
import { SavedOrdersCapError } from '../../src/data/repositories/savedOrders';
```
(`db` is already imported — only add the `SavedOrdersCapError` line.)

- [ ] **Step 2: Add local state for the save card**

Inside `OrderTracking`, alongside the other `useState` hooks:

```ts
const [saveName, setSaveName] = useState('');
const [saveDone, setSaveDone] = useState(false);
const [saveDismissed, setSaveDismissed] = useState(false);
const [saving, setSaving] = useState(false);
```

Pre-fill the name once the order loads and is delivered (add after the existing order-load effect):

```ts
useEffect(() => {
  if (order?.status === 'delivered' && !saveName) {
    setSaveName(t('order.saveOrderDefaultName', { restaurant: order.restaurantName }));
  }
}, [order?.status, order?.restaurantName]);
```

- [ ] **Step 3: Render the card (only when delivered, resolvable, not dismissed/done)**

In the JSX, after the status-steps block and before the contact card (pick a stable insertion point inside the main `ScrollView`), add:

```tsx
{order.status === 'delivered' &&
  !saveDone &&
  !saveDismissed &&
  !hasUnresolvableMods(order.items) && (
    <View style={styles.saveCard}>
      <View style={styles.saveHeadRow}>
        <Text style={styles.saveTitle}>{t('order.saveOrderTitle')}</Text>
        <Pressable
          onPress={() => {
            tap();
            setSaveDismissed(true);
          }}
          hitSlop={12}
          accessibilityLabel={t('common.cancel')}>
          <Text style={styles.saveClose}>✕</Text>
        </Pressable>
      </View>
      <TextInput
        value={saveName}
        onChangeText={setSaveName}
        style={styles.saveInput}
        placeholder={t('order.saveOrderTitle')}
        maxLength={40}
        accessibilityLabel={t('order.saveOrderTitle')}
      />
      <Pressable
        disabled={saving || saveName.trim().length === 0}
        onPress={async () => {
          setSaving(true);
          try {
            await db.savedOrders.save({
              restaurantId: order.restaurantId,
              restaurantName: order.restaurantName,
              name: saveName.trim(),
              items: order.items,
            });
            success();
            track('saved_order_created', { restaurantId: order.restaurantId });
            setSaveDone(true);
          } catch (e) {
            if (e instanceof SavedOrdersCapError) {
              Alert.alert(t('order.saveOrderTitle'), t('order.saveOrderCapMsg'));
            } else {
              Alert.alert(t('order.saveOrderTitle'), t('common.retry'));
            }
          } finally {
            setSaving(false);
          }
        }}
        style={[styles.saveBtn, (saving || saveName.trim().length === 0) && { opacity: 0.5 }]}>
        <Text style={styles.saveBtnText}>{t('order.saveOrderCta')}</Text>
      </Pressable>
    </View>
  )}
```

Add `TextInput` to the `react-native` import at the top of the file. Add these styles to the `StyleSheet.create({...})` block:

```ts
saveCard: {
  backgroundColor: colors.white,
  borderWidth: 1,
  borderColor: colors.line,
  borderRadius: radius.xl,
  padding: 14,
  marginHorizontal: 16,
  marginTop: 12,
  ...shadow.soft,
},
saveHeadRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
saveTitle: { fontSize: font.sizes.xl, fontWeight: font.weights.bold, color: colors.ink },
saveClose: { fontSize: 16, color: colors.ink3 },
saveInput: {
  borderWidth: 1,
  borderColor: colors.line,
  borderRadius: radius.md,
  paddingHorizontal: 12,
  paddingVertical: 10,
  marginTop: 10,
  fontSize: font.sizes.lg,
  color: colors.ink,
},
saveBtn: {
  marginTop: 10,
  backgroundColor: colors.sea,
  borderRadius: radius.pill,
  paddingVertical: 12,
  alignItems: 'center',
},
saveBtnText: { color: colors.white, fontSize: font.sizes.lg, fontWeight: font.weights.bold },
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/customer && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Manual smoke (mock backend)**

Run: `cd apps/customer && npx expo start` (mock backend is the default). Navigate to an order, force it to `delivered` (mock orders advance automatically, or open a past order), confirm the card appears with the pre-filled name, Save closes the card, and re-entering the screen does not re-show it for that session after save.
Expected: card renders and behaves; no crash.

- [ ] **Step 6: Commit**

```bash
git add apps/customer/app/order/[id].tsx
git commit -m "feat(saved-orders): save-this-order card on delivered tracking screen"
```

---

### Task 6: "Saved for you" Home rail + remove affordance

**Files:**
- Modify: `apps/customer/app/(tabs)/home.tsx`

**Interfaces:**
- Consumes: `db.savedOrders.list`/`db.savedOrders.remove`, `useCart().loadFromOrder`, the stale-modifier guard, i18n keys from Task 4.
- Produces: no exports; a "Saved for you" rail above the existing Reorder rail.

- [ ] **Step 1: Load saved orders + add cart/guard imports**

In `home.tsx`, add imports:
```ts
import { useCart } from '../../src/store/cart';
import type { SavedOrder } from '../../src/data/types';
```
Add the same predicate used elsewhere (module scope):
```ts
function hasUnresolvableMods(items: { modifierChoices?: { optionId?: string }[] }[]): boolean {
  return items.some((it) => (it.modifierChoices ?? []).some((c) => !c.optionId));
}
```
Inside `HomeTab`, add state + loader (place near the `reorderRail` effect ~line 124):
```ts
const [savedOrders, setSavedOrders] = useState<SavedOrder[]>([]);
const loadFromOrder = useCart((s) => s.loadFromOrder);

useEffect(() => {
  db.savedOrders.list().then(setSavedOrders).catch(() => setSavedOrders([]));
}, []);
```

- [ ] **Step 2: Handlers — load and remove**

Inside `HomeTab`:
```ts
const openSaved = (s: SavedOrder) => {
  tap();
  if (hasUnresolvableMods(s.items)) {
    router.push(`/restaurant/${s.restaurantId}` as never);
    return;
  }
  loadFromOrder({ restaurantId: s.restaurantId, restaurantName: s.restaurantName, lines: s.items });
  router.push('/(tabs)/cart');
};

const removeSaved = (s: SavedOrder) => {
  Alert.alert(t('savedOrder.removeConfirm'), '', [
    { text: t('common.cancel'), style: 'cancel' },
    {
      text: t('savedOrder.remove'),
      style: 'destructive',
      onPress: () => {
        db.savedOrders.remove(s.id).then(() => setSavedOrders((prev) => prev.filter((x) => x.id !== s.id)));
      },
    },
  ]);
};
```
Add `Alert` to the `react-native` import.

- [ ] **Step 3: Render the rail above the Reorder rail**

Immediately BEFORE the `{reorderRail.length > 0 && (` block (~line 292), insert:

```tsx
{savedOrders.length > 0 && (
  <View style={{ paddingHorizontal: 20, marginTop: 14 }}>
    <View style={[styles.secHead, dir.row]}>
      <Text style={styles.secTitle}>{t('home.savedForYou')}</Text>
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingTop: 10 }}>
      {savedOrders.map((s) => (
        <Pressable
          key={s.id}
          onPress={() => openSaved(s)}
          onLongPress={() => removeSaved(s)}
          accessibilityRole="button"
          accessibilityLabel={s.name}
          style={styles.savedCard}>
          <Text style={styles.savedName} numberOfLines={1}>{s.name}</Text>
          <Text style={styles.savedSub} numberOfLines={1}>{s.restaurantName}</Text>
          <Text style={styles.savedMeta}>{t('orders.itemsCount', { n: s.items.length })}</Text>
        </Pressable>
      ))}
    </ScrollView>
  </View>
)}
```

Add styles to the `StyleSheet.create` block (reuse existing `secHead`/`secTitle`):
```ts
savedCard: {
  width: 168,
  backgroundColor: colors.white,
  borderWidth: 1,
  borderColor: colors.line,
  borderRadius: radius.lg,
  padding: 12,
  ...shadow.soft,
},
savedName: { fontSize: font.sizes.lg, fontWeight: font.weights.bold, color: colors.ink },
savedSub: { fontSize: font.sizes.sm, color: colors.ink2, marginTop: 4 },
savedMeta: { fontSize: font.sizes.sm, color: colors.ink3, marginTop: 6 },
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/customer && npx tsc --noEmit`
Expected: PASS. (`secHead`, `secTitle`, and `orders.itemsCount` are pre-existing in `home.tsx` / `en.json` — verified — so reusing them needs no new definitions.)

- [ ] **Step 5: Manual smoke (mock backend)**

Run: `cd apps/customer && npx expo start`. Save an order via Task 5's card, return to Home, confirm the "Saved for you" rail appears above "Order again", tapping a card loads the cart and routes to the Cart tab, and long-press prompts removal.
Expected: rail renders and behaves; no crash.

- [ ] **Step 6: Commit**

```bash
git add apps/customer/app/(tabs)/home.tsx
git commit -m "feat(saved-orders): Saved for you Home rail with load + remove"
```

---

### Task 7: Full test + typecheck sweep

**Files:** none (verification only).

> **Note on the spec's RLS test:** the customer app's Vitest setup has no live-Postgres harness, so the owner-only RLS policy is verified at the migration layer (Task 1 Step 2 — the policy is byte-identical to `favorites`' proven `saved_orders_owner_all` shape) rather than by an app-level integration test. The runtime cap and stale-modifier behaviors ARE unit-tested (Task 2). If/when the repo gains a Supabase integration-test harness, add a cross-user read/insert/delete denial test then.

- [ ] **Step 1: Run the customer test suite**

Run: `cd apps/customer && npx vitest run`
Expected: PASS, including the new `savedOrders.test.ts` and the existing `cart.test.ts`.

- [ ] **Step 2: Typecheck the whole app**

Run: `cd apps/customer && npx tsc --noEmit`
Expected: PASS with no errors.

- [ ] **Step 3: Confirm no direct repo imports leaked into screens**

Run: `cd apps/customer && grep -rn "repositories/savedOrders\|supabase/savedOrders" app/`
Expected: only `app/order/[id].tsx` importing `SavedOrdersCapError` from `repositories/savedOrders` (the sole allowed exception — an error class, not data access). No screen imports the repo's data methods directly; all data access is via `db.savedOrders`.

- [ ] **Step 4: Final commit (if any lint/format fixups)**

```bash
git add -A
git commit -m "chore(saved-orders): test + typecheck sweep" || echo "nothing to commit"
```

---

## Post-implementation (owner-gated, not part of this plan's commits)

- Apply migration `086` to production via the Supabase MCP `apply_migration` (owner action).
- Regenerate DB types if the project tracks generated Supabase types.
- Saved Orders is app-side UI + one table — it ships in the next EAS build, not via an OTA-only change. Note it in release notes.
