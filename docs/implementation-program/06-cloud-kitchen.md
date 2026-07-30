# Package 06 — cloud-kitchen operating launch

## Outcome

Turn the already-built own-brand and multi-brand infrastructure into a controlled
food business, one brand at a time, with known recipes/costs, food-safety
evidence, capacity controls and honest P&L.

The commercial and sequencing source of truth remains
[`../CLOUD-KITCHEN-PLAN.md`](../CLOUD-KITCHEN-PLAN.md). This package specifies
the remaining product, data, operational and verification work.

> **Status 2026-07-30 — recon + build session.** Claims verified against the
> live repo/database; deliveries and corrections:
>
> * The own-brand infrastructure credit belongs to **mig 126 alone** (1063
>   lines) — the "126-129, 152-166" range in this file is wrong: 127-129 are
>   fee/zone fixes and 152-166 are the vertical-authority program. The
>   protection is genuinely layered: four independent guards keep own brands
>   unfeaturable, the settlement exclusion has three legs, and
>   `ranking_integrity_audit` is a security-invoker view.
> * **Built this session:** mig 184 — the weekly fair-marketplace integrity
>   sweep this file requires (nothing watched the invariants; first prod run:
>   0 violations) + urgent food-safety escalation (`food_safety` reason ->
>   `urgent` priority, previously UNREACHABLE, -> immediate ops page). Mig 185
>   — `brand_gate_report` encoding the plan's real **seven** gates (this file
>   lists five), measuring what the data can prove and returning NULL for
>   owner-evidence gates (COGS, second cook) — NULL blocks. Mig 186 — busy
>   mode with bounded self-expiring prep bumps flowing into
>   `delivery_feasibility`, so checkout ETAs and the SLA engine move together.
>   `scripts/validate-cost-import.sh` — the Stage-1 read-only CSV validator.
>   Restaurant app: pause-all now reports per-brand results, the ticket
>   detail carries the brand tag, and item-86 works on every brand of a
>   multi-brand kitchen (it silently operated on the lowest-id brand only).
> * **Corrected claims:** "combined brand-tagged queue and pause-all" was
>   PARTIAL (no per-brand pause exists, and pause-all had no per-brand
>   result); busy mode and post-acceptance prep/ready timers did not exist;
>   'urgent' support priority was legal but unreachable.
> * **Still open (product):** per-brand pause, post-acceptance prep/ready
>   timers and stalled-order aging, structured out-of-stock reason codes on
>   reject, test-order mode.
> * **Owner-gated, untouched by design:** Stage 0 dossier, provisioning
>   (0 kitchens / 0 own-brand rows in prod — correctly unfabricated), real
>   recipes/costs, counter/dine-in decision, Stage 7 inventory. Note: prod has
>   44 active third-party merchant rows — gate 7's >= 40 passes on rows;
>   whether they are genuinely TRADING is the owner's judgment.

## Current evidence

Already built and live:

- `kitchens`, `merchant_type`, `kitchen_id`, owner-brand settlement exclusion,
  ranking constraint/audit and `platform_revenue_report` from migration 126;
- vertical-aware fees and service-area fixes from migrations 127–129;
- admin kitchen/ownership RPCs;
- company-owned disclosure in customer app;
- combined brand-tagged restaurant-app queue and pause-all;
- finance reporting that separates third-party commission from own-brand
  subtotal.

Still owner/operations work:

- reconcile signed lease size/timing facts and obtain the real fit-out quote;
- licensing/legal confirmation for production and any dine-in use;
- name the kitchen team and backup cook;
- create the real kitchen and brand records only after menus/facts are ready;
- source, cost, test and photograph real products;
- operate the brand gates from the Cloud Kitchen plan.

No production row or investor claim should be fabricated merely to make the UI
look populated.

## Expected repository surfaces

- owner-reviewed launch dossier, cost import and food-safety/shift runbooks;
- additive cost/inventory migrations only at the evidence gates described
  below, with generated DB types/security tests;
- current admin kitchen/merchant/finance pages and provisioning RPCs;
- restaurant multi-brand queue, availability, prep/busy and incident surfaces;
- customer own-brand disclosure and five locale files;
- analytics/operating reports built on `platform_revenue_report`;
- optional counter fulfillment only after the explicit owner/legal decision.

## Stage 0 — owner launch dossier

No kitchen seed or capex release until one reviewed dossier contains:

- signed lease facts: address, area, dates, rent, deposit, permitted use;
- licence list, responsible adviser, application owner and evidence;
- fit-out/vendor quotes and contingency;
- equipment, ventilation, cold-storage and fire-safety requirements;
- staffing roster, pay, shift coverage and named backup;
- approved supplier list and cold-chain plan;
- allergen/HACCP-style controls and incident procedure;
- waste, cleaning, pest-control and temperature-log procedure;
- dine-in legality/requirements if the terrace/counter will operate;
- opening cash, working capital and stop-loss limit.

Each unknown is labeled as an assumption with owner/date, never converted into a
product constant or investor fact.

## Stage 1 — menu and cost truth before ERP

The existing operating plan deliberately defers a full inventory system. Keep
that discipline. Start with a controlled cost import and immutable effective
costs, not a general warehouse platform.

Suggested minimal model after real recipes/invoices exist:

```text
menu_item_cost_versions
  id
  menu_item_id
  effective_from
  food_cost_egp
  packaging_cost_egp
  source_invoice_refs
  approved_by
  approved_at
  unique(menu_item_id, effective_from)

brand_daily_metrics
  restaurant_id
  trading_date
  orders
  net_sales_egp
  food_cost_egp
  packaging_cost_egp
  waste_egp
  labour_hours
  incidents
  source
```

Before the ~500-order/month-of-invoices threshold in the operating plan, use a
versioned spreadsheet/import artifact with:

- recipe yield and portion;
- ingredient quantities;
- latest supplier invoice and unit conversion;
- food and packaging cost;
- menu price, VAT/tax treatment if applicable;
- contribution under pessimistic/base/current cost;
- allergen cross-contact and preparation notes;
- reviewer and effective date.

The import validates menu item IDs, positive values, duplicate effective dates
and restaurant ownership. It never writes sales totals or historical order
prices.

Move to the database cost-version model when there is enough real volume to
justify it. Do not build purchasing/inventory/accounting modules ahead of actual
operating use.

## Stage 2 — real kitchen and brand provisioning

Use only the owner/admin RPCs from migration 126:

1. confirm the exact zone and service-area coordinates;
2. `admin_upsert_kitchen` with verified lease facts;
3. create each restaurant/storefront through the normal merchant/admin path;
4. `admin_set_merchant_type` and attach the shared kitchen;
5. verify `commission_pct=100` sentinel and no settlement eligibility;
6. verify own brands cannot be featured and appear in
   `ranking_integrity_audit`;
7. assign staff roles explicitly;
8. keep future brands closed/unpublished until their gate passes.

Seed one real brand first—Sinai Smash per the operating plan—not five empty or
fictional live storefronts.

## Stage 3 — kitchen operating controls

Extend the restaurant/admin surfaces only where live operations require it.

Required:

- brand-specific availability/86 controls;
- pause-all with visible per-brand result and RLS-denial handling;
- busy mode that increases honest prep estimates;
- queue aging and P90 preparation reporting by brand/daypart;
- acceptance/prep/ready timers that work across multiple brands;
- missed-order and stalled-order alerts;
- thermal/offline recovery and a paper fallback;
- explicit ticket brand, modifiers, allergies and kitchen note;
- cancellation/out-of-stock reason capture;
- daily opening/closing checklist and incident log;
- test-order mode clearly excluded from revenue/ratings.

Do not create cross-brand baskets initially. Use documented combo items on one
host brand exactly as the operating plan specifies. Revisit grouped child
orders only after real attachment demand and dispatch complexity are measured.

## Stage 4 — food safety and quality evidence

Product support must not imply software replaces food-safety operations.

Maintain auditable logs for:

- receiving and supplier lot where required;
- cold/frozen storage temperatures;
- cook/hold/cooling checks;
- cleaning and opening/closing sign-off;
- allergen cross-contact exceptions;
- customer quality/food-safety complaints;
- waste and spoilage;
- corrective action and responsible person.

An urgent food-safety case:

- pages the named owner;
- freezes the affected item/brand/batch as appropriate;
- preserves order/customer/supplier evidence with restricted access;
- does not expose medical details broadly;
- requires explicit closure and corrective action.

Shawrimp remains last because shellfish needs a proven cold chain and mature
incident process.

## Stage 5 — counter/dine-in decision

Counter sales currently lack an in-system flow. Before building one, the owner
must decide whether dine-in/counter operation is licensed and material.

If approved, add a distinct `counter`/`dine_in` fulfillment contract:

- no driver dispatch or delivery fee;
- no delivery SLA credit;
- customer identity optional/minimized;
- payment and receipt still recorded;
- own-brand revenue and cost reporting preserved;
- cashier/operator and void/refund audited;
- inventory/cost denominator includes counter sales;
- no fake delivery order or synthetic address.

Until shipped, reconcile paper/POS counter sales weekly against cash, invoices
and production. Never mix them into app order counts manually.

## Stage 6 — launch one brand at a time

The fixed gate from the operating plan applies before every next brand:

- at least 14 consecutive trading days;
- zero food-safety incidents;
- measured COGS within ±5 percentage points of target from invoices;
- at least 95% accepted inside the window;
- P90 prep no worse than the declared range;
- multi-brand queue proven before brand two;
- named second cook;
- at least 40 live third-party merchants.

Additionally require:

- reconciliation from orders to own-brand revenue report;
- cancellation/refund/support within agreed bounds;
- peak-load test and pause/busy-mode drill;
- contribution after food, packaging and platform variable cost is positive;
- owner signs a go/hold/stop decision with evidence.

Sequence remains:

1. counter/dine-in only if legally and operationally approved;
2. Sinai Smash;
3. Sukkar;
4. First Light;
5. Corallo;
6. Shawrimp.

## Stage 7 — capacity, sourcing and waste

Only after the first brand produces reliable daily data, add the smallest
inventory layer needed:

```text
ingredients
  id, kitchen_id, name, base_unit, allergen_flags

recipe_components
  menu_item_id, ingredient_id, quantity, yield_loss_pct

inventory_movements
  ingredient_id
  kind received|used|waste|adjustment
  quantity
  source_ref
  actor_id
  occurred_at
```

This is a perpetual operational ledger, not financial accounting. It must have
unit conversions, immutable movement history and adjustment audit. Recipe
theoretical use is compared with actual purchasing/waste; it does not silently
post authoritative stock without a defined production event.

Build purchase orders, forecasting or supplier integrations only after repeated
manual work proves the requirement.

## Fair-marketplace safeguards

Keep these as database/monitoring invariants:

- own brands can never be featured;
- ranking logic does not special-case ownership;
- customer card/storefront discloses “Sharm Eats Kitchen” in five locales;
- own-brand operators cannot see competitor-private data;
- platform reporting never double-counts own-brand commission;
- third-party settlement never includes an own brand;
- launch categories follow the written gap-filling policy;
- founding-rate remedy and 7-day exit claim match signed merchant terms.

Add a weekly integrity report with own-brand share, ranking positions, featured
constraint, settlement exclusions and access-policy checks.

## Analytics and operating scorecard

Per brand/daypart:

- views, conversion, orders, repeat and attach;
- acceptance, prep P50/P90, ready-to-pickup wait;
- cancellation/out-of-stock/refund/support;
- sales, food cost, packaging, waste and contribution;
- labour hours and orders per labour hour;
- availability/pause time;
- quality and food-safety incidents;
- third-party merchant count and own-brand share.

Never report blended gross take rate as margin. Use
`platform_revenue_report` for platform revenue and the approved cost source for
own-brand contribution.

## Tests and verification

Database:

- admin-only provisioning;
- staff role boundaries;
- no own-brand settlement under all writers;
- no own-brand featuring under direct/RPC/cron paths;
- cost-version ownership/effective-date constraints;
- platform revenue arithmetic;
- counter fulfillment exclusions if built;
- inventory movement authorization/audit if built.

Applications:

- multi-brand realtime queue, brand filtering, pause-all and partial failure;
- busy/prep-time behavior;
- offline/restart/thermal recovery;
- allergies/modifiers/notes legibility;
- own-brand disclosure in five locales/RTL;
- finance and operating scorecards.

Operational drills:

- full service from test order through handoff;
- sudden brand pause and item 86;
- tablet/network failure with paper recovery;
- peak queue;
- supplier/cold-chain rejection;
- food-safety incident;
- cash/card/refund reconciliation.

## Rollout and rollback

Provisioning, publication and ordering are separate gates. A brand can exist
privately for menus/test orders without appearing or accepting customer orders.

Rollback closes the brand and preserves orders, cost versions, incidents and
financial evidence. It never converts an own brand to third party to make
settlements “work.” A failed brand gate means hold/close and investigate, not
automatic launch of the next brand.

## Acceptance

- Lease/licence/fit-out/staff/supplier facts are owner-reviewed and traceable.
- One real brand has costed recipes, safe procedures and a private end-to-end
  test before publication.
- Own-brand revenue, costs and settlement exclusion reconcile.
- Queue, pause, busy mode and offline fallback survive an operating drill.
- Food-safety evidence and escalation are usable by the named team.
- Every next brand is blocked by measurable gates, not a calendar promise.
- Marketplace fairness remains technically enforced and reportable.
