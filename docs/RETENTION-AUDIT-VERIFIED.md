# Retention & launch-readiness audit — verification results

Two audits were handed over on 2026-07-27 (retention layer, then launch
readiness). Every checkable claim was verified before any work was planned:
repo claims by parallel read-only agents citing file:line, and
database/edge-function claims against **deployed production state** (the repo
is not the source of truth for function bodies — house rule 2).

Verdicts below are evidence-backed. Two claims were REFUTED and three were
narrowed; everything else confirmed. Two defects were found that neither
audit reported.

## Retention layer

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| R1 | Notification switches are fake UI | **CONFIRMED** | `apps/customer/app/settings.tsx:101-111` — they are static `<View>`s, not `Switch`es; no handler, no persisted field in `src/store/session.ts:32-53` |
| R2 | Campaign delivery is broken (empty `orderId` rejected) | **CONFIRMED (prod)** | Deployed `send_push_campaign` posts `'orderId', ''`; deployed `expo-push` v13 `index.ts` rejects falsy `orderId` with 400. Campaign row is inserted **before** the fire-and-forget `net.http_post`, so it records "sent" regardless |
| R3 | No preference/consent/quiet-hours/frequency-cap tables | **CONFIRMED (prod)** | Only push tables in prod are `push_tokens`, `push_campaigns` |
| R4 | No notification inbox/history in the app | **CONFIRMED** | No such route in `apps/customer/app/` (28 files); pushes are unrecoverable once dismissed |
| R5 | No receipt polling / delivery log / retry queue | **CONFIRMED**, with nuance | `expo-push` **does** parse Expo *tickets* and prunes `DeviceNotRegistered` tokens (`index.ts:183-206`), but never polls *receipts* (ticket `id` declared at `:56`, never stored), and the `sent` counter is returned in a body no caller reads |
| R6 | Permission requested at startup with no primer | **CONFIRMED** | `app/_layout.tsx:40` calls `registerForPush()` on mount; `src/lib/push.ts:54` requests the OS dialog. A contextual call exists at `app/otp.tsx:58` but never wins the race |
| R7 | Favourites are restaurant-only | **CONFIRMED** | `migrations/021_favorites.sql:7-12` — PK `(user_id, restaurant_id)`, no item concept anywhere |
| R8 | Guest favourites replaced, not merged | **CONFIRMED** | `src/lib/favorites.ts:32-40` → `session.ts:138-141` unconditional `set({ favoriteIds: ids })`. Bites on returning-account sign-in and after any failed best-effort mirror write |
| R9 | No favourite-event triggers (offer/back-in-stock/reopened) | **CONFIRMED** | No such trigger in any migration |
| R10 | Cart is device-only; abandoned-cart reminders impossible | **CONFIRMED** | No server-side cart table exists |
| R11 | "Recommended" is global rating sort | **CONFIRMED** | No personalization signals stored |
| R12 | Analytics blind in production | **CONFIRMED** | `apps/customer/eas.json:19-30` has `EXPO_PUBLIC_SENTRY_DSN`, no PostHog key; `src/lib/analytics.ts:76` `if (!posthog) return;`. **15 call sites across 13 of 14 event types are wired and collecting nothing** — this is a one-env-var fix, not a build |
| R13 | Segmentation is only all/lapsed/never_ordered/zone | **CONFIRMED (prod)** | Deployed RPC validates exactly those four |
| R14 | Campaigns lack scheduling/drafts/test-send/approval/i18n/AB/suppression/attribution | **CONFIRMED** | Entire UI is `apps/admin-web/src/app/campaigns/page.tsx`; campaign copy explicitly bypasses the locale map (`expo-push/index.ts:131`) |
| R15 | Transactional pushes work in 5 languages with tap routing | **PARTIAL** (audit called it fully working) | Senders and locale parity are real (`copy.test.ts:63`), but see D2 below |

### Defects found during verification (in neither audit)

- **D1 — the admin campaign success metric cannot report failure.**
  `push_campaigns.recipients` is written **before** the send from the segment
  size, and the admin UI renders it as "{n} sent"
  (`apps/admin-web/src/app/campaigns/page.tsx:243`). Combined with R2, the
  operator sees a confident success number for a campaign that delivered
  nothing. Fix alongside R2 — a delivery fix without a truthful counter just
  hides the next failure.
- **D2 — two transactional pushes deep-link to the wrong screen.**
  Because `expo-push` requires a non-empty `orderId`, senders stuff other ids
  into that field: `credit_issued` sends `coalesce(p_order_id, p_user_id)`
  (mig 101:65), so an order-less credit navigates to `/order/{userId}` — a
  nonexistent order — while the copy promises the wallet. `referral_rewarded`
  (mig 038:209) routes to the *referred friend's* order, which the recipient
  does not own. `routeForNotification` (`src/lib/push.ts:82-90`) has only
  three branches and the payload contract (`index.ts:68`) carries nothing
  richer. The right fix is a `route`/`target` field in the payload — the same
  contract change R2 needs, so do them together.

## Launch readiness

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| L1 | Apps are on Expo SDK 52 with high/critical advisories | **REFUTED** | All three are on **SDK 57.0.8**; `npm audit --omit=dev` reports **0 critical / 0 high / 0 moderate** on customer, driver and restaurant. The claim traced to our own stale `CLAUDE.md`, now corrected |
| L2 | `apps/restaurant` lacks `.env.example` | **CONFIRMED → FIXED** | Created from the four `EXPO_PUBLIC_*` vars the app actually reads |
| L3 | Stale docs (mock data, obsolete migration counts) | **CONFIRMED, partly fixed** | `CLAUDE.md` SDK line fixed; `OPS-RUNBOOK.md:50` still says "currently 084" (actual: 135) |
| L4 | Compromised-password protection is off | **CONFIRMED (prod)** | Security advisor `auth_leaked_password_protection`. Dashboard toggle — owner action |
| L5 | Backup exists but no restore rehearsal | **CONFIRMED** | Verified dump taken 2026-07-27; restoring it into a scratch project is genuinely still unproven |
| L6 | E2E prod order lifecycle unproven | **CONFIRMED** | Prod has 23 orders, 9 `order_financials`, 7 settlements all `draft` — no settlement has ever been finalized or paid |
| L7 | Monitoring never deliberately triggered | **CONFIRMED** | Telegram ops webhook is configured, but no alert path has been fired on purpose end-to-end |

Everything else in the launch list (store-status audit, support details,
device testing, release artifacts, card reconciliation, vertical readiness,
deck economics) is **owner-gated or genuinely unbuilt** — accepted as stated,
no verification needed.

## Recommended build order

Sequenced by "what is actively lying to a user or an operator" first, since
those are cheap and dangerous, then by what unlocks measurement.

1. **Analytics env var** (minutes) — R12. Everything downstream is unmeasurable
   without it, and the code is already written.
2. **Campaign delivery + honest counter + payload `route` field** (R2, D1, D2
   together — one contract change, one migration, one function deploy).
3. **Notification preferences + consent**, with the settings UI made real and
   `send_push_campaign` filtering on it (R1, R3) — required before any
   volume of marketing push, and legally load-bearing.
4. **Guest-favourite merge** (R8) — small, and it silently loses user data today.
5. **Menu-item favourites + Saved screen** (R7).
6. **Server cart snapshots → abandoned-cart reminders** (R10), then reorder
   cadence reminders, then favourite-event triggers (R9).
7. **Explainable recommendations** from orders/favourites/cuisine (R11).

Deliberately *not* in this list until asked: notification inbox (R4) and
receipt polling (R5) — both are real gaps, but neither changes pilot outcomes
at 23 lifetime orders.
