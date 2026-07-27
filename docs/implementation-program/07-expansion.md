# Package 07 — verticals, grocery, pharmacy and city expansion

## Outcome

Make the existing vertical architecture real end to end, then launch grocery,
pharmacy and city two as separate gated product programs. None is a configuration
flip and none should run in parallel with an unproven Sharm food operation.

The earlier scope in [`../VERTICALS-ROADMAP.md`](../VERTICALS-ROADMAP.md) remains
useful, but this spec corrects its now-stale statement that delivery quoting is
hardcoded to food.

## Current evidence

- `verticals` contains food, grocery and pharmacy.
- `restaurants.vertical_id`, `delivery_fee_rules.vertical_id`, and menu
  `sku`, `barcode`, `unit`, `requires_prescription` columns exist.
- Migration 127 made delivery-fee quoting use the merchant's vertical.
- Grocery/pharmacy still appear as cuisine chips in customer code, while the
  actual vertical is not load-bearing across all domain/repository/UI paths.
- Merchant onboarding/admin editing still defaults to food and does not provide
  a complete vertical workflow.
- Catalog metadata is mostly discarded by mappers and menu editors.
- Pricing/order/credit/refund/settlement amounts are integer EGP. Variable-weight
  grocery exposes this as a foundational precision and final-price problem.
- Stock is boolean availability, not quantity/reservation.
- There is no substitution/picker workflow.
- Pharmacy has no prescription, pharmacist or ID-verification workflow.
- Zones are a Sharm-specific enum and service area is one platform bounding box.
  Updating that box for city two would widen/replace Sharm, not create a real
  multi-city model.

## Expected repository surfaces

- staged vertical/money/catalog/inventory/prescription/city migrations and
  generated DB types/security tests;
- latest production quoting, checkout/place-order, assignment, settlement and
  service-area RPC bodies where contracts change;
- customer domain types, mappers, repositories, navigation, browse/search,
  catalog/cart/order and five locale files;
- merchant onboarding/catalog/import/picker flows;
- admin vertical, merchant, city, pharmacy and operating controls;
- driver delivery-verification changes when legally required;
- private Storage bucket/policies for prescriptions;
- Edge Functions/jobs for imports, notifications and regulated workflows;
- migration/compatibility runbooks and full money/release/device test packs.

## Gate 0 — expansion readiness

Do not start a vertical/city implementation until the business gate is signed:

- Sharm food pilot has repeat demand and stable lifecycle metrics;
- supply/driver/support/settlement operations are repeatable;
- no unresolved money-integrity blocker;
- owner has named a launch market, supply lead and operational owner;
- vertical-specific unit economics and legal advice exist;
- engineering capacity is allocated without stopping pilot reliability work.

Architecture work may be reviewed earlier, but no inactive vertical is presented
as live.

## Program A — make vertical identity load-bearing

### Domain contract

Thread `vertical_id` through:

- generated DB types and row mappers;
- customer `Restaurant`/merchant domain model;
- repository filters and cache keys;
- home/browse/search/results/storefront;
- menu-item domain model for SKU/barcode/unit/prescription;
- merchant onboarding and menu/catalog editor;
- admin merchant editor and reporting;
- order snapshot and analytics.

Use one taxonomy:

- `vertical` answers **what commerce workflow is this?**
- category/cuisine answers **what kind within that vertical?**

Remove grocery/pharmacy as global food-cuisine aliases. A selected vertical owns
its category list and customer vocabulary.

### Vertical configuration

```text
verticals
  id
  is_active
  display_order
  icon_key
  copy_namespace
  capabilities jsonb

vertical_categories
  id
  vertical_id
  slug
  is_active
  display_order
```

Capabilities are bounded presentation/config hints, not security authority:

- supports_scheduled;
- supports_weighted_items;
- supports_substitutions;
- supports_prescription;
- supports_age_check;
- terminology keys.

Server functions still enforce vertical-specific rules explicitly.

### Merchant lifecycle

- applicant chooses only an owner-enabled vertical;
- non-food applications route to ops review until that program launches;
- admin can assign vertical with audit;
- changing a live merchant's vertical is blocked if it has incompatible catalog
  or active orders;
- menu editor reveals only fields relevant to its vertical;
- publication fails if mandatory vertical data is incomplete.

### Acceptance

Create one private test merchant per vertical. Each appears only inside the
correct vertical, uses correct terminology/catalog fields/fee rule, and cannot
take an order while its vertical is inactive.

## Program B — money precision RFC, before grocery

Grocery cannot safely bolt decimal/weighted prices onto integer EGP. Approve one
money representation before catalog implementation.

Recommended direction:

- canonical monetary storage becomes integer minor units (`*_minor`, 100 qirsh
  per EGP) using `bigint`;
- currency remains EGP for the current market;
- UI formatting is centralized;
- commission/discount/tax/credit/refund allocation has an explicit rounding
  policy;
- old integer-EGP fields remain compatibility snapshots during migration;
- no floating point or client `numeric` arithmetic in authority paths.

Staged migration:

1. Write a money inventory of every amount column, RPC, Edge Function, type,
   formatter, report and test.
2. Add shadow minor-unit columns and deterministic backfill
   `old_egp * 100`; do not overwrite old facts.
3. Add shared conversion/rounding helpers and dual-write assertions.
4. Replace `place_order` from its current production body so it calculates minor
   units and asserts legacy totals for whole-EGP food.
5. Update payment/refund/credit/settlement/driver/platform reports.
6. Regenerate types and update all clients.
7. Shadow-compare for a full operating cycle.
8. Make minor units authoritative; retain compatibility reads for old binaries.
9. Remove legacy writes only after all supported binaries and jobs have moved.

The RFC must define:

- half-up/half-even rule and where residual qirsh goes;
- maximum amount/quantity;
- percentage commission rounding;
- discount allocation across lines;
- partial refund allocation;
- Paymob minor-unit contract;
- exports/reports;
- migration rollback and mismatch alarm.

If the owner chooses whole-EGP pricing for the grocery pilot, weighted goods must
use fixed prepacked weights/prices. Do not advertise price-by-weight while
silently rounding.

## Program C — grocery

### C1. Catalog and bulk import

Extend menu items or introduce vertical-neutral catalog naming while maintaining
old clients:

```text
catalog_items
  merchant_id
  sku
  barcode
  name/description/image
  sale_mode each|fixed_pack|measured
  base_unit each|g|kg|ml|l|pack
  price_minor
  price_basis_quantity
  min_quantity, quantity_step, max_quantity
  tax/category metadata
  is_active
  unique(merchant_id, sku)
```

Bulk CSV import:

- download template and dry-run preview;
- validate headers, types, duplicates, images, unit/quantity combinations;
- show row-level errors;
- upsert only by merchant-scoped SKU;
- explicit create/update/archive counts;
- idempotency/import audit;
- never authorize a merchant to another merchant's catalog.

Support barcode search/scanning as an optimization after import and manual SKU
flow work.

### C2. Inventory and reservations

```text
inventory_balances
  merchant_id, catalog_item_id
  on_hand
  reserved
  version

inventory_movements
  item_id
  kind receipt|reservation|release|sale|return|waste|adjustment
  quantity
  order_id null
  actor_id
  idempotency_key unique
```

Order preparation reserves atomically and fails/explains shortages. Cancellation
or expiry releases. Pickup/finalization converts reservation to sale. Direct
adjustments require a reason and audit. Boolean availability remains a manual
stop independent of quantity.

Start with merchant-maintained stock or “in stock/out of stock” for a small
catalog if accurate quantities cannot be operated. A false precise stock number
is worse than an explicit availability workflow.

### C3. Basket preparation and final price

Introduce a grocery fulfillment state machine separate from food kitchen states:

```text
placed
→ accepted
→ picking
→ awaiting_customer
→ packed
→ ready_for_pickup
→ picked_up
→ delivered
```

For measured goods:

- checkout shows estimated quantity/total and an explicit maximum authorization
  or COD expectation;
- picker records actual weight within configured tolerance;
- server reprices from authoritative basis;
- customer approves if total/substitution crosses the agreed tolerance;
- card capture/refund/credit follows Package 04;
- the final receipt shows estimated vs actual;
- dispatch does not pick up until the payable total is resolved.

Do not allow a picker to enter an arbitrary price.

### C4. Substitutions

```text
order_item_substitutions
  original_order_item_id
  proposed_catalog_item_id null
  proposed_quantity
  price_delta_minor
  reason
  status proposed|accepted|rejected|expired|not_available
  proposed_by, decided_by
  timestamps
```

Customer preference per line:

- best match within price tolerance;
- contact me;
- refund if unavailable;
- named substitute.

Flow:

1. picker marks shortage;
2. server validates proposed item, stock, price and merchant;
3. customer receives operational notification/inbox action;
4. approval is idempotent and owner-bound;
5. timeout follows the customer's declared fallback;
6. order totals, payment adjustment, inventory and receipt update atomically.

### C5. Picker role

Add a narrow `picker` capability—not owner/manager permissions—to the existing
staff-role system.

Picker can:

- see assigned grocery baskets;
- scan/confirm items;
- record bounded weight;
- propose substitution/out-of-stock;
- pack/mark ready.

Picker cannot:

- change catalog prices;
- edit merchant/storefront/payout;
- issue refund/credit;
- see unnecessary customer data;
- complete delivery/payment.

Use merchant/restaurant app mode initially if ergonomics work; a separate app is
justified only by measured workflow/device needs.

### C6. Customer and merchant UX

Replace food language per vertical:

- restaurant → store;
- menu/dish/kitchen/prep → catalog/item/picking/packing;
- cuisine → grocery category;
- dietary/allergy flows shown only where meaningful;
- quantity/unit/price basis and substitution preference always clear.

Complete all copy in five locales and RTL. A grocery catalog may need
merchant-provided translations/search aliases; define who owns them.

### Grocery acceptance

- 1,000+ SKU import can dry-run, report errors and idempotently apply.
- Concurrent baskets cannot oversell the same last stock.
- Every reservation is sold or released.
- Weighted-item estimate, actual, approval and final receipt reconcile to qirsh.
- Substitution accept/reject/timeout and refund paths are proven.
- Picker has no price/refund/other-merchant authority.
- A production-shaped store completes order-to-settlement with zero unexplained
  variance.

## Program D — pharmacy

### D0. Legal gate

No pharmacy build/merchant promise before written Egyptian legal advice covers:

- entity and pharmacy licensing;
- who may own/operate/dispense;
- prescription and controlled-item scope;
- online ordering/delivery restrictions;
- pharmacist and driver identity checks;
- patient data, retention, deletion and breach obligations;
- prohibited marketing/substitution practices;
- record/reporting requirements.

The legal matrix decides the product states. Code cannot infer compliance from a
`requires_prescription` boolean.

### D1. Product classification

Add server-controlled medication attributes:

- prescription class;
- controlled/prohibited delivery state;
- age requirement;
- substitution allowed and pharmacist-only substitution;
- storage/temperature requirement;
- maximum quantity;
- active ingredient/strength/form;
- approval/version/source.

Merchants cannot downgrade legal classifications to sell an item.

### D2. Prescription evidence

Use a private Storage bucket with:

- owner upload/read;
- assigned authorized pharmacist read;
- service processing only;
- no public URL;
- short-lived signed access;
- encryption/retention/deletion policy;
- malware/file-type/size validation;
- access audit.

```text
prescriptions
  id, customer_id
  storage_path
  status submitted|under_review|approved|rejected|expired
  reviewer_id
  decision_reason
  issued/expires metadata where legally required

prescription_order_items
  prescription_id
  order_item_id
  authorized_quantity
```

### D3. Pharmacist queue and order enforcement

Add an authorized pharmacist role and review queue. Approval/rejection is
structured, immutable and scoped to the exact medication/quantity/order.

Starting from the latest production `place_order`/checkout preparation:

- block prohibited items;
- require valid approved evidence for prescription items;
- prevent reuse beyond authorized quantity/expiry;
- require pharmacist approval before payment/fulfillment as legal advice
  dictates;
- prevent ordinary staff/admin impersonating a pharmacist;
- fail closed when classification/evidence is missing.

### D4. Delivery verification

If required:

- customer names the eligible recipient;
- driver receives only minimum necessary instruction;
- ID/age check uses an explicit pass/fail flow;
- failed check returns the sealed order under a defined chain of custody;
- no ID image is retained unless legal advice requires it;
- controlled/temperature-sensitive items have handoff evidence.

### Pharmacy acceptance

- legal requirements are mapped to testable product controls.
- Prescription media is private and every access is auditable.
- Cross-customer/pharmacy/pharmacist RLS tests fail closed.
- `place_order` cannot bypass prescription/classification/quantity rules.
- Reject/expiry/reuse/return and refund paths are proven.
- Customer, pharmacist, picker, driver and support roles see only required data.

## Program E — city dimension

Do not add another value to the Sharm `zone_type` enum or replace the single
`service_area_bbox`. Introduce first-class city/service-area entities.

```text
cities
  id uuid
  slug unique
  country_code
  timezone
  default_locale
  currency
  is_active

service_areas
  id
  city_id
  name
  boundary geography(polygon/multipolygon)
  is_active

zones
  id uuid
  city_id
  slug
  name
  boundary geography
  is_active
  unique(city_id, slug)
```

Migration strategy:

1. seed Sharm city and map every current enum zone to a new zone row;
2. add nullable `city_id`/new `zone_id` shadow FKs to restaurants, kitchens,
   drivers, addresses, orders, fee rules, settlements/report dimensions;
3. deterministic backfill from current zone;
4. dual-read/dual-write with mismatch assertions;
5. replace `is_within_service_area` with a point-to-active-area resolver;
6. update quote, merchant onboarding, driver eligibility, dispatch, search,
   analytics, support and admin filters;
7. snapshot city/zone on orders;
8. migrate client types/routes/cache keys;
9. activate city two privately;
10. remove enum authority only after old binaries/jobs are retired.

City-specific configuration:

- service area/boundaries;
- delivery fees and distance/radius;
- merchant/driver supply and operating hours;
- support/ops contacts;
- payment availability;
- promotions/referrals;
- auto-assignment/SLA settings;
- locale/copy as needed.

Every customer query and realtime subscription is city-scoped. Admin must show
the active city context prominently to prevent cross-city operations. A driver
cannot be assigned across cities merely because coordinates are near a boundary.

### City-two go-live gate

- named city GM/ops/support/driver supply;
- legal/payment/tax review;
- mapped service area and field-tested addresses;
- enough live supply to avoid an empty marketplace;
- fees and unit economics approved;
- private COD lifecycle and restore drill;
- settlement/cash/support/incident rehearsal;
- release/monitoring segmented by city;
- soft launch cohort and rollback/close switch.

## Tests and verification

- vertical and city RLS, filters and cache isolation;
- inactive vertical/city fail closed;
- fee quote selects city + zone + vertical rule;
- old food/Sharm binaries continue during staged migrations;
- no grocery/pharmacy vocabulary leaks into food and vice versa;
- all money paths reconcile after minor-unit migration;
- five locales/RTL for each activated workflow;
- physical device, offline, poor-network and realtime tests;
- backup/restore includes every new table, Storage policy and cron/function.

## Rollout and rollback

Order:

1. vertical identity and private test merchants;
2. money precision shadow migration;
3. grocery private catalog/picker pilot;
4. grocery controlled launch;
5. pharmacy only after legal and grocery foundations;
6. city dimension shadow migration;
7. private city-two pilot and controlled launch.

Vertical/city activation is server-authoritative. Rollback closes the affected
vertical/city and preserves orders, catalog, prescription and financial records.
It must not require reverting shared Sharm food code or dropping migrated data.

## Acceptance

- Vertical and city are explicit authority/query/report dimensions.
- Food behavior remains unchanged through the compatibility window.
- Grocery pricing, inventory, substitutions, picker and settlement are
  production-shaped and auditable.
- Pharmacy is impossible to activate without the legal and product controls.
- City two does not share a global bbox or Sharm-only zone enum as authority.
- Each launch has a private pilot, measurable supply/economics gate and reversible
  activation.
