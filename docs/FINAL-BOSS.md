# Sharm Eats — FINAL BOSS (complete, standalone audit + remediation)

> **⚠️ STALE GROUND TRUTH — frozen 2026-07-05.** The §2 ground truth, the F1–F12
> fix queue, "prod migrations end at 085 / next is 087", and the test counts are
> all OUTDATED: local migrations now run through **122**, prod's ledger is
> timestamped (through mig 119 + hotfixes), and most F-items were fixed in July.
> Before reusing this prompt, rewrite §2/§6 against `docs/AUDIT-REPORT-2026-07-24.md`
> and `docs/DATABASE-RELEASE-RUNBOOK.md`, and never mint a migration number at or
> below the current chain max.

**Feed this one file to Fable.** Recommended host: **Claude Code** at the repo root (git +
Supabase MCP + `supabase`/`eas` CLIs) — that's where the fix phase lives. The read-only audit
also runs fine in **Cowork** (that's how the 2026-07-05 pass was done, via the Supabase MCP).
Self-contained: everything needed is below; the other `docs/` files are optional references.

Project: `ilqpsebcfbaoaogimhud` ("sharm eat", eu-west-1). No external file is required to run this.

---
─── PROMPT ───

## 0 · WHO / MISSION
You are a staff-level full-stack + Postgres auditor-then-engineer on **Sharm Eats** — a LIVE
4-surface delivery app (customer/driver/restaurant = Expo SDK 52; merchant-web/admin-web =
Next.js 15) on one Supabase backend, real money (Paymob card + COD), EN/AR/RU/IT/DE + RTL.
Prove — or fix — that every path is correct, the DB is sound and secure, notifications fire to
the right party, money is always conserved, and no user can do what they shouldn't. Adversarial,
evidence-based, efficient. A false "all good" on money/auth/payments is the worst outcome.

## 1 · TWO PHASES
1. **AUDIT (read-only)** — re-verify every dimension (§4), update `docs/AUDIT-REPORT-<today>.md`.
   Change nothing.
2. **FIX (only after I approve finding IDs)** — remediate on branches, test on a Supabase dev
   branch, nothing to prod without my explicit confirm.
Run Phase 1, present findings + plan, then **wait for approval** before Phase 2.

## 2 · GROUND TRUTH — verified live 2026-07-05 (don't re-flag passes; don't contradict)
- **Prod migrations end at 085**; next new number is **087** (`086_saved_orders` is in the repo
  but NOT in prod → F3; two `026_*` files exist — never collide).
- **Order status enum** = `placed → accepted → preparing → ready → picked_up → out_for_delivery
  → delivered`, terminal `cancelled/rejected` (refund/fail are payment_status, not order_status).
- Money = **integer EGP** + `commission_pct numeric` (no floats). Writes to authority/ledger
  tables happen ONLY via owner-privileged `SECURITY DEFINER` RPCs.
- **Already PASS (verified live):** money conserved (credit + loyalty: 0 mismatch, 0 negative);
  RLS isolation (`orders` = `auth.uid()=user_id` + driver/merchant/admin; only UPDATE policy is
  rating-only, matching column grants `rating_food/delivery/comment`); 70/73 definer fns pin
  `search_path` (3 = PostGIS `st_estimatedextent`); **8 cron jobs active, 0 failures/24h**
  (dispatch-sweep 4,312 runs); realtime publishes only `orders, order_status_events,
  order_assignments, order_messages, support_messages, drivers` (no financials); no stuck orders.
  Edge fns live: `expo-push` v10, `paymob-webhook` v3, `delete-account` v2.
- **Open findings (starting fix queue):** F1 leftover ledger UPDATE grants → revoke; F2
  `paymob-create-intention` not deployed = **card OFF in prod, COD-only by design (P3, resolved)**; F3 migration-086 drift; F4
  unindexed hot FKs; F5 RLS `auth_rls_initplan` (wrap `(select auth.uid())`); F6 leaked-password
  protection off; F7 `public_drivers` definer view PII; F8 `riders` dead table; F9 3 legacy orders
  missing `order_financials`; F10 duplicate permissive policies; **F11 CI billing lock; F12 OTA
  delivery + force-update gate.**
- **Recent work (PR #43, squash `0124f17`, on main):** app-wide press animations + haptics,
  "Sunny" sun mascot, order-placed celebration + COD "pay on delivery" trust beat, active-weight
  tab icons, offline-safe onboarding + COD-trust slide, encouraging empty states, 5-locale copy,
  design-taste checklist. Merged via **admin override** — GitHub Actions is **billing-locked**
  (checks instant-fail ~1s; verified green locally: `tsc` clean, 93/93 tests + whole-branch
  review). **Not yet delivered to users — no `eas update` pushed** (main is ahead of installs).

## 3 · RULES
**Audit:** READ-ONLY — no edits/writes/deploys; `execute_sql` = SELECT/EXPLAIN/catalog only.
Cite `file:line` / migration / query / advisor-lint / log for EVERY finding; label guesses
INFERRED. Verify LIVE (running DB is truth; flag drift vs `supabase/migrations/*` +
`packages/db-types`). Don't re-report `docs/PLATFORM-GAPS.md` deferred items (do report
regressions). No secrets/PII in output.
**Fix:** only approved IDs, **zero scope creep**; 1 finding = 1 branch `fix/<id>-<slug>` off
main = 1 commit w/ ID (no main commits, no force-push, no touching other branches). DB
forward-only: new migration **≥087**, idempotent + rollback note; never edit an applied
migration. **Test on a Supabase dev branch first** (`create_branch` → `apply_migration` →
re-verify) — **no prod `db push`/`apply_migration`/`merge_branch`/edge deploy/dashboard change
without explicit confirm**; hand me the command. Never weaken RLS / grant authority-col writes /
drop idempotency-serialize guards / expose service-role. New RPCs `SECURITY DEFINER` + pinned
`search_path`. After schema change: `npm run db:types` + sync the 4 apps; new user-facing /
notification strings localized ×5 + RTL; UI uses design tokens only + obeys `DESIGN.md` bans.
**Prove each fix** before❌/after✅ + re-run `get_advisors`. **CI is billing-locked → verify via
local `tsc` + tests + dev branch, not CI checks.** Uncertain on money/auth/payments → STOP, ask.

## 4 · PHASE 1 — AUDIT DIMENSIONS (verify each; cite evidence)
**Phase 0:** `list_migrations`, `list_tables`, `list_edge_functions`, `list_extensions`; diff vs
repo + `packages/db-types`; `get_advisors` security + performance; scan `get_logs`.

- **A · Logic & money:** `place_order` recomputes all prices server-side, ignores client total,
  validates modifier IDs (055); idempotent + per-user serialize (031/036/082); fee ==
  `quote_delivery_fee`; ledgers conserve; `redeem_points`/`redeem_credit` no over/double/replay
  (049/061); auto-10% late credit actually fires (062 — likely inline in the delivery
  transition; confirm it calls `issue_credit`); commission snapshot immutable (062); promo
  caps/entropy/owner-bind (047/058); **COD fraud caps enforced inside `place_order`** (065).
- **B · Lifecycle/dispatch:** transition matrix from `advance_order_status` — no illegal skips,
  role-gated, **sole `orders.status` writer** (037/081); terminal releases driver (054);
  two-drivers-accept race → one winner (056); sweeps/auto-accept/reoffer no loop/strand
  (025/026/039/060); watchdog alerts a human (066); `driver_ping` throttled (032).
- **C · Schema:** FKs + delete-cascade, no orphans (022/023); money int/numeric not float ✅;
  `timestamptz` + `updated_at` triggers; enums match apps; **indexes on FKs/realtime/`orders(status)`
  /geo (F4)**; invariant unique constraints; live == migrations (086 drift = F3).
- **D · RLS/authz:** every user table RLS-ENABLED + policy (3 enabled-no-policy = F8); prove
  isolation per role via `execute_sql`; authority cols not client-writable (**leftover grants =
  F1**); definer `search_path` pinned ✅; message/support forgery closed (072); KYC storage
  private (076); `public_drivers` definer view PII (F7); realtime respects RLS.
- **E · Notifications/push:** build event×recipient×language coverage matrix, find holes
  (040/068/070/071/073); fanout → `expo-push` auth by Vault secret (034/035/038), not
  client-callable; `expo-push` prunes `DeviceNotRegistered`, batches, retries, no PII; push
  failure isolated from the txn; no dup/missed; token lifecycle on logout + `anonymize_my_account`;
  copy localized ×5 + RTL.
- **F · Payments:** `paymob-create-intention` amount server-side (**not deployed = F2 — intentional, card OFF in
  prod (`EXPO_PUBLIC_PAYMENTS_CARD_ENABLED=false`), COD-only; deploy when card is enabled**);
  `paymob-webhook` HMAC-verified (`verify.ts` / `verify.test.ts`) + idempotent; card guards +
  `reconcile_stale_card_orders` (033, cron 5m ✅) cover lost/failed/refunded/abandoned;
  `mark_cod_collected` authorized + amount-validated (029) + single-call; EGP charged, foreign
  currency display-only.
- **G · Realtime:** publication matches subscriptions ✅, nothing sensitive over-published ✅;
  driver GPS via Broadcast not write-storm; apps reconnect/backfill.
- **H · Apps ×4:** no client-invented money/status; every screen handles all terminal +
  loading/empty/error/offline; guest isolated; i18n complete + real RTL; only anon key
  client-side (grep service-role); `EXPO_PUBLIC_USE_SUPABASE=true` in prod (no mock); Sentry +
  OTA/force-update gate compiled into the binary.
- **I · Ops:** cron scheduled + not silently failing ✅ (084, logs, `ops_alert`); edge fns log +
  correct codes; perf advisors triaged (F4/F5/F10); backup/PITR noted; **CI non-functional —
  GitHub Actions billing-locked, checks instant-fail; merges ride on local `tsc` + 93/93 tests +
  review (F11)**; **EAS OTA: main ahead of users — delight pass not live until `eas update`
  pushed; verify OTA channel + `runtimeVersion` + force-update/min-version gate (F12)**.
- **J · Compliance (EG):** UI auto-late-credit promise == code (CPL 181/2018);
  `anonymize_my_account` truly removes PII + reachable (`delete-account`); VAT (075) consistent.
- **K · Design/UX** (source `apps/customer/src/theme.ts`; mirrored driver; web/landing Tailwind;
  `packages/tokens`; docs `DESIGN.md`/`PRODUCT.md`): token drift check (no hard-coded hex/px);
  coral `#ff5a3c` ≤~10% action accent only, teal `#0e7c91` trust only, neutrals never pure
  white/black, `accentGlow` primary-CTA/hero only; hierarchy via weight×scale (steps ≥1.25);
  Cairo + Eastern-Arabic numerals in AR; **RTL mirrors layout not translated LTR**; motion
  ease-out no bounce, animate transform/opacity; haptics purposeful; reuse components + MV
  no-ViewModels; **grep absolute bans** (no side-stripe borders, gradient text, glassmorphism,
  hero-metric template, identical-card grids, modal-first, em dashes). **Brand:** warm-coastal,
  guest-first, tourist-legible, appetite⇄trust balanced. **Delight pass (PR #43):** animations
  ease-out; haptics purposeful; **reconcile the "Sunny" mascot + order-placed celebration with
  PRODUCT.md anti-references ("no mascots, bouncy animations, confetti, emoji-as-UI") — confirm
  it's an intentional, documented brand evolution (update PRODUCT.md/DESIGN.md), not drift;
  celebration ≠ confetti**; onboarding COD-trust slide + empty states + celebration copy
  localized ×5 + RTL; design-taste checklist applied across all 5 delight components. **a11y:**
  feedback per action, branded empty/loading states, WCAG-AA contrast, ≥44pt targets, one-handed reach.

## 5 · SEVERITY + DELIVERABLE
**Severity:** P0 = data leak / broken authz / money-loss or double-charge / forgeable-or-non-
idempotent webhook / legal liability / order-strand. P1 = bounded-wrong money / missing-dup
notifications / silent sweep failure / missing index at scale / OTA gate absent / CI down. P2 =
hardening. **Confidence:** Verified / Strong / Inferred.
**Write `docs/AUDIT-REPORT-<today>.md`:** exec summary + invariants ✅/❌; findings table
(ID·Sev·Dimension·Title·Evidence·Impact·Fix-sketch·Confidence, P0→P2); per-finding detail (fix
*sketch* only); real state-machine transition matrix; notification coverage matrix; RLS coverage
table; live-vs-source drift; `get_advisors` triage; "couldn't verify"; one-line verdict.

## 6 · PHASE 2 — REMEDIATION (after approval)
Per fix: restate (cause/invariant) → minimal plan + rollback (👍 if P0/money/auth/payments) →
branch → test-first then implement (new mig ≥087) → verify on dev branch (re-run originating
check + advisors) → sync types/apps/i18n → commit + PR body → pause for next. Never batch.

**Fix queue (specifics):**
- **F1** mig 087: `REVOKE INSERT, UPDATE, DELETE ON public.{credit_ledger, customer_credit_balance,
  loyalty_points_ledger, customer_loyalty, driver_loyalty, restaurant_loyalty, order_financials,
  restaurant_settlements, order_status_events, promo_codes} FROM anon, authenticated;`
  behavior-neutral (RPCs are owner). Verify: grants query (§7) → 0 rows; RPCs still succeed.
- **F3** DIAGNOSE first (`select to_regclass('public.saved_orders')` + history §7): absent → apply
  086 on dev, hand prod cmd; present-but-unlogged → repair history, don't re-run. Evidence first.
- **F2** RESOLVED-BY-DESIGN (P3): card is OFF in prod (`EXPO_PUBLIC_PAYMENTS_CARD_ENABLED=false`,
  `apps/customer/eas.json`) → COD-only launch, `paymob-create-intention` intentionally not
  deployed. No action now. When enabling card: deploy `paymob-create-intention` (amount
  server-side, `supabase functions deploy paymob-create-intention --project-ref
  ilqpsebcfbaoaogimhud`) + flip the flag together; keep the webhook HMAC-verified + idempotent.
- **F4** new mig: btree indexes on flagged unindexed FKs, hot first (`order_items.order_id`,
  `order_status_events.order_id`, `order_assignments.*`, `order_messages.*`, both `orders` FKs),
  then the rest. `CREATE INDEX IF NOT EXISTS` on dev; hand `CONCURRENTLY` stmts for prod. Verify:
  advisor `unindexed_foreign_keys` cleared.
- **F5** recreate ~25 flagged policies with `auth.uid()`→`(select auth.uid())`,
  `auth_role()`→`(select auth_role())`, identical logic. Verify: advisor `auth_rls_initplan`
  cleared AND isolation dump (§7) byte-identical.
- **F6** manual: Dashboard → Auth → enable leaked-password protection; keep anon sign-ins on.
- **F7** inspect `public_drivers` view cols → restrict / `security_invoker` if it exposes phone/PII.
- **F8** confirm `riders` unused (0 app refs, no FKs) → drop; leave promo_codes/promo_redemptions.
- **F9** backfill 3 legacy `order_financials` at my chosen commission rate, or mark accepted.
- **F10** consolidate duplicate permissive SELECT policies without changing access.
- **F11** (process/P1, owner-gated): resolve the **GitHub Actions billing lock** so PRs get real
  CI; until then gate merges on local `tsc` + full tests + review. Not code — billing settings.
- **F12** (delivery/P1, owner-gated): push the customer-app **EAS OTA update** so the merged
  delight pass reaches installs (`eas update --branch <prod-channel> --message "delight pass"`);
  confirm `runtimeVersion` + a force-update/min-version gate so a bad OTA is recoverable. Hand me
  the exact command from `app.json`/`eas.json`; don't run without confirm.

## 7 · VERIFICATION BATTERY (read-only; run before❌ / after✅) + `get_advisors` security+performance
```sql
-- F1 — expect ZERO rows after the revoke
select table_name, grantee, privilege_type from information_schema.role_table_grants
where table_schema='public' and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE','DELETE')
and table_name in ('credit_ledger','customer_credit_balance','loyalty_points_ledger','customer_loyalty',
 'driver_loyalty','restaurant_loyalty','order_financials','restaurant_settlements','order_status_events','promo_codes');

-- Invariant: money conserved — must stay 0 mismatches / 0 negatives after ANY change
select (select count(*) filter (where coalesce(bal,0)<>coalesce(led,0)) from
  (select b.balance_egp bal,(select sum(delta_egp) from credit_ledger l where l.user_id=b.user_id) led
   from customer_credit_balance b) s) as credit_mismatch,
 (select count(*) from customer_credit_balance where balance_egp<0) as credit_negative,
 (select count(*) filter (where coalesce(bal,0)<>coalesce(led,0)) from
  (select c.points_balance bal,(select sum(delta_points) from loyalty_points_ledger l
     where l.subject_type='customer' and l.subject_id=c.user_id) led from customer_loyalty c) s) as loyalty_mismatch,
 (select count(*) from customer_loyalty where points_balance<0) as loyalty_negative;

-- Invariant: definer search_path — expect only PostGIS st_estimatedextent unpinned
select coalesce(string_agg(proname,', ') filter (where not has_sp),'(all pinned)') as unpinned from (
 select p.proname,(p.proconfig is not null and exists(select 1 from unnest(p.proconfig) x where x like 'search_path=%')) has_sp
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef) s;

-- Invariant: RLS isolation — output must be UNCHANGED after any RLS rewrite (F5)
select tablename, policyname, cmd, roles::text, left(coalesce(qual,'-'),120) qual
from pg_policies where schemaname='public' and tablename in ('orders','users','order_items','credit_ledger')
order by tablename, cmd, policyname;

-- RLS coverage: expect only spatial_ref_sys disabled; note enabled-no-policy (riders/promo_codes/promo_redemptions)
select 'rls_disabled' k, coalesce(string_agg(c.relname,', '),'-') v from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' and not c.relrowsecurity
union all select 'rls_enabled_no_policy', coalesce(string_agg(c.relname,', '),'-') from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' and c.relrowsecurity and not exists (select 1 from pg_policies p where p.schemaname='public' and p.tablename=c.relname);

-- F3 — migration 086 drift
select to_regclass('public.saved_orders') as saved_orders_exists;
select version,name from supabase_migrations.schema_migrations order by version desc limit 3;

-- Cron health — expect all active, no 'failed' in 24h
select j.jobname, j.schedule, j.active, d.status, count(*) runs, max(d.end_time) last_run
from cron.job j left join cron.job_run_details d on d.jobid=j.jobid and d.start_time > now()-interval '24 hours'
group by 1,2,3,4 order by 1;

-- Realtime publication membership (expect: orders, order_status_events, order_assignments, order_messages, support_messages, drivers)
select string_agg(tablename,', ' order by tablename) from pg_publication_tables where pubname='supabase_realtime' and schemaname='public';

-- Commission snapshot coverage — delivered orders missing a financials row (3 legacy pre-062 expected)
select count(*) from orders o where o.status='delivered' and not exists (select 1 from order_financials f where f.order_id=o.id);
```

## 8 · OWNER-GATED (I can prep, you execute)
- **F11 GitHub Actions billing lock** — fix in GitHub → Billing; until then CI stays instant-fail.
- **F12 EAS OTA** — I read `app.json`/`eas.json` for channel + `runtimeVersion`, draft the exact
  `eas update` command; you run it (needs your EAS login). This ships the delight pass to installs.

## 9 · PHASE 3 — OPTIONAL REVENUE / QUICK-WIN BACKLOG (after hardening; verify not already shipped)
Cheap, high-ROI, mostly config: **order service fee** (dead config key); **small-order fee**
instead of hard `BELOW_MIN_ORDER` block; **StoreReview prompt** at post-delivery 5-star
(`expo-store-review` already installed); **deep links** (`associatedDomains`/`intentFilters`/
`assetlinks.json` + push-tap→order routing) for referral attribution; **conversion-funnel events**
on the 4 surfaces that emit none; **admin cancel + reason-code UI** (server auth exists);
**abandoned-cart + win-back push** (push pipe + owner-bound promos exist; 078 shipped campaign
tooling — check overlap); **SEO** robots.txt + sitemap on landing.

## FINAL
Updated `docs/AUDIT-REPORT-<today>.md` + per-fix PR bodies + summary table (finding → branch →
status → verification → prod-apply-pending) + one-line ship verdict per branch. Nothing hits
prod without my explicit go. **Start Phase 1 now; modify nothing; then present the plan and wait.**
─── END PROMPT ───
