# Restaurant Self-Onboarding — Design Spec

Date: 2026-07-24 · Status: approved design, pre-implementation
Approach: **draft-restaurant-first** (approved over application-table-first and manual-intake alternatives)

## Goal

A restaurant owner goes from "found the landing page" to "live and selling" with admin
involvement limited to: reviewing 3 KYC documents, seeding the menu, and clicking Approve.
Today every restaurant is hand-inserted by admins; this is the largest open owner-gated gap
(docs/PLATFORM-GAPS.md, "Restaurant onboarding KYC").

Decisions made during brainstorming:

- **Entry point:** merchant-web (`:3001`) hosts signup + wizard; landing site links to it.
- **Menu model (hybrid):** admin seeds the initial menu during approval; merchant edits it
  afterward in merchant-web. (Merchant write policies on all 4 menu tables already exist —
  only UI is missing.)
- **Go-live gate:** all 3 KYC docs approved **and** an explicit admin approve action.
  Never list an unlicensed kitchen.
- **Commission/terms:** standard 15% shown in-flow with click-accept (mig 107 construct);
  admin may override `commission_pct` per merchant before approval. Fix the stale column
  default 12.0 → 15.0.
- **Batching Phase 1 was considered and deferred** in the same session: the mig 085 shadow
  sweep (720 runs/24h, 0 failures) has logged **zero** eligible pairs since 2026-07-03.

## What already exists (reused, not rebuilt)

| Piece | Where | Reuse |
|---|---|---|
| Staff linkage + roles | `merchant_staff`, `users.role`, `auth_role()`, `is_merchant_staff()` (mig 007) | as-is |
| Draft invisibility | `restaurants_read` policy: `is_active OR is_merchant_staff(id) OR admin` | as-is — drafts hidden from customers, visible to owner |
| KYC trail | `kyc_documents` (`subject_type='restaurant'`), private `kyc` bucket + RLS (migs 075/076), admin-web `/kyc` review page | as-is; merchant-web gains an upload UI |
| Menu write access | merchant INSERT/UPDATE/DELETE policies on `menu_sections`/`menu_items`/`modifiers`/`modifier_options` | as-is; merchant-web gains an editor UI |
| Menu editor UI | admin-web `/menu` (MenuManager, RestaurantEditor) | adapted into merchant-web, RLS-scoped |
| Provisioning pattern | mig 108 `provision_driver` (idempotent, fail-closed, typed errors) | pattern for the new RPCs |
| Terms acceptance | mig 107 construct | recorded at wizard submit |
| Ops alerting | `ops_alert` → Telegram | new-application + approval notifications |
| Payout fields | `restaurants.payout_*` (mig 074) | collected in wizard |

## Section 1 — Data model & backend (migration 120)

### Schema

- `restaurants.onboarding_status text not null default 'live'`,
  check in `('draft','submitted','approved','live','rejected')`. Existing rows backfill to
  `'live'` via the default. `is_active` remains the sole customer-visibility switch;
  `onboarding_status` is workflow state. **Authority column** — no client UPDATE grant.
- `restaurants.commission_pct` default `12.0` → `15.0` (docs/FINANCIALS.md source of truth).
  Existing rows keep explicit values.
- Rejection reason stored (column `onboarding_rejection_reason text` on `restaurants`).

### `apply_as_restaurant(...)` — SECURITY DEFINER RPC

Grant: `authenticated` only (`REVOKE ALL FROM PUBLIC, anon` first). Pinned `search_path`.
Args: name, description, cuisines, phone, address, zone, geo, `is_open_24h`,
`prep_time_low`/`prep_time_high`, payout fields, terms version.

Atomically:
1. Fail closed: `auth.uid()` null → `AUTH_REQUIRED`; caller role in
   (admin, driver, dispatcher) → `NOT_ELIGIBLE`; existing `merchant_staff` row → idempotent
   return of the existing restaurant id (`ALREADY_APPLIED` semantics without error).
2. Validate: name 2–120 chars, zone exists in `zones`, geo within the selected zone's
   service area (reuse the mig 079 delivery-radius helper), phone shape.
   Typed errcodes (`INVALID_NAME`, `ZONE_NOT_SERVED`, …).
3. Insert `restaurants`: `is_active=false`, `is_open=false`, `onboarding_status='submitted'`,
   `commission_pct=15`, unique generated slug, `tourist_safe=false`, `featured=null`.
4. Insert `merchant_staff (profile_id, restaurant_id, 'owner')`.
5. `users.role: 'customer' → 'merchant_staff'`.
6. Record terms acceptance (mig 107 construct).
7. `ops_alert`: new restaurant application (name, zone).

### `approve_restaurant(p_restaurant_id, p_decision, p_reason default null)` — admin-only RPC

Fail-closed admin check (`coalesce(auth_role()::text,'') <> 'admin'` → `NOT_AUTHORIZED`).

- `'approve'` requires, **verified inside the RPC** (UI checks are advisory only):
  - 3 `kyc_documents` rows for this restaurant with doc types
    `commercial_registration`, `tax_card`, `food_license`, all `status='approved'`
    → else `KYC_INCOMPLETE`;
  - ≥1 `menu_items` row → else `MENU_EMPTY`.
  Then: `onboarding_status='approved'`, `is_active=true`, **`is_open` stays false**
  (merchant flips Open from their dashboard when actually ready — no stranded orders).
  Fires merchant push via existing fanout.
- `'reject'`: `onboarding_status='rejected'`, reason stored, `is_active` stays false,
  merchant notified.
- This RPC is the **only** writer of `onboarding_status`.

Untouched: KYC tables/bucket/policies, `restaurants_read` policy, menu tables,
`advance_order_status`, all money paths.

## Section 2 — Merchant-web (merchant journey)

Routing by onboarding state (resolved in the auth layout):

| State | Renders |
|---|---|
| No session | `/login` (existing) or new `/signup` |
| Session, no `merchant_staff` row | Onboarding wizard |
| `submitted` | Application-status checklist |
| `rejected` | Rejection notice + reason + support contact |
| `approved`/`live` | Existing dashboard + new Menu tab |

- **`/signup`** — Supabase email/password self-registration, "Partner with Sharm Eats"
  framing, mirrors login styling. Landing site gets one link (EN/AR).
- **Wizard** — 4 steps, one component per step, draft persisted to localStorage, DB touched
  only at final submit:
  1. Business basics (name, description, cuisines, phone, address, hours)
  2. Location (zone dropdown from `zones` + map pin → `geo`)
  3. Payout (method + existing payout fields)
  4. Review & terms — 15% commission stated plainly, terms links, single accept
     checkbox → `apply_as_restaurant`. Typed RPC errors → friendly inline copy.
- **Status checklist** (while `submitted`) — merchant home until approval:
  - ✅ Application submitted
  - ⬜ Upload 3 KYC docs (commercial registration, tax card, NFSA food license) —
    upload UI in merchant-web, private `kyc` bucket, same path convention as mobile;
    per-doc pending/approved/rejected chips with re-upload on reject
  - ⬜ Menu — "Our team builds your menu with you after document review"
  - ⬜ Go-live — pending admin approval
  Realtime/refetch on `kyc_documents` + own `restaurants` row.
- **Menu tab** (post-approval) — adapted from admin-web MenuManager/RestaurantEditor,
  scoped to own restaurant (RLS enforces regardless): edit names/descriptions/prices/
  availability, add/remove items in sections, edit modifiers. Profile edits ride
  `restaurants_merchant_update`; authority columns stay non-writable.
- Localization: EN + AR (merchant-facing surface), matching merchant-web's existing i18n
  approach.

## Section 3 — Admin-web (approval side)

- **New `/onboarding` queue page** — rows: `onboarding_status='submitted'` (tab for
  `rejected`), oldest first. Per row: name, zone, submitted date, owner contact, 3 KYC
  status chips, menu-item count, inline-editable `commission_pct` (negotiation override).
  Actions:
  - Review docs → existing `/kyc` filtered to the restaurant
  - Seed menu → existing `/menu` RestaurantEditor (admin sees inactive rows already)
  - Approve → `approve_restaurant(id,'approve')`; button enabled only when UI sees
    3 approved docs + ≥1 item, RPC re-checks regardless; confirm dialog warns
    "restaurant becomes visible to customers"
  - Reject → required reason → `approve_restaurant(id,'reject',reason)`
- **Notifications:** new application → `ops_alert` (from the RPC). Approve/reject →
  merchant push via existing fanout (migs 070/073) + status page updates. Copy EN/AR.

## Section 4 — Security, error handling, testing, rollout

### Security

- Both RPCs: SECURITY DEFINER, pinned `search_path`, `REVOKE ALL FROM PUBLIC, anon`,
  grant `authenticated` only, `coalesce`-based fail-closed role checks.
- `onboarding_status`: no column UPDATE grant anywhere; `approve_restaurant` sole writer.
- Abuse: confirmed auth account required; one restaurant per account (idempotent);
  every application raises an `ops_alert` so spam waves are visible.
- Role flip `customer → merchant_staff` preserves order history (order RLS is
  `user_id`-based).
- Migration house rules: fresh function names (no overloads), tx-wrapped local dry run,
  dev-branch verification, advisors after apply, `npm run db:types` regen + app sync.

### Error handling

Typed errcodes (`AUTH_REQUIRED`, `NOT_ELIGIBLE`, `ZONE_NOT_SERVED`, `INVALID_NAME`,
`KYC_INCOMPLETE`, `MENU_EMPTY`, `NOT_AUTHORIZED`) mapped to specific human copy in both
webs — no raw Postgres errors. (A duplicate `apply_as_restaurant` call is not an error:
it idempotently returns the existing restaurant id.) Wizard drafts survive refresh (localStorage). Upload failures are per-file
with retry. All new screens ship loading/empty/error states.

### Testing

- Migration: `BEGIN; … ROLLBACK;` against local Postgres, then Supabase dev branch.
- SQL behavior (dev branch): apply — happy path, idempotent duplicate, anon/role guards,
  invalid zone; approve — blocked <3 approved docs, blocked empty menu, non-admin
  rejected, `is_open` false after approve, reject stores reason.
- merchant-web vitest: wizard step validation, onboarding-state routing, error→copy map.
- Manual E2E before merge: signup → wizard → 3 uploads → admin KYC approve → menu seed →
  approve → merchant opens → visible in customer app.

### Rollout

Web-only (no EAS build, no OTA): migration 120 to prod (owner-confirmed) → deploy
merchant-web + admin-web → landing link last (soft-launch by reachability). Existing
restaurants backfill to `'live'` — zero behavior change. Success = one real restaurant
onboarded with admin touch limited to doc review + menu seed + approve click.

## Out of scope (explicit)

- Activation-fee billing (PLATFORM-GAPS "merchant onboarding/activation fee") — rides the
  future merchant-billing rails, not this project.
- Restaurant mobile-app onboarding UI (merchant-web is the onboarding surface).
- Multi-restaurant owners (one restaurant per account in v1).
- Auto-live without admin action (rejected during design).
- Batching Phase 1 (deferred on shadow-sweep evidence, revisit when
  `batch_candidate_log` shows pairs).
