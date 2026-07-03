# Sharm Eats

Multi-category delivery **super-app** for Sharm el-Sheikh (food first; groceries/pharmacy slot in with zero schema change). Serves **tourists** (hotels, card, EN/RU/AR) and **residents** (apartments, cash-on-delivery, Arabic-first) from one backend, with a **hybrid fleet** (platform drivers + merchants who self-deliver) and **manual dispatch** now / auto-dispatch ready.

**Build plan:** `~/.claude/plans/lets-build-a-delivery-virtual-whale.md`

## Architecture

Four surfaces, one Supabase backend, **no separate API server**. All money/status/dispatch authority lives in Postgres RPCs + Edge Functions — never in clients.

```
apps/
├── customer/      Expo SDK 52 — browse → cart → pay (card/COD) → live track
├── driver/        Expo SDK 52 — online → accept → pickup → deliver + live GPS
├── merchant-web/  Next.js 15 — live order queue (accept/preparing/ready)
└── admin-web/     Next.js 15 — dispatch board + live ops
landing/           Next.js 15 — 5-language waitlist (pre-launch)
packages/
├── db-types/      generated Supabase types (single source of truth)
├── shared/        order-status state machine + fee math (pure TS)
└── tokens/        design tokens (Sharm sand/sea palette)
supabase/
├── migrations/    001-004 (Phase-0) + 005-014 (super-app evolution)
├── functions/     paymob-create-intention, paymob-webhook, expo-push
└── seed.sql       food vertical + 5 pilot merchants + test drivers
```

### Key design decisions
- **Server authority:** `place_order` recomputes every price from the DB (client total ignored), writes `order_items` snapshots, validates merchant/address/items atomically. `advance_order_status` is the ONLY writer of `orders.status` and enforces a legal state machine per role.
- **Category-agnostic:** a `verticals` table + polymorphic merchants/catalog. "Restaurant" = merchant where vertical='food'. Adding groceries later = seed rows, no DDL.
- **Hybrid fulfillment:** each order is `platform` (your fleet, dispatched) or `self_delivery` (merchant's driver).
- **Live tracking:** order status via Realtime `postgres_changes`; driver GPS via Realtime **Broadcast** (ephemeral, no DB write storm) + a throttled `driver_ping` for the authoritative `drivers.current_geo`.
- **RLS by role:** customer / driver / merchant_staff / dispatcher / admin on one DB. Authority columns get NO direct UPDATE — only the SECURITY DEFINER RPCs mutate them.
- **Dual payments:** Paymob hosted card checkout (HMAC-verified webhook, idempotent) + cash-on-delivery (settles on delivery via `mark_cod_collected`).

## Bringing it online

### 1. Supabase project
Create a project (region **eu-central-1**), then apply migrations + seed (in order 001 → 014, then `seed.sql`). Set Edge Function secrets:
```
PAYMOB_SECRET_KEY, PAYMOB_PUBLIC_KEY, PAYMOB_INTEGRATION_ID, PAYMOB_HMAC_SECRET
```
Deploy functions:
```
supabase functions deploy paymob-create-intention --project-ref <REF>
supabase functions deploy paymob-webhook --no-verify-jwt --project-ref <REF>
supabase functions deploy expo-push --no-verify-jwt --project-ref <REF>
```
Point the Paymob dashboard callback at `https://<REF>.supabase.co/functions/v1/paymob-webhook`.

### 2. Generate types
```
SUPABASE_PROJECT_REF=<REF> npm run db:types   # from repo root
```

### 3. Env per app
Each app has `.env.example`. Customer/driver use `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY` (customer also needs `EXPO_PUBLIC_USE_SUPABASE=true` to flip off mock data). Dashboards use `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

### 4. Run
```
# Expo apps (install per-app; they manage their own node_modules)
cd apps/customer && npm install && npm start
cd apps/driver   && npm install && npm start
# Next.js dashboards
cd apps/merchant-web && npm install && npm run dev   # :3001
cd apps/admin-web    && npm install && npm run dev   # :3002
```
> Monorepo note: only `packages/*` are npm workspaces. The apps own their lockfiles because Expo (React 18) and Next.js (React 19) need different co-located React versions.

### 5. First real order (end-to-end test)
1. Seed makes 5 pilot merchants + 3 test drivers. Create an admin: `update public.users set role='admin' where phone='<you>'`.
2. Link a merchant staffer (`merchant_staff`) and a driver (`drivers.profile_id`) per `seed.sql` notes.
3. Customer app → browse → cart → place a COD order and a card order.
4. Merchant web → accept → preparing → ready.
5. Admin → dispatch board → assign a driver. Driver app → accept → pickup → deliver. Customer sees the live dot.

## Business context

**Competition (corrected July 2026):** Bringit is the local incumbent (owner-confirmed; restaurant count / rating to re-verify); wedge = tourist-first + hyper-local + 12% commission (vs 18-22%). See `docs/restaurant-loi.md`.
