# Cloud Kitchen — Operating Plan

**Decision (2026-07-27):** Sharm Eats operates its own cloud kitchen at Mercato (signed
lease, EGP 40,000/month, founder-operated) running **five virtual brands**: First Light
(breakfast), Sukkar (desserts), Corallo (Italian), Sinai Smash (burgers), Shawrimp
(shrimp shawarma). The company owns the food, the staff, and the whole margin.

This document is the operating source of truth: money model, launch sequence with gates,
and the channel-conflict policy. Rates and platform economics live in
`docs/FINANCIALS.md`; the schema is migration `126_cloud_kitchen_foundation.sql`; the
investor narrative is `docs/INVESTOR-DECK-PROMPT-EGYPT.md` slide 11.

---

## Why (one paragraph)

`docs/FINANCIALS.md` §5: $1M/yr revenue needs ~2,800–3,000 orders/day at 15% — Sharm
alone cannot produce that. A marketplace order contributes ~EGP 37; an own-brand order
~EGP 192 before labour (see below) on the same app, driver and customer. The kitchen
lifts blended take rate above the 15% marketplace cap, guarantees the catalog is never
empty in five chosen categories, and turns the already-paid EGP 40k/month rent — 77% of
current burn — from a hole into a revenue line.

---

## 1. Money model (how an own brand is accounted)

### The settlement trap — memorise this

Settlement computes `net_payable = card_sales − commission (+ cod_discount)`. For a
brand we own there is nobody to pay:

| `commission_pct` | Resulting weekly draft | Verdict |
|---|---|---|
| 15 | payable of 85% of card sales **to ourselves** | fake liability |
| **0** | **payable of 100% of card sales to ourselves** | **the intuitive answer is the worst one** |
| 100 | ≈0 payable, but commission = subtotal double-counts in reports | still wrong |

**No rate produces zero. The rate is the wrong lever.** Migration 126 therefore
**excludes `merchant_type = 'own_brand'` from both settlement writers**
(`generate_settlements`, `settlement_sweep`) and adds a trigger so no settlement row
can ever exist for an own brand. `commission_pct` is parked at a **100.00 sentinel**
so any unpatched "platform take" arithmetic reads "we keep all of it".

### Revenue recognition — never double-count

- Third party: our revenue = `commission_egp`; the subtotal is theirs.
- Own brand: our revenue = `subtotal_egp`; `commission_egp` is an **internal transfer**.

> **net revenue = Σ commission (third parties) + Σ subtotal (own brands).**
> Own-brand `commission_egp` is never added to anything.

`platform_revenue_report(date, date)` (mig 126) is the only sanctioned computation; the
admin /finance page renders it. It returns **both** rates — blended and marketplace.
Quote the **marketplace** rate to investors as "take rate"; quote blended only next to
the kitchen's fixed cost base, because blended is revenue ÷ GMV, **not a margin**.

### COGS

Deliberately **not** in the schema (same restraint as mig 125's no-fiction-backfill):
food cost is per-item and time-varying, and labour/rent allocation is an
accounting-policy decision. Track COGS from supplier invoices in a spreadsheet until one
brand has ~500 delivered orders and a month of invoices, then build
`menu_item_costs(item_id, cost_egp, effective_from)`. The single exception:
`kitchens.monthly_rent_egp` (a known contractual figure, reporting-only).

---

## 2. Unit economics (honest version)

Two corrections to the deck's EGP 140/order figure, both of which an investor would find:

1. **Labour is fixed, not per-order.** The deck deducts "allocated labour 60" per order
   while its EGP 52k/month burn contains no labour line. A cook is paid whether he makes
   10 meals or 60.
2. **Platform variable costs apply to own brands too** — the ~EGP 8/order
   (loyalty accrual, SLA provision, driver tier bonus) from `FINANCIALS.md` §3.
   Delivery fee stays 100% pass-through to drivers: the kitchen adds **no** delivery
   margin; the entire uplift is food gross margin.

```
Own-brand delivery order, AOV EGP 300
  Revenue (we keep 100%)             300
  − Food COGS (30% target)            90
  − Packaging                         10
  − Platform variable                  8
  = Contribution before labour       192
```

**Monthly fixed (kitchen):** rent 40,000 (verified) + staff ~32,000 (head cook 12k,
2 line/prep 14k, counter 6k) + utilities ~8,000 (deck's 5k is low for a unit with
commercial hoods) + cleaning/licences ~5,000 ≈ **EGP 85k cash**, plus **~EGP 23k**
fit-out depreciation (backed out of the raise's 36% kitchen allocation — a percentage,
not a quote; replace with the real contractor number).

| Scenario | COGS | Contribution | Cash break-even (85k) | Full break-even (108k) |
|---|---|---|---|---|
| Pessimistic | 38% → 114 | 168 | 17/day | 21/day |
| **Base** | **30% → 90** | **192** | **15/day** | **19/day** |
| Optimistic | 25% → 75 | 207 | 14/day | 17/day |

**Headline: ~15–20 orders/day across five brands** to cover cash costs. Not the deck's
"under 10/day" — that figure covered rent only, against a contribution that had already
absorbed labour. Use the honest number; it is still a low bar.

**Dine-in** (AOV ~180, no packaging, no platform variable): ~EGP 126/cover at 70%
margin. 20 covers/day ≈ EGP 75.6k/month — nearly the whole cash fixed base. But
"costs nothing extra" is false as stated: counter staff, plates and washing, seating,
WC, probably a broader licence category, and it competes with delivery for the line at
20:00. Say **"shares rent and kitchen with the delivery business."**

**Blended gross take rate = 0.15 + 0.85 × m** (m = own-brand order share).
At 10% mix → 23.5%. The defensible sentence: *"At a 10% own-brand mix we clear a 23.5%
blended gross take rate — above Talabat's 22–28% headline commission — without charging
any merchant more than 15%."*

---

## 3. Launch sequence (all five, staged — with gates, not dates)

The deck's own warning: *"launching five simultaneously with no kitchen team is the most
common way cloud kitchens fail."* All five launch — one at a time.

**Order (differs from the deck's table order, deliberately):**

| # | Brand | Why this slot |
|---|---|---|
| 0 | **Dine-in / terrace counter** | No drivers, no dispatch, no app dependency. Starts covering rent on day one. |
| 1 | **Sinai Smash** (burgers) | Volume anchor, most forgiving prep, smallest ingredient set, "opposite McDonald's" hook. Maximum learning per week. Breakfast first would mean learning slowly in the lowest-volume daypart. |
| 2 | **Sukkar** (desserts) | Prep-forward — made ahead, plated in 90s — near-zero live-line load. Highest margin, best attach; enables "sweet finish" combo items on Smash's menu. |
| 3 | **First Light** (breakfast) | Adding a *shift*, not a cuisine, to a team with a routine. Captures the dead 07–11h window. |
| 4 | **Corallo** (Italian) | Pasta to order = real technique; needs a competent line, worth doing properly rather than early. |
| 5 | **Shawrimp** (shrimp shawarma) | Last, deliberately: shellfish is the highest food-safety-risk category in a hot climate; needs a proven cold chain. The "world first" claim invites press — point it at a mature kitchen. |

**Gates before each next brand (ALL must hold):**

1. ≥14 consecutive trading days, zero food-safety incidents.
2. Measured food COGS within ±5pp of the 30% target, **from purchase invoices** — if
   real COGS is 40%, the model changes before it gets multiplied by five.
3. ≥95% of orders accepted inside the auto-accept window.
4. P90 prep time ≤ the brand's `prep_time_high` (the SLA credit engine and CPL 181/2018
   exposure sit downstream of this number — set it honestly per brand: Sukkar ~5 min,
   Corallo ~20).
5. **The multi-brand kitchen queue is live and dogfooded** before a second
   `merchant_staff` row exists (shipped 2026-07-27: `getMyKitchen()`, combined
   brand-tagged queue, pause-all).
6. A named second cook — the bus-factor answer is a name, not a plan.
7. ≥40 live third-party merchants. 5 own brands of 30 storefronts is 17% and looks
   astroturfed; 5 of 60 is 8% and unremarkable.

**Top risks:** Egyptian food-handling + dine-in licensing (confirm the exact set with a
Sharm F&B lawyer **before** fit-out; 8–12 weeks; the likeliest missed-opening cause) ·
founder as single point of failure (documented prep sheets from day one — automation-first
must mean *written down*) · COGS drift (weekly invoice review, 12 weeks) · peak-capacity
collapse (the pause-all control + a busy-mode prep-time bump) · the unresolved lease
figures (159 m²/3-week vs 98 m²/10-week — reconcile against the signed lease before any
investor sees either).

---

## 4. Channel-conflict policy (say this to merchants and investors)

1. **Gap-filling, not duplication.** Own brands open only in categories with no live
   merchant. If a merchant later joins a category we occupy, they get the founding rate
   regardless of cohort timing.
2. **No ranking advantage, ever.** Enforced in the database, not by promise:
   `restaurants_own_brand_never_featured_chk` makes featuring an own brand impossible
   for every writer — cron, RPC, or manual UPDATE. The `ranking_integrity_audit` view is
   the artefact to show anyone who asks.
3. **No data advantage.** Own-brand ops see exactly what any merchant sees for their own
   restaurant.
4. **Full disclosure.** Every own brand carries a neutral "Sharm Eats Kitchen" chip on
   the card and storefront (5 locales, `restaurant.ownBrand`). Never seed ratings on an
   own brand — they earn them like everyone else.
5. **Same terms internally.** Own-brand P&L is charged the standard 15% as an internal
   transfer, so "we're on the same terms and we eat our own cooking" is literally true.

The LOI already gives merchants no exclusivity and a 7-day no-penalty exit — lead with
that: a merchant who can leave costlessly is structurally protected.

**The 30-second merchant version:** *"Yes, we run a kitchen — five brands at Mercato,
labelled as ours in the app. In writing: we only open categories nobody covers, we never
rank ourselves above you — the database physically refuses — and we pay the same 15%.
If we ever compete with you directly, you're on founding rates permanently, and you can
walk in 7 days anyway."*

---

## 5. What is built vs pending (as of 2026-07-27)

| Piece | State |
|---|---|
| Migration `126_cloud_kitchen_foundation.sql` | Written; survived a 15-agent adversarial review (2026-07-27) that found + fixed 3 real defects (NULL-kitchen conversion crash, settlement-freeze on converted merchants, upsert field-wipe); shim suite green (8 tests + negative control); **not yet applied to prod** — follow the 126 procedure in `docs/DATABASE-RELEASE-RUNBOOK.md` (backup → prod dry-run artifact `supabase/tests/126_cloud_kitchen_dryrun_prod.sql` → apply); never `db push` |
| Settlement self-payout exclusion (both writers + trigger) | In mig 126 |
| Ranking integrity (CHECK + sweep exclusion + audit view) | In mig 126 |
| `admin_upsert_kitchen` / `admin_set_merchant_type` / `platform_revenue_report` | In mig 126 |
| Kitchen-aware batching (`same_pickup`) | In mig 126; shadow log gains the column |
| Multi-brand kitchen queue (apps/restaurant) | Shipped: `getMyKitchen()`, `.in()` queue, per-brand realtime channels, brand chips + filter, pause-all. Needs the next EAS build (native app) |
| merchant-web deterministic brand resolution | Shipped (ordered `.limit(1)`) |
| Customer disclosure chip | Shipped: `OwnBrandBadge`, card + storefront, 5 locales. Next EAS build |
| Admin /finance platform-revenue panel | Shipped; hides itself until the RPC exists in prod |
| Cross-brand basket | **Deferred.** Launch with "kitchen combo" items on a host brand's menu (zero schema change); revisit child-orders/delivery-group once real attach data exists |
| Dine-in "Counter sale" flow | **Deferred** (~1–2 days when needed): `'dine_in'` fulfillment type + synthetic counter-customer; excluded from dispatch/SLA/commission. Until then walk-ins are recorded on paper **and reconciled weekly against invoices** — unrecorded walk-in revenue corrupts the COGS denominator |
| COGS / `menu_item_costs` | Deferred until ~500 orders + 1 month of invoices |

**Owner actions before the kitchen can exist in prod:** ① apply mig 126 (backup first);
② `npm run db:types`; ③ create the kitchen + 5 brands via `admin_upsert_kitchen` /
`admin_set_merchant_type` (zone for Mercato: confirm — likely `hadaba`; the enum value
`naama_bay` does not exist, the real ids are `naama`, `hadaba`, …); ④ reconcile the
lease figures in the deck; ⑤ get a real fit-out quote to replace the 36% allocation.
