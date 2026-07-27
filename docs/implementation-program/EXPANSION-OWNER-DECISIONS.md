# Expansion owner decisions and activation inputs

**Recorded:** 2026-07-27

**Scope:** grocery, pharmacy/health and delivery as a service

**Purpose:** prevent implementation sessions from inventing product, money,
legal or operating behavior.

These are the v1 defaults Claude should implement unless the owner changes this
file. “Pending evidence mapping” does not block dark engineering, but it blocks
the related activation—including a private/internal pilot wherever that
evidence is a stated gate.

## Cross-product decisions

| Decision | Selected v1 | Status / evidence |
|---|---|---|
| Expansion order | Vertical authority → fixed-pack grocery → merchant delivery → health/pharmacy → customer Send → full grocery/Rx/city | Approved planning default |
| Existing food behavior | Must remain backward-compatible and independently closable | Required |
| Launch control | Server-authoritative staged launch; commerce verticals use `disabled/private/public`, while delivery uses `disabled/internal/merchant_private/customer_private/public` plus `closed/open/draining` intake; UI is never authority | Required |
| First geography | Existing Sharm service area only | Approved planning default |
| Payments | COD for commerce pilots; cards only after Package 04 gate | Required |
| Money | Whole EGP for fixed-pack pilots; minor units before measured goods | Required |
| Public activation | Named cohort, controlled orders, zero unexplained money/custody variance, signed evidence | Required |
| Legal/licence documents | Owner reports licences and legal papers are available | Claude must inventory/map them without committing confidential contents |
| Evidence storage | Encrypted restricted vault/object store + private-schema metadata/access audit | Ordinary admin/support/merchant access denied |
| Testing | Full automated, RLS, E2E, device, load, rollout and rollback matrices in Packages 07/08 | Required |

## Grocery v1

| Decision | Selected v1 |
|---|---|
| Product | One private fixed-pack grocery merchant |
| Catalog | 50–200 curated SKUs |
| Sale modes | `each`, sealed `fixed_pack` |
| Excluded | Measured weight, loose produce repricing, substitutions, partial fulfillment |
| Availability | Honest merchant-controlled in/out; no real-time-stock claim |
| Quantity | Integer units with server basket/item/value limits |
| Initial basket limits | 30 distinct SKUs, 20 units per line, 60 total units and EGP 5,000 total; server-versioned and reducible before activation |
| Payment | COD |
| Picking | Existing merchant/restaurant app; owner/manager/staff permissions follow Package 07 |
| Search | Server-side indexed search and stable pagination |
| Import | CSV template + dry run + row errors + idempotent merchant-SKU upsert |
| Pilot proof | 20 controlled orders, then 20–50 if metrics remain clean |
| Public gate | Food gate plus zero order/cash/settlement mismatch |

Later full grocery requires minor-unit money, stock movements/reservations,
measured-item repricing, customer substitutions, partial refunds and picker
scanning. The v1 UI must not imply those exist.

## Pharmacy and health v1

| Decision | Selected v1 |
|---|---|
| Evidence | Licences/legal papers reported available; build restricted register and control map |
| First assortment | Fixed-pack, server-allow-listed products |
| Safest early label | `Health & Personal Care` until the evidence map supports “Pharmacy” |
| Seller | Only the entity/partner named and covered by mapped evidence |
| Classification | Server-owned `product_compliance_reviewer` workflow; ordinary admin/merchant cannot approve or downgrade |
| Unknown class | Fail closed |
| Prescription/Rx | Disabled until D1–D4 controls and exact evidence mapping pass |
| Controlled/restricted/cold-chain | Disabled in the first pilot |
| Age/ID | Disabled unless the approved product class and driver flow require it |
| Payment | COD initially |
| Availability | Fixed-pack boolean availability; no measured quantities |
| Privacy | No prescription/health document collection in the non-Rx pilot |
| Rx recipient authority | Pharmacist-approved recipient is immutable through authorization/order/handoff; `patient_only` binds the named patient; proxy stays disabled until the evidence map defines it |
| Pilot proof | Private cohort, full order/return/refund/settlement rehearsal |
| Failed ID/recipient pilot economics | No COD collection or retained card charge; full refund, driver paid, platform absorbs outbound/return |
| Returned medicine | Pharmacy quarantine; never automatic restock; pharmacist disposition |

Claude may build the complete prescription/pharmacist architecture dark while
the evidence is being mapped. It may not activate Rx merely because the
`requires_prescription` column exists.

## Delivery-as-a-service v1

| Decision | Selected v1 |
|---|---|
| Product model | Separate `delivery_jobs`; never a fake restaurant/vertical |
| First external requester | Verified merchant after admin/internal proof |
| Customer Send | After merchant pilot and Package 04 card gate |
| Route | One pickup, one drop-off, same active service area |
| Geography prerequisite | Seed Sharm city/service area from current authoritative bbox; preserve food compatibility |
| Parcel | One sealed package |
| Fulfillment | Immediate/manual dispatch |
| Driver capacity | One active food-or-parcel job |
| Goods purchasing | Prohibited |
| Contents COD/cash-on-behalf | Prohibited |
| Recipient contents payment | Prohibited |
| Merchant fee | Weekly invoice/prepaid ledger with hard exposure cap |
| Customer fee | Sender-paid card after card gate |
| Proof | Sender pickup verification + recipient delivery OTP |
| OTP delivery | Approved server-side SMS to verified contact; requester/driver cannot read code |
| Routine photos | No; private incident evidence only unless papers require more |
| Failed delivery | Mandatory return-to-sender |
| Scheduling/multi-stop/pooling | Later |
| Automatic dispatch | Later, after pickup-nearest/shared-capacity proof |
| Tracking | Authenticated participant-only; public GPS broadcast prohibited |
| Operator access | Narrow delivery config/dispatch/support/finance capabilities; ordinary admin has no implicit access |
| Customer card model | Delivery-specific attempts/webhook/refund tables; never a fake food order |
| Customer card exception fees | EGP 0 throughout v1; full-refund-only authority remains exact |
| Private-pilot extra fees | Waiting/cancel/return fee charged to requester = EGP 0; platform pilot expense pays valid driver earning |

### Provisional private-pilot limits

These are conservative engineering defaults, not permission for public launch.
The mapped insurance/licence/operating documents may reduce them.

| Input | Provisional value |
|---|---|
| Package count | 1 |
| Small band | Up to 30 × 30 × 30 cm and 3 kg |
| Medium band | Up to 50 × 40 × 40 cm and 10 kg |
| Larger/heavier | Reject |
| Declared value | Maximum EGP 5,000 |
| Service area | Both endpoints inside active Sharm area |
| Driver active capacity | 1 |
| Offer expiry | 30 seconds, configurable |
| Quote expiry | 10 minutes, configurable |
| OTP attempts | 5 with cooldown/alert |
| Merchant outstanding exposure | EGP 5,000 or 20 unsettled jobs, whichever occurs first |

Prohibited by default:

- cash, currency, negotiable instruments and high-value jewellery;
- weapons, explosives, hazardous/flammable/toxic material;
- illegal/stolen goods;
- alcohol, tobacco/vapes and controlled substances;
- prescription medicine in the parcel-delivery product;
- live animals, people, biological samples and perishable/cold-chain goods;
- identity documents or anything excluded by the mapped insurance/terms.

## Inputs Claude must register before activation

| Input | Engineering may proceed dark? | Public/private activation condition |
|---|---:|---|
| Pharmacy/seller licence scope and expiry | Yes | Mapped to products, seller and controls |
| Accountable pharmacist identity/authority | Yes | Required for any pharmacist/Rx flow |
| Courier/entity licence | Yes | Required for merchant/customer parcel pilot as applicable |
| Motor/courier/third-party insurance | Yes | Named insured, drivers/vehicles, territory, goods and limits mapped |
| Loss/damage liability and declared-value cap | Yes | Terms + support/finance workflow signed |
| Prohibited-goods policy | Yes | Versioned in server config and customer/merchant attestation |
| Parcel size/weight/vehicle bands | Yes | Ops and insurance sign-off |
| Waiting/cancel/return fees | Yes | Pricing version and copy approved |
| Merchant credit/exposure cap | Yes | Finance owner and collection process named |
| Support/dispatch operating owner | Yes | Named for every pilot window |
| Confidential document storage | Yes | Restricted location, access owner and expiry process confirmed |
| Private prescription malware scanner | Yes | Endpoint/secret/no-retention terms and clean/malware/timeout proof |
| Pharmacist MFA/reauth enrollment | Yes | Verified credential user completes fresh AAL2 assertion on device |
| Delivery platform-owner UUID | Yes | Explicit bootstrap identity recorded by release operator; never inferred |
| Recipient OTP SMS provider | Yes | Credentials/callback signature/no-secret logs and real-number delivery proof |
| Delivery PII encryption key | Yes | Secret-manager key/version/rotation and deletion runbook |
| Durable delivery push | Yes | Package 03 outbox/receipt/retry/operator-state gate before merchant/customer activation |
| Grocery pilot basket limits | Yes | Owner/ops confirms or reduces the provisional versioned limits before E1 activation |

## Change-control rule

Any change to an item in this file that affects eligibility, money, liability,
privacy, proof or user-visible promises requires:

1. owner decision recorded here;
2. legal/finance/ops mapping where relevant;
3. versioned server configuration or migration;
4. updated tests, copy and runbook;
5. private verification before activation.
