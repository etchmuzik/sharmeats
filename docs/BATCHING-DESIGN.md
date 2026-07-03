# Order Batching — "Order Groups" Design

**Status:** proposal / not built. Decision doc for a scoped phase-2 feature.
**Goal:** let one driver carry **two compatible orders at once**, without cold
food or a broken tracking/earnings experience.

---

## 1. Why this is a project, not a toggle

The whole platform assumes **one active order per driver** today:

| System | Current 1:1 assumption |
|---|---|
| `order_assignments` | unique index: at most one active assignment **per order** — but the app also treats it as one **per driver** |
| `getActiveJob()` (driver app) | returns a **single** job (`.limit(1)`) — the "Active delivery" card shows one |
| `auto_assign_order` | offers **one** order to the nearest driver; a driver with any active assignment is skipped |
| Driver location stream | one Realtime channel **per order** (`order:{id}:driver_loc`) — a batched driver would only feed one customer's map |
| ETAs | each order's `eta_at` assumes a direct restaurant→customer trip |
| COD / earnings | `driver_earnings` is one row per completed delivery — **already fine**, no change needed |

So the fix isn't "allow 2" — it's introducing a **group** concept that these
systems understand, while keeping the clean order↔assignment 1:1 invariant intact.

---

## 2. Core model — an order-group *above* assignments

**Do not** put two orders on one `order_assignments` row. Instead add a thin
grouping layer; each order still has its own assignment, status, ETA, COD, and
customer tracking. The group just says "these are carried together, in this order."

```
delivery_batches
  id              uuid pk
  driver_id       uuid  -> drivers
  status          text  -- forming | offered | accepted | active | completed | cancelled
  created_at, accepted_at, completed_at

delivery_batch_stops
  batch_id        uuid  -> delivery_batches
  order_id        uuid  -> orders  (unique — an order is in at most one batch)
  leg             text  -- 'pickup' | 'dropoff'
  seq             int   -- sequence within the batch (0,1,2,3…)
  arrived_at      timestamptz
  -- e.g. pickup A(seq0), pickup B(seq1), dropoff A(seq2), dropoff B(seq3)
```

Key rule: **a batch is at most 2 orders at launch** (cap in config
`batch_max_orders`, default 2). Bigger batches multiply the cold-food risk; start
conservative and raise it only with data.

The existing `order_assignments` rows are still created per order (so
reassignment, COD, per-order status all keep working). The batch is the
driver-facing envelope.

---

## 3. Eligibility — when may two orders batch?

This is the make-or-break. Naive pairing = cold food = churned customers. Batch
**only** when all of these hold (all tunable via `platform_settings`):

1. **Same or adjacent pickup.** Same restaurant, OR two restaurants within
   `batch_max_pickup_gap_m` (default 400 m). Same-restaurant is the safe launch case.
2. **Drop-offs on the way.** The detour to serve both must be small: 
   `route(A_pick → B_pick → A_drop → B_drop)` vs. two solo trips adds
   ≤ `batch_max_detour_min` (default 8 min). Use `st_distance` on the existing
   `geography` points as a cheap proxy before any routing API.
3. **Time-compatible.** Both orders `ready` (or predicted ready) within
   `batch_ready_window_min` (default 6 min) — no holding one order hot while the
   other cooks.
4. **Same zone.** Both in the same delivery `zone` (we already resolve this).
5. **Neither is scheduled/at-risk.** Skip if either is already SLA-late or is a
   `scheduled_for` future order.

If any fails → the two dispatch **solo**, exactly as today. Batching is always an
optimisation on top of the working 1:1 path, never a replacement.

---

## 4. Sequencing — the driver gets ONE clear route

The batch stops are pre-sequenced so the driver never juggles two loose jobs:

```
Pick up A  →  Pick up B  →  Drop A  →  Drop B
```

(Or `B,A,B,A` — whichever `st_distance` says is shorter. At 2 orders there are
only a couple of valid orderings; pick the min-total-distance one.) The driver
screen shows this as a **single itinerary with a progress checklist**, not two
cards. Each stop advances that order's real status under the hood
(`advance_order_status`) so the customer side is unchanged.

---

## 5. Driver UX

- **Offer:** "Batched offer — 2 orders, +38 EGP, ~9 min extra" with both pickups/
  drop-offs on a mini-map. Accept once → both `order_assignments` go `accepted`.
- **Active screen:** one itinerary card, current stop highlighted, the
  **phase-aware countdown** (already built, PR #37) retargeted to the *current
  stop's* deadline. "Pick up A by 7:32 · then B · then drop both."
- **Per-order details** (address, COD amount, dropoff notes) expand at each stop.
- **COD:** collected per order at each drop, exactly as today — `mark_cod_collected`
  is already per-order, so the cash math needs **zero change**.

## 6. Customer UX — the tracking gotcha

The driver location stream is **per-order** today. Two fixes, pick one:
- **(a) Broadcast to both channels.** The driver app publishes each GPS fix to
  every active order's `order:{id}:driver_loc` channel. Small change, keeps both
  customers' maps live. **Recommended.**
- **(b) Driver-keyed channel** + orders subscribe by `assigned_driver_id`. Cleaner
  long-term but a bigger refactor of both apps.

Customers are **never told** their order is batched (no "you're order #2 of 2"
anxiety). Their ETA already reflects the honest estimate; if batching adds time,
that's priced into the eligibility detour cap so the promise still holds.

---

## 7. Build sequence (phased, each shippable)

**Phase 0 — data + eligibility (backend only, dark).**
`delivery_batches` / `delivery_batch_stops` tables + RLS; a `batch_candidates()`
function that, given a ready order, finds an eligible partner using the §3 rules.
No dispatch change yet — just log what it *would* batch. Validate against real
order data before anything is user-facing.

**Phase 1 — batched dispatch.**
Extend `auto_assign_order` (or a new `auto_assign_batch`) to, when a candidate
pair exists, create a batch + both offers to one driver. Falls back to solo on
no candidate. Feature-flagged off by default (`batching_enabled`).

**Phase 2 — driver itinerary UI.**
The single-itinerary card, sequenced stops, per-stop countdown, per-order expand.
This is the bulk of the app work.

**Phase 3 — customer multi-channel tracking (§6a).**
Driver broadcasts to all active orders' channels so both maps stay live.

**Phase 4 — turn it on, measure.**
Enable for same-restaurant pairs first (safest). Watch: on-time %, food-temp
complaints, driver earnings/hr, detour actuals vs. estimate. Widen the eligibility
caps only if the numbers hold.

---

## 8. Risks & how the design contains them

| Risk | Containment |
|---|---|
| Cold food | Strict eligibility (ready-window + detour cap); start same-restaurant only |
| Broken tracking for 2nd customer | §6a multi-channel broadcast |
| Driver overwhelmed | One itinerary, not two cards; pre-sequenced; cap = 2 |
| Reassignment tangles | Per-order `order_assignments` preserved; a batch can split back to solo if one order is reassigned |
| COD miscount | No change — `mark_cod_collected` is already per-order |
| SLA breach | At-risk/late orders excluded from batching (§3.5) |

---

## 9. Rough effort

- Phase 0–1 (data + dispatch): ~2–3 focused days incl. local SQL validation.
- Phase 2 (driver UI): ~2–3 days — the biggest chunk.
- Phase 3 (tracking): ~1 day.
- Phase 4 (rollout + tuning): ongoing, data-driven.

**Recommendation:** build Phase 0 first (dark, backend-only) so you can see on
real orders how often eligible pairs actually occur in Sharm before investing in
the UI. If batchable pairs are rare at your volume, the ROI may not be there yet —
and Phase 0 tells you that cheaply.

---

## Appendix — Phase 0 is LIVE (mig 085, shadow mode)

Backend-only instrumentation is deployed and running. It changes nothing a user
sees; it just logs which order pairs *would* be eligible to batch.

- **Table:** `batch_candidate_log` (admin-read RLS) — one row per eligible pair.
- **Finder:** `batch_candidates()` — read-only, "what's eligible right now?"
- **Cron:** `sharmeats-batch-shadow` every 2 min logs new eligible pairs.
- **Thresholds:** `platform_settings` keys `batch_max_pickup_gap_m` (400),
  `batch_max_dropoff_gap_m` (1500), `batch_ready_window_min` (6) — tune anytime.

### Reading the results (run as admin)
```sql
-- How many eligible pairs have we seen, and how many were same-restaurant?
select count(*)                                          as total_pairs,
       count(*) filter (where same_restaurant)           as same_restaurant_pairs,
       round(avg(pickup_gap_m))                          as avg_pickup_gap_m,
       round(avg(dropoff_gap_m))                         as avg_dropoff_gap_m,
       date_trunc('day', observed_at)                    as day
from public.batch_candidate_log
group by day order by day desc;
```

**Decision gate for Phase 1:** if, after a week or two of real volume, this table
shows eligible pairs happening regularly (especially same-restaurant), batching is
worth building the UI for. If pairs are rare, hold — the ROI isn't there yet, and
you learned that for the cost of one migration instead of a two-week build.
