# FOLLOWUPS — `supabase/migrations/203_audit_round_2_dispatch.sql`

Scope: ONE new migration file. No existing migration, edge function or app file was touched.

## STATUS: UNAPPLIED

**This migration has never been run against production, staging, or the linked Supabase
project.** No Supabase MCP write tool was used. It must still get the house-rule-6 treatment:
`BEGIN; \i 203...; ROLLBACK;` against a real local Postgres with the full migration history,
then the Supabase security advisors after applying, then `npm run db:types`.

### What WAS validated (more than "read it carefully")

I built a throwaway Postgres 17 cluster (`initdb` in a temp dir, since deleted), created stub
tables/types/functions matching the shapes migs 002/008/010/171/173 leave behind, and ran the
whole migration plus targeted behaviour tests. Every statement applied; every function compiled;
the following behaviours were observed, not assumed:

| Check | Result |
| --- | --- |
| Whole file applies cleanly (DDL, constraints, indexes, grants, comments, 2 cron entries) | pass |
| `push_outbox_sweep`: queued → dispatching → (2xx) → dispatched | pass |
| `push_outbox_sweep`: message past `expires_at` → suppressed/`expired`, never POSTed | pass |
| POST body matches `expo-push` `PushBody` exactly, nulls stripped so `driver_assigned` lets the function resolve the customer | pass (verified the literal JSON) |
| Dispatch-leg retry: 503 → requeue → 3 POSTs total → `failed` + `settled_at` | pass |
| `dispatch_watchdog` fires on an order with 9 assignments **and a non-null `assigned_driver_id`** (the exact blind spot) | pass |
| `nearest_drivers` @28800s: idle-2h driver IN, 60-day-stale and never-pinged OUT | pass |
| `nearest_drivers` with the setting deleted: fails OPEN, all drivers returned | pass |
| `assign_driver` on a cancelled order → `ORDER_TERMINAL` | pass |
| `assign_driver` reassignment releases the displaced driver `on_job` → `online` | pass |
| `assign_driver` stamps a future `offer_expires_at` | pass |
| `driver_respond` accept with NULL expiry → `OFFER_EXPIRED` (fails closed) | pass |
| `driver_respond` accept on a cancelled order → `ORDER_NOT_AVAILABLE` | pass |
| `driver_respond` happy path still accepts and sets `on_job` | pass |
| `mark_cod_collected` on cancelled / on `ready` → `COD_TOO_EARLY`; on `out_for_delivery` → paid + earnings row | pass |
| `auto_accept_sweep` with one open and one paused merchant → accepts exactly 1 | pass |

Stubs are not the real schema, so this proves **syntax and control flow**, not RLS, ACL,
PostGIS behaviour, or interaction with the real `driver_cod_capacity` / `push_headers` / vault.

## What I fixed

| # | File:line | Fix |
| --- | --- | --- |
| 1 | `203:…` §1 `push_outbox_sweep(integer)` | The push outbox had **no consumer**. Since mig 200, `driver_assigned` / `order_ready_pickup` / `low_rating` were enqueued and sent to nobody. New sweep claims queued rows (`for update skip locked`) and POSTs them to `/expo-push`; judges the previous run's POSTs via `net._http_response` (mig 199's self-pipelining shape). Cron `sharmeats-push-outbox`, 20s. |
| 1b | §1 cron | `push_receipt_sweep()` (mig 174) was **built and never scheduled** — no Expo receipt has ever been polled. Added `sharmeats-push-receipts`, every 2 min. |
| 1c | §1 phase 4 | Reaps `push_attempts` whose message expired, so the retry backlog stops growing invisibly. |
| 2 | §6 `mark_cod_collected` | Added the order-status gate: cash may only be marked collected on `picked_up` / `out_for_delivery` / `delivered`. Was markable on `placed` and on **cancelled** orders. |
| 3 | §4 `assign_driver` | Locks the order `for update` first (same lock `auto_assign_order` takes, closing the double-offer race) and refuses terminal orders. |
| 4 | §4 `assign_driver` | Releases the **displaced** driver from `on_job` on reassignment (mig 054's fleet-decay bug via the manual path). Guarded so a driver with another live order is left alone. |
| 5 | §5 `driver_respond` | Refuses to accept when the order is `delivered`/`cancelled`/`rejected`. Also inverted the lock order to orders→assignment so it cannot ABBA-deadlock with `assign_driver`. |
| 6 | §4/§5/§9 | Dispatcher offers now get `offer_expires_at` (new `dispatch_manual_offer_ttl_seconds`, 300s); `driver_respond` treats NULL expiry as expired (**fails closed**); one-time backfill sets `offer_expires_at = now()` on the live NULL rows so `dispatch_sweep` reaps them with existing machinery. |
| 7 | §7 `auto_accept_sweep` | Inner-joins `restaurants` and requires `is_active AND is_open`. The restaurant app's pause control previously had no effect on orders already at `placed`. |
| 8 | §2/§3 | `dispatch_max_ping_age_seconds` 300 → 28800 (conditionally, only if still the mig-201 default). `nearest_drivers` now **skips the gate entirely** when the threshold is absent. |
| 9 | §8 `dispatch_watchdog` | Counts offer churn (≥N assignment rows on one non-terminal order inside the window) plus a push-outbox backlog count. |

Bodies were rebuilt from the **latest** definition of each function, located with
`grep -rln "function public.<name>" supabase/migrations/`: `assign_driver`→150,
`driver_respond`→030, `mark_cod_collected`→104, `auto_accept_sweep`→026,
`dispatch_watchdog`→133, `nearest_drivers`→201. No argument list changed anywhere, so no
second overload / PGRST202. Every function re-asserts its revoke + grants.

## The direction argument on #8, since it was asked for explicitly

The gate is an **availability** filter, not an **authority** check, and house rule 4 is about
the latter. The two failure modes are not comparable:

- **Gate off, drivers stale** — some offers land on phones that are not listening. The offer
  TTL expires, dispatch moves to the next candidate, and (after this migration) the watchdog
  sees the churn. Wasteful, bounded, visible.
- **Gate on, threshold lost** — the candidate list is empty for *every* order. No driver is
  ever offered anything. There is no error, no failed cron run, no log line. The platform
  simply stops delivering food and nothing says why.

Deleting one `platform_settings` row must not be able to do the second thing. Authority fails
closed; availability fails open. 28800s (one shift) still excludes the two-month-stale seed
drivers that caused the 3,429-lap incident and still excludes a driver who never pinged —
it only stops excluding the driver sitting in the app right now waiting for work.

## Deliberately NOT fixed

1. **The per-token retry path (`claim_push_retries` / `settle_push_attempt`) is still not
   driven.** This needs a TypeScript change, not SQL. A `retryable_failed` attempt is *one
   token*; `expo-push` has no way to be told "send only to this token" — it resolves tokens
   itself from the recipient. Calling it with the attempt's recipient would (a) re-send to
   that user's other tokens that already succeeded and (b) make `recordAttempts` collide with
   the existing `attempt_no = 1` rows on `unique (message_id, push_token_id, attempt_no)` and
   silently stop recording. **The fix is ~30 lines in `supabase/functions/expo-push/index.ts`:
   accept optional `attemptId` + `token` in `PushBody`, skip recipient/token resolution when
   present, and settle via `settle_push_attempt`.** Then a `push_retry_sweep()` can drive
   `claim_push_retries` per row. Mitigated meanwhile: expired attempts are reaped and the
   watchdog counts the unretryable backlog so the gap is visible.

2. **The enqueued row and expo-push's own `push_messages` row are two rows for one event.**
   `enqueue_push` keys `driver_assigned:<order>`; `outbox.ts` keys
   `evt:driver_assigned|order:<id>|to:<users>`. They never collide, so nothing breaks, but the
   outbox now has a dispatch-intent row and a delivery row per event. Unifying them means
   passing the outbox message id into `expo-push` and having it adopt rather than insert —
   again an edge-function change. The `'dispatched'` status keeps the intent row out of
   `my_notification_inbox` (mig 179 shows only `complete`/`partly_failed`) so there is no
   user-visible duplication in the meantime.

3. **No un-pay path for a paid + cancelled COD order.** The gate stops new ones being created;
   it does not repair any that already exist, and there is still no RPC to reverse
   `payment_status='paid'` + the `driver_cash_ledger` credit + the `driver_earnings` row. That
   needs a product decision (does the driver keep the delivery fee? does ops write it off?) and
   a check against real production data for how many such orders exist. Not half-built here.

4. **`assign_driver` still allows assigning a `placed` order.** Only terminal statuses are
   refused. `auto_assign_order` requires `accepted`/`preparing`/`ready`, but a dispatcher
   pre-assigning a driver to an order the merchant has not accepted yet may be intentional
   ops behaviour. Tightening it is a product call.

5. **Nothing was added to `scripts/test-security-migrations.sh`.** That file is outside my
   one-file scope. The behaviours in the table above are exactly the assertions a
   `supabase/tests/203_audit_round_2_dispatch.test.sql` should carry; someone who owns that
   scope should add it and register it in the `test_files` array (which the script's own
   comment says has silently orphaned test files before).

6. **Paymob / card payments: untouched**, per the standing instruction. Note in passing that
   `mark_cod_collected` is COD-only by construction, so nothing here crosses into card.

## Things the audit did not flag that I found on the way

1. **`push_receipt_sweep()` (mig 174) has never had a cron entry.** The migration is titled
   "cron entry point for the receipt poller" and then does not schedule it. `grep -rn
   "cron.schedule" supabase/migrations/` returns no `sharmeats-push-receipts`. So no Expo
   receipt has ever been polled and `push_attempts.receipt_checked_at` is null across the
   board. Scheduled in §1.

2. **`driver_respond`'s reject path cleared `orders.assigned_driver_id` unconditionally.** If a
   dispatcher reassigned the order while the offer sat on the old driver's screen, a late
   decline wiped the *new* driver off the customer's tracking card. Now scoped with
   `and assigned_driver_id = v_asg.driver_id`.

3. **`assign_driver` and `driver_respond` took `orders` and `order_assignments` locks in
   opposite orders** once `assign_driver` started locking. Textbook ABBA deadlock between a
   dispatcher reassigning and the displaced driver accepting. Both now take orders first.

4. **A PL/pgSQL `for … in <query>` loop opens a cursor, and a cursor rejects data-modifying
   CTEs** (`DECLARE CURSOR must not contain data-modifying statements in WITH`). My first draft
   of the claim used mig 173's `with claimed … bumped as (update … returning) select * from
   bumped` shape directly inside the loop header, which would have failed at *runtime* on every
   invocation — invisible in review, invisible until the push queue silently stopped draining.
   Mig 173 gets away with it because it uses `return query`, not a loop. Phase 3 now claims in a
   standalone statement and reads the rows back by a per-run `clock_timestamp()` stamp.

5. **`alter table … drop constraint if exists push_messages_status_check`** assumes Postgres's
   default name for the inline `check` in mig 171. It almost certainly is that, and mig 173 did
   the same thing for `push_attempts`, but **verify in the dry run**: if the real name differs,
   the drop is a silent no-op and the old narrow constraint will reject `'dispatching'` on the
   first sweep. One `\d+ public.push_messages` settles it.
