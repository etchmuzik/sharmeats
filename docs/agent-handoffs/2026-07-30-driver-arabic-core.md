# Driver Arabic core handoff — 2026-07-30

Branch: `codex/driver-arabic-core`

Base: `b14433695bf7af74af22fb23bdf36cc0750dd284`

## What changed

- Added a typed English/Arabic dictionary and interpolation/direction helpers in
  `apps/driver/src/i18n.ts`.
- Added a root language provider that persists the choice in AsyncStorage under
  `sharmeats.driver.locale`. Storage failures fail soft and never block a shift.
- Added an obvious 44pt language switch on sign-in and the signed-in home
  identity row.
- Localized the core driver path:
  - sign-in and the backend-configuration gate;
  - home online/offline state, earnings, active delivery, offers, empty/error
    states, navigation links, legal links, avatar feedback and sign-out;
  - active-job timeline, navigation/contact actions, hotel/drop-off
    instructions, order checks, COD/card copy, tip copy, location disclosures,
    countdowns and completion actions;
  - native stack titles for the core and adjacent driver routes.
- Arabic layouts use one mirroring mechanism: local Yoga `direction: 'rtl'`
  with ordinary `flexDirection: 'row'`. No row is manually reversed, avoiding
  the RTL + `row-reverse` double-reversal. Text alignment and writing direction
  remain explicit. This intentionally does **not** call
  `I18nManager.forceRTL` or require an app restart.
- Known sign-in, online/offline, offer, job-status, location and avatar-upload
  failures map to localized recovery copy. Raw exceptions are sent to the
  existing crash diagnostics with safe operation/order/assignment context and
  are not the primary Arabic toast or inline error.
- Android's required persistent location notification reads the same locale key
  directly from AsyncStorage before the foreground task starts, so it is safe
  when React is not mounted.
- Arabic native titles are centered where native-stack supports alignment while
  keeping native title/back gestures intact.
- Order IDs, restaurant/customer data, amounts, statuses, RPC arguments,
  location streaming, notification registration and status transitions were
  not changed.

## Tests added

`apps/driver/src/i18n.test.ts` covers:

- supported persisted locale validation;
- typed English/Arabic lookup;
- placeholder interpolation while preserving an order code;
- explicit LTR/RTL direction contracts.
- known operational error classification and raw-message suppression;
- background-safe Android notification copy with invalid-locale fallback.

## Verification

Run from `apps/driver`:

```text
npm run typecheck
# tsc --noEmit — passed

npm test
# 6 files passed, 44 tests passed

git diff --check
# passed

git show --check
# passed
```

No dependency, schema, migration, Supabase, edge-function, EAS or production
change is included. The worktree used the existing driver `node_modules` only
for local verification; that symlink is not part of the commit.

## Integration notes

- Cherry-pick this branch as one isolated commit after checking for concurrent
  edits to the driver core screens.
- The scope is intentionally EN/AR for the high-frequency shift flow. History,
  tier, KYC and chat bodies retain their existing English content; only their
  native titles are translated. Add their copy to the same typed dictionary in
  a later package rather than introducing a second localization mechanism.
- Device acceptance should verify language persistence after a cold launch,
  mixed Arabic/Latin restaurant names, the order-code display, both LTR and RTL
  offer actions, localized failure states, the COD confirmation alert, and the
  Android foreground-service notification.

## Explicit native residuals

- Native-stack does not expose a safe right-aligned iOS title or a
  per-screen mirrored native back affordance without changing global RTL state.
  Arabic titles are centered where supported, but the native back control and
  iOS large-title placement remain platform-native. This is intentional:
  force-mirroring them would require `I18nManager.forceRTL` and an app restart,
  which is too risky during a driver shift.
- The Android foreground notification takes the persisted language when the
  location stream starts. Changing language during an already-running stream
  updates the notification the next time the stream starts; the active stream
  is not restarted merely to replace notification text.
