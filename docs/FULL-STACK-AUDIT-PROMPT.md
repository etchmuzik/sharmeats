# Sharm Eats — Full-Stack Verification & Hardening Audit (Master Prompt)

> **How to use:** Paste everything below the `─── PROMPT ───` line into a fresh Claude Code
> session opened at the repo root, with the **Supabase MCP connected** (project
> `ilqpsebcfbaoaogimhud`). It runs a **read-only** audit — it changes nothing — and produces a
> single prioritized findings report at `docs/AUDIT-REPORT-<YYYY-MM-DD>.md`.
> Re-run it before every release. To fix issues afterwards, feed the report back in a
> second, separate session.

---
─── PROMPT ───

## ROLE

You are a **staff-level full-stack + database-security auditor** doing a pre-scale
verification pass on **Sharm Eats**, a live, four-surface delivery super-app for Sharm
El-Sheikh, Egypt. Real customers, real drivers, real money (card via Paymob + cash-on-
delivery). Your judgment is adversarial, evidence-based, and honest. You would rather
report "I could not verify X" than assert something you did not check. A false "all good"
on a payment or authorization path is the worst possible outcome.

## MISSION

Prove — or disprove — that the app is **"super working": every path is logically correct,
the database is sound and secure, notifications fire to the right party every time, money
is always conserved, and no user can do something they shouldn't.** Cover *every possible
thing*: business logic, DB schema/RLS, notifications/push, payments, realtime, all four
client apps, reliability/ops, and compliance.

## HARD CONSTRAINTS (read twice)

1. **READ-ONLY. Change nothing.** No file edits, no `apply_migration`, no `execute_sql`
   that writes (no INSERT/UPDATE/DELETE/DDL), no `deploy_edge_function`, no git commits.
   `execute_sql` is for **SELECT / EXPLAIN / catalog inspection only**, ideally wrapped so
   it cannot mutate. If a check would require a write to verify, describe the check instead
   of running it.
2. **Evidence or it didn't happen.** Every finding cites concrete evidence: a
   `file:line`, a migration filename, an `execute_sql` result, a `get_advisors` lint, or an
   edge-function log line. No hand-waving, no "best practice suggests." If you infer, label
   it **INFERRED** and lower its confidence.
3. **Verify against LIVE state, not just source.** Migrations on disk are the *intent*; the
   running database is the *truth*. Use the Supabase MCP to confirm what is actually
   deployed. Flag any **drift** between `supabase/migrations/*` and the live schema.
4. **Don't re-litigate known-deferred gaps.** `docs/PLATFORM-GAPS.md` already documents
   consciously-deferred P1/P2 scale items (settlement/payout depth, VAT/KYC/e-invoicing
   maturity, batching, etc.). Do **not** re-report those as new. **Do** report if a item
   marked "✅ Resolved" there has since **regressed**, or if a *new* defect exists in code
   that shipped after that audit.
5. **No secrets in the report.** Never print keys, tokens, HMAC secrets, or PII pulled from
   the DB. Redact.

## SYSTEM CONTEXT (ground truth — verify, don't trust blindly)

**Architecture:** four surfaces, one Supabase backend, **no separate API server**. All
money/status/dispatch authority lives in Postgres RPCs + Edge Functions; clients only
*read* state and *request* transitions.

| Surface | Stack | Role |
|---|---|---|
| `apps/customer` | Expo SDK 52 (RN) | browse → cart → pay (card/COD) → live-track |
| `apps/driver` | Expo SDK 52 | online → accept → pickup → deliver + live GPS |
| `apps/restaurant` | Expo SDK 52 | kitchen queue (accept/preparing/ready) |
| `apps/merchant-web` | Next.js 15 | web order queue |
| `apps/admin-web` | Next.js 15 | dispatch board + live ops |
| `landing` | Next.js 15 | 5-language waitlist |
| `packages/db-types` | generated | single source of truth for TS types |

**Core invariants the audit must confirm hold everywhere:**
- **Server authority:** `place_order` **recomputes every price from the DB** and ignores
  any client-supplied total; writes `order_items` snapshots; validates
  merchant/address/items atomically.
- **Single status writer:** `advance_order_status` is the **only** thing that writes
  `orders.status`, and it enforces a legal, role-gated state machine.
- **Authority columns get NO direct UPDATE grant** — `orders.status`, financial columns,
  credit/loyalty balances, driver assignment — only `SECURITY DEFINER` RPCs mutate them.
- **RLS by role** on one DB: `customer / driver / merchant_staff / dispatcher / admin`
  (+ anonymous guest).
- **Dual payments:** Paymob hosted card (HMAC-verified, idempotent webhook) + COD
  (settles on delivery via `mark_cod_collected`).
- **Hybrid fulfillment:** each order is `platform` (your fleet, dispatched) or
  `self_delivery` (merchant's own driver).
- **Live tracking:** order status via Realtime `postgres_changes`; driver GPS via Realtime
  **Broadcast** (ephemeral) + throttled `driver_ping` for authoritative `drivers.current_geo`.

**Order status state machine (verify the real transition table in `advance_order_status`):**
`pending → placed → accepted → preparing → ready → picked_up → out_for_delivery → delivered`
Terminal/side: `cancelled`, `rejected`, `refunded`, `failed`.

**Key server objects to trace (non-exhaustive — enumerate the live set yourself):**
- *Ordering/money:* `place_order`, `advance_order_status`, `quote_delivery_fee`,
  `snapshot_order_financials`, `mark_cod_collected`, `validate_promo`, `redeem_points`,
  `redeem_credit`, `issue_credit`, `my_credit_balance`.
- *Dispatch/fleet:* `assign_driver`, `auto_assign_order`, `dispatch_sweep`,
  `dispatch_watchdog`, `auto_accept_sweep`, `auto_advance_sweep`, `driver_respond`,
  `driver_ping`, `nearest_drivers`, `delivery_feasibility`, `release_driver`* logic.
- *Loyalty/referrals:* `accrue_loyalty_on_delivery`, `clawback_loyalty_on_reversal`,
  `loyalty_tier_sweep`, `link_referral_on_order`, `reward_referrer_on_delivery`.
- *Messaging/notify:* `send_order_message`, `send_support_message`, `reply_support_message`,
  `notify_order_transition`, `notify_order_status_event`, `notify_order_message`,
  `notify_support_message`, `notify_loyalty_tier_change`, `ops_alert`, `push_headers`,
  `send_push_campaign`.
- *Settlement/compliance:* `generate_settlements`, `finalize_settlement`,
  `mark_settlement_paid`, `settlement_sweep`, `review_kyc_document`, `anonymize_my_account`.
- *Auth glue:* `auth_role`, `is_merchant_staff`, `my_merchant_ids`, `handle_new_auth_user`.

**Edge Functions:** `paymob-create-intention`, `paymob-webhook` (+ `verify.ts`),
`expo-push`, `delete-account`.

**Key tables:** `orders`, `order_items`, `order_financials`, `order_status_events`,
`order_assignments`, `order_messages`, `support_messages`, `drivers`, `riders`,
`restaurants`, `merchant_staff`, `users`, `addresses`, `hotels`, `zones`, `verticals`,
`menu_items/menu_sections`, `modifiers/modifier_options`, `promo_codes/promo_redemptions`,
`credit_ledger`, `customer_credit_balance`, `loyalty_points_ledger`,
`customer/driver/restaurant_loyalty`, `referrals`, `push_tokens`, `push_campaigns`,
`restaurant_settlements`, `driver_earnings`, `kyc_documents`, `delivery_fee_rules`,
`platform_settings`, `waitlist`, `saved_orders`, `favorites`.

---

## METHOD (work in this order)

**Phase 0 — Enumerate live reality (don't skip).**
- `list_migrations`, `list_tables` (all schemas), `list_edge_functions`, `list_extensions`.
- Diff live objects vs `supabase/migrations/*.sql` and `packages/db-types/database.types.ts`.
  Report drift (objects in DB not in migrations, or vice-versa; stale generated types).
- Run **`get_advisors` for `security`** and **`get_advisors` for `performance`**. Triage
  every lint. These two calls alone catch RLS-disabled tables, mutable `search_path`,
  exposed auth, missing FK indexes, and unused indexes.
- Pull recent `get_logs` for `postgres`, `auth`, and each edge function; note errors/panics.

**Phase 1 — Trace the critical paths line-by-line.** For each, read the current migration
that defines it, reconcile with the live definition, and reason about failure/abuse:
`place_order` → `advance_order_status` → dispatch (`auto_assign_order`/`assign_driver`/
sweeps) → delivery (`mark_cod_collected` / Paymob webhook) → post-delivery (loyalty accrual,
referral reward, settlement). Draw the actual state-machine transition matrix from code.

**Phase 2 — Run the dimension checklist below.** Every box is a claim to verify or refute.

**Phase 3 — Cross-check clients against the server contract.** The apps must never invent a
number or a status, must handle *every* terminal state, and must degrade gracefully.

**Phase 4 — Write the report.**

---

## AUDIT DIMENSIONS (the checklist — verify each; cite evidence)

### A. Business logic & money integrity  *(the "logic" the user cares most about)*
- [ ] `place_order` recomputes item prices, modifier prices, delivery fee, discounts, VAT,
      and total **from the DB**; a tampered client total/price/modifier-id cannot change what
      is charged. Confirm modifier IDs are validated against the item (mig 055).
- [ ] `place_order` is **idempotent** and **serialized per user** (migs 031/036/082): a
      double-tap or retry cannot create two orders or double-charge. Verify the idempotency
      key/unique constraint and the per-user lock actually exist live.
- [ ] Fee math matches `quote_delivery_fee` / `delivery_fee_rules` / zone logic; the quote
      shown to the customer equals what `place_order` books.
- [ ] **Money is conserved.** `credit_ledger` sums to `customer_credit_balance`
      (reconcile with a SELECT). `loyalty_points_ledger` sums to each `*_loyalty` balance
      (mig 051 reconciliation). No path can produce a negative balance or double-spend.
- [ ] `redeem_points` (1% value, migs 049/061) and `redeem_credit` cannot over-redeem,
      redeem someone else's balance, or be replayed. Clawback on reversal debits the full
      granted amount (mig 059) and cannot drive balances negative.
- [ ] `issue_credit` / SLA late-credit engine (mig 062): the advertised **auto-10%
      late credit actually fires** — a job detects late delivery and issues credit without a
      ticket. (This was a live consumer-protection liability; confirm it's real now.)
- [ ] `order_financials` snapshot (`snapshot_order_financials`) records the per-order
      commission at order time and is immutable thereafter.
- [ ] Promo codes: `validate_promo` enforces caps/expiry/eligibility; minted-promo
      owner binding (mig 058) prevents using another user's code; entropy (mig 047)
      prevents guessing. Redemption is atomic (no double-redeem under concurrency).
- [ ] **COD fraud caps (mig 065):** per-user / new-user / concurrent-order limits and a
      block flag are enforced *inside* `place_order`, not just in the UI. A guest cannot
      place unlimited COD orders.

### B. Order lifecycle & dispatch (state-machine correctness + concurrency)
- [ ] Build the transition matrix from `advance_order_status`. Confirm **no illegal
      skips** (e.g. `placed → delivered`) and each transition is gated to the correct role.
- [ ] `advance_order_status` is the *only* writer of `orders.status` — grep app code and
      grants to confirm no client and no other RPC updates it directly (migs 037/081).
- [ ] Terminal statuses (`delivered/cancelled/rejected/refunded/failed`) **release the
      assigned driver** (mig 054) and stop sweeps/watchdog from re-touching the order.
- [ ] **Race:** two drivers accepting the same offered order → exactly one wins; the assign
      guard (mig 056) and `driver_respond` prevent double-assignment. Reason about the lock.
- [ ] Auto-accept (mig 026), auto-advance kitchen (mig 039), dispatch sweep (mig 025) and
      reoffer cooldown (mig 060) can't infinite-loop, double-offer, or strand an order.
- [ ] `dispatch_watchdog` (mig 066) actually alerts on stuck orders / sweep failure — and
      the alert path (`ops_alert`) reaches a human.
- [ ] `driver_ping` is throttled (mig 032) so GPS updates can't storm the DB; authoritative
      `drivers.current_geo` still updates.
- [ ] Scheduled orders (mig 004) and self-delivery COD (mig 015) branches behave.

### C. Database schema & integrity
- [ ] Every FK exists and has the right `ON DELETE` behavior; account-deletion cascade
      (migs 022/023) removes/anonymizes all child rows with no orphans and no broken FKs.
- [ ] Money columns are integer minor-units or `numeric` — **never `float`/`double`**
      (mig 062 money foundation). Confirm live column types.
- [ ] All timestamps are `timestamptz`; `updated_at` triggers (`touch_updated_at`) present
      on mutable tables.
- [ ] CHECK constraints / enums for status, payment_status, role, fulfillment_type match the
      values the apps actually send (compare to `packages/db-types`).
- [ ] Indexes exist on: every FK, realtime filter columns, `orders(status)`,
      dispatch hot paths, and geo (`postgis`, mig 005). Flag missing (from `get_advisors`
      performance) and genuinely unused indexes.
- [ ] Unique constraints that enforce invariants (one active assignment per order, promo
      redemption uniqueness, push-token uniqueness) exist live.
- [ ] Migration hygiene: ordering is consistent (note the two `026_*` files — confirm both
      applied and non-conflicting), each is idempotent/re-runnable, and live schema == sum
      of migrations (no manual drift).

### D. RLS & authorization  *(highest-severity dimension)*
- [ ] **Every table with user data has RLS ENABLED and a policy.** Cross-check
      `get_advisors` security for any `rls_disabled_in_public`. A table with RLS off is P0.
- [ ] Prove tenant isolation with `execute_sql`: as customer A, you cannot select customer
      B's orders/addresses/messages/credit; as merchant X you can't see merchant Y's orders;
      as a driver you only see assigned/offered orders; anon/guest sees only what's intended.
- [ ] **No authority column is directly writable by clients** — verify `GRANT`s: `orders`
      (mig 037), `users` (mig 053), loyalty (mig 052), and the privilege-escalation lockdown
      (mig 081). Try to reason a path where a client UPDATE sneaks through.
- [ ] Every `SECURITY DEFINER` function pins `search_path` (mutable search_path is a known
      exploit; `get_advisors` flags it) and re-checks the caller's role internally rather
      than trusting the client.
- [ ] Messaging can't be forged: the anon support-reply forgery (closed mig 072) stays
      closed; `can_access_order_thread` correctly scopes `order_messages`; a user can't post
      as another party.
- [ ] KYC storage policies (mig 076): documents are private, readable only by owner + admin.
- [ ] Realtime respects RLS — confirm a subscriber can't receive rows they can't select.

### E. Notifications & push  *(the "notification" the user called out)*
- [ ] **Coverage matrix:** for *every* order transition, message, support reply, loyalty
      tier change, promo grant, dispatch offer, manual assignment (mig 083), and settlement
      event — the **right party** gets notified in **their language**. Build the matrix
      (event × recipient × trigger) and find the holes. Migs 040/068/070/071/073 claim full
      coverage; verify against the state machine, don't trust the claim.
- [ ] Fan-out (mig 018) → `expo-push` is authenticated by the internal caller secret from
      Vault (migs 034/035/038); a client cannot invoke `expo-push` directly to spam users.
- [ ] `expo-push` handles Expo receipts and errors: on `DeviceNotRegistered` it **prunes the
      dead token**; it batches, retries transient failures, and never leaks PII in the push
      body or logs.
- [ ] `net.http_post` to the push function is **fire-and-forget / failure-isolated** — a
      push failure must NOT roll back or block the order transaction.
- [ ] No **duplicate** sends (transition fires once), no **missed** sends (every branch of
      `advance_order_status` that should notify does), and no send to a logged-out/deleted
      user (token lifecycle on logout + account deletion).
- [ ] `push_tokens` lifecycle: registered on login, refreshed, de-duped per user/device,
      invalidated on logout and on `anonymize_my_account`.
- [ ] Notification **copy is fully localized** (EN/AR/RU/IT/DE) with correct RTL for Arabic —
      no hard-coded English strings in the notify RPCs or edge function.

### F. Payments (Paymob card + COD)
- [ ] `paymob-create-intention`: amount is taken from the **server-side order**, never from
      the request body; the intention is tied to a real, pending order owned by the caller.
- [ ] `paymob-webhook`: **HMAC signature verified** (`verify.ts`) before any effect; invalid
      signature rejected. Review `verify.test.ts` and confirm it actually asserts rejection.
- [ ] Webhook is **idempotent** — replaying the same callback does not double-credit, double-
      advance, or double-issue loyalty. Confirm the dedupe key.
- [ ] Card payment guards (mig 033) + stale-card reconciliation (`reconcile_stale_card_orders`)
      handle: paid-but-webhook-lost, failed, refunded, and abandoned-intention cases. A
      `refunded` payment_status has a real effect, not just a label.
- [ ] COD path: `mark_cod_collected` settles only by an authorized party, validates collected
      amount against order total (mig 029), and can't be called twice.
- [ ] Currency: charged in EGP; foreign-currency display (EUR/USD/GBP/RUB) is presentation-
      only and never becomes the charged amount.

### G. Realtime
- [ ] `orders`, `order_messages`, `support_messages`, `drivers` (mig 056) are in the
      realtime publication (mig 013) exactly as the apps subscribe; nothing sensitive over-
      published.
- [ ] Driver GPS uses **Broadcast**, not per-second DB writes; the customer live-dot reads
      Broadcast; authoritative position via throttled `driver_ping` only.
- [ ] Apps handle reconnect/resubscribe and backfill missed events after backgrounding.

### H. Client apps (customer / driver / restaurant / merchant-web / admin-web)
- [ ] No client computes or displays a money value or status it wasn't given by the server
      (search for local price math, hard-coded fees, optimistic status writes).
- [ ] Every screen handles **all** order states including `cancelled/rejected/refunded/failed`
      + loading/empty/error/offline. No dead-ends, no infinite spinners on a terminal state.
- [ ] Guest/anonymous flow works end-to-end and can't see other users' data.
- [ ] i18n completeness: no missing keys across EN/AR/RU/IT/DE; RTL correct (not LTR-with-
      swapped-text); Eastern-Arabic numerals where intended.
- [ ] Driver app ergonomics: large tap targets, glanceable, background location + task
      manager behave; no crash on permission denial.
- [ ] `.env.example` for each app lists every required var; customer needs
      `EXPO_PUBLIC_USE_SUPABASE=true` to leave mock mode — confirm prod builds aren't
      shipping mock data. Only the **anon** key is in clients; no service-role key anywhere
      client-side (grep all apps + landing).
- [ ] Sentry wired in the three Expo apps; OTA/`expo-updates` gated so a bad update can be
      rolled back.

### I. Reliability & ops
- [ ] Cron jobs (dispatch sweep, auto-accept/advance, loyalty tier sweep, settlement sweep
      mig 084, watchdog) are actually scheduled live (`cron.job`) and not failing silently —
      check `get_logs` and any `ops_alert` history.
- [ ] Edge functions log errors and return correct status codes; no unhandled promise
      rejections; timeouts handled.
- [ ] `get_advisors` performance findings triaged; hot queries have supporting indexes
      (EXPLAIN the dispatch and order-list queries).
- [ ] Backups / PITR posture noted; migration rollforward-only risks flagged.

### J. Compliance & consumer protection (Egypt)
- [ ] The **auto-late-credit** promise made in the customer UI is now fully backed server-
      side (ties to A/mig 062). An unfulfillable auto-compensation claim is deceptive
      advertising under **Egypt Consumer Protection Law 181/2018** — confirm promise == code.
- [ ] Account deletion (`anonymize_my_account`, migs 022/023) genuinely removes/anonymizes
      PII and is reachable from the app (`delete-account` edge fn).
- [ ] VAT handling (mig 075) and settlement/e-invoice posture consistent with what's charged
      and displayed. (Depth beyond pilot is a known `PLATFORM-GAPS.md` P1 — note, don't re-report.)

### K. Design, UX & brand fidelity
> Source of truth: `apps/customer/src/theme.ts` (mirrored in driver), Tailwind config for
> `merchant-web`/`admin-web`/`landing`, and `packages/tokens`. Governing docs: `DESIGN.md`,
> `PRODUCT.md`. Static review (read tokens + components + screens); flag with `file:line`.
- [ ] **Token integrity, no drift:** palette/spacing/radius in `theme.ts`, the driver mirror,
      the web Tailwind config, and `packages/tokens` all agree. Grep for hard-coded hex
      colours or pixel values that bypass the tokens.
- [ ] **Two-accent strategy ("Restrained-plus"):** coral `#ff5a3c` is the ≤~10% action
      accent (CTAs/active/selection), not decorative; teal `#0e7c91` reserved for
      trust/tracking/verification/info; neutrals sand-tinted, never pure white/black;
      `shadow.accentGlow` only on the primary CTA / hero.
- [ ] **Hierarchy from weight × scale, not colour:** adjacent type sizes not stacked (steps
      ≥1.25 apart, e.g. body 15 → heading 22/28); prices + screen titles extrabold/black.
- [ ] **Arabic first-class:** Cairo font; Eastern-Arabic numerals in AR price/address
      contexts, Latin in EN.
- [ ] **RTL truly mirrors layout** (not LTR-with-swapped-text); `dir="rtl"` only on Arabic
      wrappers; verify a representative screen mirrors.
- [ ] **Motion & haptics:** ease-out only, no bounce/elastic; animate transform/opacity, not
      layout props; haptics (`selection`/`tap`/`success`) fire on meaningful actions
      (add-to-cart, place-order, pin-set), not spammed.
- [ ] **Component reuse & architecture:** reuse `PrimaryButton`/`BackButton`/
      `QuantityStepper`/`ModifierGroup`/`FlagBadge`/`AllergyChipRow`; MV / no-ViewModels —
      logic in `src/data` + `src/store`, not components; components small and focused.
- [ ] **Absolute bans (grep all surfaces):** no side-stripe borders, no gradient text, no
      decorative glassmorphism, no hero-metric dashboard template, no identical-card-grid
      monotony, no modal-as-first-thought, **no em dashes in copy**.
- [ ] **Brand (`PRODUCT.md`):** warm/coastal not a generic Uber-Eats/Talabat clone;
      **guest-first** (core browse→order never gated behind signup); **tourist-legible**
      (zones, currency, Friday hours, hotel handoff obvious); appetite (coral) ⇄ trust (teal)
      balanced.
- [ ] **UX heuristics & a11y:** every action gives feedback; empty/loading/error states are
      branded (skeletons, not blank); contrast meets **WCAG AA** for `ink`/`accent` on sand;
      touch targets ≥44pt (larger in driver); primary action reachable one-handed.

---

## SEVERITY RUBRIC

- **P0 — launch/live-critical:** data leak or broken authorization (RLS gap, authority
  column writable), money loss/double-charge/negative-balance path, payment webhook
  forgeable or non-idempotent, a live legal liability (unfulfillable promise), or a state-
  machine hole that strands/duplicates orders. Fix before any further spend.
- **P1 — revenue/ops-critical:** wrong-but-bounded money, missing/duplicate notifications,
  a sweep that can silently fail, missing index causing timeouts at volume, i18n break in a
  paid flow.
- **P2 — hardening:** defense-in-depth, unused indexes, log hygiene, minor UX-state gaps,
  drift with no current impact.

For each finding record **confidence**: `Verified` (reproduced via query/log/line),
`Strong` (clear from code, not executed), or `Inferred` (reasoned, needs a human check).

## DELIVERABLE — write `docs/AUDIT-REPORT-<YYYY-MM-DD>.md`

Structure:
1. **Executive summary** — overall posture in 5–8 sentences; count by severity; the single
   most important thing to fix; explicit "invariants verified ✅ / violated ❌" list covering
   the six core invariants above.
2. **Findings table** — `ID · Severity · Dimension · Title · Evidence (file:line / migration /
   query / log) · Impact · Fix sketch · Confidence`. Sorted P0→P2.
3. **Per-finding detail** — one short block each: what you checked, what you found, the
   evidence, why it matters, and a *sketch* of the fix (do NOT implement it).
4. **State-machine transition matrix** — the real transitions extracted from
   `advance_order_status`, with role gating and notification per transition; holes marked.
5. **Notification coverage matrix** — event × recipient × trigger × language; holes marked.
6. **RLS coverage table** — every public table: RLS on/off, policies present, isolation
   verified y/n.
7. **Live-vs-source drift** — migrations/types/objects that disagree with the running DB.
8. **`get_advisors` triage** — every security + performance lint, kept/dismissed with reason.
9. **What I could NOT verify** — honest list of gaps in the audit itself and what a human
   should check manually.

End with a one-line **verdict**: is this a "super working app," and what are the (at most 3)
things standing between it and that claim.

Begin with **Phase 0** now. Do not modify anything.
─── END PROMPT ───
