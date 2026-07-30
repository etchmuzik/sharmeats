# Codex peer review — Claude Package 07 commits 187–188

Date: 2026-07-30
Reviewed commits: `ce23f5e`, `1da31c8`, `77f6bbc`
Review branch: `codex/p07-peer-review`

No source or migration was changed by this review.

## P1 — lifecycle reminder visibility has a race window

Locations:

- `supabase/migrations/187_e0_governance_repair.sql:138`
- `supabase/migrations/187_e0_governance_repair.sql:249`

Both lifecycle producers call `user_can_view_vertical()` and later enqueue the
push without sharing the existing
`hashtextextended('vertical:' || vertical_id, 0)` transition lock. Access or
launch stage can change after the check but before enqueue. The push dispatcher
does not re-check vertical visibility, so the queued reminder can re-expose a
vertical that became private during that interval.

Suggested resolution: either serialize the final visibility check plus enqueue
with the established vertical transition lock in a deadlock-safe order, or
make the dispatcher re-check recipient visibility immediately before delivery.
Add a two-session transition-versus-producer concurrency proof.

## P1 — direct private-stage repair bypasses the transition lock

Location:

- `supabase/migrations/187_e0_governance_repair.sql:56`

The one-time grocery/pharmacy update changes `verticals.launch_stage` directly
without taking the same vertical advisory lock used by `place_order()` and
`set_vertical_launch_stage()`. A concurrent order can pass the public-stage
check, wait, and commit after the migration has made the vertical private.

Suggested resolution: acquire the established `vertical:grocery` and
`vertical:pharmacy` transaction locks in deterministic order before the direct
repair and its audit events. Verify with the same two-session ordering test used
by the E0 authority migrations.

## P2 — new suppression reason is rejected by the ledger

Locations:

- `supabase/migrations/187_e0_governance_repair.sql:139`
- `supabase/migrations/187_e0_governance_repair.sql:250`
- `supabase/migrations/176_lifecycle_gates.sql:83`

Migration 187 records `vertical_not_visible`, but
`lifecycle_sends_suppression_reason_check` does not permit that value.
`lifecycle_record()` catches the constraint failure, so the reminder remains
suppressed but the decision row silently disappears.

Suggested resolution: replace the named check constraint with the previous
vocabulary plus `vertical_not_visible`, and add a regression assertion that
both producers leave a suppression ledger row.

## P2 — cuisine refactor is client-only authority

Locations:

- `apps/customer/src/data/types.ts:1`
- `apps/customer/src/data/supabase/mappers.ts:104`
- `packages/db-types/database.types.ts:6097`

The handwritten customer type removes `grocery` and `pharmacy`, while the
database/generated types and admin write path still permit those values in
`restaurants.cuisines`. The mapper casts the database array to the narrower
type, hiding any stale values at compile time.

Suggested resolution: normalize legacy rows and bind the database/admin write
path to food-cuisine vocabulary, or keep an explicit compatibility decoder
until that authority migration ships. Regenerate database types afterward.

## Integration note

The customer catalog-search replacement should build on migration 188's
`search_catalog` RPC rather than restoring the removed vertical cuisine chips
or introducing another endpoint.
