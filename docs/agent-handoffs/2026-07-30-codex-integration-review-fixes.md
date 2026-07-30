# Codex handoff — restaurant-readiness integration fixes

Date: 2026-07-30

Branch: `codex/restaurant-readiness-stack`

Base reviewed: `195c6cc`

## Why this follow-up exists

A read-only review of the combined customer, driver and restaurant quick wins
found four seams that did not exist inside any one feature branch:

1. `dropoff_note` was rendered only when a separate preference existed, so a
   cash-change request could be stored but invisible to the driver.
2. The customer wrote an English sentence after the driver gained Arabic.
3. The localized restaurant core still displayed raw Supabase diagnostics.
4. A delayed restaurant-locale read could overwrite an immediate user choice.

## Cross-app cash-change contract

- Customer writes an end-anchored versioned marker:
  `[[sharmeats:cash-change:v1:tender=600;change=28]]`.
- The marker follows the customer note on its own generated line.
- Driver parses only valid v1 markers, removes only that marker and its one
  separator, and preserves the authored note exactly.
- Unsupported or malformed markers remain visible. A newer writer therefore
  fails visibly on an older reader instead of silently losing an instruction.
- Driver renders the exact tender/change amounts with typed EN/AR copy.
- A free-text note or valid cash marker renders even with a null/unknown
  drop-off preference.
- No database, RPC or migration changed; the transport remains the existing
  snapshotted `orders.dropoff_note`.

Deploy the customer writer and driver reader together. An older driver build
will display the marker literally, so the customer writer should not be
released ahead of the reader.

## Restaurant safety follow-up

- Order update, multi-brand open/pause, menu load/update, order-detail load and
  logo upload failures now send raw diagnostics to the existing crash reporter
  with safe operation identifiers.
- Operators see typed client-owned EN/AR recovery copy, never raw table, policy
  or RPC messages.
- Logo permission, success, failure and accessibility labels are localized.
- Locale hydration now ignores a stale storage read after a user selects a
  language in the current session.

The previously documented English-only sign-in, KYC, tier and chat-body scope
remains unchanged.

## Verification

From each app directory:

- Customer: typecheck passed; 48 files / 496 tests passed.
- Driver: typecheck passed; 7 files / 50 tests passed.
- Restaurant: typecheck passed; 6 files / 50 tests passed.
- Repository `git diff --check`: passed.

No Claude main, merchant, Package 07 governance, migration or deployment state
was changed.
