# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Sharm Eats — a delivery super-app for Sharm el-Sheikh. Six surfaces, one Supabase backend, **no separate API server**:

- `apps/customer` — Expo SDK 52 + expo-router (browse → cart → checkout → live tracking)
- `apps/driver` — Expo SDK 52 (go online → accept → pickup → deliver, live GPS)
- `apps/restaurant` — Expo SDK 52 (merchant order management, mobile)
- `apps/merchant-web` — Next.js 15 dashboard, port **3001**
- `apps/admin-web` — Next.js 15 ops/dispatch/finance dashboard, port **3002**
- `landing` — Next.js 15 marketing site (deployed separately to Vercel)
- `packages/db-types` — generated Supabase types; `packages/tokens` — design tokens
- `supabase/` — migrations (sequentially numbered SQL), Deno edge functions, seed

## Install & run — the one monorepo rule that matters

**Only `packages/*` are npm workspaces. Every app and `landing` manage their OWN `node_modules` + lockfile** (Expo needs React 18, Next.js needs React 19; hoisting would conflict). Always install and run from inside the app directory:

```bash
cd apps/customer && npm install && npm start      # Expo dev server
cd apps/merchant-web && npm install && npm run dev  # :3001
cd apps/admin-web && npm run dev                    # :3002
```

The root `package.json` scripts that use `--workspace apps/...` are stale (apps aren't workspaces) — don't rely on them. The `db:*` root scripts do work.

## Commands

Per app (run from the app's directory):

```bash
npm run typecheck        # tsc --noEmit — exists in every surface; run after any change
npm test                 # vitest — exists in apps/customer and apps/merchant-web only
npx vitest run src/lib/rewards.test.ts   # single test file
npm run lint             # Next.js apps only
```

Edge functions (Deno, not Node — run from repo root so the root `deno.json` is picked up):

```bash
deno test --permit-no-files supabase/functions/
```

Database:

```bash
npm run db:types         # regenerate packages/db-types/database.types.ts from prod schema
                         # (run from repo root after any applied migration)
```

CI (`.github/workflows/ci.yml`) runs typecheck/test/lint per surface (missing scripts are skipped, not failed) + Deno tests for edge functions.

## Architecture: authority lives in Postgres

All money, order-status, and dispatch logic is in **SECURITY DEFINER Postgres RPCs** and edge functions — never in clients. Clients are thin: they call RPCs and subscribe to Realtime.

- `place_order` recomputes every price from the DB (client-sent totals are ignored), snapshots `order_items`, validates atomically. It also enforces delivery-radius and honest ETA.
- `advance_order_status` is the **only** writer of `orders.status` and enforces a legal state machine per role (customer/driver/merchant_staff/dispatcher/admin).
- RLS is deny-by-default on one shared DB. Authority columns (status, commission, verification flags, geo) get **no direct UPDATE grant** — only the RPCs mutate them.
- Realtime: order status via `postgres_changes`; driver GPS via Realtime **Broadcast** (ephemeral) + throttled `driver_ping` for the authoritative `drivers.current_geo`.
- Payments: Paymob hosted card checkout (HMAC-verified, idempotent webhook in `supabase/functions/paymob-webhook`) + cash-on-delivery. Card is currently dark in prod (`EXPO_PUBLIC_PAYMENTS_CARD_ENABLED=false` in `eas.json`).
- Category-agnostic schema: `verticals` table + polymorphic merchants/catalog — "restaurant" = merchant where vertical='food'. New verticals are seed rows, not DDL.

### Customer app data layer

`apps/customer/src/data/` is a repository layer with two backends — `mock/` and `supabase/` — switched by `EXPO_PUBLIC_USE_SUPABASE=true`. New data access goes through a repository, not ad-hoc supabase calls in components. Routes live in `app/` (expo-router); shared modules in `src/` behind the `@/*` alias.

## Migration house rules (each of these caused a real production incident)

Migrations are `supabase/migrations/NNN_name.sql`, applied in order (currently through 109). When writing one:

1. **Never `CREATE OR REPLACE` a function with a different argument list** — Postgres creates a second overload, PostgREST then fails with PGRST202 on every call. Drop the old signature explicitly, and verify prod ends up with exactly ONE overload matching the app's arg list.
2. **Start from the latest version of a function's body**, never an older migration's copy — re-pasting an old body silently reverts later security hardening.
3. **Every SECURITY DEFINER RPC**: `REVOKE ALL ... FROM PUBLIC, anon;` then grant only the roles that need it. Granting to `authenticated` does NOT revoke the default PUBLIC/anon execute.
4. **Role checks must fail closed**: `NULL <> 'admin'` evaluates to NULL and fails OPEN. Use `coalesce(role, '') <> 'admin'` or `IS DISTINCT FROM`.
5. Column-level UPDATE grants matter — RLS cannot restrict columns; broad default grants on tables like `drivers`/`restaurants` allowed self-verification and zero-commission exploits before they were locked down.
6. Validate migrations with a transaction-wrapped dry run (`BEGIN; ... ROLLBACK;`) against a local Postgres before applying to prod, then run the Supabase security advisors after applying.
7. After applying, regenerate types: `npm run db:types`.

## Builds & releases

- EAS builds per app (`eas.json` in each app dir). `appVersionSource: "remote"` — build numbers auto-increment on EAS; **do not hand-edit them**.
- Native changes (new native modules, config plugins, Sentry metro changes) require a full EAS build; JS-only changes can ship OTA via `eas update`.
- Cloud build credits are on a monthly cap that fails AFTER upload; `eas build --local` is the fallback. See `docs/EAS-BUILD-RUNBOOK.md`.
- `SENTRY_DISABLE_AUTO_UPLOAD=true` is the fail-safe default in build profiles — a Sentry upload failure must never break a prod build.

## Where the truth lives

- `docs/FINANCIALS.md` — commission/fee/loyalty numbers (source of truth; 15% commission, 1% cashback, drivers keep 100% of delivery fees)
- `docs/OPS-RUNBOOK.md` — production operations
- `docs/GO-LIVE.md`, `docs/LAUNCH-RUNBOOK.md` — launch state and steps
- `README.md` — accurate on architecture/design decisions, but stale on details (mentions a removed `packages/shared`; migration count is far beyond 014)
