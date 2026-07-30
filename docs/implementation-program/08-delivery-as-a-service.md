# Package 08 — delivery as a service (“Send”)

## Outcome

Add point-to-point courier delivery inside the Sharm Eats platform without
pretending that a parcel is a restaurant order. Reuse the verified fleet,
location, dispatch, notification and support patterns while giving delivery
jobs their own lifecycle, custody evidence, pricing, finance and incident
records.

Launch in this order:

1. admin-created internal deliveries;
2. verified-merchant delivery requests;
3. customer “Send a package” private pilot;
4. controlled public launch only after licensing/insurance, payment, device and
   operating gates pass.

This package is independent from the grocery/pharmacy vertical selector. The
customer may eventually see top-level choices such as **Food**, **Groceries**,
**Health/Pharmacy** and **Send**, but only the first three are catalog commerce
verticals.

> **Status 2026-07-30 — E2 foundations session (owner-approved scope).** All
> four "existing risk" claims below were verified TRUE; the dispatch one is
> FIXED (mig 189: auto-assign now searches around the PICKUP). Built dark:
> mig 190 Slice 0 (cities/service_areas, Sharm seeded from the real bbox
> authority, fail-closed resolver, boundary-fixture equivalence proven);
> mig 191 Slice A (delivery_service_configs disabled+closed, three pilot
> cohorts, append-only access events, capability-gated config/cohort RPCs
> reusing E0 — the platform owner from mig 187 is the grant root); mig 192
> Slice B (pricing/parcel-policy versions with the owner's provisional
> numbers flagged replace-before-trading, private quotes, quote_delivery_job —
> delivery_dispatch-only, refusing on 8 fail-closed classes, idempotent).
> Sharm is live-verified disabled/closed: NOTHING is visible or orderable.
> Next per the spec's rollout: Slice C job model + custody state machine,
> Slice D shared driver work claims, then internal manual-dispatch proof.
> Gate 0 evidence register remains owner/compliance-gated.

## Current evidence

Reusable primitives already exist:

- verified drivers, locations, order assignments, offers and expiry;
- manual and automatic dispatch patterns;
- customer/driver tracking, Realtime, push tokens and allow-listed push routes;
- customer addresses and PostGIS;
- order chat, driver cash, settlement, Paymob and refund implementations that
  can serve as design patterns.

Delivery as a service does **not** exist:

- `orders` requires a restaurant, restaurant name, customer delivery address
  and a non-empty merchant catalog basket;
- order placement requires an active/open merchant and current menu prices;
- the lifecycle is food-specific;
- order financials assume food subtotal, merchant commission and settlement;
- there is no independent pickup contact/location, parcel declaration,
  sender/recipient proof, chain of custody, return-to-sender or parcel incident
  workflow.

Existing code also exposes risks that must not be copied:

- delivery-fee quoting currently uses a flat base and does not consume the
  configured per-kilometre amount;
- current order feasibility can fail open when coordinates are missing;
- automatic order dispatch searches around the drop-off rather than the pickup;
- assignment uniqueness prevents two active drivers per order but does not
  globally prevent one driver accepting overlapping food and parcel jobs;
- Paymob attempts/refunds are hard-bound to food `orders`;
- the existing public GPS broadcast pattern is not an acceptable authority or
  privacy boundary for a new public courier product.

## Non-negotiable product boundary

Do not:

- add “delivery” as a `verticals` row;
- create a fake courier restaurant or fake menu item;
- mix parcel fees into restaurant GMV/commission/settlement;
- ask the driver to buy items;
- carry or remit cash for parcel contents;
- accept recipient payment for parcel contents;
- allow multi-stop, pooled or cross-city jobs in v1;
- accept a job without valid pickup and drop-off coordinates;
- market public delivery before the licence, liability, insurance and incident
  evidence is mapped to product controls.

Those shortcuts create misleading books, broken lifecycle metrics and an
uncontrolled cash/custody business.

## Owner-selected v1 contract

The default implementation contract is:

| Decision | v1 selection |
|---|---|
| First external requester | Verified merchant; customer follows after internal proof |
| Scope | One pickup, one drop-off, one sealed parcel |
| Fulfillment | Immediate/manual dispatch; scheduling later |
| Goods | Transport only; declared allowed category |
| Contents cash | Prohibited |
| Fee payer | Requesting merchant in pilot; sender for customer flow |
| Merchant payment | Weekly invoiced/prepaid ledger with a hard exposure cap |
| Customer payment | Card only after Package 04 gate; no public flow before it |
| Driver capacity | One active food-or-parcel job in v1 |
| Proof | Pickup verification plus recipient OTP |
| Photos/signature | Incident-only/private in v1; not routine public media |
| Returns | Mandatory return-to-sender state and fee contract |
| Private-pilot waiting/cancel/return charge | EGP 0 to requester; valid driver earning is platform pilot expense |
| Dispatch | Manual first, nearest-to-pickup automation later |
| Public geography | Both endpoints inside one active service area |

The owner reports that licences/legal papers exist. Before activation Claude
must build a restricted evidence register and map the actual document scope,
licensee, issue/expiry dates and coverage to this contract. Do not commit
confidential documents or their contents.

Exact parcel dimensions, weight, declared-value, prohibited-goods, liability,
insurance, waiting, cancellation and return amounts remain configuration/owner
inputs. Until entered and signed, the service stays `disabled` or `private`.
See [`EXPANSION-OWNER-DECISIONS.md`](EXPANSION-OWNER-DECISIONS.md).

## Expected repository surfaces

- new staged migrations, generated database types and security assertions;
- latest production driver assignment/location/admin function bodies when
  shared capacity or dispatch contracts change;
- new quote, lifecycle, proof, notification and finance authority RPCs;
- server-side recipient OTP SMS provider integration, delivery log and secret
  handling;
- private Storage bucket/policies for incident proof;
- customer “Send” wizard, quote, tracking, history, chat and exception flows;
- merchant web/restaurant request, history and invoice views;
- driver unified offer/job, pickup proof, recipient proof and return flow;
- admin dispatch, pricing, proof, incident, finance and feature-stage controls;
- five customer-facing locale files and RTL;
- Terms, Privacy/Data Safety, prohibited-goods, incident and operating runbooks;
- analytics dictionary, dashboards, alerts and release/rollback evidence.

## Gate 0 — evidence and operating contract

Inventory the available papers in an encrypted document vault plus metadata in
a non-exposed `private` schema:

```text
private.delivery_compliance_evidence
  id
  evidence_type
  issuer
  licensee_or_insured_party
  scope_summary
  covered_service_area_id
  covered_driver_or_vehicle_classes
  covered_parcel_categories
  jurisdiction
  document_sha256
  document_version
  effective_at
  expires_at
  supersedes_id null
  verified_by
  verified_at
  approved_by
  approved_at
  restricted_storage_reference
  status current|superseded|suspended|expired|rejected

private.delivery_compliance_evidence_events
  evidence_id
  action created|read|verified|approved|superseded|suspended|expired
  actor_user_id
  reason
  occurred_at

private.delivery_compliance_requirement_sets
  id
  version
  status draft|approved|retired
  approved_by
  approved_at

private.delivery_compliance_requirements
  requirement_set_id
  evidence_type
  service_area_id
  driver_or_vehicle_class null
  parcel_category null
  minimum_coverage_egp null
  required
```

The repository stores only a template/control mapping, never scans, identity
numbers, policy numbers, signatures or full policy text. Only a database-owned
`delivery_compliance` capability and narrow service functions can read
metadata or issue document access. Ordinary admin, dispatcher, support,
merchant and driver roles receive only bounded “requirement current/not
current” results. Every metadata/document read is audited.

Before public activation, the mapping must cover:

- the entity permitted to contract for courier services;
- driver/courier licensing and employment/contractor requirements;
- motor/courier/third-party liability coverage and exclusions;
- declared-value and loss/damage liability;
- prohibited/restricted goods;
- sender/recipient data processing and retention;
- proof/photograph/OTP handling;
- accident, loss, damage, theft, prohibited-item and failed-delivery response;
- invoicing, tax/VAT and driver-earning treatment;
- customer terms, merchant agreement and privacy/data-safety disclosures.

Bind every active delivery config to explicit evidence requirements. A
scheduled job alerts before expiry and marks expired/suspended records. The
effective intake check fails closed immediately when any required
entity/territory/driver/vehicle/parcel/insurance record is not current; an
operator cannot override it with a UI toggle. Code does not interpret legal
text—it enforces the signed versioned control matrix.

## Slice 0 — Sharm geography bridge

Package 08 cannot reference the future `cities`/`service_areas` model as if it
already existed. Before Slice A, implement the Sharm-only foundation from
Package 07 Program E:

```text
cities
  id
  slug unique
  timezone
  currency
  is_active

service_areas
  id
  city_id
  slug
  boundary geography(multipolygon)
  is_active
  unique(city_id, slug)
```

Seed Sharm from the current production `service_area_bbox`/serviceability
source, compare boundary behavior on inside/outside/edge fixtures, and keep the
old helper as a compatibility wrapper during the supported-binary window.
Package 08 uses the new Sharm `service_area_id`; it does not add city two or
change food dispatch/fees. Missing/unmapped coordinates fail closed.

## Slice A — dark product configuration

Use one server-authoritative feature stage:

```text
delivery_service_configs
  service_area_id primary key
  launch_stage disabled|internal|merchant_private|customer_private|public
  intake_state closed|open|draining
  pricing_version_id
  parcel_policy_version_id
  scheduling_enabled
  max_active_jobs_per_driver
  quote_ttl_seconds
  offer_ttl_seconds
  otp_ttl_seconds
  otp_max_attempts
  payment_recovery_window_seconds
  driver_location_max_age_seconds
  default_merchant_exposure_limit_egp
  default_merchant_unsettled_job_limit
  minimum_customer_build null
  minimum_driver_build
  minimum_merchant_build
  updated_by
  updated_at

delivery_customer_pilot_access
  id primary key
  user_id
  service_area_id
  status active|expired|revoked
  granted_by, granted_at, expires_at, revoked_at, reason
  partial unique(user_id, service_area_id) where status = active

delivery_merchant_pilot_access
  id primary key
  restaurant_id
  service_area_id
  status active|expired|revoked
  granted_by, granted_at, expires_at, revoked_at, reason
  partial unique(restaurant_id, service_area_id) where status = active

delivery_driver_pilot_access
  id primary key
  driver_id
  service_area_id
  status active|expired|revoked
  granted_by, granted_at, expires_at, revoked_at, reason
  partial unique(driver_id, service_area_id) where status = active

private.delivery_access_events
  subject_kind customer|restaurant|driver|operator
  subject_id
  capability_or_stage
  action granted|expired|revoked
  actor_user_id
  reason
  occurred_at
```

There is exactly one config row per service area. No nullable/global config
exists in v1, so precedence cannot conflict. Parcel bands/categories/limits and
prohibited goods live in immutable normalized policy-version rows, not
unvalidated JSON. The referenced parcel policy is the sole source of
`terms_version` and `required_evidence_set_id`; config does not override either.

Launch-stage eligibility:

- `disabled`: no new job for any requester;
- `internal`: approved operators create internal jobs for allow-listed drivers;
- `merchant_private`: internal plus allow-listed `restaurants.id`;
- `customer_private`: internal/allow-listed merchants plus allow-listed users;
- `public`: verified merchants/customers subject to ordinary rules.

The current merchant authority is explicitly `restaurants.id`, with membership
from `merchant_staff.restaurant_id`. A future legal-merchant entity migration
is separate; do not invent a new merchant FK inside this package.

`is_delivery_verified_restaurant` is a server predicate, not a UI badge. It
requires:

- `restaurants.is_active=true` and `onboarding_status in ('approved','live')`;
- every KYC document required by the current restaurant approval contract is
  still approved/current;
- an active delivery billing account inside both exposure limits;
- current merchant-pilot access unless stage is `public`;
- no delivery/compliance suspension;
- requester is current owner/manager staff;
- current service-area policy/evidence/minimum-build checks.

Restaurant `is_open` is not required for an off-platform pickup, but inactive,
rejected/draft or KYC/billing-ineligible merchants fail closed. The quote and
create-job RPCs both re-evaluate the predicate.

`intake_state=open` accepts eligible new quotes/jobs. `draining` rejects new
quotes/jobs/offers while active participants and operators can finish or return
existing custody. `closed` rejects new work and requester mutations but keeps
active-participant read/tracking plus assigned-driver/ops delivery, return and
incident resolution. Disabling never hides an in-custody parcel.

The current `app_role` has no support role. Reuse the shared
`private.platform_owners`, `private.platform_operator_capabilities` and
capability-event tables established by Package 07 Program A; do not create
delivery-specific duplicates. V1 grants narrow database-owned delivery
capabilities only to verified admin users. Ordinary admin does not
automatically receive delivery support, finance or config authority.

The initial `platform_owners` row is an explicit owner UUID supplied to and
recorded by the migration/release operator; never guess it from the first admin.
Only an active platform owner can grant/revoke `delivery_access` or
`delivery_compliance`. An active `delivery_access` operator can grant/revoke
the other delivery capabilities and pilot cohorts but cannot grant itself
owner/compliance authority. All operations use definer RPCs and append access
events; no role directly updates grant rows.

Stage/intake/build/cohort/evidence checks apply inside quote/create/dispatch/
payment authority. List/direct-ID/Realtime policies always preserve access to
the requester and assigned driver for their existing job. Default every new
environment to `disabled + closed`.

## Slice B — pricing and quote

### Pricing versions

```text
delivery_pricing_versions
  id
  service_area_id
  currency
  base_fee_egp
  included_distance_m
  per_started_km_egp
  distance_multiplier
  parcel_band_adjustments
  driver_base_earning_egp
  driver_per_started_km_egp
  driver_waiting_earning_egp
  driver_return_earning_egp
  waiting_free_minutes
  waiting_fee_egp
  cancellation_rules
  return_fee_rule
  min_fee_egp
  max_fee_egp
  active_from
  retired_at null
  approved_by
```

Only one approved, non-retired pricing version can be active per service area;
activation is an audited RPC, not a direct update.

```text
delivery_parcel_policy_versions
  id
  prohibited_goods_version
  terms_version
  required_evidence_set_id
  status draft|approved|retired
  approved_by
  approved_at

delivery_parcel_categories
  policy_version_id
  category
  is_allowed
  required_vehicle_class null

delivery_parcel_bands
  policy_version_id
  parcel_band_code
  max_length_cm
  max_width_cm
  max_height_cm
  max_weight_kg
  max_declared_value_egp
  primary key(policy_version_id, parcel_band_code)
```

Use integer EGP for the initial fixed-price pilot. If Package 07’s minor-unit
money migration lands first, use minor units consistently; never mix units or
use client floating-point authority.

### Quote facts

```text
private.delivery_quotes
  id
  requester_kind internal|customer|merchant
  requester_user_id null
  requester_restaurant_id null
  created_by_user_id
  requester_subject_hash null
  requester_scope_key
  idempotency_key
  pickup_point geography(point) null after retention
  dropoff_point geography(point) null after retention
  pickup_service_area_id
  dropoff_service_area_id
  straight_line_distance_m
  billable_distance_m
  duration_estimate_s null
  parcel_category
  parcel_band_code
  package_count
  declared_value_egp
  fragile
  prohibited_goods_version
  terms_version
  price_egp
  maximum_charge_egp
  driver_earning_egp
  pricing_version_id
  parcel_policy_version_id
  service_config_updated_at
  retention_until
  redacted_at null
  expires_at
  consumed_at null
  created_at
  unique(requester_scope_key, idempotency_key)
```

Private quotes have no anon/authenticated table grants; requester/operator
access is through scoped RPCs. Unconsumed expired quotes are deleted. A
consumed quote keeps non-PII price/policy audit facts but redacts requester and
exact points within 24 hours after consumption because the job owns its own
encrypted endpoint snapshot.

`quote_delivery_job`:

- authenticates the requester, operator capability or
  `merchant_staff.restaurant_id` membership;
- requires finite in-range coordinates;
- resolves both endpoints against the same active service area;
- fails closed on missing/unmapped points;
- validates requester stage/cohort, parcel category/band/count/value/fragility,
  current policy/terms/evidence and minimum build;
- calculates distance/price from server configuration;
- returns a short-lived quote with every pricing and eligibility input
  snapshotted;
- rate-limits abusive callers and never trusts a client fee/distance;
- does not create a job or driver obligation.

If road-routing is unavailable in v1, use a documented conservative server
formula from PostGIS distance and a configured multiplier. Show “estimated
route” honestly. The accepted quote price remains fixed unless any endpoint,
category, band, package count, declared value, fragile state,
prohibited-goods version or terms version changes. `create_delivery_job`
compares all inputs and consumes the quote atomically; a caller cannot reuse a
valid quote with different parcel facts.

## Slice C — delivery-job model

### Job

```text
delivery_jobs
  id
  public_reference unique
  requester_kind internal|customer|merchant
  requester_user_id null
  requester_restaurant_id null
  created_by_user_id
  requester_subject_hash null
  internal_reason null
  merchant_reference null
  requester_scope_key
  quote_id unique
  idempotency_key

  parcel_category
  parcel_band_code
  package_count
  declared_value_egp
  fragile
  prohibited_goods_attested_at
  prohibited_goods_version
  terms_accepted_at
  terms_version

  service_area_id
  city_id null
  status
  version
  assigned_driver_id null

  quoted_fee_egp
  quoted_driver_earning_egp
  pricing_version_id
  payment_method internal|merchant_invoice|merchant_prepaid|card
  merchant_billing_account_version null
  zero_fee_reason null

  payment_pending_at null
  requested_at null
  accepted_at null
  arrived_pickup_at null
  picked_up_at null
  delivered_at null
  return_started_at null
  returned_at null
  cancelled_at null
  completed_at null
  created_at
  updated_at

  unique(requester_scope_key, idempotency_key)
  unique(requester_restaurant_id, lower(merchant_reference))
    where requester_kind = merchant and merchant_reference is not null
```

Identity checks:

- `internal`: no requester user/restaurant; creator has `delivery_dispatch`,
  `internal_reason` and an internal pilot quote;
- `merchant`: requester user and `requester_restaurant_id` are present and the
  user is owner/manager staff of that `restaurants.id`;
- `customer`: requester user is present and restaurant is null.

For a merchant job, `create_delivery_job` locks the billing account and
snapshots its immutable version plus `merchant_invoice` or `merchant_prepaid`
method on the job. A later account-mode/version change affects only new jobs;
finalization uses the accepted snapshot and its already-posted exposure/prepaid
reserve.

`requester_restaurant_id` is an FK to `public.restaurants(id)`;
`requester_user_id`/`created_by_user_id` use the repository's existing profile/
auth reference convention. Use CHECK constraints for the three identity shapes
and reject deletes that would erase an active custody/finance subject. After
terminal retention, a controlled pseudonymization RPC may null the user
reference only when `requester_subject_hash` is present; the immutable
restaurant/finance subject remains for a merchant job.

Merchant reference is trimmed, maximum 64 characters and case-insensitively
unique per restaurant so a retried off-platform order cannot create a second
job under a new idempotency key.

Endpoint/contact snapshots live outside the exposed Data API:

```text
private.delivery_job_endpoints
  id
  delivery_job_id
  contact_kind pickup|dropoff
  point geography(point)
  address_ciphertext
  contact_name_ciphertext
  phone_e164_ciphertext
  phone_hash
  phone_last4
  notes_ciphertext
  encryption_key_version
  retention_until
  redacted_at null
  unique(delivery_job_id, contact_kind)

private.delivery_job_parcel_details
  delivery_job_id unique
  description_ciphertext null
  encryption_key_version
  retention_until
  redacted_at null
```

An authenticated Edge/RPC boundary returns only the minimum fields to the
requester, assigned driver or granted `delivery_support` operator at the
current state. Exact PostGIS points are intentionally plaintext inside the
unexposed `private` schema so serviceability/dispatch can use spatial indexes;
address, contact, phone and notes remain ciphertext. Raw endpoint rows have no
anon/authenticated grants. The scoped `private.delivery_job_legal_holds` table
is the only legal-hold authority—do not add a competing row boolean. Store
endpoint/price/terms snapshots so later profile/config changes do not rewrite
history.

Encryption/decryption happens server-side with a versioned key kept in the
platform secret manager; clients/database rows never contain the key. Rotation
can re-encrypt active rows and retains an audited key-version reference.

The encrypted parcel description is bounded optional free text, not a legal
classification. The server-owned parcel category/prohibited matrix decides
eligibility.

### Custody event log

```text
delivery_job_events
  id
  delivery_job_id
  event_type
  from_status null
  to_status null
  actor_kind
  actor_user_id null
  reason_code null
  metadata jsonb
  idempotency_key
  occurred_at
  unique(delivery_job_id, idempotency_key)
```

Events are append-only for ordinary roles. Metadata has an allow-listed schema
and excludes raw phone, address, OTP and proof URLs.

### State machine

```text
payment_pending                         -- customer card only
  → requested

requested
  → offered
  → accepted
  → arrived_pickup
  → pickup_verified
  → picked_up
  → out_for_delivery
  → delivered
  → completed
```

Exception branches:

```text
payment_pending                         → cancelled → completed
offered -- reject/expire/revoke ------> requested
requested|offered|accepted              → cancelled → completed
accepted|arrived_pickup|pickup_verified → pickup_failed
pickup_failed                           → requested | cancelled → completed
picked_up|out_for_delivery              → delivery_failed
delivery_failed                         → returning → returned → completed
picked_up|out_for_delivery              → delivery_recovery_required
delivery_recovery_required              → out_for_delivery | custody_exception
returning                               → return_recovery_required
return_recovery_required                → returning | custody_exception
returning                               → custody_exception
custody_exception                       → handed_to_ops|lost|damaged|disposed
handed_to_ops|lost|damaged|disposed     → completed
```

Rules:

- only authority RPCs change status;
- transitions lock the row and compare the expected version/status;
- duplicate requests return the prior result;
- the server records timestamps and actor;
- v1 permits only one active assignment/offer per job; rejection/expiry returns
  the job to `requested` before another offer;
- `pickup_verified` is not custody; it may still enter `pickup_failed`;
- a parcel in custody cannot become simply `cancelled`;
- a failed delivery after pickup must enter the return path;
- a driver breakdown after custody enters `delivery_recovery_required` or
  `return_recovery_required`; it never resets the parcel to `requested`;
- `completed` means custody has a terminal resolution and financial
  finalization succeeded; delivered/returned/incident-resolution remains
  visible as the outcome;
- a failed return cannot disappear into a generic incident—it resolves to
  handed-to-ops, lost, damaged or legally approved disposal with evidence;
- `pickup_failed → requested|cancelled` atomically cancels/releases the accepted
  assignment and shared driver claim, clears `assigned_driver_id`, records the
  failure event and makes any retry require a new offer;
- terminal records remain readable/auditable and are never reused;
- any operator-capability override requires a reason and emits a distinct
  event; ordinary admin has no implicit override.

Assignment state follows the job: an accepted assignment stays active through
custody, then completes/releases driver capacity at delivered, returned or a
recorded custody-exception outcome; finance may finalize the job afterward.
The only earlier release after pickup is the atomic recovery handoff defined in
Slice D, which marks the prior assignment `handed_off` while transferring
custody and capacity to the accepted recovery assignment. Pre-custody
cancellation/reassignment cancels/releases the assignment. Offers are
sequential in v1 except for the one recovery offer alongside the current
custodian; concurrent broadcast offers are deferred.

### Server-authoritative API

Exact argument types follow generated schema types, but these semantics and
guards are fixed:

- `quote_delivery_job(p_requester_kind, p_restaurant_id, p_pickup,
  p_dropoff, p_parcel_facts, p_terms_version, p_idempotency_key)` — requester/
  stage/evidence/geo/policy authority; returns immutable quote.
- `create_delivery_job(p_quote_id, p_contact_payload, p_parcel_facts,
  p_idempotency_key)` — requester authority; rechecks/consumes quote and writes
  encrypted contacts. Merchant/internal becomes `requested`; customer card
  becomes `payment_pending`.
- `admin_create_internal_delivery_job(...)` — `delivery_dispatch` only, with
  zero-fee reason and allow-listed driver cohort.
- `offer_delivery_job(p_job_id, p_driver_id, p_expected_version,
  p_idempotency_key)` — dispatcher/auto service only; one live offer.
- `reassign_delivery_job(...)` — dispatch capability, reason required,
  pre-custody only.
- `offer_delivery_recovery(...)` — `delivery_dispatch` only while the job is in
  a recovery-required state; keeps the current custody assignment/claim active
  and creates one recovery offer.
- `respond_to_delivery_recovery_offer(...)` — the offered recovery driver only;
  rejection leaves the job/current custodian unchanged, while acceptance moves
  only that assignment to `handoff_pending` and creates a scoped custody
  handoff. It does not acquire a claim.
- `confirm_delivery_recovery_handoff(...)` — authenticates the exact
  current-custodian or receiving-driver side against that handoff. The second
  valid confirmation, or one valid side plus a reasoned `delivery_support`
  incident override, atomically consumes both confirmations, marks the old
  assignment `handed_off`, releases its claim, accepts the recovery
  assignment/acquires its claim, changes `assigned_driver_id`, appends the
  custody event and resumes `out_for_delivery` or `returning`.
- `revoke_delivery_job_offer(p_assignment_id, p_reason,
  p_idempotency_key)` — dispatch authority. A primary offer returns the job to
  `requested`; a recovery offer/handoff is cancelled without changing the
  recovery-required job state or current custodian/claim.
- `expire_delivery_job_offers(p_batch_size, p_now)` — scheduled service-only
  worker locks due offered/handoff-pending assignments. Primary expiry returns
  the job to `requested`; recovery expiry closes its handoff and leaves the job
  recovery-required with the original custodian/claim.
- `respond_to_delivery_job_offer(p_assignment_id, p_decision,
  p_expected_version, p_idempotency_key)` — offered driver only and
  `assignment_kind=primary`; acceptance atomically acquires shared capacity.
  It rejects recovery assignments.
- `advance_delivery_job_status(p_job_id, p_expected_status, p_target_status,
  p_idempotency_key)` — assigned driver only for its allow-listed physical
  transitions.
- `issue_delivery_job_proof(p_job_id, p_proof_kind, p_channel,
  p_idempotency_key)` — service/authorized transition only.
- `verify_delivery_job_proof(p_job_id, p_proof_kind, p_code,
  p_expected_version, p_idempotency_key)` — scoped participant/driver flow;
  capped and audited.
- `cancel_delivery_job(p_job_id, p_expected_version, p_reason,
  p_idempotency_key)` — requester or support within the current custody/fee
  rule.
- `record_delivery_failure(...)`, `start_delivery_return(...)` and
  `complete_delivery_return(...)` — assigned driver/dispatch guards and
  mandatory reason/proof.
- `open_delivery_incident(...)` and `resolve_delivery_incident(...)` — assigned
  participant can open; `delivery_support` resolves with bounded outcomes.
- `finalize_delivery_job_financials(p_job_id, p_expected_version,
  p_idempotency_key)` — finance service only; validates terminal custody and
  posts balanced ledger/driver earning before `completed`.
- `adjust_delivery_job_financials(...)` — `delivery_finance`, reason and
  immutable compensating entries; never edits prior ledger entries.
- `set_delivery_service_config(...)` — `delivery_config`, evidence/version/
  minimum-build checks and append-only config event.
- `expire_delivery_payment_attempts(p_batch_size, p_now)` — scheduled
  service-only recovery for attempts beyond
  `payment_recovery_window_seconds`; it cancels unpaid jobs or queues a
  late-success refund/finance repair.

Revoke direct status, proof-secret, assignment-acceptance, finance-summary and
config writes from application roles. Each definer RPC self-authorizes,
pins `search_path`, revokes PUBLIC and has cross-role/replay tests.

Offer-response versus expiry and Paymob-webhook versus payment-expiry serialize
on the same assignment/attempt/job rows. Whichever valid transaction commits
first determines the state; the loser re-reads and returns the idempotent final
result. A late payment success after cancellation never dispatches—it creates a
visible refund/finance-repair item.

## Slice D — assignments and shared driver capacity

```text
delivery_job_assignments
  id primary key
  delivery_job_id references delivery_jobs
  driver_id references drivers
  assignment_kind primary|recovery
  handoff_from_assignment_id null references delivery_job_assignments
  status offered|handoff_pending|accepted|rejected|expired|cancelled|
         completed|handed_off
  assigned_by manual|automatic
  offered_at
  expires_at
  responded_at null
  rejection_reason null

  partial unique(delivery_job_id) where status in (offered,handoff_pending)
  partial unique(delivery_job_id) where status = accepted
```

Use the current order-assignment offer pattern, but do not copy its incomplete
capacity rule. `delivery_jobs.assigned_driver_id` is a read optimization updated
only in the same authority transaction as the accepted assignment/claim.

Introduce a shared, transactionally enforced driver work claim or equivalent
authority covering **both** food orders and parcel jobs:

```text
driver_work_claims
  id primary key
  driver_id
  work_kind food_order|delivery_job
  order_id null
  delivery_job_id null
  status active|released
  claimed_at
  released_at null
  release_reason null

  check exactly one of order_id/delivery_job_id matches work_kind
  unique(order_id) where order_id is not null and status = active
  unique(delivery_job_id) where delivery_job_id is not null and status = active
  unique(driver_id) where status = active
```

Both subject columns have real FKs. For v1, one driver has at most one active
claim across both products. Acquire the claim when an offer is **accepted**, in
the same driver-scoped transaction/advisory lock as assignment/job mutation.
An offer alone does not occupy capacity.

Before custody, only one offered-or-accepted path progresses at a time. In a
recovery-required state, one recovery offer may coexist with the current
accepted custody assignment, but the current driver's claim remains active.
The candidate must be a different eligible driver and acquires no capacity from
the offer alone.
Acceptance is a single custody-handoff transaction: it locks the job, handoff,
both confirmations, both assignments and both drivers; validates/consumes the
two scoped sides; marks the former assignment `handed_off` and releases its
claim before accepting the recovery assignment and acquiring the new claim.
Failure/expiry leaves the original custodian and claim unchanged. There is
never a committed moment with two active claims or no accountable custodian.

Before deploying, backfill every current accepted/in-progress food assignment
into a claim. Abort on conflicting drivers rather than choosing a winner.
Patch every current production food accept, cancel, reject, reassign and
terminal-status writer to acquire/release the same claim; do not assume the
existing assignment row will become `completed`. Keep `drivers.status`
consistent in the same authority transaction.

A watchdog may release only a provably terminal orphan, records the repair and
alerts ops; it never guesses from stale time alone. Tests race food-vs-parcel
acceptance, simulate a crash between steps and prove the transaction/repair
path cannot double-assign or strand capacity.

Automatic dispatch is off during the first pilot. When enabled:

- search around **pickup**, not drop-off;
- require verified/active/on-duty driver, supported vehicle, service area and
  capacity;
- use fresh location with a defined staleness cutoff;
- never fail open on missing location;
- use bounded offers, expiry and fallback to manual dispatch;
- record candidates/offers/rejections without exposing unrelated customer data.

Fix or replace public GPS broadcast before any merchant/customer cohort.
Tracking authorization must derive from authenticated job participation, not
knowledge of a UUID.

## Slice E — pickup, delivery and return proof

### Proof records

```text
delivery_job_proofs
  id
  delivery_job_id
  proof_kind pickup_otp|delivery_otp|return_otp|incident_photo|admin_override
  status pending|verified|failed|expired|overridden
  issued_to_phone_last4 null
  delivery_channel null
  issued_at
  revoked_at null
  verifier_user_id null
  attempt_count
  last_attempt_at null
  expires_at null
  verified_at null
  private_storage_path null
  reason_code null
  created_at

  partial unique(delivery_job_id, proof_kind) where status = pending

private.delivery_job_proof_secrets
  proof_id unique
  code_hmac
  hmac_key_version
  issued_to_phone_hash
  created_at
  destroyed_at null

private.delivery_custody_handoffs
  id
  delivery_job_id
  from_assignment_id
  to_assignment_id unique
  status pending|completed|expired|cancelled
  expires_at
  completed_at null
  created_at
  partial unique(delivery_job_id) where status = pending

private.delivery_custody_handoff_confirmations
  id
  handoff_id
  participant_side current_custodian|receiving_driver
  expected_driver_id
  confirmed_by_user_id null
  confirmation_kind driver|support_override
  confirmation_token_digest null
  token_key_version null
  override_incident_id null
  issued_at
  expires_at
  confirmed_at null
  consumed_at null
  unique(handoff_id, participant_side)
  check driver confirmation has token/key and no override incident;
        support override has an incident and no reusable plaintext token

private.delivery_proof_delivery_attempts
  id
  proof_id
  attempt_number
  idempotency_key unique
  provider_message_reference null
  status queued|provider_accepted|delivered|failed|unknown
  retry_count
  error_code null
  requested_at
  provider_accepted_at null
  callback_at null
  callback_signature_verified
  unique(proof_id, attempt_number)

delivery_job_incidents
  id
  delivery_job_id
  incident_type accident|loss|damage|prohibited_item|unsafe|
                recipient_unavailable|return_failed|driver_breakdown|
                custody_handoff|privacy|other
  severity
  status open|investigating|resolved
  custody_outcome null|handed_to_ops|lost|damaged|disposed
  opened_by
  assigned_to null
  resolution_code null
  financial_outcome null
  opened_at
  resolved_at null
```

Custody confirmation tokens are server-random, stored only as keyed digests and
bound to handoff ID, from/to assignment IDs, expected driver, participant side
and expiry. A token/confirmation from another job, recovery generation, side or
driver cannot satisfy the handoff. The two rows are consumed only by the atomic
transfer; generic OTP/proof rows and `verifier_user_id` are never used as
recovery authority. A support override occupies exactly one side, references
an open incident and records the operator/reason/private evidence.

OTP rules:

- cryptographically random, short-lived and stored only as a server-keyed HMAC
  in a private table with no client grants;
- scoped to one job and proof step;
- never returned by read APIs after creation;
- capped attempts, cooldown and abuse alert;
- push, database rows, callbacks, logs and analytics never contain plaintext
  code. It exists transiently only in the approved provider's outbound SMS
  request/body and the recipient's SMS; disable provider body retention where
  supported and persist only bounded delivery metadata;
- pickup verification is delivered server-side to the verified sender/merchant
  contact;
- delivery verification is delivered server-side by an approved SMS provider
  to the normalized named-recipient phone; the recipient needs no app;
- the requester and driver can trigger a bounded resend but can never read the
  code; provider payload is transient and delivery outcome is logged without
  secret content;
- SMS send/resend is idempotent, bounded by config, retries only provider-
  retryable failures, verifies provider callback signatures/replay IDs and
  alerts a terminal failure;
- return verification is independently delivered to the pickup/sender contact;
- recovery custody handoff requires bounded, short-lived confirmation from both
  the current and receiving driver; only `delivery_support` may replace one
  side after opening an incident and recording private proof/reason;
- offline completion queues the attempt but cannot claim success until the
  server verifies it;
- `delivery_support` override is exceptional, reasoned, audited and
  operator-visible.

Incident photos, if enabled, use a private Storage bucket:

- service-created path containing job ID and random object name;
- assigned participant upload only for the allowed job/status/purpose;
- no public URL or bucket listing;
- authenticated proxy read for the assigned `delivery_support` capability, with
  each successful fetch audited;
- MIME/size validation and malware/content workflow as appropriate;
- access audit, retention/deletion and legal-hold behavior;
- no routine proof photo in v1 unless the signed operating contract requires it.

If an approved recipient SMS channel is not configured and proven on a physical
device/real number, customer Send remains disabled. Sender-mediated sharing is
not accepted as independent recipient proof. Internal test recipients use the
provider sandbox only in non-production.

Return-to-sender:

- record recipient unavailable/refused/unsafe/prohibited-item reason;
- notify requester and ops;
- keep custody assigned to the driver;
- calculate the signed return/waiting fee server-side;
- require sender return OTP or audited support exception;
- settle driver earning and merchant/customer charge from final facts;
- open an incident if return cannot complete.

## Slice F — communication, privacy and notification

Use a separate private message table for v1; do not generalize food chat inside
the same migration:

```text
private.delivery_job_messages
  id
  delivery_job_id
  author_user_id
  author_kind requester|driver|support
  body_ciphertext
  encryption_key_version
  idempotency_key
  sent_at
  retention_until
  redacted_at null
  unique(delivery_job_id, idempotency_key)
```

Scoped RPCs permit:

- requester/authorized merchant staff;
- assigned driver while the job is active;
- explicitly granted `delivery_support`;
- no recipient account access unless explicitly modeled and verified;
- no finance/config operator access merely because they are admin.

Message plaintext is bounded before encryption. It cannot carry proof files,
OTPs or confidential evidence. Realtime uses an authenticated private job
channel carrying only message IDs; clients fetch authorized decrypted content
through the RPC and resync by cursor after reconnect.

Use a participant-private, RLS-protected tracking table/channel:

```text
public.delivery_job_locations
  delivery_job_id
  driver_id
  point geography(point)
  accuracy_m
  recorded_at
  received_at
  unique(delivery_job_id, driver_id, recorded_at)
```

Only the currently assigned driver writes. The requester and assigned
participant read through authenticated job-scoped RLS; knowledge of a UUID or
the anon key grants nothing. Do not use the existing public broadcast channel.

```text
private.delivery_job_legal_holds
  id
  delivery_job_id
  scope endpoints|parcel_text|messages|gps|proof|all
  reason
  placed_by
  placed_at
  released_by null
  released_at null
```

Default privacy schedule, unless the signed control map requires a shorter or
longer period:

- encrypted endpoints/contact/notes/parcel text/messages are available during
  the job and support window, then redacted/deleted 90 days after completion;
- precise GPS deletes after 30 days;
- incident proof remains until incident closure plus 180 days or an active
  legal hold;
- financial ledger/invoice facts retain for the accounting period without raw
  contact, message, free-text parcel or GPS data;
- account deletion blocks while the user has an active custody obligation,
  then pseudonymizes requester IDs and follows the same retention/legal-hold
  schedule;
- retention jobs check the scoped hold table for endpoints, text, messages, GPS
  and proof; every retention, redaction, export and hold action is audited.

Notifications are transactional:

Merchant/customer activation depends on Package 03’s durable push outbox,
attempt/ticket storage, Expo receipt polling, bounded retry/dead-token handling
and truthful operator failure states. Internal admin/manual tests may proceed
earlier, but driver offers and custody updates cannot rely on the current
transport-only success label.

Push is never state authority: driver/requester apps also query/subscribe to
current offers/jobs on foreground/reconnect, and server expiry/return workers
advance deadlines even if no device receives a notification.

- quote expiry if the user is still in-flow;
- request accepted/driver assigned;
- driver arrived pickup;
- parcel picked up;
- driver arriving/drop-off OTP prompt;
- delivered;
- delivery failed/returning/returned;
- cancellation, payment and incident updates.

Payload routes are allow-listed (`/delivery/{jobId}` or the app’s final route
contract), carry a delivery-job ID rather than an order ID, and respect the
current essential-event preference contract. Old binaries must ignore unknown
payloads without routing to a food order.

Never put phone numbers, full addresses, parcel free text, declared value, OTP
or proof URLs in push, analytics, logs or crash reports.

## Slice G — finance and payment

Parcel finance is separate from restaurant GMV and commission:

```text
delivery_merchant_billing_accounts
  restaurant_id primary key
  billing_mode prepaid|invoice
  status active|suspended
  credit_limit_egp
  unsettled_job_limit
  version
  approved_by

delivery_ledger_transactions
  id
  delivery_job_id null
  transaction_kind exposure_reserve|exposure_release|charge|driver_earning|
                   waiver|refund|merchant_payment|invoice
  idempotency_key unique
  reason_code null
  actor_user_id null
  created_at

delivery_ledger_entries
  transaction_id
  line_no
  account_kind bank_cash|paymob_clearing|merchant_receivable|
               merchant_prepaid_liability|driver_payable|
               driver_delivery_expense|platform_delivery_revenue|
               delivery_tax_payable|delivery_refund_expense|
               exposure_memo_debit|exposure_memo_credit|
               internal_pilot_expense
  account_subject_id null
  debit_egp
  credit_egp
  check exactly one side is positive
  primary key(transaction_id, line_no)

delivery_job_financials
  delivery_job_id unique
  quoted_fee_egp
  maximum_reserved_charge_egp
  base_fee_egp
  waiting_fee_egp
  cancellation_fee_egp
  return_fee_egp
  discount_egp
  tax_egp
  total_charge_egp
  driver_earning_egp
  platform_revenue_egp
  merchant_receivable_egp
  refunded_egp
  zero_fee_reason null
  payment_status
  calculation_version
  summary_version
  last_ledger_transaction_at null
  finalized_at null

delivery_driver_earnings
  id
  delivery_job_id
  delivery_job_assignment_id unique
  driver_id
  amount_egp
  status pending|eligible|settled|reversed
  driver_settlement_id null
  generated_at

delivery_invoices
  id
  restaurant_id
  period_start
  period_end
  status draft|issued|part_paid|paid|void
  total_egp
  issued_at null
  paid_at null

delivery_invoice_lines
  invoice_id
  delivery_job_id
  ledger_transaction_id
  amount_egp
  unique(invoice_id, ledger_transaction_id)

delivery_invoice_payments
  id
  restaurant_id
  ledger_transaction_id unique
  amount_egp
  reference
  received_at

delivery_invoice_payment_allocations
  payment_id
  invoice_id
  amount_egp
  primary key(payment_id, invoice_id)

delivery_driver_settlement_items
  driver_settlement_id references public.driver_settlements
  delivery_driver_earning_id unique
  amount_egp
  primary key(driver_settlement_id, delivery_driver_earning_id)

delivery_refunds
  id
  delivery_job_id
  payment_attempt_id
  amount_egp
  reason_code
  status requested|submitted|succeeded|failed|repair_required
  idempotency_key unique
  provider_refund_reference null
  created_at
  completed_at null
```

Every ledger transaction balances debits and credits in one definer
transaction. Ledger rows are append-only; refunds/waivers/corrections are
compensating transactions. `delivery_job_financials` is the one read summary
derived from the ledger, not an independently editable ledger. Finalization
sets its first terminal snapshot; every later refund/adjustment posts a new
balanced transaction and refreshes refunded amount, summary version and last
transaction. The job keeps only immutable quoted fee/driver-earning snapshots.

Journal templates are executable fixtures: merchant exposure uses paired memo
accounts; invoice charge debits merchant receivable and credits revenue/tax;
merchant invoice payment debits bank and credits merchant receivable; prepaid
funding debits bank and credits prepaid liability; prepaid charge debits that
liability and credits revenue/tax; card capture debits Paymob clearing and
credits revenue/tax; driver earning debits delivery/pilot expense and credits
driver payable; refund debits the approved refund/revenue account and credits
Paymob clearing. Every template balances exactly.

Pilot rules:

- internal jobs use an explicit zero-fee reason and never look like revenue;
- verified merchants use a delivery receivable/prepaid ledger, hard exposure
  ceiling, weekly statement and finance sign-off;
- private-pilot requester waiting/cancel/return charges are zero; valid driver
  earnings post to internal pilot expense. A non-zero public fee needs approved
  versioned pricing/terms and private proof;
- quote stores a maximum possible charge; create-job locks the billing account
  and atomically reserves that exposure, so concurrent requests cannot cross
  either the amount or unsettled-job limit. Prepaid accounts require sufficient
  available balance;
- no driver collects parcel-content cash;
- no recipient pays the parcel-content value;
- driver earning is finalized once per assignment from terminal custody facts;
  job financials aggregate all assignment earnings so a separately assigned
  return/recovery driver is paid without overwriting the first driver's earning;
- merchant cancel/wait/return fees are server-calculated from the accepted
  version. All customer-card cancel/wait/return fees are zero in v1 so a
  full-refund-only provider contract can reconcile exactly; non-zero customer
  exception fees wait for separately approved partial-refund authority;
- adjustments/waivers need reason, actor and immutable audit;
- every completed/returned/cancelled job reconciles to charge, driver earning
  and platform revenue or a documented zero-fee reason.

Do not attach a delivery job to the current order-only Paymob attempt by a fake
order ID. Use an additive delivery-specific contract:

```text
delivery_payment_attempts
  id
  delivery_job_id
  idempotency_key
  amount_egp
  captured_amount_egp
  refunded_amount_egp
  status creating|pending|succeeded|failed|expired|refunded
  provider_order_id null
  provider_transaction_id null
  created_at
  updated_at

  unique(delivery_job_id, idempotency_key)
  unique(delivery_job_id) where status in (creating,pending,succeeded)
  unique(provider_order_id) where not null
  unique(provider_transaction_id) where not null
```

Customer `create_delivery_job` creates `payment_pending`; a delivery-specific
intention function locks the job, uses the snapshotted amount and returns the
same attempt for a repeated `(delivery_job_id, idempotency_key)`; concurrent
different keys cannot create two active attempts. A verified HMAC webhook
idempotently settles the attempt and transitions the job to `requested`.
Failed/expired/abandoned payment never dispatches and ends in cancelled after
the recovery window. Cancellation/return invokes delivery-specific full refund
authority and reconciliation. Driver earning is based on custody/terms and is
not silently reversed because the platform refunded a customer.

V1 permits only a **full refund of the captured delivery charge**; it has no
partial-refund UI/authority. The refund RPC locks the attempt, checks cumulative
pending/successful refunds cannot exceed the captured amount, creates one
idempotent provider request and records repair-required outcomes. Merchant
ledger credits/waivers may be partial compensating entries but are not Paymob
partial refunds.

Customer payment implementation and activation wait for Package 04’s card
idempotency/refund/reconciliation gate. The merchant/internal pilots do not
need a fake card/order path.

Existing `driver_earnings.order_id` remains unchanged for food. Parcel earnings
use `delivery_driver_earnings`; update weekly driver settlement/report
authority to union both ledgers and create explicit settlement items for each
source. Prove old food totals unchanged and every parcel earning paid exactly
once.

## Slice H — application experiences

### Admin first

- create an internal/private job;
- validate endpoints/parcel/terms and preview the quote;
- manual assign/reassign/cancel;
- see state/event/custody timeline;
- initiate/monitor return;
- view proof through authorized short-lived access;
- open/resolve incident;
- see financial reconciliation and merchant exposure;
- change launch stage/config only with audited owner permission.

### Merchant web and restaurant app

- owner/manager request delivery for an off-platform order;
- saved merchant pickup location/contact;
- recipient contact/address and merchant reference;
- parcel category/band/attestation;
- quote and fee confirmation;
- status/tracking/chat/cancel/return;
- history, invoice/statement and exception detail.

Ordinary staff permission is an explicit owner choice; default deny in v1.
Merchant reference is not a Sharm Eats food order and must not collide with
`orders.id`.

### Driver

- unified offer card clearly labeled Food or Delivery;
- pickup/drop-off zones and parcel band before acceptance, minimum necessary
  exact data after acceptance;
- navigate/arrive/pickup OTP/picked-up/drop-off OTP;
- recipient unavailable/unsafe/prohibited/damaged flow;
- return-to-sender and sender proof;
- earnings/incident state with no food commission language;
- one active-work rule visible and enforced.

### Customer “Send”

After merchant proof and the card gate:

1. choose pickup/current or saved address;
2. choose drop-off and recipient;
3. declare allowed parcel category, size/weight, package count, value and
   fragile state;
4. accept prohibited-goods and liability terms;
5. receive an expiring quote;
6. pay;
7. track/chat/cancel within policy;
8. have the server deliver the recipient OTP over the verified SMS channel;
9. see delivery/return proof and support path;
10. view history/receipt/refund.

All customer-visible behavior ships in EN/AR/RU/IT/DE and Arabic RTL. Address,
phone and error input must work on physical devices and poor networks.

## Slice I — analytics and operations

Use non-PII identifiers and bounded properties:

- `delivery_entry_viewed`;
- `delivery_quote_requested|succeeded|failed|expired`;
- `delivery_job_requested`;
- `delivery_offer_sent|accepted|expired|rejected`;
- `delivery_pickup_arrived|verified|failed`;
- `delivery_picked_up`;
- `delivery_dropoff_verified|failed`;
- `delivery_job_delivered|returning|returned|cancelled`;
- `delivery_incident_opened|resolved`;
- `delivery_payment_succeeded|failed|refunded`;
- `delivery_support_opened`;
- funnel duration and failure reason codes.

Dashboards:

- quote → request → accepted → pickup → delivered conversion;
- pickup wait, assignment, travel and total duration;
- cancel/fail/return/incident rate and reasons;
- merchant volume/exposure and repeat;
- driver offer acceptance/utilization/earnings;
- charge, refund, driver earning and platform-revenue reconciliation;
- delivery by service area/time/band without exposing contacts/contents;
- licence/insurance evidence expiry and feature-stage status.

Alerts:

- stuck custody state;
- job picked up with no fresh location;
- repeated OTP failures;
- driver double assignment/capacity inconsistency;
- return overdue;
- loss/damage/prohibited-item/accident incident;
- finance mismatch or merchant exposure breach;
- expired required compliance evidence;
- disabled/private-stage bypass attempt.

Operating runbooks cover dispatch, cancellation, waiting, failed pickup,
recipient unavailable, return, accident, loss/damage, prohibited item, proof
override, contact/privacy request, merchant exposure and finance repair.

## Complete test and verification matrix

Every implementation slice ends with a dated evidence report containing commit
SHA, migration/Edge Function versions, commands/results, build/device IDs,
production queries, smoke users/jobs, rollback observation and open exceptions.

### Database and migration

- fresh-database install and production-shaped upgrade;
- deterministic backfill, constraints, indexes and generated DB types;
- current production function bodies captured before replacement;
- Sharm service-area seed matches current bbox/helper fixtures and the
  compatibility wrapper preserves food behavior;
- live food work claims backfill deterministically; conflicting drivers abort
  rather than auto-resolve, and historical accepted assignments on terminal
  orders do not become active claims;
- real-schema `BEGIN … ROLLBACK` dry run with functional assertions;
- explicit Data API grants, RLS and policies for every new public table;
- definer `search_path`, revoked PUBLIC execute and narrow grants;
- database/security advisors compared to baseline;
- backup plus isolated restore verifies job, event, proof, finance, Storage
  metadata, functions and RLS.

### RLS, Storage and role matrix

Positive/negative tests for anonymous, unrelated customer, requester customer,
recipient-without-account, unrelated merchant, requester merchant owner,
manager/staff, unassigned/assigned/previous driver, dispatcher, each explicit
operator capability, ordinary admin and service role:

- list/direct-ID/nested relation/Realtime visibility;
- cross-requester and cross-merchant quote/job/message/proof/finance access;
- driver access before offer, during assignment and after retention cutoff;
- forged requester kind/merchant membership/driver assignment;
- private Storage upload/read/list/delete/path traversal and expired/revoked
  authenticated proxy access;
- operator-capability override audit and ordinary-admin denial;
- disabled/internal/merchant-private/customer-private/public stages;
- exactly one service config per area, minimum-build enforcement, cohort
  expiry/revocation and evidence-expiry fail-closed behavior;
- race platform-owner/capability/cohort grant, expiry and revocation; one active
  generation remains and ordinary admin cannot self-elevate;
- old JWT, guessed UUID and direct PostgREST calls.

### Quote and eligibility

- both endpoints inside, one outside, both outside, boundary points;
- null/NaN/infinite/out-of-range/swapped coordinates;
- disabled service area/config/requester kind;
- expired/reused/changed quote and idempotent consume;
- repeated/scoped idempotent quote requests return one quote; another requester
  cannot collide with or consume it;
- every parcel band/limit/prohibited category and unknown classification;
- server price fixtures, min/max, rounding and pricing-version immutability;
- concurrent quote consumption and client fee/distance tampering;
- rate limit and abuse behavior.

### Lifecycle and concurrency

- every allowed transition and every forbidden transition by every role;
- duplicate/reordered/replayed API and Realtime events;
- cancel before/after assignment and after custody;
- offer reject/expiry/reassign and stale response;
- race offer accept against expiry/revoke; exactly one outcome/claim commits;
- pickup-failed retry/cancel, delivered/returned financial completion and every
  custody-exception resolution;
- pickup-failed retry/cancel atomically releases assignment, claim and
  `assigned_driver_id` before any new offer;
- pickup OTP valid/invalid/expired/rate-limited/duplicate/offline;
- delivery OTP equivalent cases;
- delivery failure → returning → returned, plus return failure/incident;
- delivery/return recovery-required → offered handoff → resumed custody, plus
  expired/rejected/failed handoff retaining the original custodian;
- generic primary-offer respond/revoke/expiry RPCs reject or correctly branch
  on recovery assignments; no recovery outcome returns the job to `requested`;
- row/version locks and idempotency under concurrent requests;
- immutable terminal facts and append-only event audit.

Use model/state-machine tests to generate transition sequences, not only one
happy-path example.

### Driver capacity, dispatch and tracking

- race parcel acceptance against food-order acceptance for one driver;
- release then reassign the same food/parcel subject to a different driver while
  immutable prior claim history remains;
- race recovery acceptance with old-driver/new-driver capacity changes; the
  two-sided handoff atomically transfers one claim, `assigned_driver_id` and
  custody event without a no-custodian or double-claim state;
- prove production-shaped live-food claim backfill and repair after a simulated
  crash/orphan without releasing non-terminal work;
- claim release on every terminal/expiry/reassign path;
- nearest-to-pickup candidate order and stale/missing GPS fail closed;
- unsupported vehicle/service area/off-duty/unverified driver rejection;
- one-active-job v1 invariant under concurrent auto/manual dispatch;
- authenticated tracking only, forged/public broadcast denied;
- background/terminated location updates and reconnect without duplicate state.

### Finance and payment

- internal zero-fee reason;
- merchant invoice/prepaid ledger, exposure ceiling and statement;
- race concurrent merchant requests at the exposure boundary; only capacity
  inside the locked limit succeeds;
- invoice/prepaid billing-mode and account-version snapshots remain unchanged
  when the merchant account later changes; each finalizes against the correct
  journal template;
- every ledger transaction balances and every adjustment is compensating;
- execute every balanced journal template, invoice-payment allocation and
  exposure reserve/release;
- weekly invoice/payment allocation and parcel driver earning appear exactly
  once in settlement while food totals remain unchanged;
- a post-custody recovery assignment pays each involved driver exactly once and
  the job summary equals the sum of assignment earnings;
- base/wait/cancel/return/waiver combinations;
- every customer-card exception fee remains zero in v1 and a full refund
  reconciles exactly; non-zero customer-fee attempts fail closed;
- driver earning finalized exactly once;
- no restaurant GMV/commission/settlement contamination;
- no parcel-content cash or recipient charge path;
- card success/failure/abandon/timeout/delayed callback/replay later;
- concurrent same-key and different-key payment-intention calls produce one
  active attempt and one provider order;
- full-refund success/failure/replay, cumulative-refund cap, merchant partial
  ledger credit/waiver and reconciliation; no Paymob partial-refund path in v1;
- property test: charge - refund = receivable/cash, and driver/platform facts
  reconcile for every terminal job.

### Security and privacy

- OTP entropy/hash/expiry/attempt tests and no secret in logs/push/analytics;
- custody-handoff proof requires both drivers or a reasoned incident override
  and cannot be replayed across assignments, jobs, sides or recovery
  generations;
- PII redaction tests for logs, Sentry, PostHog, support export and events;
- contact/proof retention/deletion/legal hold;
- active-job account deletion blocked, terminal-job pseudonymization, scheduled
  contact/message/GPS deletion and legal-hold precedence;
- compliance expiry closes new intake but preserves in-custody completion;
- spoofed/replayed SMS callback, provider retry and terminal send failure;
- quote/job endpoint, parcel-text, message and GPS erasure at each deadline,
  with scoped legal hold winning every race;
- file MIME/size/path/content validation;
- free-text injection and notification-route allow-list tests;
- rate limits, enumeration, IDOR, privilege escalation and service-role-only
  paths;
- threat model and privacy/data-safety review signed before customer pilot.

### App and user-flow verification

- unit/integration tests, typecheck, lint and production build for all affected
  apps;
- Playwright/browser behavioral E2E for admin config/cohorts/manual dispatch/
  incident/finance and merchant quote/create/history/invoice, including
  permission denials and duplicate submits;
- admin internal job and full manual dispatch;
- merchant create/track/cancel/history/invoice plus denial for draft/rejected/
  inactive/KYC-stale/billing-suspended/over-limit/non-manager merchants;
- driver accept/pickup/deliver/fail/return/incident;
- customer quote/pay/track/cancel/return/refund when enabled;
- all five locale key parity, Arabic RTL and long/error copy;
- accessibility labels, keyboard/web, screen-reader basics and large text;
- physical Android/iOS fresh install and upgrade from last supported binary;
- foreground/background/terminated push and deep link;
- offline, slow, intermittent and duplicate-submit recovery;
- app kill/restart during quote, payment, pickup and delivery;
- recipient without the app receives/resends/completes OTP through the approved
  SMS provider; requester/driver cannot retrieve the code.

### Performance and reliability

- default benchmark data: 10,000 historical jobs, 500 drivers, 100 fresh
  locations and 50 concurrent quote/create clients;
- quote p95 ≤ 750 ms, create/consume/exposure-reserve p95 ≤ 1.5 s, manual
  offer/accept p95 ≤ 1 s, non-validation error rate < 1% and zero duplicate
  job, ledger, claim or proof side effects;
- pickup-nearest candidate query p95 ≤ 500 ms with a recorded query plan;
- 100 active jobs publishing one location every five seconds sustain writes and
  authenticated reads with p95 ≤ 1 s and no cross-job event;
- concurrent delivery benchmark may not worsen the food checkout/dispatch
  control p95 by more than 10%;
- record p50/p95/p99, environment, concurrency, error rate and query plans; a
  changed budget is approved before, not after, the run;
- cron/worker retry, poison job, idempotency and alert behavior;
- no unbounded list/search or proof download;
- restore, failover and stuck-job watchdog exercise.

### Production rollout proof

For each stage:

1. deploy dark with config disabled;
2. run schema/security/advisor smoke;
3. activate only named accounts;
4. run complete internal/merchant/customer happy and exception paths;
5. compare food control metrics and finance;
6. exercise disable/drain/return/rollback while jobs are offered, accepted,
   picked up and returning: new work is denied while each existing participant
   retains only the operations required to resolve custody;
7. sign security/privacy, ops, finance, legal/product and owner checklist;
8. record exact production version and open exceptions.

Public activation requires:

- current mapped licence/insurance/legal evidence;
- Package 03 durable push/receipt/retry/operator-failure gate proven for driver
  offers and custody events;
- 20 internal jobs and 20–50 merchant jobs with zero custody/finance mismatch;
- customer card/refund gate proven if customer Send is enabled;
- no open P0/P1 security, privacy, custody, payment or driver-capacity issue;
- physical-device matrix and return/incident rehearsal passed;
- support/dispatch ownership for every operating window;
- close switch and rollback tested in production-private stage.

## Rollout and rollback

Rollout:

1. evidence/control mapping and signed limits;
2. Sharm geography bridge, then dark schema/config/RLS/quotes;
3. admin-created internal job and dedicated driver cohort;
4. manual-dispatch internal proof;
5. verified-merchant request and capped invoice/prepaid finance;
6. 20–50 merchant-job pilot;
7. customer-private Send after card gate;
8. automatic dispatch only after shared capacity and pickup-nearest proof;
9. controlled public service-area rollout.

Rollback/close:

- set `intake_state=draining` (or emergency `closed`) to reject new
  quote/create/offer attempts; do not use launch-stage visibility to hide
  existing work;
- preserve access for active participants and ops to finish/return in-custody
  jobs;
- stop new offers while keeping manual recovery;
- reconcile/cancel jobs not yet picked up;
- return every parcel already in custody;
- preserve immutable event, proof, payment and finance records;
- disable customer/merchant entry points through server response and app config;
- never drop job data or revert shared food dispatch while work is active.

Production rollback means intake closure, custody drain/return, old-client
compatibility and a forward corrective migration if necessary—not a destructive
down migration.

## Compatibility

- old customer/merchant/driver binaries retain food behavior;
- unknown notification payloads do not route to `/order/{deliveryJobId}`;
- new driver builds understand work kind before parcel offers are enabled;
- shared capacity changes deploy server-first with food regression tests;
- new nullable/generic fields are additive until all supported binaries migrate;
- feature stage remains disabled if the minimum compatible build is not proven.

## Acceptance

- Delivery jobs are not restaurant orders or a catalog vertical.
- Both endpoints and every parcel/price/terms fact are server-validated and
  snapshotted.
- One driver cannot accept overlapping food/parcel work in v1.
- Every parcel has an append-only custody trail from request to delivery/return.
- Pickup and delivery proof cannot be replayed, guessed or leaked.
- Failed delivery after pickup always has a return/incident resolution.
- Merchant/customer charge, driver earning and platform revenue reconcile
  without touching restaurant GMV/commission.
- Tracking, contacts, messages and proofs are participant-scoped and private.
- Five-locale, RTL, poor-network, physical-device and exception E2E evidence
  passes.
- Activation is staged, measurable, reversible and tied to current
  licence/insurance/operating evidence.
