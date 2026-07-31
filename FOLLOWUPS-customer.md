# FOLLOWUPS — `apps/customer`

Branch `fix/audit-round-2`. `npx tsc --noEmit` exits 0; `npx vitest run` is 56 files / 603 tests green
(was 52 / 565 — 38 new tests).

---

## Fixed

### P1 — duplicate COD orders (idempotency key was per-MOUNT, not per-basket)
- `apps/customer/src/lib/checkoutIdempotency.ts` (new) — key is derived from a cart fingerprint
  (restaurant + item + options + qty + notes + allergens; price deliberately excluded) and persisted
  to AsyncStorage, so it survives remounts, backgrounding and process kills.
- `apps/customer/app/checkout.tsx:72-93` — replaced the `useRef` mint with a fingerprint-keyed load.
- `apps/customer/app/checkout.tsx:411-416` — key is retired ONLY on the path that reaches tracking.
  A throw from the read-back or the payment hand-off keeps it, so the retry deduplicates onto the
  order that already exists. (It was originally cleared right after `create()`; that would have
  re-opened the duplicate window for card orders whose hand-off failed.)
- `apps/customer/src/lib/checkoutIdempotency.test.ts` (new, 12 tests).

### P1 — dead "Place order" button
- `apps/customer/app/checkout.tsx:1005-1020` — `!restaurant` and `!idempotencyKey` were conditions
  `place()` silently returned on but the button's `disabled` did not include. Both added.
- `apps/customer/app/checkout.tsx:923-935` — a failed restaurant fetch now renders a tappable
  "couldn't load this restaurant, tap to retry" line instead of nothing.

### P1 — auth gate discarded its error, and the allergy profile never reached the kitchen
- `apps/customer/src/data/supabase/orders.ts:60-75` — `sb.auth.getUser()`'s error was discarded, so a
  flaky network was indistinguishable from "signed out" and produced the untranslated English string
  `"Not authenticated"`. Now: `AuthSessionMissingError`/401 → `error.authRequired`; anything else →
  new `error.authUnavailable`. Both translated in five locales.
- **Food safety.** `apps/customer/src/lib/allergenBriefing.ts` (new) +
  `apps/customer/src/data/supabase/orders.ts:84` — `place_order` has **no allergen parameter**
  (latest signature: mig 153/162, 12 args, none of them allergens), and mig 037 revoked every
  column-level UPDATE on `orders` except the three rating columns. So `orders.aggregate_allergens`
  was **null on every live order**, `apps/restaurant/src/components/AllergenBanner.tsx` never
  rendered, and the customer was told on the checkout briefing card that the kitchen had been
  briefed when it had not. Until the column can be written server-side (see below), the aggregated
  allergen list rides in `p_kitchen_notes` — a field the restaurant app and merchant-web both
  display. Emitted as stable keys (`ALLERGIES: nuts, shellfish`), idempotent on retry.
- `apps/customer/src/lib/allergenBriefing.test.ts` (new, 6 tests).

### P2 — `users.locale` / `preferred_currency` were never written
- `apps/customer/src/lib/profilePrefs.ts` (new) — best-effort mirror of session language + currency
  onto the profile row.
- Wired at the three moments the answer changes: `app/otp.tsx:66` (sign-in completes),
  `app/settings.tsx:158,192` (language + currency switchers), `app/onboarding.tsx:163`
  (first-launch language), `app/checkout.tsx:709` (currency switcher).

### P2 — raw backend error text shown to customers
- `apps/customer/src/lib/authErrors.ts` (new) — classifies a backend auth failure into an i18n KEY;
  never returns backend wording. Adds rate-limit (`error.otpTooMany`) and transport
  (`error.network`) cases, which are materially better advice than "try again".
- `app/signin.tsx:47` and `app/otp.tsx:75,93` — stopped rendering `e.message`. This is what leaked
  *"enable a Phone provider in Supabase → Authentication → Providers → Phone"* to customers.
  Raw text still reaches Sentry via `captureError`.
- `src/data/supabase/orders.ts:456-462` — `mapPlaceOrderError`'s fallback no longer returns the raw
  Postgres/PostgREST message; the original is preserved on `.cause` for Sentry.
- `src/data/supabase/orders.ts:100,104` — two more untranslated developer strings replaced.
- `apps/customer/src/lib/authErrors.test.ts` (new, 6 tests).

### P2 — loyalty/credit redemption misreported every failure
- `app/(tabs)/rewards.tsx:40-63` — `redeemErrorKey()` maps `INSUFFICIENT_POINTS` /
  `INSUFFICIENT_CREDIT` / `AUTH_REQUIRED` / transport failures to distinct translated strings.
  Everything used to say "not enough points", including a lost response — the exact case where the
  balance HAS been spent.
- `app/(tabs)/rewards.tsx:92-99,110-114` — both handlers now reload status/history/balance after a
  failure, so the customer sees the true balance rather than a stale one next to a "it failed"
  dialog, and a transport failure says "check your history before trying again".
- Client-side idempotency is **not possible** here — see "Needs a migration" below.

### P2 — checkout had no error handling on its three prerequisite fetches
- `app/checkout.tsx:185-260` — address / payment-method / restaurant fetches now distinguish
  `loading` / `failed` / genuinely empty, each with a tap-to-retry (`loadNonce`). A customer who HAS
  a saved address is no longer shown the "Add an address" CTA because the fetch flaked.

### P2 — hardcoded 12-hour English AM/PM clock times
- `apps/customer/src/lib/format.ts:29-88` — `formatTimeIn(locale, date)` + `formatTime(date)`, the
  latter reading the live session locale exactly as `i18n.t()` does, so all 13 existing call sites
  (tracking ETA, SLA promise line, scheduled slots, order history, celebration sheet, active-order
  banner) became locale-correct with no call-site changes. Region-pinned tags (`ar-EG`, `de-DE`, …),
  wrapped in try/catch with the old English clock as the fallback for a Hermes build without ICU.

### P3 — Hermes-unsafe date parsing on Realtime messages
- `src/data/supabase/mappers.ts:51` — exported the existing `tsToMs` helper.
- `src/data/supabase/messages.ts:20-27` and `src/data/supabase/support.ts:15-27` — both mappers used
  bare `new Date()`, which returns NaN on Hermes for the WAL timestamp form Realtime delivers
  (`2026-06-27 23:36:59+00`). Live messages got NaN sort keys and landed out of order.

### P3 — `checkout.payCard` missing from every locale
- Added to all five locale files, plus 8 other new keys. Removed the four
  `t(key) !== 'key' ? t(key) : "hardcoded English"` fallback hacks in `checkout.tsx` that were
  hiding exactly this class of bug.
- `apps/customer/src/i18n/localeParity.test.ts` (new, 13 tests) — asserts the five files carry
  identical key sets, no blank values, and identical `{placeholder}` sets. `lookup()` falls back to
  the raw key, so a missing key is invisible to tsc and to the build; this is the cheap guard.

### P3 — cart sync could resurrect a bought basket
- `src/store/cart.ts:108-120, 293-301, 352-370` — `clearEverywhere` cancelled the debounce timer but
  could do nothing about a write already in flight, whose upsert then landed after `clear_my_cart`.
  Added a `syncEpoch`; a write that completes across a clear retires its own row instead of
  recording a version.
- `src/store/cart.test.ts:246-282` — new test; verified it FAILS with the epoch check disabled.

### P2 — RTL on the order-tracking screen
- `app/order/[id].tsx` — the whole screen had no direction handling. Added `useDirection()` and
  mirrored all 19 row layouts plus the text blocks: ETA row + trailing column alignment, SLA line,
  timeline steps (including the absolutely-positioned connector, whose `left` moved out of the
  stylesheet to the call site), cancelled card, save-preset card, kitchen-briefing rows, hotel
  handoff (incl. `alignSelf`), share card + button, rider card / name / meta / action buttons, order
  summary lines + fee + total + payment sub-line, restaurant contact address + all three action
  buttons, the LIVE badge and the map back button (both absolute, both now pinned to the reading
  edge).

---

## NOT fixed — deliberate

### Needs a migration (out of my scope: `apps/customer/` only)
1. **`place_order` should take `p_allergens allergy_key_type[]` and write
   `orders.aggregate_allergens`.** My kitchen-note stop-gap gets the words in front of a human, but
   the restaurant app's `AllergenBanner` — the loud red one — keys off the column and will stay dark
   until this lands. House rule 1 applies: this is a NEW argument list, so the current 12-arg
   signature must be dropped explicitly, not `create or replace`d. Start from mig 153's body (or
   whatever 202/203 leave behind — check before writing). Once it exists, delete
   `src/lib/allergenBriefing.ts` and pass the array directly.
2. **`redeem_points` / `redeem_credit` need an idempotency key.** Both are
   `SECURITY DEFINER`, both `select … for update`, decrement the balance and `insert into
   promo_codes` in one transaction, and neither takes a dedup token (migs 120/122/197). A lost
   response therefore burns the balance with no way for the client to find out whether it landed —
   nothing client-side can fix that, which is why I only improved the reporting. Concretely:
   add `p_idempotency_key uuid default null`, a unique partial index on
   `(user_id, idempotency_key) where idempotency_key is not null` over the ledger, and return the
   EXISTING promo code when the key repeats. Same drop-then-create discipline.
3. `orders.aggregate_allergens` is nulled by both anonymisation paths (migs 022/112) — fine, but
   worth re-checking after (1) lands.

### Paymob / card (owner-deferred, per instructions)
- `src/data/supabase/orders.ts:startCardPayment` still throws the raw supabase/edge-function error,
  which `checkout.tsx`'s catch renders verbatim. Same class of bug as the sign-in leak, but it is on
  the card path, so I left it. Card is dark in prod (`EXPO_PUBLIC_PAYMENTS_CARD_ENABLED=false`).
- `checkout.payCard` was added to the locale files as instructed — that is a string, not card logic.

### RTL — the rest of the app (this is the largest remaining item)
I fixed the worst offender. **20 files still have no `useDirection`**, ranked roughly by how much a
customer looks at them:

| File | row layouts |
|---|---|
| `app/item/[id].tsx` | 7 |
| `app/restaurant/[id].tsx` | 7 |
| `src/components/ModifierGroup.tsx` | 7 |
| `app/(tabs)/cart.tsx` | 6 |
| `app/address/add.tsx` | 4 |
| `app/invite.tsx` | 4 |
| `app/settings.tsx` | 4 |
| `src/components/RestaurantCard.tsx` | 4 |
| `app/address/picker.tsx` | 3 |
| `app/help.tsx` | 3 |
| `app/saved.tsx` | 3 |
| `app/(tabs)/orders.tsx` | 2 |
| `app/order/[id]/review.tsx` | 2 |
| `src/components/CheckoutStepper.tsx` | 2 |
| `src/components/KitchenBriefing.tsx` | 2 |
| `src/components/TabBar.tsx` | 2 |
| `app/otp.tsx`, `app/settings/allergies.tsx`, `src/components/AllergyChipRow.tsx`, `src/components/QuantityStepper.tsx`, `src/components/RxBadge.tsx`, `src/components/ScreenErrorBoundary.tsx`, `src/components/SkeletonRestaurantCard.tsx`, `src/components/TouristSafeBadge.tsx`, `src/components/OwnBrandBadge.tsx` | 1 each |

Highest value per line: `RestaurantCard`, `ModifierGroup`, `QuantityStepper`, `TabBar` and
`CheckoutStepper` are shared components — fixing those five mirrors large parts of home, browse,
saved, cart and the item sheet at once. Recommend doing that batch first, then `item/[id]`,
`restaurant/[id]` and `(tabs)/cart` (the browse→cart spine), then the rest.

### Not attempted
- `formatTimeIn` has no unit test: `src/lib/format.ts` imports the session store, which reaches
  `react-native`, which Vitest cannot parse. Splitting the pure half into its own module for one
  test did not seem worth the file. Node's ICU also differs from Hermes', so such a test would
  assert the wrong engine.
- `redeemErrorKey` (in `app/(tabs)/rewards.tsx`) is untested for the same reason — screens import
  `react-native`.

---

## Found, not in the audit

1. **`checkout.tsx` used `t(key) !== 'key' ? t(key) : "English"` in four places.** That idiom is what
   let `checkout.payCard` be missing from all five locales without anyone noticing — it converts a
   missing translation into working English. All four removed; `localeParity.test.ts` now catches
   the underlying problem instead.
2. **`quoteState === 'failed'` retry is a `Pressable` with no `accessibilityRole`/label** and it
   retries by cloning the address object (`setAddress((a) => ({...a}))`). It works, but it is a
   different retry mechanism from the `loadNonce` one I added three lines above it. Worth unifying;
   I left it alone to keep the delivery-fee logic untouched.
3. **`app/(tabs)/rewards.tsx` `state.kind === 'error'` renders only the screen title** — no message,
   no retry button. Not in scope for this pass but it is a dead end for the customer.
4. **`src/data/supabase/rewards.ts` throws `new Error('Redeem failed')`** — untranslated. It is now
   caught and re-mapped by `redeemErrorKey`, so it never reaches a customer, but it should carry a
   code rather than prose.
5. **`app/otp.tsx` hardcodes `phoneDisplay = params.phone ?? '+20 100 123 4567'`** — a fake fallback
   number. If the param is ever lost, the app sends an OTP to a stranger's phone. Small, real, and
   one line to fix, but it is an auth-flow change I did not want to make blind.
