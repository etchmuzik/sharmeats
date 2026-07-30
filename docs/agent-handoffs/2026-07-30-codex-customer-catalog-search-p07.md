# Codex handoff — bounded customer catalog search on Package 07

Date: 2026-07-30
Branch: `codex/customer-catalog-search-p07`
Base: `77f6bbc`

## Why

Browse previously downloaded each restaurant menu sequentially for dish search
and dietary filters. An initial constant-query replacement was rejected in peer
review because it still relied on leading-wildcard Data API scans and could
silently truncate a global flag index at Supabase's response-row cap.

Claude's Package 07 migration 188 now provides the visibility-scoped,
keyset-paginated `search_catalog` authority. This slice uses it rather than
creating a competing search endpoint.

## What changed

- Dish search calls `search_catalog` once, then hydrates only its returned item
  IDs in one bounded read so existing cards retain images and descriptions.
- Customer `%`, `_`, `*`, and backslash characters are treated as literal
  search text.
- Dietary filters query only available dishes carrying every selected flag.
  The narrow result uses an item-ID keyset until an empty page, so configurable
  Data API caps and concurrent availability changes cannot silently skip rows.
- A restaurant now matches multiple dietary flags only when at least one
  orderable dish carries all of them; the old union-of-unrelated-dishes result
  could mislead customers.
- Explicit search/filter error state includes a translated retry action.
  Pull-to-refresh also forces a fresh catalog attempt.
- Mock and Supabase adapters expose the same `search()` and
  `restaurantIdsForFlags()` contract.
- Mock mode now fails closed to public food merchants; the private grocery and
  pharmacy fixtures no longer appear to an ordinary mock customer, including
  direct menu/item deep links and restaurant review lookups.
- A dish-search failure renders its retry state above restaurant matches, not
  only when the entire list happens to be empty.

## Verification

Run from `apps/customer`:

- Focused catalog/helper, adapter, and mock-visibility tests — 3 files, 12 tests
  passed.
- `npm run typecheck` — passed.
- `npm test -- --run` — 45 files, 477 tests passed.

## Integration notes

- This supersedes the earlier `codex/customer-scalable-menu-search` /
  `94b2018` experiment. Do not cherry-pick that older commit.
- Migration 188 must be applied before deploying this client; otherwise dish
  search shows the retry state while ordinary restaurant browsing still works.
- No new migration, dependency, environment variable, or analytics payload is
  introduced here.
