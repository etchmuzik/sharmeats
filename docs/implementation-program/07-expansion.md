# Package 07 — verticals, grocery, pharmacy and city expansion

## Outcome

Make the existing vertical architecture real end to end, then launch grocery,
pharmacy and city two as separate gated product programs. None is a configuration
flip and none should run in parallel with an unproven Sharm food operation.

The sequencing in
[`../BUSINESS-ROADMAP-2026-07-27.md`](../BUSINESS-ROADMAP-2026-07-27.md)
remains the business authority. This spec owns the expansion engineering
contract. For interleaving this package with delivery-as-a-service, the
roadmap-approved E0–E8 sequence in
[`EXPANSION-OWNER-DECISIONS.md`](EXPANSION-OWNER-DECISIONS.md) and
[`CLAUDE-EXPANSION-REVIEW-AND-IMPLEMENT.md`](CLAUDE-EXPANSION-REVIEW-AND-IMPLEMENT.md)
is explicit authority; Package 07 does not have to finish Rx/city before the
internal or verified-merchant courier pilots.

## Current evidence

- `verticals` contains food, grocery and pharmacy.
- `restaurants.vertical_id`, `delivery_fee_rules.vertical_id`, and menu
  `sku`, `barcode`, `unit`, `requires_prescription` columns exist.
- Migration 127 made delivery-fee quoting use the merchant's vertical.
- `verticals.is_active` is not yet an authority boundary. Current public
  merchant/menu reads and the production order-placement path do not all fail
  closed on it. A non-food merchant can therefore become visible/orderable
  without the intended vertical launch gate.
- Grocery/pharmacy still appear as cuisine chips in customer code, while the
  actual vertical is not load-bearing across all domain/repository/UI paths.
- Merchant onboarding/admin editing still defaults to food and does not provide
  a complete vertical workflow.
- Catalog metadata is mostly discarded by mappers and menu editors.
- Current search fetches broad menu data for client-side filtering, there is no
  production bulk-import workflow, and orders do not snapshot the vertical.
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

Do not **activate or market** a vertical/city until the business gate is signed:

- Sharm food pilot has repeat demand and stable lifecycle metrics;
- supply/driver/support/settlement operations are repeatable;
- no unresolved money-integrity blocker;
- owner has named a launch market, supply lead and operational owner;
- vertical-specific unit economics and legal advice exist;
- engineering capacity is allocated without stopping pilot reliability work.

Dark schema, security, compatibility and private-test foundations may be
implemented earlier. They stay `disabled`/`private`, create no public promise
and cannot divert reliability work from the food pilot.

## Program A — make vertical identity load-bearing

### A0. Server-authoritative launch gate

Close this before adding a grocery or pharmacy tab. Existing `is_active` must
become a real emergency kill switch, not presentation metadata.

Add a bounded launch state:

```text
verticals
  is_active boolean                 -- emergency operational kill switch
  launch_stage disabled|private|public

vertical_private_access
  id
  vertical_id
  user_id
  generation
  status active|revoked|expired
  cohort
  reason
  granted_at
  expires_at null
  granted_by
  revoked_at null
  revoked_by null
  partial unique(vertical_id, user_id) where status = active

vertical_private_access_events
  grant_id
  action granted|used|expired|revoked
  actor_user_id null
  reason null
  occurred_at

vertical_launch_events
  vertical_id
  previous_stage
  new_stage
  previous_is_active
  new_is_active
  reason
  evidence_reference null
  actor_user_id
  occurred_at

private.platform_owners
  user_id primary key
  status active|revoked
  granted_by_database_owner
  granted_at
  revoked_at null

private.platform_operator_capabilities
  id primary key
  user_id
  capability expansion_launch_manager|compliance_evidence_manager|
             product_compliance_reviewer|pharmacy_support|delivery_access|
             delivery_compliance|delivery_config|delivery_dispatch|
             delivery_support|delivery_finance
  status active|expired|revoked
  granted_by
  granted_at
  expires_at null
  revoked_at null
  reason
  partial unique(user_id, capability) where status = active

private.platform_operator_capability_events
  capability_grant_id
  action granted|expired|revoked
  actor_user_id
  reason
  occurred_at
```

Food is backfilled to its current public behavior. Grocery and pharmacy remain
`disabled` until an explicit owner migration or audited admin action changes
them. Never infer launch state from the existence of a merchant or catalog.

The following paths must all enforce the same rule:

- public/anonymous merchant and menu `SELECT` policies;
- customer browse, search, storefront and direct-ID reads;
- delivery quote and serviceability functions;
- authoritative cart preparation and `place_order`;
- promotions, saved-item/reorder and notification jobs;
- Realtime subscriptions and caches;
- private test access, which is user-scoped and cannot leak through a public
  direct-ID query.

`place_order` must re-read the merchant, vertical, catalog rows and launch state
inside its transaction. A stale client, deep link, saved cart or guessed UUID
cannot bypass a disabled/private vertical. Merchant owners may manage their own
private catalog, but that does not make it customer-orderable.

The effective state is unambiguous:

```text
if is_active = false                 → disabled
else if launch_stage = disabled      → disabled
else                                  launch_stage
```

`is_active=false` is therefore the emergency override even if a stale row says
`public`; `is_active=true` never overrides a `disabled` launch stage.
`launch_stage` is non-null and constrained to the three defined values.

Visibility/authority truth table:

| Effective state | Anonymous/customer | Private-grant customer | Merchant owner/manager | Approved platform operator | Service jobs |
|---|---|---|---|---|---|
| `disabled` | no read/order | no read/order | manage own draft catalog only | inspect/configure | no customer action |
| `private` | no read/order | read/order until grant expiry/revocation | manage own catalog/orders | operate named cohort | only for an explicitly authorized cohort subject |
| `public` | normal scoped read/order | normal scoped read/order | normal scoped manage | normal operations | subject to ordinary user/merchant eligibility |

The service role bypasses RLS, so jobs/definer functions must call the same
effective-stage and subject-access check internally rather than treating
`service_role` as customer eligibility.

The initial platform-owner UUID is an explicit release input, never inferred
from the first admin. Only an active platform owner grants/revokes the root
expansion capabilities (`expansion_launch_manager`,
`compliance_evidence_manager`, `product_compliance_reviewer`,
`pharmacy_support`, `delivery_access` and `delivery_compliance`) through
definer RPCs; ordinary admin cannot self-grant. Package 08 may let an active
`delivery_access` operator delegate only `delivery_config`,
`delivery_dispatch`, `delivery_support` and `delivery_finance`. Every
generation is retained with an event.

Private-access grant generations/events are never deleted; expiry/revocation
closes the active generation and a regrant creates a new one. Launch state
changes only through a definer RPC authorized by
a server-owned `expansion_launch_manager` capability—not editable JWT metadata—
and always append `vertical_launch_events`. Merchant/admin UI cannot write the
columns directly.

`grant_vertical_private_access`, `revoke_vertical_private_access` and a
service-only idempotent `expire_vertical_private_access` worker lock the
vertical/user, maintain the one-active-generation invariant and append events.

For every new public table, add explicit Data API grants and RLS; current
Supabase projects do not guarantee automatic exposure of newly created tables.
Add negative anonymous, cross-customer, cross-merchant and expired-access tests.

### Domain contract

Thread `vertical_id` through:

- generated DB types and row mappers;
- customer `Restaurant`/merchant domain model;
- repository filters and cache keys;
- home/browse/search/results/storefront;
- menu-item domain model for SKU/barcode/unit/prescription;
- merchant onboarding and menu/catalog editor;
- admin merchant editor and reporting;
- order snapshot, settlements/support dimensions and analytics.

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
  launch_stage disabled|private|public
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
take an order while its vertical is inactive. Prove direct table reads, RPC
calls, guessed IDs, Realtime and old app binaries all fail closed.

## Program B — money precision RFC, before measured grocery

Measured/variable-weight grocery cannot safely bolt decimal pricing onto integer
EGP. Approve one money representation before C1–C6 introduces measured prices,
repricing or partial adjustments. C0 fixed-pack, whole-EGP items are explicitly
exempt and may pilot first.

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
7. Shadow-compare through at least 1,000 production-shaped automated money
   cases and every real money fact for 30 consecutive operating days with at
   least 500 real facts. Any unexplained qirsh mismatch resets the gate; the
   approved threshold is zero unexplained mismatch.
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

### C0. Fastest safe grocery pilot — fixed packs only

This is the recommended first expansion slice. It deliberately avoids the
money, inventory and substitution complexity of a full supermarket.

Pilot contract:

- one private, operator-named grocery merchant;
- 50–200 curated SKUs;
- `sale_mode` is only `each` or sealed `fixed_pack`;
- whole-EGP authoritative prices and integer quantities;
- COD only until Package 04's card gate passes;
- merchant staff pick and pack in the existing merchant/restaurant app;
- merchant-controlled in-stock/out-of-stock availability, with no claim of
  real-time stock quantities;
- one order contains items from one merchant and one vertical;
- no measured weight, customer substitutions, partial fulfillment, driver
  purchasing or cash-on-behalf;
- initial server-versioned limits of 30 distinct SKUs, 20 units per line,
  60 total units and EGP 5,000 basket value; owner/ops may reduce them before
  activation without a client release;
- vertical-specific copy and all five locales.

Minimum implementation:

1. Complete Program A and keep grocery `private`.
2. Add server-owned grocery category, sale-mode and unit constraints plus
   partial unique indexes on `(restaurant_id, sku)` and
   `(restaurant_id, barcode)` when those values are non-null. The same barcode
   may exist at different merchants; duplicates inside one merchant fail import.
3. Preserve SKU/barcode/unit/vertical through generated types, domain mappers,
   order-item snapshots and admin/merchant editors.
4. Add CSV template, dry-run validation, row errors and idempotent
   merchant-scoped upsert.
5. Add server-side catalog search and pagination; do not download the full
   catalog for client filtering.
6. Use the existing boolean availability workflow with a named operator and
   timestamp; show honest “availability confirmed by store” copy. A database
   trigger writes an append-only `menu_item_availability_events` row with
   server-stamped actor/time, prior/new value, reason/source and idempotency key
   for every change, including direct Data API writes.
7. Map the existing food lifecycle internally while presenting
   `accepted → picking → packed → out for delivery → delivered` copy.
8. Run 20–50 controlled COD orders and reconcile merchant, driver and platform
   money before considering public activation.

```text
menu_item_availability_events
  id
  restaurant_id
  menu_item_id
  previous_available
  new_available
  actor_user_id null
  source merchant_app|restaurant_app|admin|import|system|data_api
  reason_code null
  idempotency_key null
  changed_at                      -- server timestamp
  unique(menu_item_id, idempotency_key) where idempotency_key is not null
```

Ordinary roles cannot update/delete audit rows. The trigger derives merchant,
item, actor and values from the transaction rather than trusting client audit
fields. A raw PostgREST update gets a server-generated event ID,
`source=data_api` and no client idempotency key. App-specific definer RPCs may
set an allow-listed source and idempotency key in private transaction context.
A no-op availability update emits no event.

If an item becomes unavailable after placement, C0 never silently removes the
line or changes the total. Before pickup, the merchant uses an idempotent,
server-authorized unavailable-item rejection that rejects the whole order,
releases/cancels any driver assignment, notifies the customer and records the
item/reason. COD has no collection; any future card path uses Package 04 refund
authority. After pickup, support opens an incident/return path rather than
rewriting the basket.

C0 acceptance:

- private access and direct-ID bypass tests pass;
- a 200-SKU import can dry-run and repeat without duplicates;
- search is paginated and scoped to the selected vertical/merchant;
- stale price, unavailable item, invalid unit and basket-limit attempts fail
  server-side, including exact boundary/boundary-plus-one cases for distinct
  SKUs, per-line units, total units and value;
- an old food binary remains unchanged and cannot order private grocery;
- 20 controlled orders complete with zero unexplained order or cash variance.

Programs C1–C6 define the later full-grocery capability. They are not hidden
requirements for the fixed-pack pilot, and the pilot must not imply that
quantity-level inventory, measured pricing or substitutions exist.

### C1. Catalog and bulk import

Keep the physical `menu_items` table through the fixed-pack and first
full-grocery implementation so current food clients remain compatible. Apps may
use a vertical-neutral `CatalogItem` domain alias. Introducing a separate
`catalog_items` table later requires its own measured RFC, compatibility
view/dual-write plan and old-binary proof; Claude must not make that migration
implicitly inside C1.

```text
menu_items additions/current fields
  restaurant_id
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
  unique where not null (restaurant_id, sku)
  unique where not null (restaurant_id, barcode)
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
  restaurant_id, menu_item_id
  on_hand
  reserved
  version

inventory_movements
  menu_item_id
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
→ out_for_delivery
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
  proposed_menu_item_id null
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

Push delivery is never workflow authority. The customer app queries/subscribes
to pending substitution actions on foreground/reconnect and shows them in the
active order even if notifications are disabled, delayed or missed. Each
proposal stores a server deadline and deterministic fallback; a server job
applies it idempotently at expiry. Any push route/event must use Package 03's
allow-listed transactional contract and its approved essential/quiet-hours
classification, but fulfillment cannot wait indefinitely for a receipt or an
inbox feature.

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

The owner reports that licences and legal papers are available. Claude must
inventory them in a restricted evidence register, then obtain an owner/legal
sign-off mapping their actual contents to the controls below. Do not copy
confidential document bodies into git, logs, test fixtures or analytics.

The register lives outside the exposed `public` Data API—prefer an encrypted
document vault plus a `private` Postgres schema for metadata:

```text
private.regulated_entities
  id
  legal_name
  country_code
  external_registry_reference
  registration_hash
  status pending|verified|suspended|expired
  verified_by
  verified_at

private.compliance_evidence
  id
  evidence_type
  subject_entity_id references private.regulated_entities
  covered_restaurant_id null references public.restaurants
  territory
  covered_product_classes
  issuer
  scope_summary
  document_sha256
  document_version
  restricted_storage_reference
  effective_at
  expires_at null
  status current|superseded|suspended|expired|rejected
  supersedes_id null
  verified_by
  verified_at
  approved_by
  approved_at

private.compliance_evidence_events
  evidence_id
  action created|read|verified|approved|superseded|suspended|expired
  actor_user_id
  reason
  occurred_at
```

`regulated_entities.id` is the stable internal legal-entity key. Confidential
registration/licence identifiers and documents remain encrypted in the vault;
the database stores only the bounded external reference/hash needed for audit.
Restaurant storefronts link to the verified entity through an audited mapping,
not a name comparison.

Only a server-owned `compliance_evidence_manager` capability and narrow service
functions can read/write metadata or issue document access. Ordinary
admin/support/merchant/pharmacist roles receive only the bounded
“requirement current/not current” result they need. Capability grants are
database-owned, audited and not user-editable JWT metadata.

Every product classification references the evidence ID/version that supports
it. A scheduled job alerts before expiry and marks expired evidence; authority
functions fail closed when a required seller, territory or product-class
record is no longer current. Document access is audited, versioned and
revocable.

No public pharmacy activation or merchant promise until that evidence covers:

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

### D0.5. Safest pre-pharmacy pilot

If the owner wants an earlier adjacent category, launch it as **Health &
Personal Care**, not “Pharmacy,” and only after the evidence register confirms
the seller and product scope.

The pilot is fixed-pack, COD and allow-listed. It excludes prescription
medicines, controlled/restricted medicines, products requiring pharmacist
review, cold chain, age/ID verification, diagnostic claims and medical
substitution. Server-owned classification—not merchant self-declaration—decides
what is allowed. Merchants cannot downgrade an item into the pilot.

This slice still depends on Program A, C0 catalog/search/import foundations,
privacy review, an explicit prohibited-products list and an eligible seller. If
the legal mapping says any selected OTC medicine requires pharmacy controls, it
moves to D1–D4. The UI must not use pharmacy/pharmacist/prescription claims for
a non-pharmacy assortment.

Acceptance:

- every sellable item has a reviewed classification/version/source;
- unknown, unreviewed, prescription, controlled, age-gated and cold-chain
  classes fail closed at publish, cart preparation and order placement;
- customer copy states the actual category and seller, not a medical promise;
- no personal-health or prescription evidence is collected.
- 20 controlled delivered orders, two cancel/return/refund rehearsals and at
  least five unknown/restricted/expired-evidence publish-or-order attempts
  complete with zero policy or money variance.

### D1. Product classification

Classification is immutable and versioned:

```text
product_classification_versions
  id
  menu_item_id
  class general_health|otc|prescription|controlled|prohibited
  is_orderable
  requires_pharmacist_review
  recipient_rule none|named|patient_only
  minimum_age null
  id_check_required
  substitution_rule none|pharmacist_only|equivalent_allowed
  temperature_band ambient|cool|cold|frozen|prohibited
  temperature_evidence_required
  sealing_required
  handoff_rule_version
  driver_disclosure minimal|product_name_required
  return_disposition quarantine|return_supplier|destroy|prohibited
  batch_traceability_required
  maximum_quantity
  active_ingredient null
  strength null
  dose_form null
  evidence_id
  evidence_version
  status draft|approved|superseded|withdrawn|recalled
  effective_at null
  ended_at null
  supersedes_id null
  classified_by
  approved_by null
  approved_at null
  reason
```

Only one approved/current version resolves for a product. Unknown, draft,
expired-evidence, withdrawn, recalled, controlled and prohibited states fail
closed unless an explicit later contract permits them. A server-owned
`product_compliance_reviewer` capability creates/reviews versions; for any
medicine, classifier and approver are distinct. Merchants and ordinary admins
cannot create, approve or downgrade classifications.

Publication, authoritative cart preparation and `place_order` re-read the
current classification/evidence. Approval after a cart was prepared does not
make that stale cart authoritative. A withdrawal/recall immediately hides the
item, emits an audit/ops event and finds in-flight orders: before pickup they
cancel/return under authority; after pickup they open a pharmacist/support
incident. No client cache can override the recall.

Where the mapped obligation requires lot-level traceability:

```text
private.pharmacy_inventory_lots
  id
  restaurant_id
  menu_item_id
  supplier_entity_id references private.regulated_entities
  batch_number
  expires_at
  quantity_received
  quantity_available
  status active|quarantined|recalled|expired|depleted
  evidence_id
  received_by
  received_at

private.pharmacy_dispense_items
  order_id
  order_item_id
  inventory_lot_id
  quantity
  pharmacist_credential_id
  seal_reference
  temperature_result null
  dispensed_at
  unique(order_item_id, inventory_lot_id)
```

Lot allocation/dispense is atomic, cannot use expired/quarantined/recalled
stock, and supports supplier/batch recall through active and completed orders.
If the evidence map requires batch traceability and these controls are absent,
full pharmacy activation remains disabled.

### D2. Prescription evidence

Use a private Storage bucket with:

- customer/document-owner upload;
- assigned authorized pharmacist read;
- service processing only;
- no public URL;
- encryption/retention/deletion policy;
- malware/file-type/size validation;
- access audit.

Do not rely on a direct signed URL as proof of who fetched a document. Serve
reads through an authenticated Edge Function/proxy that checks the current
assignment/credential, streams the object, and records successful access.
Short-lived signed URLs may be internal implementation details but are never
returned as reusable application URLs.

```text
private.prescriptions
  id
  customer_id
  storage_path
  object_version
  sha256
  consent_version
  consented_at
  scan_status pending|clean|rejected|quarantined|timeout
  status submitted|under_review|approved|rejected|expired|withdrawn|superseded
  supersedes_id null
  issued_at null
  expires_at null
  retention_until
  legal_hold
  withdrawn_at null
  deletion_status pending|deleted|anonymized|blocked_by_hold
  deleted_at null

private.pharmacy_review_requests
  id
  customer_id
  restaurant_id
  regulated_entity_id
  prescription_id
  cart_hash
  cart_hash_version
  status submitted|assigned|approved|rejected|expired|cancelled
  expires_at

private.pharmacy_review_recipients
  id
  review_request_id unique
  recipient_kind account_holder|named_patient|authorized_proxy
  subject_user_id null
  display_name_ciphertext
  identity_match_hmac null
  hmac_key_version null
  authority_basis account_holder|prescription_patient|mapped_proxy
  recipient_rule_version
  retention_until

private.pharmacy_review_request_items
  id
  review_request_id
  menu_item_id
  classification_version_id
  requested_quantity
  unique(review_request_id, menu_item_id)

private.prescription_authorizations
  id
  review_request_id
  customer_id
  menu_item_id
  classification_version_id
  approved_recipient_id
  recipient_rule_version
  authorized_quantity
  consumed_quantity
  valid_from
  expires_at
  status active|consumed|expired|revoked

private.prescription_authorization_consumptions
  id
  authorization_id
  order_id
  order_item_id
  quantity
  idempotency_key
  consumed_at
  unique(authorization_id, idempotency_key)
  unique(order_item_id)

private.pharmacy_order_handoff_requirements
  order_id unique
  approved_recipient_id
  recipient_rule_version
  recipient_kind
  minimum_age null
  id_check_required
  sealing_required
  temperature_evidence_required
  status pending|passed|failed|returned
  verified_by_driver_id null
  verified_at null
  reason_code null

private.prescription_access_events
  prescription_id
  actor_user_id
  access_kind upload|scan|review|proxy_read|decision|delete
  result
  occurred_at
```

Clients cannot write `cart_hash`, classification versions, review items or
approved-recipient authority. `prepare_pharmacy_review` resolves one
restaurant/entity, current menu prices/classifications, integer quantities and
a server-normalized proposed recipient, then hashes a versioned canonical
server serialization (sorted item IDs plus classification versions,
quantities, customer, restaurant, prescription and recipient facts/rule
version). Submitted requests/items/recipient are immutable; changing the cart
or recipient creates a new request. All private tables have no
anon/authenticated grants. Narrow definer RPCs and bounded status views
self-authorize customer/pharmacist/support access.

The evidence matrix defines which recipient kinds are valid for each
`recipient_rule`. `patient_only` requires the pharmacist to bind the named
prescription patient. `authorized_proxy` remains disabled unless the mapped
law/evidence defines the authority and handoff check. Store only encrypted
display data and, when required, a server-keyed identity HMAC—never a raw ID
number or ID image by default.

`place_order` locks every authorization row, verifies customer/cart hash,
classification version, approved recipient/rule version, validity and
remaining quantity, creates order/items, the immutable handoff requirements
and consumption rows atomically, then increments consumed quantity. Two
checkouts cannot spend the same authorization. The delivery recipient cannot
be changed after authorization; a change requires a new review.
Cancellation/refund does not automatically restore medical authorization; only
the signed pharmacist/legal rule can issue a new version.

Account deletion follows retention/legal-hold rules: identity is deleted or
anonymized where permitted, documents are purged when due, and held records
remain inaccessible to ordinary product/support flows.

Upload/scan contract:

- allow only JPEG, PNG and PDF by extension **and** magic bytes, maximum 10 MB;
- upload enters a quarantine prefix unreadable to customer/pharmacist;
- a private ClamAV-compatible scanner worker records engine/signature version,
  result and object checksum, with a 60-second attempt timeout and at most three
  retries after 1/5/15 minutes;
- only a clean result atomically promotes the exact object version to the
  reviewable prefix;
- timeout/error/malware stays quarantined, alerts ops and requires deletion or
  customer resubmission—no admin/support “mark clean” override;
- the scanner endpoint/secret and no-sample-retention agreement are owner
  infrastructure inputs; D2 activation stays disabled until a real clean,
  malware-test and timeout case pass.

### D3. Pharmacist queue and order enforcement

Pharmacist authority is a verified credential assignment, not a generic app
role:

```text
private.pharmacist_credentials
  id
  user_id
  restaurant_id references public.restaurants
  regulated_entity_id references private.regulated_entities
  territory
  scope
  evidence_id
  valid_from
  valid_until
  status pending|active|suspended|expired|revoked
  verified_by
  verified_at

private.pharmacist_review_assignments
  id
  review_request_id
  pharmacist_credential_id
  status offered|claimed|released|decided
  assigned_at
  claimed_at null
  released_at null
  decided_at null
  partial unique(review_request_id) where status in (offered,claimed)

private.pharmacist_reauth_assertions
  id
  pharmacist_credential_id
  user_id
  auth_session_id
  aal
  token_digest
  nonce unique
  issued_at
  expires_at
  consumed_at null

private.pharmacist_decisions
  id
  review_request_id unique
  assignment_id references private.pharmacist_review_assignments
  pharmacist_credential_id
  reauth_assertion_id unique
  decision approved|rejected
  approved_recipient_id null
  reason_code
  authorization_version null
  idempotency_key unique
  decided_at
```

The decision RPC locks the review/assignment, requires an active in-scope
credential at decision time and a recent one-use reauthentication assertion,
verifies the recipient against the current classification/evidence rule, and
writes the immutable decision, approved recipient and any authorizations
atomically.

The reauthentication Edge flow performs a fresh Supabase MFA challenge/verify,
requires `aal2`, binds the assertion to JWT user + auth session + credential,
stores only a random-token digest/nonce, expires it after 10 minutes and lets
the decision RPC consume it once. A normal refreshed access token is not a
reauth assertion. Replay, wrong session/user/credential and expired assertions
fail.

Credential suspension/expiry blocks new reads/decisions immediately and revokes
proxy access. Two pharmacists cannot decide one request. The approved decision
creates authorizations only for the immutable typed request items and its
classification versions.

Support gets a separate `pharmacy_support` capability with bounded status,
reason-code and logistics views. It cannot read prescription media, approve a
classification or make a clinical decision. Ordinary platform admins cannot
impersonate pharmacist/compliance capabilities.

Starting from the latest production `place_order`/checkout preparation:

- block prohibited items;
- require valid approved evidence for prescription items;
- prevent reuse beyond authorized quantity/expiry;
- require pharmacist approval before payment/fulfillment as legal advice
  dictates;
- prevent ordinary staff/admin impersonating a pharmacist;
- fail closed when classification/evidence is missing.

### D4. Delivery verification

Classification/evidence maps every product to explicit recipient, age/ID,
temperature, sealing, privacy and return flags. A missing/unknown flag makes the
item unorderable. The handoff RPC reads the recipient/rule snapshotted by
`place_order`; neither customer nor driver can substitute a different
recipient after pharmacist approval.

- customer names the eligible recipient;
- driver receives only the minimum instruction (for example, “ID + age 18+
  required”), not medication names/diagnosis unless the mapped rule requires it;
- ID/age check uses an explicit pass/fail flow;
- failed check returns the sealed order under a defined chain of custody;
- no ID image is retained unless legal advice requires it;
- controlled/temperature-sensitive items have handoff evidence.

Private-pilot money/return default:

- cancel before pickup releases the order and produces no customer charge;
- failed recipient/ID/age/refusal after pickup returns the sealed parcel to the
  pharmacy, fully refunds any card payment, collects no COD, pays the driver,
  and the platform absorbs outbound/return cost during the pilot;
- merchant/platform error also produces a full refund and platform-funded
  driver earning;
- returned medication is quarantined and never automatically restocked;
- opened, damaged, temperature-excursion or tampered goods stay quarantined for
  pharmacist disposition/destruction;
- a later customer/merchant fault-fee matrix requires an owner decision,
  versioned terms/pricing and private proof before use.

### Pharmacy acceptance

- legal requirements are mapped to testable product controls.
- Prescription media is private and every access is auditable.
- Cross-customer/pharmacy/pharmacist RLS tests fail closed.
- `place_order` cannot bypass prescription/classification/quantity rules.
- Reject/expiry/reuse/return and refund paths are proven.
- Customer, pharmacist, picker, driver and support roles see only required data.
- Before public activation, complete at least 30 controlled pharmacy scenarios:
  20 approved/delivered plus at least two each of rejection, expiry, concurrent
  reuse blocked, failed ID/age sealed return and refund/settlement. Counts and
  overlapping cases are recorded, not inferred.

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

Every slice produces a dated verification report containing the commit SHA,
migration versions, deployed Edge Function versions, commands/results, test
users/merchants, device/build IDs, production queries, rollback result and
remaining exceptions. Typecheck alone is never completion.

### Schema, migration and release verification

- run from a fresh local database and upgrade from the current production-shaped
  schema;
- check deterministic backfills, row counts, constraints, indexes and
  idempotency;
- transaction-dry-run replacement RPCs from their current production
  `pg_get_functiondef`, with functional assertions before rollback;
- apply through the database release runbook, reconcile local/remote migration
  ledgers and regenerate DB types;
- verify explicit grants, RLS enabled/forced where required, definer
  `search_path`, revoked PUBLIC execute and narrow role grants;
- run Supabase database/security advisors and compare to the pre-change
  baseline;
- prove the kill switch/feature stage can close the slice without a code
  rollback or destructive data change;
- restore a post-migration backup into an isolated database and verify tables,
  functions, roles, RLS, Storage metadata and row-count invariants.

### RLS and authority matrix

Automate positive and negative cases for anonymous, ordinary customer,
private-pilot customer, merchant owner, manager, staff, picker, pharmacist,
driver, dispatcher, support/admin and service role:

- disabled/private/public vertical visibility via list, direct ID, nested
  relation, search RPC and Realtime;
- expired/revoked private access;
- cross-customer, cross-merchant, cross-city and cross-pharmacy reads/writes;
- stale price, unavailable item, invalid category/unit/sale mode, basket limit
  and vertical mismatch at authoritative cart preparation and `place_order`;
- merchant attempts to change server-owned classification, vertical launch
  state, price outside its role or another merchant's SKU;
- old JWT claims, guessed UUIDs and direct PostgREST calls;
- notification, promotion, reorder and saved-cart jobs cannot re-expose a
  disabled vertical.

### Catalog and grocery verification

- CSV template, malformed headers, encoding, duplicate SKU/barcode, row-level
  errors, dry-run/no-write, repeat import and concurrent import;
- merchant-scoped uniqueness and no cross-merchant upsert;
- server search relevance, filter correctness, stable pagination, deleted rows
  and no data leakage;
- C0 fixed-pack orders prove current price, integer quantity, availability,
  basket limits, immutable vertical/item snapshots, cancellation and settlement;
- full-grocery tests later cover concurrent last-unit reservations, expiry
  release, movement idempotency, weighted tolerances, rounding, substitutions,
  partial refunds and picker privilege boundaries;
- property/concurrency tests assert every reservation becomes sale or release
  and every final total reconciles to the payment/refund/settlement facts.

### Pharmacy and privacy verification

- map each licence/legal-paper requirement to an evidence reference, product
  control, owner, automated test and manual sign-off; store no confidential
  document body in the repository;
- classification defaults fail closed; unknown/unreviewed/restricted items
  cannot publish or order, and merchant downgrade attempts fail;
- legal-entity/restaurant/evidence-scope mismatch and typed review-request/
  cart-hash/recipient tampering fail; no cross-pharmacy request or
  authorization is possible;
- prescription upload validates owner/path/type/size, uses private Storage and
  cannot be enumerated or accessed by another customer/pharmacy;
- authenticated proxy access expires/revokes correctly; every successful
  pharmacist/service fetch is recorded; retention and deletion jobs are tested
  against legal holds;
- pharmacist identity, scope, decision immutability, quantity/expiry/reuse and
  ordinary-admin impersonation negative tests;
- race two pharmacists deciding one request and two checkouts consuming one
  authorization; exactly one authority action succeeds;
- account-holder/named-patient rules, recipient change after approval,
  patient-only mismatch and unmapped proxy attempts fail closed; handoff uses
  exactly the approved recipient/rule snapshot without retaining a raw ID;
- expire/suspend a pharmacist mid-review and revoke its document access;
- replay/wrong-user/wrong-session/expired MFA reauthentication assertions fail;
- change/revoke/recall a classification while it is in a cart and while the
  order is in fulfillment; the correct cancel/return/incident path wins;
- malware scan timeout/failure keeps an object quarantined and unreadable;
- magic-byte/MIME/size mismatch, scanner retry, clean promotion, checksum/
  object-version swap and no-admin-bypass tests pass against the configured
  private scanner;
- expired/quarantined/recalled lot allocation fails and a batch recall finds
  every active/completed dispense record;
- race retention deletion against a legal hold and prove the hold wins;
- device E2E covers approve, reject, expired evidence, failed ID/age handoff,
  sealed return, refund/credit and minimum driver-visible data;
- a privacy review checks logs, analytics, push copy, crash reporting and
  support/driver exports for medication or prescription leakage.

### City and geospatial verification

- fee quote selects the correct active city, zone and vertical rule;
- both in/out/on-boundary points, malformed coordinates and missing coordinates
  fail according to the explicit contract;
- no customer query, cache, Realtime channel, driver assignment, promotion or
  report crosses city;
- timezone/DST, locale, operating hours and city-specific feature flags are
  tested;
- old Sharm rows and binaries retain their behavior throughout dual
  read/write, backfill and rollback.

### App, E2E and device matrix

- affected package unit/integration tests, typecheck, lint and production build
  for customer, restaurant, merchant, driver and admin apps;
- browser behavioral E2E covers admin launch/vertical/classification controls,
  merchant onboarding/catalog edit, CSV preview/apply/error/retry, availability
  audit, picker actions and permission denials—not just rendered pages;
- five locales have key parity; Arabic is manually tested RTL and long-copy
  layouts are checked;
- food, fixed-pack grocery, health/personal-care and pharmacy terminology never
  leaks across verticals;
- physical Android and iOS devices cover fresh install, upgrade from the last
  supported build, foreground/background/terminated push, allowed deep links,
  offline queueing, reconnect, duplicate tap, poor network and app restart;
- end-to-end fixtures prove browse/search → cart → quote → order → merchant
  handling → dispatch → delivery → cash/settlement, plus every cancel/reject/
  return/refund exception enabled by the slice;
- Realtime disconnect/reconnect never duplicates an order action or displays a
  cross-scope row.

### Performance, observability and production proof

- C0 default budgets: 10,000 catalog rows, 25 concurrent API users, search p95
  ≤ 750 ms, cart preparation/order p95 ≤ 2 s, non-validation error rate < 1%,
  zero duplicate orders, and 1,000-row CSV dry-run/apply each ≤ 30 s;
- full-grocery budgets: 100 concurrent baskets contending across 100 stocked
  items, reservation/release p95 ≤ 1 s, measured reprice p95 ≤ 1 s,
  substitution decision p95 ≤ 1 s, scheduled fallback applied within 60 s of
  its deadline, non-validation error rate < 1%, zero oversell/double
  reservation and zero unexplained payment/refund/settlement mismatch;
- pharmacy default budgets: 10,000 classified products, 1,000 pending review
  rows and 10 concurrent operators; catalog/classification/queue reads p95
  ≤ 750 ms and authorized order placement p95 ≤ 2 s with zero double
  consumption;
- record p50/p95/p99, error rate, dataset/concurrency, environment and query
  plans. A changed budget requires owner/engineering approval before testing,
  not after a failure;
- verify indexes with representative production-shaped rows and no unbounded
  customer-side catalog download;
- emit launch-stage, search, import, cart rejection, order funnel, fulfillment,
  settlement and exception events without sensitive product/patient data;
- dashboards and alerts distinguish validation, RLS, import, order, payment,
  inventory, prescription, dispatch and notification failures;
- deploy dark/private first, run synthetic and named-pilot smoke tests, compare
  food control metrics, and have ops execute the close/rollback runbook;
- public activation requires the slice-specific controlled-order count,
  zero unexplained money variance, no open P0/P1 issue and written product,
  operations, security/privacy and owner sign-off.

## Rollout and rollback

Order:

1. fail-closed vertical authority and private test merchants;
2. fixed-pack grocery private pilot;
3. pharmacy evidence register plus server classification;
4. health/personal-care pilot after its evidence/classification gate;
5. money precision shadow migration only when measured pricing is approved;
6. full grocery catalog/inventory/substitution/picker program;
7. pharmacy only after the documented legal mapping and D2–D4;
8. city dimension shadow migration;
9. private city-two pilot and controlled launch.

Vertical/city activation is server-authoritative. Production rollback means
closing the affected feature stage, draining/returning active work, preserving
old-client compatibility and shipping a forward corrective migration when
needed. It is not a destructive production down migration. It preserves
orders, catalog, prescription and financial records and must not require
reverting shared Sharm food code or dropping migrated data.

## Acceptance

- Vertical and city are explicit authority/query/report dimensions.
- Inactive/private verticals fail closed across reads, quotes, checkout,
  notifications, Realtime and old-binary/direct-ID paths.
- Food behavior remains unchanged through the compatibility window.
- The fixed-pack grocery pilot makes no inventory, measured-price or
  substitution claim it cannot enforce.
- Grocery pricing, inventory, substitutions, picker and settlement are
  production-shaped and auditable.
- Pharmacy is impossible to activate without the legal and product controls.
- City two does not share a global bbox or Sharm-only zone enum as authority.
- Each launch has a private pilot, measurable supply/economics gate and reversible
  activation.
