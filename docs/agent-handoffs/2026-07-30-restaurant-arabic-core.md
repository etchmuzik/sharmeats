# Restaurant Arabic operational core — 2026-07-30

## Isolation

- Branch: `codex/restaurant-arabic-core`
- Worktree: `/Users/etch/Downloads/sharmeats-agent-restaurant-i18n`
- Base: `b144336`
- Scope: `apps/restaurant` only, plus this handoff note
- Database/migrations: none

Cherry-pick the single commit reported with this note. Do not merge the worktree
or copy `node_modules`.

## What changed

- Added a typed English/Arabic operational dictionary in
  `apps/restaurant/src/i18n.ts`. English defines the key union; Arabic must
  implement every key at compile time.
- Added `LocaleProvider` with app-local `AsyncStorage` persistence under
  `restaurant:locale` and an immediate EN/AR toggle.
- Added the language control to `KitchenHeader`, where it remains reachable on
  every live-queue shift.
- Localized the high-frequency operational path:
  - Home queue sections, empty/error states and primary status actions.
  - Open/pause, sound, menu/docs/tier and multi-brand header controls.
  - Ticket timing, payment, fulfillment, address labels, rejection and
    acceptance actions.
  - Menu search, availability, out-of-stock counts and switch labels.
  - Order detail sections, order/payment statuses, allergy and prescription
    warnings, delivery and customer-contact actions.
  - Native route titles for menu, verification, tier, order and chat.
- Applied immediate RTL direction to operational screen/container layouts.
  Arabic letter spacing and uppercase transforms are disabled.
- A locale selected before the initial AsyncStorage read completes now wins;
  delayed hydration cannot switch the operator back to a stale preference.
- Core order/menu/open-state failures and logo upload feedback use typed safe
  EN/AR recovery copy. Raw Supabase diagnostics are sent to crash reporting
  with operation identifiers and are not shown in the kitchen UI.
- Kept order codes, money values, brand tags and other technical identifiers
  LTR so they are not visually reordered. Restaurant names, menu item names,
  notes and address data remain server/customer content and are not translated.
- Added pure tests for locale completeness, interpolation, direction,
  normalization and EN/AR switching.

## Deliberate exclusions

- Sign-in, KYC/legal body copy, tier body copy and chat message-composer body
  copy remain English. The route titles are localized, but translating those
  lower-frequency/legal surfaces should be a separate reviewed pass.
- The provider does **not** call `I18nManager.forceRTL()`. Native forced RTL
  requires an app reload, which is unsafe during an active kitchen ticket.
  Operational content changes direction immediately; native header/back chrome
  can remain in the platform direction until a future controlled-reload design.
- No machine translation of restaurant/menu/customer content was added.
- No migrations, RPC changes, backend writes or other app surfaces were touched.

## Verification

Run from `apps/restaurant`:

```text
npm run typecheck
  PASS

npm test
  PASS — 6 files, 50 tests

npx expo export --platform web --output-dir /tmp/sharmeats-restaurant-i18n-web
  PASS — Metro bundled 1,894 modules

git diff --check
  PASS
```

## Review notes / remaining risk

- Arabic operational wording should receive one native-speaker kitchen review,
  especially the pause/open and reject/accept verbs, before store release.
- Test a narrow Android phone and the target counter tablet with realistic long
  restaurant names. Arabic strings are wider than English and the header uses
  wrapped 48dp controls.
- Verify TalkBack order in Arabic. Accessibility labels are translated, but
  screen-reader focus order depends on the final Android Yoga/native layout.
- If full native header mirroring is later required, design a safe
  save-preference → prompt → controlled-restart flow; do not add a surprise
  reload to the live queue.
