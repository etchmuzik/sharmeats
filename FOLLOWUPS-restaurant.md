# FOLLOWUPS — `apps/restaurant/`

Scope: `apps/restaurant/` only. `npx tsc --noEmit` exits 0; `npx vitest run` = 10 files / 93 tests passing (was 7 / 65).

---

## What I fixed

### P1 — kitchen alerting was client-side, best-effort and silent about its own failures

- `src/push.ts:60` — `registerForPush()` now returns a `PushAlertStatus` instead of early-returning `void` on a denied permission. A denial was previously indistinguishable from success.
- `src/push.ts:45` — new `currentPushAlertStatus()` reads the permission **without** prompting, for the foreground re-check.
- `src/push.ts:63` — new `openNotificationSettings()` (`Linking.openSettings`) so a denial can actually be undone.
- `src/push.ts:118` — the `catch` no longer swallows; it reports to Sentry and returns `'unknown'`.
- `src/alerting.ts` (new) — pure rules: `PushAlertStatus`, self-expiring mute (`muteUntilFrom` / `isMuteActive` / `muteMinutesRemaining`), `alertingIsDegraded`, `formatWait`, `oldestWaitSeconds`. Fully unit-tested (`src/alerting.test.ts`).
- `app/home.tsx:86` — **mute is now a bounded 30-minute window, not a permanent flag.** New storage key `chime:mutedUntil` (deliberately new, so a stale `'1'` from the old `chime:muted` key cannot be misread as a timestamp). It re-arms itself and toasts "New-order sound is back on."
- `app/home.tsx:294` — foreground `AppState` listener re-reads the permission, so the warning clears itself when someone fixes it in Settings.
- `src/components/AlertBanners.tsx` (new) — `AlertingStatusBanner` states, in words, every way the tablet is currently *not* alerting: notifications denied (with an **Open settings** action), sound muted (with minutes remaining + an unmute action), Realtime feed down. `'unknown'`/`'unsupported'` deliberately stay quiet so the banner is never noise.
- `src/components/AlertBanners.tsx` — `UnacknowledgedAlert`: a pinned, pulsing, tappable red bar showing the count of unaccepted orders and the oldest wait. **Depends on no OS permission, no push pipeline, no audio route** — this is the alert of last resort. Tapping clears the brand filter and scrolls to the ticket.
- `src/orders.ts:334` — `subscribeOrders` / `subscribeOrdersMulti` now report channel liveness (`CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED`). Multi reports the *weakest* link. `app/home.tsx:281` polls every 20 s while the feed is down and shows the banner.
- `app/home.tsx:255` — the resync `.catch(() => {})` now reports to Sentry.

### P2 — busy mode (mig 186) had zero callers

- `src/busyMode.ts` (new) — presets (10/20/30 min, all inside the RPC's 5..60 bound), a 60-minute duration (inside 15..240), `isBusyActive`, `busyMinutesRemaining`, `summarizeBusy` (collapses across brands, reporting the **largest** live bump so the header never understates). Tested in `src/busyMode.test.ts`, including assertions that the presets stay inside mig 186's bounds.
- `src/orders.ts:427` — `setBusyMode(restaurantId, extraMinutes, durationMinutes)` calls the RPC. No client-side validation: the RPC is the authority, and a refusal is surfaced, not swallowed.
- `src/orders.ts:105,196,231` — `KitchenBrand` carries `busyUntil` / `busyExtraMinutes`; `getMyKitchen` selects them off the `restaurants` embed. (SELECT is ungated on `restaurants`; only UPDATE is column-restricted, and there is no client UPDATE grant on these columns — as intended.)
- `src/capabilities.ts:74` — `canSetBusyAll` **aliases** `canToggleOpenAll` rather than restating it: `set_busy_mode` gates on `is_merchant_manager()` exactly as `restaurants.is_open` does. A test asserts they are the same function so the two cannot drift.
- `src/components/BusyControl.tsx` (new) — presets + "Back to normal" + an explanation of the self-expiry. Below manager it renders as a read-only chip, matching the open/closed control's rule (a visible-but-dead button would tell a kitchen it had extended its prep time when it had not).
- `app/home.tsx:519` — `applyBusyMode` writes every brand with `Promise.allSettled` (never `all`), names the brands that did not change on partial failure, and always resyncs from the server afterwards.

### P2 — abandoned orders never left the queue (238 h in "ready")

- `src/orders.ts:265` — `ACTIVE_ORDER_WINDOW_HOURS = 24`, `ACTIVE_ORDER_LIMIT = 200`, `activeOrderSince()`. The fetch is now `.gte('placed_at', …)` + `.limit(…)`.
- `src/orders.ts:296` — the fetch is ordered **newest-first and reversed client-side**. With the cap on an oldest-first fetch, the rows dropped would have been the ones that just arrived — the cap would have hidden new orders under a backlog.
- `src/orders.ts:452` — `isWithinQueueWindow()`, applied in the Realtime handler (`app/home.tsx:302`), so an UPDATE on a long-dead order cannot resurrect it. Fails *toward visible* on an unparseable timestamp.

### P2 — five hardcoded-English screens, English default, no locale sync

- `src/i18n.ts` — ~110 new keys, English + Arabic (this app ships 2 locales, not the customer app's 5). `i18n.test.ts` already enforces key parity, and it passes.
- `src/i18n.ts:379` — `localeFromLanguageTag()` + `deviceLocale()` using `Intl.DateTimeFormat().resolvedOptions().locale`. `expo-localization` is not a dependency of this app and I may not run `npm install`; Hermes ships full ICU, so Intl is the dependency-free route. Wrapped in try/catch with an English fail-safe.
- `src/locale.tsx:46` — the provider now **starts from the device** and only overrides from storage when an explicit past choice exists (`stored === null` is no longer coerced to `'en'`).
- `src/locale.tsx:107` — new `useSafeLocale()` that degrades to English instead of throwing, for code that can render above the provider.
- `src/profile.ts` (new) + `app/home.tsx:317` — **locale sync**: writes `users.locale` whenever the tablet's locale changes. Push copy is rendered server-side from that column, which defaults to `'ar'` (mig 002) — that mismatch is exactly the "English UI, Arabic push" defect. `users.locale` is one of the self-service columns mig 053 grants back to `authenticated` on the owner's own row, so no RPC is needed.
- Screens routed through i18n: `app/signin.tsx`, `app/index.tsx`, `app/kyc.tsx`, `app/tier.tsx`, `app/order/[id]/chat.tsx`, plus `src/components/ScreenErrorBoundary.tsx`. All gained `direction` on their root container. Email/password fields are pinned LTR on purpose (credentials are Latin-script in every locale).
- `src/kyc.ts:16` — `RESTAURANT_DOC_TYPES` now carries a `labelKey`, not English text. The `doc_type` strings are unchanged — they are a protocol value shared with admin-web.

### P3 — multi-brand filter was unusable

- `src/brandFilter.ts` (new) + `app/home.tsx:326` — `nextBrandFilterReset` fires **once per ticket** rather than once per render. A ticket the operator has already been shown no longer re-locks the filter to "All"; a genuinely new one still does. Six cases covered in `src/brandFilter.test.ts`, including the exact stateless-bounce regression.

### Also checked / fixed

- **Screen error boundaries** — only the root layout exported one, so any throw anywhere unmounted the whole stack including the queue. `ErrorBoundary` is now also exported from `app/home.tsx`, `app/menu.tsx`, `app/kyc.tsx`, `app/tier.tsx`, `app/order/[id].tsx`, `app/order/[id]/chat.tsx` (verified expo-router wraps per-route exports: `node_modules/expo-router/build/useScreens.js:141`). The boundary itself no longer throws a second error when it mounts above the locale provider.
- **Realtime teardown** — reviewed, already correct: per-subscriber channel names plus `removeChannel` on unsubscribe. No change needed.
- **Reconnect resync** — already present (matching the `onResync`-on-`SUBSCRIBED` pattern the other surfaces use); I added the liveness half and the polling fallback.
- **Swallowed errors** — `app/kyc.tsx:44` ("empty is fine" rendered an unreachable backend as "you have uploaded nothing", inviting a merchant with approved documents to re-upload), `app/order/[id]/chat.tsx` load/send, `app/signin.tsx` submit: all now report to Sentry and show translated copy.
- `formatWait` moved from `OrderRow` into `src/alerting.ts` so the ticket and the banner cannot disagree about a customer's wait.
- `UnacknowledgedAlert`'s pulse is cancelled when the count hits 0 (a repeating worklet on a never-unplugged tablet is a battery leak).

---

## Deliberately NOT fixed

- **Decline flow after the 180 s auto-accept window** — out of scope by instruction; needs a product decision.
- **Self-delivery completion path** — same.
- **Pause / close-all-brands and auto-accept ignoring `restaurants.is_open`** — SERVER-side (`auto_accept_sweep`), belongs to the SQL agent. **There is no client half to fix**: `app/home.tsx` already writes every brand with `allSettled` and names the ones that did not flip. The client-visible symptom will be that a kitchen presses "pause all", every brand flips to closed on screen and in the DB, and orders keep arriving anyway because the sweep never reads `is_open`. Nothing in this app can detect that; the fix has to be in SQL.
- **Paymob / card payments** — untouched. (`isVisible()` still hides unpaid card orders from the queue, unchanged.)
- **`staffRoleLabel()` in `src/capabilities.ts` is dead code** — `KitchenHeader` uses `t('role.*')` instead. It is still hardcoded English and still tested. Deleting it means touching a test file that encodes the mig-136 security contract, so I left it; a follow-up should remove both.
- **`tier.tsx`'s `benefitValue` uses `textAlign: 'right'`** (physical, not logical) so it stays right-aligned under RTL. Cosmetic; RN has no `'end'` value for `textAlign`.
- **The unacknowledged banner's wait timer ticks every 15 s, not every 1 s.** Deliberate: a per-second tick on this screen re-renders the whole `SectionList`. The ticket's own timer is still per-second.
- **`getActiveOrders` still `.catch`es into a generic `loadError`** in `load()`; distinguishing "no restaurant" from "network" is already handled, but the *reason* is not reported to Sentry there. Small, left alone to keep the diff focused.

---

## Things the audit did not mention that I found

1. **The 200-row cap direction was a latent trap.** Adding `.limit()` to the existing `ascending: true` query would have silently dropped the *newest* orders on a busy night — the exact failure the surface exists to prevent. Fixed by fetching descending and reversing.
2. **Realtime would have defeated the age bound.** An UPDATE on an abandoned order re-adds it to the list regardless of the fetch's `gte`. Needed `isWithinQueueWindow` in the handler too.
3. **`ScreenErrorBoundary` would have crashed a second time** once it started calling `useLocale()`, because expo-router can mount it above the provider that threw. Hence `useSafeLocale()`.
4. **Changing the mute key was necessary, not cosmetic.** The old value was the literal string `'1'`; `new Date('1')` parses in some engines. A fresh key removes the ambiguity entirely.
5. **`users.locale` defaults to `'ar'`** (mig 002 / 007 / 124). Every restaurant staffer created without a `locale` meta hint has been receiving Arabic push notifications since launch, regardless of what their tablet shows. The sync fixes it going forward but **existing rows are stale** — worth a one-off backfill decision by whoever owns ops.
6. **`app/menu.tsx` was already fully i18n'd** — the "five hardcoded screens" are signin / index / kyc / tier / chat (plus the error boundary), not menu.
