# Sharm Eats — Full-Stack A→Z Audit Report

**Date:** 2026-07-31 · **Audited HEAD:** `b11ab0a` (origin/main, clean tree) · **Prod project:** `ilqpsebcfbaoaogimhud` (ACTIVE_HEALTHY, Postgres 17.6, eu-west-1)
**Method:** the repo's own protocol (`docs/FULL-STACK-AUDIT-PROMPT.md`), extended to post-protocol scope (204 migrations, 8 edge functions, 6 surfaces, P07 expansion + P08 delivery). Read-only throughout — no fixes, no writes, no commits.

> **Session notes.** (1) The audit began on a checkout 20 commits behind `origin/main`; the tree was fast-forwarded `a07694a → b11ab0a` before any conclusions were drawn and every local check was re-run at the new HEAD. (2) The deep code-review fan-out hit a billing spend limit partway through. **8 of 13 dimensions completed** (money-core, money-new, state-machine, schema-hygiene, rls-authz, notifications, payments, realtime); **5 did not run** (mobile clients, web clients, reliability/ops, compliance, design/brand) — as did the two matrix builders and the automated dedup/verify passes. Findings below are therefore **corroborated by two independent agent runs plus my own direct code inspection of every P0/P1**, not by the planned automated refutation pass. §4/§5 matrices and §10 record exactly what is missing.

---

## 1. Executive summary

The platform's **foundations are sound and its gates are green**: every local quality check passes at HEAD (typecheck + unit tests on all 6 surfaces, lint + production builds on the 3 web surfaces, 84 Deno edge-function tests, the full isolated-Postgres security-migration suite). In production, **money is conserved exactly** (credit and loyalty ledgers reconcile to balances, zero negative balances), **all 21 cron jobs are live and completing**, **all 14 authority RPCs have exactly one overload**, and postgres/auth/edge logs show **zero errors in 24 h**.

What the deep review found is a consistent pattern worth naming: **the newest, least-exercised code is where the defects cluster** — migrations 194–201 and the Package 03/07/08 work shipped in the last 72 hours. Several are *regressions introduced by fixes*: mig 200 stopped an infinite push loop by routing three notifications into an outbox that has no consumer, so they are now never sent; mig 201 stopped dead seed phones from being dispatched by requiring a fresh ping the driver app never sends while idle. Both were correct diagnoses paired with an incomplete other half.

**3 P0 · 17 P1 · 26 P2** (46 total, 2 P0s being the same defect found independently by both runs — see §2).

**The single most important thing to fix:** the admin dashboard's TOTP 2FA is enforced **only in the browser** while an admin password sat in a public repo for eight weeks and has not been rotated (F-01). Anyone with that password can skip the dashboard entirely and call the admin RPCs directly with the public anon key — reaching commission rates, credit issuance, KYC approval and dispatch.

**Core invariants — live-verified:**

| Invariant | Status |
|---|---|
| `place_order` single overload; recomputes prices server-side | ✅ verified live (1 overload, 12-arg) |
| `advance_order_status` sole writer of `orders.status`; single overload | ✅ verified live |
| Money conserved: ledgers Σ = balances, no negatives | ✅ verified live (0 mismatches) |
| Authority columns not client-writable | ✅ no direct grants found on authority paths |
| Payment webhook HMAC-verified + idempotent | ✅ code + tests reviewed (card currently dark) |
| Dispatch/notification sweeps actually running | ✅ verified live (20 s sweeps completing; expo-push all 200s) |
| **Admin authority requires 2FA** | ❌ **client-side only — F-01** |
| **Every notification reaches its recipient** | ❌ **3 events queue to a consumer that doesn't exist — F-04** |

---

## 1b. Remediation status — **APPLIED TO PRODUCTION 2026-08-01**

Migration **`202_audit_20260731_p0_p1_fixes.sql`** plus the client-side halves fix
both P0s and 9 of the P1s. Every fix is covered by an assertion in
`supabase/tests/202_audit_fixes.test.sql` (31 assertions, wired into
`scripts/test-security-migrations.sh`, so CI gates them) or by unit tests.

**Production status:** applied in 10 ledgered sections
(`202a_audit_f01_admin_aal_gate` … `202j_revoke_schedule_trigger_fn_from_public`).
Post-apply verification: 11/11 new functions live, 4/4 replaced functions at
exactly one overload each (no PGRST202 risk), 5/5 new cron jobs active and
completing, no new advisor ERRORs, `db:types` regenerated. The DB-side fixes are
live now; **the client halves (F-02 heartbeat, F-03 locale, F-16 resync) ship
with the next app/web release** — they are code, not schema.

Two things the apply itself proved:

- **F-04 was real and live.** The first dispatcher tick found a `driver_assigned`
  push that had been sitting `queued` since 10:07 that morning — never sent,
  exactly as diagnosed. It was correctly settled `suppressed/expired` rather than
  delivering a ~12-hour-late "your driver is on the way".
- **F-15 found a genuinely stuck order immediately.** `dispatch_stuck_rows()`
  returned a `ready` order with an unanswered offer **10,413 minutes (~7.2 days)**
  old — the `stale_offer` shape mig 133's watchdog is structurally blind to. It
  had been invisible in production the whole time. Ops will now be alerted
  within 5 minutes.

| ID | Fix | Verified by |
|---|---|---|
| F-01 | `require_admin()` — role **and**, when the account has a verified factor, an `aal2` session. `auth_aal()` reads the JWT claim; `admin_mfa_posture()` reports who is still password-only. Enrolment arms it, so deploying cannot lock the only admin out. | 4 assertions incl. NULL-role fails closed |
| F-02 | Driver idle heartbeat (`startIdleHeartbeat`, 120 s vs the 300 s window), wired to the online toggle **and** to an already-online mount. | 7 unit tests |
| F-03 | Locale reaches `users.locale`: `signInAnonymously` now passes it as signup metadata, and the two pickers sync it. | 4 unit tests |
| F-04 | `dispatch_push_outbox()` claims queued rows (`FOR UPDATE SKIP LOCKED`) and hands them to expo-push; expires stale ones; `reclaim_stuck_push_messages()` covers a crashed dispatcher. Cron every 30 s. | 3 assertions incl. no double-send |
| F-05 | `dispatch_push_retries()` finally calls mig 173's `claim_push_retries`. Cron every 2 min. `push_receipt_sweep` is now scheduled *in a migration*. | covered by F-04 harness |
| F-06 | `mark_cod_collected` requires `status = 'delivered'` and settles at most once. | 3 assertions |
| F-10 | Proof-path guard computes the suffix first and uses `IS DISTINCT FROM` — fails closed. | 3 assertions incl. valid path still works |
| F-11 | `assign_driver` locks the order and validates its status. | 1 assertion |
| F-12 | …and releases the displaced driver back to `online`. | 1 assertion |
| F-13 | `driver_respond` re-checks the parent order under lock before accepting. | 2 assertions |
| F-14 | `scheduled_orders_enabled` setting + a BEFORE INSERT/UPDATE trigger on `orders`. | 3 assertions incl. the re-enable path |
| F-15 | `dispatch_stuck_report()` sees offer-churn and stale manual offers; `dispatch_churn_watchdog()` alerts. | 2 assertions |
| F-16 | DispatchBoard resubscribe now refetches (the `[H-CUST2]` fix every other surface had). | admin-web build + lint |
| F-17 | `private.delivery_encrypt/decrypt` search_path includes `extensions`. | applied in-migration |
| P2s | 5 private tables revoked (house rule 5b); `__pre_mig126_129_snapshot` moved out of `public`; 3 `delivery_jobs` FK indexes. | applied in-migration |

**Deliberately NOT auto-fixed** (they need a decision, not a patch): F-07 (lost
Paymob webhook — needs a transaction-inquiry poll, and card is dark), F-08/F-09
(promo/credit release — the right behaviour is a product call: re-credit the
wallet vs. resurrect the code), and the remaining P2s.

**Still required and NOT a code change: rotate the leaked admin and driver
passwords** (commit `d3427a6`). F-01 makes a stolen password insufficient *once a
factor is enrolled* — it does not un-leak it. **Neither of the 2 admin accounts
had a verified MFA factor at apply time**, so F-01 is currently inert for both:
it arms per-account the moment that account enrols. Run `select * from
public.admin_mfa_posture();` and enrol every account it lists with
`has_factor = false`.

**New drift observed during the apply:** a migration named
`platform_settings_secret_keys_lockdown` (version `20260731213852`) was applied
to production ~40 minutes before this work and has **no corresponding file in
`supabase/migrations/`**. Same class as the `restore_verbatim_internal_bodies`
row in §7 — the repo cannot reproduce production. Worth back-filling a file.

> Note on method: my first draft of this migration rewrote `assign_driver`,
> `driver_respond`, `mark_cod_collected` and `record_delivery_proof` from the
> audit's descriptions. Checked against the live bodies, that draft would have
> silently reverted the mig 149/150 COD exposure ceiling, the mig 083 assign
> push, `driver_earnings`, `rider_snapshot()` and the driver-role gate — house
> rule 2's failure mode exactly. Each is now the verbatim current body with only
> the marked `[202]` insertions.

---

## 1c. P2 remediation — **written and tested 2026-08-01, NOT applied to production**

Migration `203_audit_20260731_p2_fixes.sql`, plus client changes. Unlike mig 202 this has **not** been applied — apply it deliberately.

| § | P2 | Fix |
|---|---|---|
| 203a | P2-12 | `my_kyc_documents` / `recent_push_campaigns` / `my_restaurant_settlements` revoked from PUBLIC+anon; admin disjuncts made fail-closed with `coalesce`. Re-revoked *after* the `CREATE OR REPLACE` (which resets the ACL to include PUBLIC — revoking first would have been undone). |
| 203b | P2-16/19 | `settle_paymob_payment` → `is distinct from`. |
| 203c | P2-15 | `create_delivery_job` guards `v_cfg.service_area_id is null` first. |
| 203d | P2-05 | Settlement pushes carry `route`, not a settlement UUID in `orderId`. |
| 203e | P2-04 | New `driver_settlements` trigger → `enqueue_push` (the outbox mig 202 gave a dispatcher), keyed per settlement per event. |
| 203f | P2-13 | `search_path` pinned on all five advisor-flagged invoker functions. |
| 203g | P2-01 | `orders_tip_plausible` (≤5000) + `order_items_quantity_plausible` (≤100), `NOT VALID` then validated. Constraints, not a `place_order` edit — a constraint cannot be reverted by a later `CREATE OR REPLACE`, and it covers every writer. |
| 203h | P2-00 | `promo_redemptions` trigger locks the `promo_codes` row and numbers each redemption, + a partial unique index. Closes the cross-user `max_uses` race that the per-USER advisory lock never covered. |
| 203i | P2-17/20 | Private-schema table revoke sweep (idempotent re-run). |
| — | P2-14/18 | `197_gen_random_bytes_search_path_fix.sql` renamed to `20260730223634_…` — **the version prod already recorded**, so the repo now matches the live ledger rather than inventing a third number. |
| client | P2-02 | Driver cash-change reader mirrors the writer's plausibility ceiling (`payable + 200×5`). |
| client | P2-03 | Driver + restaurant locale sync to `users.locale`, incl. a start-up backfill for people who chose Arabic before this shipped. |
| client | P2-10 | Stale-channel teardown guard on both dashboards. |
| client | P2-11 | Admin support inbox subscribes to `support_messages` (+ resync on reconnect). |

### What the house-rule-2 check caught this round

Hashing every live body against every repo migration before writing a line found **three functions where the repo does not match production**:

- **`settle_paymob_payment` runs mig 121's body, not mig 180's.** The audit cited `180:308`. Mig 180's rewrite was never applied. Fixing "180's version" would have shipped that entire unapplied rewrite as a side effect.
- **`create_delivery_job`** — no repo migration matches the live body (193 has drifted).
- **`notify_settlement_change`** — same (093 has drifted).

All three are therefore patched by `pg_get_functiondef` + `replace()` with a pre-assertion that the exact target text exists, so **if prod has drifted again the migration fails rather than silently rewriting something it does not recognise**.

Two further defects were caught in my own work: the migration first used `promo_redemptions.promo_code_id` (prod's column is `promo_id`), and the **203i assertion was vacuous** — a bare Postgres grants nothing by default, so it passed with or without the fix. Found by running a per-section negative control; fixed by reproducing prod's `ALTER DEFAULT PRIVILEGES` hazard in the harness. All nine sections now fail the suite when removed.

### Corrections to the audit's own claims

- **P2-05 impact was overstated.** The audit predicted a tap landing on `/order/<settlement-id>`. It does not: the restaurant app routes on `event` and ignores settlement events, and merchant-web has no push tap handler. The id is inert today — a latent category error, not a live broken link. Fixed anyway; it costs nothing.
- **P2-24** (scheduled orders accepted server-side) was already closed by mig 202's trigger.
- **P2-06 / P2-07** (push receipts cron, retry runner) were already closed by mig 202.

### Verification

DB suite **95 assertions, exit 0** · driver 100 tests · restaurant 70 · customer 569 · merchant-web 76 · Deno 84 · all six typechecks clean · both Next.js apps build.

> **Pre-existing, unrelated:** `next build` fails locally on `/reset-password` (`supabaseUrl is required`) in **both** web apps. Confirmed on a stashed baseline — it is missing local `.env.local`, not a regression. With env supplied, both build clean.

---

## 2. Findings table

Confidence: **Verified** = reproduced via query/log/direct file read · **Strong** = clear from code · **Inferred** = reasoned.
"Corroboration" notes where two independent agent runs found the same defect (✓✓) and where I personally read the cited lines (👁).

| ID | Sev | Dimension | Title | Evidence | Confidence |
|---|---|---|---|---|---|
| F-01 | **P0** | rls-authz | admin-web TOTP enforced only in the browser; no server-side AAL check anywhere — leaked admin password still opens ops/finance/KYC | `login/page.tsx:37-59`, `lib/mfa.ts:49-61`; zero `aal` hits in `supabase/migrations` + `functions`; no `middleware.ts`; commit `d3427a6` (repo public 8 wks, rotation pending) | Verified 👁 |
| F-02 | **P0** | state-machine | Mig 201 fresh-ping gate has no client counterpart — idle online drivers vanish from dispatch 300 s after their last ping | `201_dispatch_requires_fresh_ping.sql:61-64`; `driver_ping` called only at online/offline toggle + foreground + active-delivery stream (`location.ts:113,130`, `home.tsx:113,156,162`, `backgroundLocationTask.ts:72` early-return); no heartbeat `setInterval` in the app | Strong ✓✓👁 |
| F-03 | P1 | notifications | `users.locale` never written by any client, defaults to `'ar'` — all push copy renders in Arabic regardless of app language | `expo-push/index.ts:263-276`; `124_signup_role_hint_lockdown.sql:59` (`coalesce(...,'ar')`); `auth.ts:149,185` sign-in passes no metadata; language picker writes only zustand/AsyncStorage | Strong |
| F-04 | P1 | notifications | Mig 200 routes `driver_assigned` / `order_ready_pickup` / `low_rating` into a push outbox with **no dispatcher** — never sent | `200_driver_assigned_notification_loop.sql:60-97` → `enqueue_push`; `172_enqueue_push.sql:93-113` only INSERTs `status='queued'`; no consumer of queued rows in any migration or edge function | Strong ✓✓ |
| F-05 | P1 | notifications | Push retry pipeline is dead code — `claim_push_retries`/`settle_push_attempt` have no caller, so `retryable_failed` is never re-sent | `173_push_retry_claim.sql:64-145`; zero callers repo-wide; no `cron.schedule` invokes it; producers keep minting retryable rows (`expo-push/index.ts:337-355,403-414`) | Strong ✓✓ |
| F-06 | P1 | payments | `mark_cod_collected` has no order-status gate — COD markable paid pre-delivery or on a cancelled order | `104_driver_cash_reconciliation.sql` — checks method, amount, actor; **never** `v_order.status`; gate exists only in driver UI (`jobs.ts:367-373`) | Verified 👁 |
| F-07 | P1 | payments | A genuinely *lost* Paymob webhook leaves a captured charge with zero local trace; mig 181 reconciles late webhooks, not lost ones | `033_card_payment_guards.sql:178-205` cancels after 30 min regardless of provider state; every 181 detector keys off a `paid` row (181:99-111,114-126,217-227); nothing polls Paymob's inquiry API | Strong |
| F-08 | P1 | money-core | Rejected/cancelled orders permanently consume one-time minted credit codes — no redemption release, no wallet re-credit | `153_vertical_stage_enforcement.sql:334-339` inserts redemption at placement; `058` counts all redemptions with no outcome filter; no DELETE/void on any cancel path across 204 migrations | Strong |
| F-09 | P1 | money-core | Credit→code conversion burns the remainder when code value exceeds order subtotal | `rewards.tsx:162` redeems entire balance; `122:75-122` debits in full; `058` caps discount at subtotal; `per_user_limit=1` consumes the code | Strong |
| F-10 | P1 | money-new / schema | `record_delivery_proof` path guard NULL-propagates — any suffix-less path accepted, forging proof rows | `194_proof_of_delivery.sql:240-245`: `substring()` returns NULL → whole comparison NULL → `raise` never fires; test only covers well-formed suffixes | Verified ✓✓👁 |
| F-11 | P1 | state-machine | `assign_driver` never validates or locks the order — offers on terminal orders, and races `auto_assign_order` into double offers | `150_cod_ceiling_enforcement.sql:41-90` (no `orders` SELECT, no `FOR UPDATE`) vs `189:27-30` which locks and guards | Strong |
| F-12 | P1 | state-machine | Manual reassignment strands the displaced driver `on_job` forever (mig-054 fleet decay, alive on the dispatcher path) | `150:82` repoints `assigned_driver_id`, never resets old driver's `drivers.status`; only release is in `advance_order_status` (054:119, 103:92), keyed to the *new* driver | Strong ✓✓ |
| F-13 | P1 | state-machine | Driver can accept an already-cancelled order → permanently `on_job`, dispatched to a restaurant for food never handed over | `030_driver_verified_gate.sql:80-103` checks only `status='offered'`, never reads `orders.status`; cancel-time release runs *before* the accept | Strong |
| F-14 | P1 | state-machine | Scheduled orders gated client-side only — `place_order` stores arbitrary `scheduled_for`, every sweep ignores it | `153:145,306,320` (no validation); no `scheduled` reference in sweeps 025/026/033/039/060/189; gate lives in `checkout.tsx:144-145` | Strong ✓✓ |
| F-15 | P1 | state-machine | `dispatch_watchdog` blind to the two stuck shapes that actually occur (offer-churn, never-expiring manual offers) | `133_watchdog_placed_orders.sql:~40-45` requires `assigned_driver_id IS NULL`; churn stamps it at offer time (189:84). The 3,429-lap incident was found by a *user report* (mig 200 header) | Verified |
| F-16 | P1 | realtime | Admin `DispatchBoard` has no reconnect resync — events lost during a socket drop leave the ops board silently stale | `DispatchBoard.tsx:60-84` subscribes with no status callback, never refetches; every other consumer carries the `[H-CUST2]` fix (`orders.ts:298-313`, `OrderQueue.tsx:102-118`, `restaurant/orders.ts:317-324`, `driver/jobs.ts:293-295`) | Verified |
| F-17 | P1 | schema-hygiene | `private.delivery_encrypt`/`delivery_decrypt` pin a `search_path` excluding `extensions` while calling bare `pgp_sym_encrypt/decrypt` | migs 191-193; mig 197's plpgsql_check sweep covered only `nspname='public'`, so `private` was missed | Strong |
| F-18…F-20 | P1 | (dup pairs) | F-02/F-04/F-05/F-10/F-12/F-14 each found independently by both runs — counted once above | — | — |
| **P2 (26)** | P2 | various | Grouped in §3.3: promo `max_uses` race · unbounded `p_tip`/quantity · unbounded cash tender · duplicate migration version `197` (×2) · 5 private tables missing house-rule-5b revoke (×2) · `settle_paymob_payment` NULL-unsafe `<>` (×2) · `create_delivery_job` fails open on missing config · `my_kyc_documents` not revoked from anon · advisor `search_path` noise (all SECURITY INVOKER) · driver settlements never notify drivers · settlement push deep-links to a bad route · `push_receipt_sweep` cron not in any migration · mig 200 dropped mig 165's vertical context · late card settlement writes `placed` + `order_paid` on a cancelled order · realtime teardown guards missing (2 surfaces) · admin support inbox neither subscribes nor polls · offer-cooldown starves orders · `auto_advance` timer refreshed by churn · driver_assigned dedupe fires at offer time · AR locale sync (×2) · unindexed FKs / unused indexes / no-PK snapshot table · leaked-password protection disabled | see merged findings JSON | Strong/Verified |

## 3. Per-finding detail

### 3.1 P0

**F-01 — admin-web 2FA is a prompt, not a permission.**
What I checked: every `aal`/`mfa` reference in the repo, `apps/admin-web` for a `middleware.ts`, and how admin RPCs gate.
What I found: all MFA logic lives in two client files (`login/page.tsx`, `security/page.tsx`). There is **no** `middleware.ts` and **zero** `aal`/`assurance_level` references in any migration or edge function. `lib/mfa.ts:49-61` even documents the deferral — *"The database is the real authority on what an aal1 session may do; this gate is a prompt, not a permission"* — but the database never performs that check. Every admin RPC gates on role alone (e.g. `coalesce(public.auth_role()::text,'') <> 'admin'` in `20260730162600_p07_governance_hardening.sql:190`, `184:160`, `185:38`, `182:211`).
Why it matters: an attacker with the leaked password (commit `d3427a6` — public repo for 8 weeks, git history retains the blob, **rotation still pending**) never visits the dashboard. They POST to `/auth/v1/token?grant_type=password` with the public anon key, get an aal1 JWT, and call the admin RPCs directly through PostgREST. TOTP enrolment changes nothing on that path. Reach: commission rates, credit issuance (real money out), KYC approval, FX rates, vertical launch stage, dispatch. The mitigation shipped for this exact incident provides zero protection against the incident's own threat model.
Fix sketch: (1) **Rotate both passwords now** — this is independent of any code change; (2) add a server-side AAL assertion to admin authority — an `auth_aal()` helper reading the JWT's `aal` claim, asserted inside the admin RPCs (or a `require_admin()` used by all of them); (3) delete/repoint the dormant `ops@sharmeats.test` admin account named in the same commit.

**F-02 — the fresh-ping gate the client never satisfies.**
What I checked: mig 201's filter, then every `driver_ping` call site in the driver app.
What I found: `nearest_drivers` now requires `last_ping_at > now() - 300s`. `driver_ping` is called in exactly four places — going online (`home.tsx:156`), going offline (`:162`), AppState foreground transition (`:113`), and the background location stream, which returns early unless an active order is stored (`backgroundLocationTask.ts:72`). There is **no idle heartbeat** anywhere (the only `setInterval`s in the app are UI countdowns).
Why it matters: an online driver waiting between jobs with the phone pocketed stops satisfying the filter after 5 minutes and is silently excluded from every dispatch. At launch scale (small fleet, drivers waiting) this deadlocks: no candidate → no offer row → no push → nothing wakes the driver, who is waiting for exactly that push. Orders sit until `dispatch_watchdog` pages ops — and per F-15 the watchdog is partly blind to this shape. Applied 2026-07-31; the migration correctly killed dead-seed-phone dispatch but assumed idle pings that the client never sends.
Fix sketch: add an idle heartbeat (`pingOnce()` on a 60–120 s timer while `status==='online'` and not streaming, plus a background-fetch task for backgrounded phones) — JS-only, shippable OTA. Until then, raise `platform_settings.dispatch_max_ping_age_seconds` to cover a realistic idle window.

### 3.2 P1 (17)

Grouped by theme; full evidence in the table above.

**Notifications are the weakest area right now.** Three defects compound: F-04 (three events queue to a non-existent consumer — customers are never told a driver is coming, drivers never hear an order is ready, merchants never hear about low ratings), F-05 (retryable failures are recorded and never retried — a 429/5xx during a marketing peak is silent permanent loss), F-03 (all copy renders from a `locale` column frozen at `'ar'` at signup, making the 29-event × 5-locale copy layer unreachable — a Russian tourist gets Arabic lock-screen notifications). Note F-04 and F-05 are both "the outbox has no runner" — one dispatcher job fixes both.

**Driver-fleet erosion has three live paths.** F-12 (manual reassignment never releases the displaced driver), F-13 (accept-after-cancel leaves a driver `on_job` with no job), F-11 (`assign_driver` neither validates nor locks the order — terminal-order offers plus a double-offer race with the 20 s sweep). Each strands a real driver outside the dispatch pool until they manually toggle offline/online, while their app still reads "online · receiving offers". This is the mig-054 bug re-entering through the dispatcher edges.

**Money defects are bounded but customer-facing.** F-08 (a merchant rejection permanently consumes the customer's compensation credit — no release, no re-credit; this touches the SLA-credit promise that carries Consumer Protection Law 181/2018 exposure) and F-09 (converting a 100 EGP balance against an 80 EGP basket silently destroys 20 EGP).

**Payments.** F-06 (`mark_cod_collected` has no status gate — verified by reading mig 104: method, amount and actor are checked, status never is; a paid+cancelled COD order has no un-pay path and still feeds driver settlement) and F-07 (dormant while card is dark, but a truly lost webhook means a charged customer with no local record at all).

**Integrity/ops.** F-10 (proof-of-delivery path guard fails open — verified at `194:240-245`; a driver can mint a proof row with no bytes behind it, whitewashing the only control policing photo-less COD deliveries), F-15 (watchdog blind to churn loops — evidenced by the 3,429-lap incident being found by a user, not the alert), F-16 (admin dispatch board goes silently stale after any network blip; it is the only realtime consumer missing the reconnect refetch every other surface has), F-17 (`private.delivery_encrypt/decrypt` resolve `pgp_sym_*` on a `search_path` that excludes `extensions`).

### 3.3 P2 (26) — **remediated 2026-08-01, NOT yet applied to production**

> **Status.** Migration `203_audit_20260731_p2_fixes.sql` + client changes close every P2 that does not need a product decision. Written and tested; **not applied to prod** (unlike mig 202). 22 new DB assertions, each with a proven per-section negative control; 12 new client unit tests. See §1c.

Hygiene and defense-in-depth; none currently exploitable. Highlights: **duplicate migration version `197`** (two files share the prefix — breaks fresh replays through the version-keyed ledger); **five `private` tables in migs 191-193 missing the house-rule-5b revoke** (protected today only by absent schema USAGE); **`settle_paymob_payment`'s NULL-unsafe `<>` on `paymob_txn_id`** (house rule 4); **unbounded `p_tip`/quantity and cash tender** (menu prices got plausibility rails in mig 132; tip and quantity did not); **`my_kyc_documents` never revoked from PUBLIC/anon** (house rule 3 — anon call returns empty since `auth.uid()` is null, hence P2); **`push_receipt_sweep` scheduled out-of-band** (a rebuilt DB loses it silently); **mig 200 rebuilt `notify_order_transition` from mig 073's body, discarding mig 165's vertical context**. Also: the advisor's 5 mutable-`search_path` functions are all SECURITY **INVOKER** — advisor noise, not an escalation path (still worth pinning). Full list with evidence in the merged findings JSON referenced in §9.

## 4. Order state-machine transition matrix

**Not produced** — the matrix-builder agent failed on the spend limit in both runs. Partial transition facts established incidentally by the state-machine dimension are cited in F-11 through F-15 (cancel reachable from any non-terminal state per `103:70-71`; terminal release at `054:119`/`103:92`; auto-accept at `026:82-91`; auto-advance keyed on `updated_at`). Rebuild this section by re-running the `matrix-state-machine` agent.

## 5. Notification coverage matrix

**Not produced** — same cause. However the notification dimension did complete and its findings (F-03, F-04, F-05, plus P2 items on driver settlements, deep-link routing and vertical context) are the substantive holes that matrix would have surfaced. Rebuild via the `matrix-notifications` agent.

## 6. RLS coverage

- **84 tables in `public`.** RLS enabled on all except `spatial_ref_sys` (PostGIS system table, write-guarded by migs 102/109 — advisor ERROR dismissed with reason) and `__pre_mig126_129_snapshot` (leftover manual-migration backup with no client grants — drop it).
- **22 tables have RLS enabled with zero policies** (deny-all through PostgREST). 20 have client grants fully revoked — correct internal-only posture. Two carry latent default grants: `promo_redemptions` (anon+authenticated SELECT/INSERT/UPDATE/DELETE) and `promo_codes` (anon+authenticated SELECT). RLS deny-all blocks them **today**; the grants violate house rule 5b and become live holes the moment any permissive policy is added. No TRUNCATE grants on either.
- Live per-user isolation probes were **not** run (see §10).

## 7. Live-vs-source drift

| Check | Result |
|---|---|
| Migration ledger vs repo files | **141 ledger rows / 204 files.** All 64 unledgered files are covered by `scripts/db-drift-baseline.txt` (documented hand-applied eras). ✅ No authored-but-never-applied migration. |
| Ledger rows without a repo file | **1**: `20260730162500_restore_verbatim_internal_bodies`. Content fetched from the ledger: a comment-only re-apply so `pg_proc.prosrc` matches the repo byte-for-byte. Behaviour-neutral — but unreproducible from the repo, and `check-db-drift.sh` only checks file→ledger, so this direction is unmonitored. |
| Deployed edge functions | 5 of 8 (`delete-account`, `expo-push` v17, `paymob-webhook` v5, `telegram-bot` v3, `expo-push-receipts` v1). Not deployed: `paymob-create-intention`, `paymob-refund` (card dark — intentional), **`kyc-upload`** (UI paths reference it). |
| Generated types | Current except **`site_health_checks`** (mig 199) — run `npm run db:types`. |
| Web version manifests | `sharmeats.online` ✅ (`760c06c`, clean). **`merchant.` and `admin.` return app HTML for `/version.json`** — manifest not deployed, so the daily `production-drift.yml` fails ❌ on both by its own rules. |
| Extensions | `postgis@public`, `pg_net@public` (advisor-WARNed; write paths guarded), plus `pg_cron`, `pgcrypto`, `supabase_vault`, `pg_stat_statements`, `plpgsql_check`, `hypopg`, `index_advisor`, `uuid-ossp`. |
| **Orders vs financials** | **3 of 12 delivered orders have no `order_financials` row** (2026-07-19/20/21, all COD, `commission_pct_snapshot` NULL). `order_financials_failures` is **empty** — the failure path didn't fire either. Commission for those orders was never recorded. |

## 8. Supabase advisors triage

**Security (253 lints):**

| Lint | Count | Triage |
|---|---|---|
| ERROR `rls_disabled_in_public` (`spatial_ref_sys`) | 1 | Dismissed — PostGIS system table, writes blocked by migs 102/109. |
| ERROR `security_definer_view` (`public_drivers`) | 1 | Accepted — intentional curated view (mig 094 write-guard). |
| WARN `function_search_path_mutable` | 5 | Kept as P2 — all five are SECURITY **INVOKER**, so not an escalation path; pin anyway (house rule). Note the genuinely risky pair is `private.delivery_encrypt/decrypt` (F-17), which the advisor does **not** flag. |
| WARN `anon_security_definer_function_executable` | 30 | Triaged — guest-first RPCs (browse/quote/track/share/waitlist) are intentional; `my_*` no-op for anon. One exception kept: `my_kyc_documents` (P2, house rule 3). |
| WARN `authenticated_security_definer_function_executable` | 126 | Expected — RPC-first architecture; role checks live inside the functions. |
| WARN `auth_allow_anonymous_sign_ins` | 64 | Expected — guest-first product. |
| WARN `auth_leaked_password_protection` disabled | 1 | Kept (P2) — enable HaveIBeenPwned; especially given F-01. |
| WARN `extension_in_public` | 2 | Deferred hardening. |
| INFO `rls_enabled_no_policy` | 23 | See §6 — 2 with latent grants, rest correct. |

**Performance:** no ERROR/WARN. 29 unindexed FKs (mostly new P07/P08 audit tables, incl. 3 on `delivery_jobs`), ~50 never-used indexes (24-order dataset — expected), 1 no-PK table. One P2 hygiene item; act when volume makes it real.

## 9. Checks-run appendix

**Phase B — local suite at `b11ab0a`** (re-run after fast-forward):

| Surface | typecheck | tests | lint | prod build | other |
|---|---|---|---|---|---|
| apps/customer | ✅ | ✅ | — | — | expo-doctor 20/20 ✅ |
| apps/driver | ✅ | ✅ | — | — | expo-doctor 20/20 ✅ |
| apps/restaurant | ✅ | ✅ | — | — | expo-doctor 20/20 ✅ |
| apps/merchant-web | ✅ | ✅ | ✅ | ✅ | |
| apps/admin-web | ✅ | — (no test script) | ✅ | ✅ | `npm ci` ✅ after lockfile update |
| landing | ✅ | — (no test script) | ✅ | ✅ | |
| supabase/functions | `deno check` ✅ | `deno test` ✅ 84/84 | — | — | |
| supabase/migrations | — | `test-security-migrations.sh` ✅ all suites | — | — | isolated Postgres 18.4 |

**Phase C — production (read-only):** 21/21 cron jobs active; postgres log shows sweeps completing every 20 s with zero errors; auth log 86 info / 14 warning / 0 errors; edge log 100 % HTTP 200. Money: credit Σ = balances ✅, loyalty Σ = balances ✅, negatives 0 ✅. Orders: 24 total, 12 delivered, **9 financial rows (3 missing — §7)**, 8 settlements, `order_financials_failures` empty.

**Phase E — runtime web check:** all 25 routes across landing (7), merchant-web (5), admin-web (13) returned HTTP 200 with zero error markers against live Supabase (dev servers, real anon key). Landing's 5-locale switcher + RTL confirmed in code (`landing/src/i18n/dictionaries.ts`, `page.tsx:42-49`) — client-rendered, hence absent from raw HTML (SSR/SEO nuance only). In-browser console/network capture was **not** possible (extension not connected).

**Phase D — code audit fan-out:** 8/13 dimensions completed across two runs (46 findings). Raw merged findings with full evidence/impact/fix text for every item, including all 26 P2s: **`docs/audit-2026-07-31-raw-findings.json`** (committed alongside this report).

## 10. What I could NOT verify

**Dimensions that never ran** (billing limit): mobile clients (customer/driver/restaurant UI state handling, i18n/RTL, secret scanning), web clients (merchant/admin route guards beyond F-01, CSV importer UI, landing), reliability/ops (edge-function error handling, backup/restore posture, EAS/Sentry), compliance (SLA auto-credit promise-vs-code, account deletion completeness, VAT), design/brand (token drift, banned patterns). **Re-run these before treating the audit as complete.**

**Process steps skipped:** the automated dedup pass and the 2-refuter adversarial verification. I substituted direct inspection of every P0/P1 and cross-run corroboration, but P2s carry single-agent confidence only.

**Also unverified:** live tenant-isolation probes (would require signing in as real users); in-browser console errors and authenticated dashboard flows (extension not connected, no test credentials); Paymob card end-to-end (dark); push delivery on a real device; whether the laptop-launchd backup job actually fires; `check-db-drift.sh` full run (needs `DATABASE_URL` — ledger reconciliation reproduced via MCP instead); deployed-function source equality with the repo.

## 11. Verdict

**Not yet a "super working app" — but much closer than the finding count suggests.** The architecture holds: authority is genuinely in Postgres, money reconciles exactly in production, and every automated gate is green. The defects cluster almost entirely in code shipped in the last 72 hours, and several are half-finished fixes rather than design flaws.

Three things stand between it and that claim:

1. **Rotate the leaked admin password and enforce 2FA server-side** (F-01) — the only finding an outsider can exploit today.
2. **Give the push outbox a dispatcher** (F-04 + F-05) — three notification types, including "your driver is on the way", are currently sent to nobody.
3. **Ship the driver idle heartbeat** (F-02) and close the three driver-stranding paths (F-11/F-12/F-13) — otherwise the fleet quietly shrinks out of dispatch during real operation.
