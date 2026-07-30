# Codex handoff — customer latest-arrival clarity

Date: 2026-07-30
Branch: `codex/customer-latest-arrival`
Base: `b144336`

## Why

The tracking screen showed a promised ETA and said the automatic credit applies
15 minutes later. That forced the customer to calculate the actual deadline.

## What changed

- Added one shared `SLA_GRACE_MS` constant and `latestArrivalAt()` helper.
- The order tracking guarantee now shows both the promised time and the exact
  latest-arrival time before automatic credit.
- Updated the existing message in English, Arabic, Russian, Italian, and German.
- Kept the existing credit calculation and backend behavior unchanged.

## Verification

Run from `apps/customer`:

- `npm test -- --run src/lib/tracking.test.ts` — 15 tests passed.
- `npm run typecheck` — passed.
- `npm test -- --run` — 42 files, 466 tests passed.

## Integration notes

- This is an independent, customer-only slice based directly on `b144336`.
- No migration, schema, analytics payload, environment variable, or package
  dependency changed.
- It is safe to cherry-pick independently after reviewing the translated copy.
