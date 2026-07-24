# Sharm Eats — FINAL BOSS: Guided Remediation Prompt

> **⚠️ STALE GROUND TRUTH — frozen 2026-07-05.** "Prod ends at 085 / start at
> 087" and the referenced audit report are outdated: local migrations now run
> through **122** and the current audit is `docs/AUDIT-REPORT-2026-07-24.md`.
> Refresh the GROUND TRUTH section before reuse; never mint a migration number
> at or below the current chain max.

Paste the block below into **Claude Code / Cowork (Fable)** at the repo root, with the
**Supabase MCP connected** to project `ilqpsebcfbaoaogimhud`. It fixes the real findings from
`docs/AUDIT-REPORT-2026-07-05.md` — safely, on branches, tested on a Supabase dev branch,
**nothing shipped to prod without your explicit OK.**

---
─── PROMPT ───

## ROLE
Senior full-stack + Postgres engineer hardening **Sharm Eats**, a LIVE delivery app
(customer/driver/restaurant Expo + merchant/admin Next.js on one Supabase backend,
`ilqpsebcfbaoaogimhud`). Real money (Paymob card + COD). Fix surgically and reversibly — a
careless change on this DB is worse than the bug. Be efficient and exact.

## READ FIRST
`docs/AUDIT-REPORT-2026-07-05.md` (the findings + evidence) and `docs/PLATFORM-GAPS.md`
(known-deferred — don't re-litigate). The audit found **no P0s**; core invariants all PASS
(money conserved, RLS isolation holds, definer fns hardened, 8 cron jobs healthy). You are
remediating **P1/P2 hardening**, not firefighting.

## GROUND TRUTH (verified live 2026-07-05 — don't contradict)
- Prod migration history ends at **085**; the next new migration number is **087**
  (086_saved_orders exists in repo but NOT in prod — see FIX-3). Two `026_*` files exist in
  repo; never collide.
- Order status enum = `placed, accepted, preparing, ready, picked_up, out_for_delivery,
  delivered, cancelled, rejected`. (No `pending/refunded/failed` — those are payment states.)
- Money cols are `integer` EGP + `commission_pct numeric`. Writes to authority/ledger tables
  happen ONLY via `SECURITY DEFINER` RPCs (owner-privileged, bypass RLS). 70/73 definer fns
  pin `search_path`.
- Edge fns live: `expo-push` v10, `paymob-webhook` v3, `delete-account` v2. Cron: dispatch/
  auto-accept/auto-advance (20s), reconcile-card (5m), watchdog/batch-shadow (2m),
  loyalty-tier (daily), weekly-settlement (Mon).

## HARD RULES (live payments app)
1. **Fix only the finding IDs the user approves.** If they didn't list any, propose the
   ordered plan below and **STOP for approval before editing.** Zero scope creep.
2. **1 finding = 1 branch (`fix/<id>-<slug>` off main) = 1 commit** referencing the ID. No
   commits to `main`, no force-push, no touching other branches/sessions.
3. **DB = forward-only.** New migration **≥087**, idempotent, rollback noted in a comment.
   Never edit an applied migration.
4. **Test on a Supabase dev branch FIRST:** `create_branch` → `apply_migration` on the
   branch → re-run the finding's verification query (below) there. **Do NOT `db push` /
   `apply_migration` to prod, `merge_branch`, deploy an edge function, or change a dashboard
   setting without explicit user confirmation.** Hand the user the exact apply command.
   Delete dev branches when done.
5. **Never weaken security.** No loosening RLS, no new permissive policy on ledger/financial
   tables, no direct authority-col grant, no dropping idempotency/serialize guards, no
   service-role key client-side. New RPCs are `SECURITY DEFINER` + pinned `search_path`.
6. **Preserve invariants:** server recomputes money in `place_order`; `advance_order_status`
   is the only status writer; webhook stays HMAC-verified + idempotent; tenant isolation via
   `auth.uid()` holds. Re-run the isolation checks after any RLS edit and confirm output is
   unchanged.
7. **Prove every fix** with the before❌/after✅ query. Re-run `get_advisors` (security +
   performance) after DB changes and confirm no new lint.
8. **Keep clients in sync:** after schema change, `npm run db:types` + update the apps; new
   user-facing/notification strings localized EN/AR/RU/IT/DE + RTL; UI changes use design
   tokens only and obey `DESIGN.md` absolute bans.
9. **Uncertain on money/auth/payments → STOP and ask.** A wrong guess here is a new P0.

## THE FIX QUEUE (ordered; each is small)

**FIX-1 · F1 · Revoke leftover ledger grants (P1, behavior-neutral).**
`anon`+`authenticated` hold table-level UPDATE on 10 tables. Not exploitable today (no write
policy) but violates the orders/users lockdown. New migration 087:
`REVOKE INSERT, UPDATE, DELETE ON public.{credit_ledger, customer_credit_balance,
loyalty_points_ledger, customer_loyalty, driver_loyalty, restaurant_loyalty, order_financials,
restaurant_settlements, order_status_events, promo_codes} FROM anon, authenticated;`
Safe because those tables are written only by owner-privileged definer RPCs. **Verify:** the
grants query below returns no rows for these tables. Then smoke-test on the dev branch that
`place_order`, `advance_order_status`, loyalty accrual, and `issue_credit`/`redeem_*` still
succeed (they run as owner).

**FIX-3 · F3 · Reconcile migration 086 (P1, careful).**
First DIAGNOSE, don't blast: does `saved_orders` exist live? (`select to_regclass('public.saved_orders')`
and check for its RPCs). If the object is ABSENT → the migration never applied: apply
`086_saved_orders.sql` on a dev branch, verify, then hand the user the prod command. If the
object is PRESENT but not in history → it was applied out-of-band: **do not re-run it**;
instead repair the migration history so future `db push` won't conflict, and report exactly
what you reconciled. Never assume — show the evidence first.

**FIX-2 · F2 · Confirm Paymob card path (P1 or doc-only).**
Only 3 edge fns are deployed; `paymob-create-intention` is not. Ask the user: is card
checkout meant to be live now, or is launch COD-only? If COD-only → document it in the README
and downgrade to P3, no code. If card is on → the create-intention function is missing from
prod; prepare it for deploy but **deploy only on explicit confirm**
(`supabase functions deploy paymob-create-intention --project-ref ilqpsebcfbaoaogimhud`).
Whatever creates the intention must compute the amount server-side from the order, never trust
the client.

**FIX-4 · F4 · Index hot foreign keys (P1 at scale).**
Add btree indexes on the advisor-flagged unindexed FKs, prioritizing the hot paths:
`order_items.order_id`, `order_status_events.order_id`, `order_assignments.*`,
`order_messages.*`, and the two `orders` FKs; then the rest (modifiers, modifier_options,
kyc_documents, favorites, promo_redemptions, support_messages, drivers, delivery_fee_rules,
push_campaigns, riders, addresses, batch_candidate_log). New migration 08x. Note: `CREATE
INDEX CONCURRENTLY` can't run inside a migration txn — use plain `CREATE INDEX IF NOT EXISTS`
on the dev branch; for prod, hand the user CONCURRENTLY statements to run out-of-band. **Verify:**
re-run `get_advisors` performance → `unindexed_foreign_keys` cleared for the indexed tables.

**FIX-5 · F5 · De-init-plan the RLS policies (P1 at scale).**
Rewrite flagged policy predicates: `auth.uid()` → `(select auth.uid())`, `auth_role()` →
`(select auth_role())`, on the ~25 policies advisor lists (orders, order_items,
order_status_events, users, drivers, order_assignments, driver_earnings, merchant_staff,
push_tokens, favorites, referrals, loyalty_points_ledger, customer/driver_loyalty,
order_financials, credit_ledger, customer_credit_balance, order_messages, support_messages,
kyc_documents, addresses, payment_methods). New migration recreating each policy with
identical logic, wrapped. **Verify:** `get_advisors` security → `auth_rls_initplan` cleared;
AND re-run the isolation spot-checks (below) — output must be byte-identical. Do NOT change
any policy's meaning.

**FIX-6 · F6 · Enable leaked-password protection (P1, 2-min, manual).**
Not a migration — Supabase Dashboard → Authentication → Providers/Policies → enable
"Leaked password protection" (HaveIBeenPwned). Instruct the user to toggle it; keep anonymous
sign-ins ON (guest checkout by design).

**P2 cleanup (only if approved):**
- **F7** — inspect the `public_drivers` SECURITY DEFINER view definition; if it projects
  phone/PII to customers, restrict columns or convert to `security_invoker`. Prove what it exposes.
- **F8** — `riders` is RLS-enabled/no-policy and looks like a legacy twin of `drivers`;
  confirm it's unused (0 refs in app + no FKs) then drop in a migration. Leave `promo_codes`/
  `promo_redemptions` (correctly definer-only).
- **F9** — 3 legacy delivered orders lack `order_financials` (all pre-mig062). Get the user's
  chosen commission rate, then backfill those 3 rows in a one-off migration; or mark as accepted.
- **F10** — consolidate duplicate permissive SELECT policies (orders, menu_items,
  menu_sections, modifiers, modifier_options, merchant_staff, platform_settings,
  delivery_fee_rules) without changing access.

## VERIFICATION BATTERY (read-only; run before ❌ and after ✅)
```sql
-- F1: expect zero rows after the revoke
select table_name, grantee, privilege_type from information_schema.role_table_grants
where table_schema='public' and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE','DELETE')
and table_name in ('credit_ledger','customer_credit_balance','loyalty_points_ledger','customer_loyalty',
 'driver_loyalty','restaurant_loyalty','order_financials','restaurant_settlements','order_status_events','promo_codes');

-- Invariant (money conserved): expect 0 mismatches, 0 negatives — must stay 0 after any change
select count(*) filter (where coalesce(bal,0)<>coalesce(led,0)) credit_mismatch,
       (select count(*) from customer_credit_balance where balance_egp<0) credit_neg
from (select b.user_id,b.balance_egp bal,(select sum(delta_egp) from credit_ledger l where l.user_id=b.user_id) led
      from customer_credit_balance b) s;

-- Invariant (definer search_path): expect only PostGIS st_estimatedextent unpinned
select count(*) filter (where not has_sp) missing from (
 select (p.proconfig is not null and exists(select 1 from unnest(p.proconfig) x where x like 'search_path=%')) has_sp
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef) s;

-- Invariant (isolation): output must be UNCHANGED after any RLS rewrite
select tablename, policyname, cmd, roles::text, left(coalesce(qual,'-'),120) qual
from pg_policies where schemaname='public' and tablename in ('orders','users','order_items','credit_ledger')
order by tablename, cmd, policyname;

-- 086 diagnosis
select to_regclass('public.saved_orders') as saved_orders_exists;
select version, name from supabase_migrations.schema_migrations order by version desc limit 3;
```
Also re-run: `get_advisors(security)` and `get_advisors(performance)` after each DB change.

## OUTPUT (per fix)
Branch `fix/<id>-<slug>` + PR body: **finding · root cause · the change (minimal, reversible)
· files/migration# · invariants preserved (with the verify query before/after) · advisors
clean · client/i18n/type impact · rollback · the exact prod-apply / dashboard step for the
human.** Pause for the next finding; never batch.

## FINAL
Remediation summary table: finding → branch → status → verification → prod-apply-pending?
Then a one-line **ship verdict** per branch. Nothing hits prod without the user's explicit go.

**Start:** read the audit report, confirm the next migration number is 087 live, present the
ordered plan (FIX-1, FIX-3, FIX-2, FIX-4, FIX-5, FIX-6, then P2), and **wait for approval.**
─── END PROMPT ───
