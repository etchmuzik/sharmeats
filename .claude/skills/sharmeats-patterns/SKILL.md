---
name: sharmeats-patterns
description: Conventions extracted from the Sharm Eats git history — commit style, migration security discipline, deployment-state honesty, per-surface isolation, and i18n rules. Use when committing, writing a Postgres migration, adding user-facing copy, or touching CI in this repo.
version: 1.0.0
source: local-git-analysis
analyzed_commits: 449
analyzed_migrations: 204
generated: 2026-07-31
---

# Sharm Eats Patterns

Extracted from 449 commits and 204 migrations. Every claim below is a measured
frequency, not a preference. Where the repo is inconsistent, that is stated.

---

## 1. Commit conventions

**Conventional commits: 399/448 (89%).** Type distribution:

| type | count | | type | count |
|---|---|---|---|---|
| `feat` | 173 | | `perf` | 6 |
| `fix` | 101 | | `ops` | 6 |
| `docs` | 66 | | `test`/`security`/`refactor`/`build` | 2 each |
| `chore` | 37 | | `ci`/`polish` | 1 each |

**Scope is the surface, not the layer.** Top scopes: `customer` (70), `db` (39),
`driver` (22), `program` (12), `restaurant` (11), `ops` (11), `push` (10),
`landing` (9), `admin` (8). Multi-surface changes use a comma: `fix(driver,restaurant):`.
Never scope by technology (`fix(react):`) — always by the surface that ships it.

### Subjects are sentences, not labels

Median subject is **69 characters**; p90 is 86; the longest is 132. This repo
deliberately exceeds the conventional 50-char guidance. A subject states the
*consequence*, not the file touched:

```
fix(dispatch): auto-assign searches around the PICKUP, not the drop-off (mig 189)
fix(campaigns): stop calling an HTTP 2xx "Delivered" (mig 146, prod-applied)
fix(favorites): stop resurrecting a favourite removed while offline
perf(db): recover free-tier compute, and fix four RPCs that could never run (#104)
```

Not `fix(dispatch): update nearest_drivers` — say what was wrong and what is
now true.

### Bodies are the norm, not the exception

**391/448 commits (87%) have a body.** Median 8 non-blank lines, p90 37, max 68.

For anything non-trivial, the body is a short postmortem. The recurring shape:

1. **Numbered, capitalised symptom headings** — `1. ORDER SCREEN CRASHED AFTER
   EVERY ORDER PLACEMENT.`
2. **Mechanism, not restatement.** Explain the causal chain: what fired, why the
   assumption was wrong, what now compares by value instead of identity.
3. **Interactions between the bugs** — the history repeatedly calls out when two
   defects amplified each other.
4. **Deployment state** — what was applied to production, when, and why out of
   the normal order.
5. **What is still unproven** — an explicit `Not yet verified:` paragraph.

The word **"Verified" appears in 69 commit bodies**. State the evidence, not the
intent: *"verified by parsing the file that zero hooks remain after it"*,
*"build 58 compiled from this branch and is on TestFlight"*.

### Honesty markers are load-bearing

The single strongest cultural signal in this history is refusing to let a commit
imply more readiness than exists. Vocabulary and counts across all commits:

| marker | count | meaning |
|---|---|---|
| `dark` / `DARK` | 38 | shipped behind a flag, not reachable by users |
| `prod-applied` | 12 | migration is live on production |
| `unapplied` | 7 | migration is committed but NOT on production |
| `NOT applied` / `NOT deployed` | 6 | emphatic form, used when a gate was missed |
| `owner-gated` | 14 | blocked on an action only the account owner can take |

**Never write a subject that implies a migration is live when it is not.** If you
add a migration without applying it, the subject must say so:

```
feat(cart): server-backed active cart schema and writer (migs 168/169, NOT applied)
docs(payments): the card rail is NOT deployed — record the gate and the gap
feat(lifecycle): gate engine and first two producers, DARK (migs 176/177/178)
```

**Correcting the record is itself a commit type here.** Several commits exist
purely to fix a stale claim: `docs(program): correct Package 03's stale state`,
`docs: verify the retention + launch-readiness audits; fix 3 stale facts`,
`feat(payments): land payment integrity as mig 180 — mig 121 was never applied`.

---

## 2. Database migrations

204 migrations in `supabase/migrations/`. Naming is **`NNN_snake_case.sql`**,
sequential from `001` to `201`. Three recent files use a
`YYYYMMDDHHMMSS_name.sql` timestamp form — the numeric form is still dominant
and is what new work should use unless the Supabase CLI generates the file.

### Measured security discipline

Of the 162 migrations that define a `SECURITY DEFINER` function:

- **152 (94%) pin `set search_path`** — this is effectively universal, treat it as mandatory.
- **102 (63%) include `revoke all`** — the gap is mostly older migrations; new
  work must revoke.
- 95 files carry explicit `grant execute`.

Of the 52 migrations that `create table`, **37 (71%) revoke immediately after**.
`ALTER DEFAULT PRIVILEGES` on this database grants `arwdDxtm` to `anon` and
`authenticated` on every new table, so *not granting* is not the same as denying.
`TRUNCATE` also ignores RLS — "RLS on, no policies" does not protect a table.

The canonical shape of a new RPC:

```sql
create or replace function public.do_the_thing(p_arg uuid)
returns ... language plpgsql security definer
set search_path = public, pg_temp        -- 152/162 do this
as $$ ... $$;

revoke all on function public.do_the_thing(uuid) from public, anon;
grant execute on function public.do_the_thing(uuid) to authenticated;
```

Granting to `authenticated` does **not** revoke the default `PUBLIC`/`anon`
execute. Both statements are required.

### Role checks must fail closed

`NULL <> 'admin'` evaluates to NULL, which fails **open**. Use
`coalesce(role, '') <> 'admin'` or `IS DISTINCT FROM`. This caused a real
incident.

### Never `create or replace` with a changed argument list

Postgres creates a *second overload*; PostgREST then returns PGRST202 on every
call. Drop the old signature explicitly and confirm production ends with exactly
one overload matching the client's argument list. Only 14 migrations contain
`drop function` — when you need one, you really need it.

### Type regeneration

`packages/db-types/database.types.ts` is the most-changed file in the repo (34
of the last 200 commits). Two accepted patterns, both present in history:

- **Co-changed** — the feature commit contains the migration *and* the regenerated
  types. This is the common case for a migration applied as part of the change.
- **Standalone `chore`** — when a batch was applied to production later:
  `chore(db-types): regenerate from prod after migrations 152-163`,
  `chore(db): apply migs 168/169 to production and regenerate types`.

Run `npm run db:types` from the repo root. Never hand-edit the generated file.

### Before applying

Transaction-wrapped dry run (`BEGIN; ... ROLLBACK;`) against local Postgres,
then run the Supabase security advisors after applying. `scripts/test-security-migrations.sh`
exists for this and was touched in 9 of the last 200 commits — it is live
tooling, not a relic.

---

## 3. Internationalisation

`apps/customer/src/i18n/locales/` holds **five locales: `ar`, `de`, `en`, `it`, `ru`.**
All five files sit in the top-6 most-changed files in the repo, with identical
change counts (22 each) — that equality is the pattern.

**Of 48 commits touching any locale file, 36 (75%) touch all five.** The
remainder are targeted copy corrections. Adding a key to `en.json` alone is a
defect: ship all five or the app renders a raw key.

Arabic is RTL — layout changes need to be checked in `ar`, not just `en`.
`landing/` uses a different mechanism (`src/i18n/dictionaries.ts`); the mobile
driver and restaurant apps localise separately (see
`feat(driver): add Arabic core shift localization`).

---

## 4. Surface isolation

Only `packages/*` are npm workspaces. **Every app and `landing` own their
`node_modules` and lockfile** — Expo needs React 18, Next.js needs React 19.
Always `cd` into the surface before installing or running.

CI (`.github/workflows/ci.yml`) matrixes per surface and reflects this exactly:

- Mobile surfaces (`apps/customer`, `apps/driver`, `apps/restaurant`) install
  with an **exact lockfile** and their `typecheck`/`test` scripts are
  **mandatory** — a missing script fails the job.
- Non-mobile surfaces install more leniently so a drifted lockfile keeps CI
  unblocking rather than silently green.
- Web surfaces (`apps/admin-web`, `apps/merchant-web`, `landing`) additionally
  run a real `next build` — typecheck alone does not prove the build succeeds.
- `expo-doctor` is **advisory**: it emits a `::warning` annotation and never
  fails CI.
- Edge functions run as a separate Deno job: `deno test --permit-no-files supabase/functions/`.

Root `package.json` scripts using `--workspace apps/...` are stale. The `db:*`
root scripts do work.

---

## 5. Tests

89 test files. Colocated `.test.ts` / `.test.tsx` beside the source — no
`__tests__/` directories. Runner is **vitest**, present only in `apps/customer`
and `apps/merchant-web`; edge functions use `deno test`.

Concentration by directory:

| location | files |
|---|---|
| `apps/customer/src/lib` | 26 |
| `apps/driver/src` | 9 |
| `apps/customer/src/data/supabase` | 8 |
| `apps/restaurant/src` | 7 |
| `apps/merchant-web/src/lib` | 6 |
| `supabase/functions/*` | 9 across 7 functions |

The bias is deliberate: **pure logic in `src/lib` is where tests live.** Money,
pricing, fees, rewards, dispatch eligibility and mappers are tested; screens
largely are not. When adding logic, put it in `lib` so it is testable rather
than inline in a screen.

Single file: `npx vitest run src/lib/rewards.test.ts`.

---

## 6. Client/server authority boundary

Clients are thin. All money, order-status and dispatch logic lives in
`SECURITY DEFINER` RPCs and edge functions. Recurring rules visible in the
history:

- `place_order` recomputes every price from the DB; client-sent totals are ignored.
- `advance_order_status` is the **only** writer of `orders.status`.
- Authority columns (status, commission, verification flags, geo) get no direct
  UPDATE grant. RLS cannot restrict columns — column-level grants are the
  mechanism. Broad default grants previously allowed self-verification and
  zero-commission exploits.
- Customer app data access goes through the repository layer in
  `apps/customer/src/data/` (`mock/` and `supabase/` backends), not ad-hoc
  Supabase calls in components.

A recurring bug class in this history: **trusting intent over evidence.**
`status='online'` survives a force-quit; `last_ping_at` is evidence. Dispatch
now requires the evidence, with the threshold in `platform_settings` and null
failing closed. Prefer a checked timestamp over a self-reported flag.

---

## 7. Branches and PRs

Branch prefix mirrors the commit type: `feat/` (15), `fix/` (11), `docs/` (4),
`security/` (2), `chore/`, `ship/`. Full form `feat/driver-restaurant-ui-modernization`.

68 commit subjects carry a trailing `(#NN)` PR reference; 34 are merge commits —
both squash-with-reference and merge-commit flows are in use.

Bodies of AI-assisted commits carry `Co-Authored-By` (72) and sometimes
`Claude-Session` (20) trailers.

---

## Checklist before committing

- [ ] Subject states the consequence, scoped by surface; length ~50–90 chars is normal here
- [ ] Body explains the mechanism, not just the change — numbered if multiple defects
- [ ] Deployment state is explicit: `prod-applied`, `unapplied`, `NOT applied`, or `DARK`
- [ ] Anything unproven is called out in a `Not yet verified:` paragraph
- [ ] New RPC has `set search_path` **and** `revoke all ... from public, anon` **and** a scoped `grant execute`
- [ ] New table revokes from `public, anon, authenticated` before its real grants
- [ ] Role checks use `coalesce(...)` or `IS DISTINCT FROM` — no bare `<>` against a nullable
- [ ] No `create or replace` with a changed argument list
- [ ] `npm run db:types` run after applying a migration
- [ ] All five locale files updated, not just `en.json`
- [ ] `npm run typecheck` run from inside the surface directory
