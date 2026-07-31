# Driver app (`apps/driver/`) — audit round 2

Verified: `npx tsc --noEmit` exits 0, `npx vitest run` → 9 files / 90 tests passing.
All changes are JS-only and shippable via `eas update` (no new native module, no
`app.json` plugin change).

## Fixed

### P1 — the missing idle heartbeat
- `src/location.ts:29` `IDLE_HEARTBEAT_INTERVAL_MS = 90_000` — inside mig 201's 300s
  window (two failures survivable), above driver_ping's 15s server throttle (mig 032).
- `src/location.ts:219` `startIdleHeartbeat()` / `:231` `stopIdleHeartbeat()` — plain JS
  interval; each tick early-returns if `isStreaming()`, so it never double-pings during
  a delivery, and pings with an EMPTY status so it can't stamp over `on_job`.
- `app/home.tsx:143` effect starts it on `online`, stops on offline/unmount;
  `app/home.tsx:259` also stops it explicitly on sign-out.
- `src/backgroundLocationTask.ts:32` `onStreamTerminated()` + `src/location.ts:64`
  listener — without this, a self-terminating stream (below) would leave `isStreaming()`
  stuck true and the heartbeat skipping every tick forever.

### P1 — toggleOnline wrote the DB and reverted only the UI
- `app/home.tsx:190` `reconcileOnline()` — re-asserts the intended value, then lets a
  fresh `getMyDriver()` read settle the disagreement; falls back to the intended value
  only if the read also fails.
- `app/home.tsx:246` every failure path in `toggleOnline` now calls it.
- `app/home.tsx:132` app-foreground now calls `load()` unconditionally (it used to only
  reload while streaming), which re-reads `drivers.status` and reconciles the switch.

### P1 — going online never verified location worked
- `src/location.ts:176` `pingOnce()` now returns `PingResult` (`ok` /
  `permission_denied` / `unavailable`) and never throws; it previously swallowed a
  denied permission, a missing fix AND an RPC error.
- `app/home.tsx:225` going online pings FIRST; a non-`ok` result aborts, reverts, calls
  `reconcileOnline(false)` so the row can't say online, and toasts a translated reason.
- `src/components/OnlineToggle.tsx:20` new `warning` prop — amber card, amber heading,
  the reason in place of "Receiving delivery offers".
- `app/home.tsx:412` `receivingOffers = online && locationBlock === null` drives the
  offers heading, empty-state icon/title/body and a11y label, so nothing claims work is
  coming when it can't.
- Also re-checked on app-foreground (`app/home.tsx:125`) and on every heartbeat tick, so
  a permission revoked from Settings mid-shift surfaces within ~90s.

### P1 — the job screen never refreshed
- `src/jobs.ts:335` `subscribeJob()` — postgres_changes on `orders` filtered to the one
  id, refetching on every UPDATE **and** on `SUBSCRIBED`; same drop-stale-channel +
  reconnect-resync shape as `subscribeOffers` and `messages.subscribe`.
- `app/job/[id].tsx:78` subscribes; `:69` adds a `useFocusEffect` refetch (returning from
  chat/maps), matching home.tsx.
- Cancellation is toasted once (ref-guarded so a reconnect doesn't repeat it) — new key
  `job.cancelledUnderYou`.

### P1 — background location never self-terminated
- `src/backgroundLocationTask.ts:88` `terminateStream()` — clears the stored order id and
  calls `stopLocationUpdatesAsync`, then notifies the foreground module.
- `:106` `orderStillLive()` — fails toward KEEPING the stream (a read `error` is a dead
  zone), stops only on a definite terminal status or an unreadable row.
- `:118` the task now terminates when: no stored order id, no session (signed out), or
  the order is no longer live. The liveness query rides the ~25s authoritative-ping
  cadence, so it costs one query per ping, not one per GPS sample.

### P1 — offers with NULL `offer_expires_at`
- `src/offerUrgency.ts:46` `hasUsableExpiry()` (+ tests).
- `src/components/OfferCard.tsx:145` a null/unparseable expiry now renders as
  amber "Needs refresh" with Accept DEAD and an explanatory line; Decline stays live so
  the driver can clear it. Previously: no countdown, no auto-dismiss, Accept enabled
  forever.
- `src/jobs.ts:180` `isOfferLive()` + `getOffers` now embeds `orders(status)` and filters
  terminal orders out at the data layer, so no consumer (list, Realtime resync, push
  refresh) can ever present an offer on a cancelled order. Fails closed when the order
  status is unreadable.
- This is the client half of what mig 203 (another agent's scope) fixed server-side;
  the two agree — null expiry fails closed in both.

### P2 — the localized error classifier never fired
- `src/i18n.ts:508` `errorDiagnostic()` now folds `_`/`-` to spaces. Every server
  sentinel is SCREAMING_SNAKE_CASE (`ILLEGAL_TRANSITION`, `NOT_YOUR_ASSIGNMENT`,
  `ALREADY_RESPONDED`, `AUTH_REQUIRED`), while the patterns were prose — so effectively
  no branch ever matched.
- Pattern lists extended with the sentinels the migrations actually raise, including
  mig 203's new `OFFER_EXPIRED` / `ORDER_NOT_AVAILABLE`; `AUTH_REQUIRED` now maps to
  "session expired"; `ORDER_NOT_FOUND` to `job.notFound`; `DRIVER_NOT_ELIGIBLE` to a new
  `home.notEligible` (it is not transient — telling the driver to "try again" is wrong).
- Covered by a new test listing the real sentinels.

### P2 — offer countdown trusted the device clock
- `src/supabase.ts:24` a `global.fetch` wrapper records the `Date` response header off
  traffic the app already makes (zero extra requests) and exposes `serverNow()`.
  Accuracy ~1–2s (header resolution + response leg); the failure it replaces is an
  unbounded skew.
- `src/components/OfferCard.tsx:83` `useCountdown` measures against `serverNow()`.

### P2 — four screens bypassed i18n; app never read the device locale
- `src/deviceLocale.ts` (new) — reads `Intl` first, falls back to `SettingsManager`
  (iOS) / `I18nManager.localeIdentifier` (Android). Deliberately NOT expo-localization:
  that is a native module and this had to ship OTA. `src/i18n.ts:429`
  `matchSupportedLocale()` maps `ar-EG`/`ar_EG` → `ar` (+ tests).
- `src/i18n-context.tsx:41` seeds the initial locale from the device; a stored choice
  still wins. `src/location.ts:118` the Android foreground-service notification falls
  back to the device locale too.
- `app/tier.tsx`, `app/kyc.tsx`, `app/history.tsx`, `app/job/[id]/chat.tsx` fully routed
  through `useI18n` (+ RTL `direction`/`textAlign`), with ~45 new keys added to BOTH `en`
  and `ar` in `src/i18n.ts`. `src/kyc.ts:15` `DRIVER_DOC_TYPES` now carries a
  `labelKey` instead of English text. Dates/times in history and chat format in the app
  locale rather than the device's.

### P3 — Android offers channel
- `src/push.ts:57` `ensureOffersChannel()` now runs BEFORE the permission gate (channel
  creation needs no permission) and exports `OFFERS_CHANNEL_ID`, adds `enableVibrate` and
  PUBLIC lockscreen visibility. Previously the MAX channel was only created after a
  granted prompt, so a driver who deferred the prompt had no channel when the first push
  arrived.

### P3 — tier.tsx / Sentry identity
- `app/tier.tsx:41` error state + retry (an `my_driver_tier` failure used to leave a
  permanent spinner with no way out but a force-quit); `captureError` on failure.
- `src/auth.tsx:22` calls `identifyDriver()` / `resetCrashUser()` on session change.
  Both functions existed and had never been called, so every driver crash was anonymous.
- `app/history.tsx:26` also now reports its load failure to Sentry instead of swallowing.

## NOT fixed — needs another scope or a decision

### Driver GPS on a public Realtime channel — SERVER HALF REQUIRED (SQL/edge scope)
The client half is done: the stream now self-terminates on a terminal/unreadable order
and on sign-out, so we no longer broadcast after a delivery ends. The payload
(`{lat,lng,heading,at}`, `src/locationCore.ts:47`) carries no driver identity, so there
is nothing identifying left to strip.

**The remaining hole is server-side and I could not close it unilaterally**, because the
channel name is shared with `apps/customer/src/data/supabase/orders.ts:326`
(`subscribeDriverLocation`) — renaming or privatising it from one side alone breaks live
tracking for every customer. Required change, for whoever owns Realtime/SQL:

1. Enable Realtime Authorization on the project (Realtime settings → private channels).
2. Add RLS policies on `realtime.messages` for `topic like 'order:%:driver_loc'`:
   - **SELECT** (receive): allow when `auth.uid()` is the order's `customer_id`, its
     `assigned_driver_id`'s profile, restaurant staff for that order, or a
     dispatcher/admin. Derive the order id from
     `split_part(realtime.topic(), ':', 2)::uuid`.
   - **INSERT** (send): allow ONLY the order's currently-assigned driver. This is the
     one that matters — today anyone with the anon key and an order UUID can inject a
     fake driver position into a customer's tracking map.
   - Both must fail closed on a null/absent order (`coalesce`, house rule 4).
3. Then, in the SAME release, flip `config: { private: true }` on both channel
   constructions: `apps/driver/src/backgroundLocationTask.ts:47` and
   `apps/customer/src/data/supabase/orders.ts:331`. Shipping either side alone breaks
   tracking, so this needs a coordinated deploy (or a feature flag read at subscribe
   time).

### Android push `channelId` on the send side (edge/SQL scope)
The client channel is now correct, but FCM routes by the `channelId` in the message
payload. The `expo-push` edge function must send, for Android offer pushes:
`channelId: 'offers'`, `priority: 'high'`, and `_displayInForeground: true`. Without it
the message lands on the app's default channel (DEFAULT importance, Doze-deferrable) and
the MAX channel is bypassed entirely — which is the actual reported symptom.

Separately, setting `com.google.firebase.messaging.default_notification_channel_id` in
the Android manifest would make the fallback safe too, but that is a config-plugin
change and needs a full EAS build, so it is out of the OTA-only scope of this pass.

### Failed-delivery flow — NOT built (product decision)
There is no way for a driver to record "customer did not answer / refused / wrong
address". Today the only exits from `out_for_delivery` are `delivered` or an ops
cancellation. Building it properly needs decisions nobody has made: how long the driver
waits, who pays the delivery fee, what happens to COD cash already collected, whether
the food is returned or discarded, and what the customer is told. It also needs a new
status (or a `delivery_outcome` column) in `advance_order_status`'s state machine —
server scope. Deliberately left undone rather than half-built.

## Things the audit did not mention

1. **`getActiveJob` can strand a driver on `on_job`** (`src/jobs.ts:373`): it scans only
   the newest 20 accepted assignments. Fine today, but if a driver accumulates accepted
   assignments faster than they terminate, an older still-active order becomes
   invisible in the app while `drivers.status` stays `on_job`. Mig 203's terminal-order
   guard reduces the exposure; worth a bounded query on `orders` instead.
2. **`DeliveryCountdown` (`src/components/DeliveryCountdown.tsx:51`) still uses
   `Date.now()`** against `orders.eta_at`. Same device-clock class of bug as the offer
   countdown, now that `serverNow()` exists it is a one-line change — left out only
   because it was outside the listed findings and the consequence (a wrong "deliver by"
   figure) is far milder than a mis-expired offer.
3. **`kyc.ts:38-40` throws raw English** (`'Upload a JPEG, PNG, or WebP image'`,
   `'Choose an image smaller than 5 MB'`) and `app/kyc.tsx` surfaces `e.message`
   verbatim in an Alert, so those three validation messages are still untranslated even
   after the i18n pass. They are data-layer invariants rather than UI strings; routing
   them through i18n means giving them error codes, which felt like a separate change.
4. **`unregisterPush` (`src/push.ts:118`) deletes by token only**
   (`.delete().eq('token', token)`) with no `user_id` guard — it relies entirely on RLS
   to scope the delete. Worth confirming `push_tokens`'s DELETE policy is owner-scoped;
   if it is not, any signed-in driver can unregister another driver's device by token.
5. **`configureNotificationHandler` sets both `shouldShowAlert` and `shouldShowBanner`**
   (`src/push.ts:37`); `shouldShowAlert` is deprecated in SDK 53+. Harmless, but it will
   start warning.
