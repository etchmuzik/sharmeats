# Sharm Eats — Full-Stack Live Audit (2026-07-05, re-verified)

**Scope:** adversarial, evidence-based, **read-only** re-verification of the live 4-surface
platform against Supabase project `ilqpsebcfbaoaogimhud` (eu-west-1, Postgres 17.6,
ACTIVE_HEALTHY) plus repo `/Users/etch/Downloads/sharmeats`. DB access = `execute_sql`
(SELECT/catalog only), `get_advisors` (security+performance), `list_migrations`,
`list_edge_functions`. Repo access = grep/read via 5 parallel subagents (apps ×4, design/UX,
notifications, lifecycle/payments/compliance, OTA/CI). **Nothing was modified.**

**Data context (pilot / near-idle):** 2 orders in last 24h, prod migrations end at **085**,
73 SECURITY DEFINER fns, 8 cron jobs, 4 test drivers (3 online). This is a low-traffic test
window — absence of load-related symptoms is not proof they won't appear at volume.

---

## One-line verdict

**Core is sound and launch-safe — money conserved, authz enforced, webhook HMAC + idempotent,
dispatch fail-safe. No new P0.** But three real gaps escalated this pass: the **dispatch
watchdog pages nobody** (alert webhook unset), the **late-credit number shown to customers
over-promises** what the engine pays, and the **delight pass can't reach a single install**
(no OTA-capable binary exists). Plus the standing F1–F12 queue.

---

## Core invariants — verified against LIVE state

| # | Invariant | Result | Evidence (this run) |
|---|---|---|---|
| ① | Money is integer/numeric, never float | ✅ PASS | `*_egp` = integer; `commission_pct numeric` |
| ② | Money conserved (ledger == balance) | ✅ PASS | credit **0 mismatch / 0 negative**; loyalty **0 mismatch / 0 negative** |
| ③ | Authority cols not client-writable | ✅ PASS | only `orders` UPDATE policy is rating-only (`orders_owner_update_rating`); ledger/financial tables have **no** write policy |
| ④ | RLS enforces tenant isolation | ✅ PASS | `orders` = `auth.uid()=user_id` +driver/merchant/admin; `users` self; `order_items` via parent; `credit_ledger` self/admin |
| ⑤ | SECURITY DEFINER hardened | ✅ PASS | 70/73 pin `search_path`; 3 unpinned = PostGIS `st_estimatedextent` (not app code) |
| ⑥ | `orders.status` single-writer + role-gated | ✅ PASS | matrix from `advance_order_status` (mig 054), anon EXECUTE revoked (081); no illegal skips |
| ⑦ | Webhook HMAC-verified + idempotent + amount-checked | ✅ PASS | `verify.ts` constant-time SHA-512 over 20 fields; pending-only UPDATE; `amount_cents == total_egp*100` before flip |
| ⑧ | COD authorized + amount-validated + fraud-capped | ✅ PASS | `mark_cod_collected` (050) driver/admin-only, exact-amount, upsert-idempotent; `place_order` COD caps (065) live in 082 |
| ⑨ | Cron alive, 0 failures/24h | ✅ PASS | 8 jobs active; dispatch-sweep 4,311 runs succeeded; reconcile-card 288; weekly-settlement pending first Monday run |
| ⑩ | Realtime publishes no financials | ✅ PASS | publication = `drivers, order_assignments, order_messages, order_status_events, orders, support_messages` |
| ⑪ | Late-credit promise mechanism fires automatically | ✅ PASS (existence) | `snapshot_order_financials` trigger on →delivered calls `issue_credit('sla_late')` when `delivered_at-eta_at > grace` — **but display value is wrong, see P1-2** |

---

## Findings (P0 → P2)

| ID | Sev | Dim | Title | Evidence | Impact | Confidence |
|----|-----|-----|-------|----------|--------|------------|
| **N1** | **P1** | B/I | Dispatch watchdog alerts nobody | `ops_alert` returns silently when `ops_alert_webhook_url` empty; live value = **EMPTY**; watchdog (066) + all ops alerts no-op | A stranded order is detected every 2 min but no human is paged; strands go silent | Verified |
| **N2** | **P1** | A/J | Late-credit UI over-promises vs engine | `order/[id].tsx:144` shows `round(totalEgp*0.1)` (of total, uncapped); engine credits `least(100, floor(subtotalEgp*0.1))` (mig 062) | Customer told e.g. 156 EGP, paid 100; systematic over-promise (CPL 181/2018 exposure) | Verified |
| **N3** | **P1** | H/A | No OTA-capable binary exists → delight pass undeliverable | every EAS build to date has `runtimeVersion=None, channel=None`; `eas update:list` → branch "production" doesn't exist | PR #43 reaches **zero installs** until a new store build ships; F12 escalated | Verified |
| **N4** | **P2** | E | Push copy is server-side English-only | `expo-push/index.ts:56-78` hardcoded `COPY`; no `users.language` lookup anywhere | AR/RU/IT/DE users get English push titles/bodies despite 5-locale app | Verified |
| **N5** | **P2** | H | Driver + restaurant apps have zero i18n | no locale dir/files in `apps/driver`, `apps/restaurant`; customer has 5×417-key parity | Non-EN drivers/merchants see English-only UI | Verified |
| **N6** | **P2** | I/E | Sentry DSN absent from prod EAS env | init gated on `EXPO_PUBLIC_SENTRY_DSN`; not in any eas.json prod profile; `crash.ts:35-37` self-warns | Prod crash reporting likely silently off (unless DSN is an EAS server secret — unverifiable from repo) | Strong |
| **N7** | **P2** | E | Notification holes: driver-on-cancel, settlement, KYC | matrix below; assigned driver not pushed when order cancelled (dead trip); no settlement/KYC push either direction | Missed notifications, wasted driver trips | Verified |
| **N8** | **P2** | K | Design token drift incl. cross-package divergence | `packages/tokens` `accent:#ff5a3c` vs `apps/customer/theme.ts` `#F05A1F`; hard-coded hex in PR#43 `Confetti.tsx:36`, `onboarding.tsx` | Admin/merchant web consume stale palette; theme not single-source | Verified |
| **N9** | **P2** | K | Em-dashes in all 5 customer locale JSONs | `en.json:64-65` `celebration.cod`, `onboarding.desc1`, `empty.cart.body` etc. (×5 locales) | Violates the em-dash ban in the delight-pass's own checklist | Verified |
| **N10** | **P2** | K | Celebration confetti ignores reduced-motion | `Confetti.tsx:42-44` animates regardless; spec said "collapses to static" | a11y: motion-sensitive users get the burst | Verified |
| **N11** | **P2** | K | New PR#43 surfaces skip RTL + <44pt targets | `onboarding.tsx` skip/lang buttons hard-pinned `right:20`/`left:20` (not mirrored); `BackButton`(38pt)/`QuantityStepper`(26-36pt) no hitSlop | AR onboarding not mirrored; small tap targets | Verified |
| — | note | K | **PRODUCT.md / DESIGN.md do not exist in the repo** | `git log --all -- docs/PRODUCT.md docs/DESIGN.md` empty; anti-refs live only in untracked `FINAL-BOSS.md:127`/`AUDIT-LEAN.md:26` | The mascot/confetti "ban" was never a committed brand rule; `DESIGNER-BRIEF.md:28` says "No mascot" (wordmark scope) — pivot shipped undocumented | Verified |

### Standing F-queue (re-confirmed live, unchanged from brief)

| ID | Sev | Status this run |
|----|-----|-----------------|
| **F1** | P1 | **OPEN** — anon+authenticated still hold INSERT/UPDATE/DELETE on all 10 ledger/authority tables (query returned 60 rows; behavior-neutral to revoke, RPCs are owner) |
| **F2** | P3 | RESOLVED-BY-DESIGN — card OFF (`EXPO_PUBLIC_PAYMENTS_CARD_ENABLED=false`), `paymob-create-intention` intentionally not deployed |
| **F3** | P2 | **CONFIRMED DRIFT** — `to_regclass('public.saved_orders')` = NULL; last prod mig = 085; `086_saved_orders.sql` in repo, **absent** in prod → apply 086 (never run, no history repair needed) |
| **F4** | P1 | **OPEN** — 20 unindexed FKs incl. hot `order_items.order_id`, `order_status_events.order_id`, `order_assignments.assigned_by_id`, `order_messages.sender_id`, `orders.address_id`, `orders.zone` |
| **F5** | P2 | **OPEN** — 30 `auth_rls_initplan` policies (per-row `auth.uid()` re-eval) |
| **F6** | P2 | **OPEN** — leaked-password protection off (advisor `auth_leaked_password_protection`) |
| **F7** | P1 | **REASSESS ↓** — `public_drivers` view exposes only `id,name,photo,vehicle,rating` (no phone/PII). Real issue is `security_definer_view` advisor ERROR: it runs as owner, bypassing RLS. Fix = `security_invoker=on`, not column removal. Downgrade to P2 |
| **F8** | P2 | **OPEN** — `riders` table 0 rows, RLS-enabled-no-policy; but `drivers.legacy_rider_id → riders(id)` FK still exists → drop needs FK handling first |
| **F9** | P2 | **OPEN** — 3 delivered orders miss `order_financials`: `d30be533…`(2026-06-07), `759ca78f…`(2026-06-07), `1213b15e…`(2026-07-01) — all pre-062, backfill or accept |
| **F10** | P2 | **OPEN** — 48 `multiple_permissive_policies` (menu_items, modifiers, orders 4×SELECT, platform_settings…) |
| **F11** | P1 | **OPEN (owner-gated)** — GitHub Actions billing-locked; runs fail in 3–5s; merges ride on local `tsc`+tests+review |
| **F12** | P1 | **OPEN (owner-gated), escalated → N3** — no OTA published AND no OTA-capable binary exists |

---

## Real state-machine transition matrix (live, from `advance_order_status` mig 054)

| From → To | customer | driver | merchant | admin/dispatcher |
|---|---|---|---|---|
| placed → accepted | – | – | ✓ | ✓ |
| accepted → preparing | – | – | ✓ | ✓ |
| preparing → ready | – | – | ✓ | ✓ |
| ready → picked_up | – | ✓ | ✓ | ✓ |
| picked_up → out_for_delivery | – | ✓ | ✓ | ✓ |
| out_for_delivery → delivered | – | ✓ | ✓ | ✓ |
| placed/accepted → rejected | – | – | ✓ | ✓ |
| placed → cancelled | ✓ | – | – | ✓ |
| any non-terminal → cancelled | – | – | – | ✓ |

No illegal skips (else-branch = `ILLEGAL_TRANSITION`). Actor bound to the specific order.
Terminal statuses release the driver `on_job→online` (054:116-122). Merchant holds
driver-leg transitions intentionally (self-delivery, mig 015). Driver cannot cancel/reject
(escalation-only, by design).

## Notification coverage matrix (holes marked ❌)

| Event | Customer | Driver | Merchant | Admin | Source |
|---|---|---|---|---|---|
| placed | – (own) | – | ✅ | – | 040→071 |
| paid (card) | ✅ | – | ✅ (via status event) | – | webhook |
| payment_failed | ✅ | – | – | – | webhook |
| accepted | ✅ | – | – | – | 071 |
| preparing | ❌ (intentional) | – | – | – | 071 |
| ready | ✅ | ✅ (if driver assigned) | – | – | 071/073 |
| picked_up / out_for_delivery / delivered | ✅ | ❌ | ❌ | – | 071 |
| **cancelled** | ✅ | **❌ dead trip** | ✅ | – | 071 |
| rejected | ✅ | – | ✅ | – | 071 |
| driver offer (auto + manual) | – | ✅ | – | – | 038/081/083 |
| driver_assigned | ✅ | – | – | – | 073 |
| order/support message | ✅ | ✅ | ✅ | ✅ | 068/070 |
| credit / referral / tier / low-rating | ✅ | ✅(tier) | ✅(low-rating) | – | 071/073 |
| **settlement generated/paid** | – | – | **❌** | ❌ | 074/084 |
| **KYC approved/rejected** | – | **❌** | **❌** | ❌(no pending ping) | 075 |
| campaign | ✅ (admin-authored) | – | – | – | 078 |

**Push pipeline hygiene:** auth fails-closed on the edge (503/401 if `PUSH_INTERNAL_SECRET`
mismatch) ✅; DeviceNotRegistered pruning ✅; batching @100 ✅; failure-isolated via `pg_net`
async + `EXCEPTION WHEN OTHERS` ✅; **no retry/receipt polling** (best-effort); **copy
English-only** (N4).

## RLS coverage (live)

- RLS disabled: only `spatial_ref_sys` (PostGIS system table) — expected.
- RLS enabled, no policy: `riders` (dead), `promo_codes`, `promo_redemptions` — intentional
  keeps (writes are definer-only; no client SELECT needed).
- `security_definer_view`: `public_drivers` (F7 — advisor ERROR, low-PII, fix = invoker).

## Live-vs-source drift

- **086 not applied** (F3) — repo ahead of prod by one migration.
- **`packages/tokens` palette stale** (N8) — `#ff5a3c` vs app v2 `#F05A1F`.
- **main ahead of every install** (N3) — no OTA/store build carries PR #41–#44.
- Two `026_*` migration files coexist in repo (known; never collide in prod history).

## get_advisors triage

**Security (128):** 1 ERROR `rls_disabled` (spatial_ref_sys, benign) · 1 ERROR
`security_definer_view` (public_drivers → F7) · 3 `rls_enabled_no_policy` (F8 + intentional) ·
`function_search_path_mutable` ×3 (trigger helpers `touch_updated_at`, `set_order_short_code`,
`generate_order_short_code` — should pin, low risk) · `auth_leaked_password_protection` (F6) ·
`extension_in_public` ×2 (postgis, pg_net — cosmetic) · 40 `auth_allow_anonymous_sign_ins`
(intentional guest-first) · 77 `*_security_definer_function_executable` (informational —
mitigated by in-function auth.uid()/auth_role() checks; spot-checked `place_order`,
`redeem_points`, `recent_push_campaigns`, `nearest_drivers` all guard correctly).
**Performance (119):** 30 `auth_rls_initplan` (F5) · 48 `multiple_permissive_policies` (F10) ·
20 `unindexed_foreign_keys` (F4) · 21 `unused_index` (pre-launch, ignore until traffic).

## Couldn't verify (needs owner/live-context)

- Whether `EXPO_PUBLIC_SENTRY_DSN` is set as an EAS **server-side** secret (repo can't see it) — N6.
- The single stuck order (`96b2968b`, `ready` 4h, COD, zone mubarak_7): radius=5km, nearest
  online driver now 1.3km, yet **zero** offer rows. Most consistent with driver online/geo
  drift during the 11:18–12:00 dispatch window in this idle test env — **not** confirmed code
  bug. But it is exactly the case N1 (silent watchdog) would hide in production.

---

## Fix-queue mapping (for Phase 2, on approval)

| ID | 1 branch = 1 commit | New mig? |
|----|---------------------|----------|
| F1 | `fix/f1-revoke-ledger-grants` | ≥087 REVOKE |
| N1 | owner config: set `ops_alert_webhook_url` (Slack/Discord) — I prep, you set |
| N2 | `fix/n2-late-credit-display` (customer app: compute `min(cap, floor(subtotal*pct))`) | no mig |
| F3 | apply `086_saved_orders` on dev → hand prod cmd | (existing 086) |
| F4 | `fix/f4-hot-fk-indexes` (dev IF NOT EXISTS; hand CONCURRENTLY for prod) | ≥087 |
| F5 | `fix/f5-rls-initplan` (~30 policies → `(select auth.uid())`) | ≥087 |
| F7 | `fix/f7-public-drivers-invoker` (`security_invoker=on`) | ≥087 |
| N3/F12 | owner: build+submit 1.0.3, then `eas update --branch production` | — |
| F6/F11 | owner dashboard/billing | — |
| N4/N5/N7/N8/N9/N10/N11 | app-side, batchable per surface | some no-mig |

---

## Phase 2 — remediation status (2026-07-05, "fix all" approved)

Branching on the Supabase project requires the Pro plan (unavailable), so DB
migrations were validated on a **local shimmed Postgres 17/18** apply+assert
harness (the house method) plus an **adversarial 7-lens SQL review** — not a
Supabase dev branch. **Nothing was applied to prod.** All app fixes are on
one-commit branches with PRs; CI shows red on every PR because GitHub Actions is
billing-locked (F11) — jobs report `steps: 0` / no logs (never started), not a
code failure. All were verified locally (tsc clean, tests passing).

### App-side PRs (open, one commit each, locally green)

| ID | Branch / PR | What | Local verification |
|----|-------------|------|--------------------|
| N2 | `fix/n2-late-credit-display` [#46] | Show real SLA credit `min(100, floor(subtotal×10%))` not `round(total×10%)` | tsc ✓; 98 tests ✓ (5 new) |
| N4 | `fix/n4-push-localization` [#50] | Localize push copy ×5 via `users.locale`; +6 N7 keys | deno test 19/19 ✓ |
| N8 | `fix/n8-token-drift` [#49] | Sync `packages/tokens` + web tailwind to v2 palette; kill hard-coded hex | tsc ×3 ✓; tests ✓ |
| N9 | `fix/n9-locale-em-dashes` [#47] | Remove em-dashes from 5 locales (88 strings) | 417-key parity ✓; tests ✓ |
| N10 | `fix/n10-confetti-reduced-motion` [#45] | Confetti respects reduce-motion (fail-closed) | 93 tests ✓ |
| N11 | `fix/n11-rtl-tap-targets` [#48] | Mirror onboarding in RTL; ≥44pt on BackButton/QuantityStepper | 93 tests ✓ |

### DB migrations (authored ≥087, forward-only, NOT applied to prod)

| ID | Migration | Change | Safety |
|----|-----------|--------|--------|
| F1 | `087_f1_revoke_ledger_writes` | REVOKE I/U/D on 10 ledger/authority tables from anon+authenticated | behavior-neutral (RPCs are definer) |
| F4 | `088_f4_fk_indexes` | 18 btree indexes on flagged FKs (hot first) | IF NOT EXISTS; skips 091-dropped cols |
| F5 | `089_f5_rls_initplan` | wrap `auth.uid()`/`auth_role()` → `(select …)` on ~45 policies via ALTER POLICY | logic byte-identical |
| F7 | `094_f7_public_drivers_writeguard` | revoke write grants on the auto-updatable definer view + base `drivers` (closes write-bypass); keep public read | read preserved (rescoped from invoker-flip, which would have broken the customer "your driver" embed) |
| F8 | `091_f8_drop_riders` | drop `drivers.legacy_rider_id` then dead `riders` table | IF EXISTS; 0 rows, 0 refs |
| F9 | `092_f9_backfill_order_financials` | backfill 3 legacy delivered orders' financials (mirrors 062 math; no SLA credit) | anti-join + ON CONFLICT DO NOTHING |
| F10 | `090_f10_consolidate_policies` | collapse 48 duplicate permissive policies (orders 4→1 SELECT; split ALL into I/U/D) | access-equivalent OR of originals |
| N7 | `093_n7_notification_coverage_gaps` | 3 additive push triggers: cancelled→driver, settlement→merchant, KYC→owner/admin | house pattern; new fn names only |

### F3 — migration 086 drift
`086_saved_orders.sql` exists in repo, `to_regclass('public.saved_orders')` = NULL
in prod. No history repair needed — apply it as the next migration.

### Owner-gated — I prepped, you run (nothing here was executed)

**N1 — wire the dispatch watchdog to a human** (`ops_alert_webhook_url` is empty
→ the 2-min watchdog pages nobody). Set a Slack/Discord incoming-webhook, then as
an admin (or via SQL you run):
```sql
update public.platform_settings
   set value = '"https://hooks.slack.com/services/XXX/YYY/ZZZ"'::jsonb
 where key = 'ops_alert_webhook_url';
```
`functions_base_url` is already set, so N7's push triggers fire once deployed.

**F6 — leaked-password protection**: Supabase Dashboard → Authentication →
Policies → enable "Check against HaveIBeenPwned". Keep anonymous sign-ins on.

**N3 / F12 — ship the delight pass (no OTA-capable binary exists yet)**:
```bash
cd apps/customer
eas build --profile production --platform all      # first 1.0.3 binary carries updates.url+channel
eas submit --profile production --platform ios      # and android
# AFTER a 1.0.3 install exists, future JS ships via:
eas update --branch production --message "PR #43 delight pass + audit fixes"
```
Recommend adding a `checkForUpdateAsync` min-version/force-update gate to 1.0.3
before relying on OTA (no kill-switch is compiled into any current binary).

**Edge deploy (after merging N4/N7)** — deploy expo-push so localized + new-event
copy ships:
```bash
supabase functions deploy expo-push --project-ref ilqpsebcfbaoaogimhud
```
Note: `users.locale` defaults to `'ar'`, so users who never chose a language
start receiving Arabic pushes after deploy (intended for a Sharm audience).

**F11 — CI billing lock**: GitHub → Settings → Billing (or make repo public).
Until then, merges gate on local tsc + tests + review.

**N5 — driver/restaurant apps have zero i18n**: spun off as a separate task
(full feature build: mirror customer i18n infra + translate ×5, one PR per app).

### Prod apply order (all owner-run, after PR merges — hand me the go)
```
086_saved_orders → 087 → 088 → 089 → 090 → 091 → 092 → 093 → 094
```
Then `npm run db:types` and sync the 4 apps (091 drops riders/legacy_rider_id
from the generated types). For F4 at scale, use the `CREATE INDEX CONCURRENTLY`
variants (outside a txn) instead of 088 as-is.

**Live DB unchanged. All work is on branches / local. Awaiting your go to apply migrations to prod.**
