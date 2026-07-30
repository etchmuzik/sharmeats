# Package 05 — tourist trust, currency and measurable growth

## Outcome

Make the tourist promise truthful in every language, clearly separate display
currency from the EGP charge, collect reliable acquisition/conversion evidence
and ask for store reviews only after real delivered value.

> **Status 2026-07-30 — recon + build session.** Every claim below was verified
> against the live repo/database before building; corrections and deliveries:
>
> * **Slice A**: the five locale files were ALREADY honest ("indicative rate",
>   "approximate prices", 5-way key parity). The surviving lie was hardcoded
>   English in `app/help.tsx` ("We accept Visa and Mastercard from any country
>   … at the daily FX rate" while prod ships cash-only with a static table) —
>   replaced with locale-keyed honest copy in all five languages, including the
>   EGP 100 SLA-credit cap and the allergy-communication disclaimer. The
>   placeholder support phone remains an owner action.
> * **Slice B**: BUILT (mig 182) — `fx_rates` observations, anon-readable
>   `current_fx_rates` with a stale flag, audited `admin_set_fx_rate` (reason,
>   expiry, actor, >10% jump guard), daily `sharmeats-fx-health` cron, client
>   resolver with cache + always-stale static fallback and a dated
>   "approximate" checkout label. The FEED edge function is deferred until the
>   owner approves a rate source/licence (step 1); `record_fx_observation` is
>   its ready contract. Seed rates are the Phase-0 numbers on a 7-day shelf
>   life — the health sweep nags until real rates are set.
> * **Slice D**: BUILT (mig 183) — `acquisition_touches` (one first touch per
>   install, organic upgradeable within 72h, bounded latest-campaign touch),
>   allow-listed `acquisition_partners`, sign-in claim, orders stamped by
>   TRIGGER (zero client authority), admin `acquisition_report`. Client:
>   install id + `sharmeats://open?src=&campaign=&partner=` capture. Referral
>   stays distinct.
> * **Slice E**: was mostly built already (all seven Package-01 funnel events,
>   enrichment, deny-list, dictionary). This session: wired the ZERO-call-site
>   `identifyUser` (the dictionary had claimed it for months), added
>   `service_area_checked` and `second_order`, and fixed a real regression —
>   the PII deny-list's 'message' fragment silently ate
>   `message_id`/`attributed_message_id`, destroying client-side push→funnel
>   attribution. The production-ingestion device proof remains an owner action
>   on a fresh build.
> * **Slice F**: the spec's "no evidence-based review prompt policy" was FALSE —
>   a high-rating-gated prompt existed. Added the missing frequency policy:
>   60-day cooldown, once per version, lifetime cap 3, suppressions recorded.
> * **Slices C/G**: not built this session — C is measurement-driven copy
>   placement; G is owner-gated partner pilots (the QR link contract and the
>   report they need now exist).

## Current evidence

- Customer display conversion exists in `src/currency/fx.ts` and Settings.
- The rates are manually maintained, approximate and not a live daily feed.
- Checkout still charges authoritative EGP amounts, which is correct.
- Help copy currently overstates the FX freshness and card availability.
- EN/AR/RU/IT/DE are supported, but copy changes need native review.
- PostHog calls exist and the production key is configured. A new customer build
  and a real ingested-event proof are still required.
- `expo-store-review` is installed, but there is no evidence-based review prompt
  policy.
- Campaign/open attribution is planned in Package 03; acquisition source needs a
  parallel first-touch model.

## Expected repository surfaces

- customer currency formatter/feed repository, Settings, Help, onboarding,
  checkout and receipt;
- five customer locale files plus store listing/review copy artifacts;
- migration/Edge Function/RPC for rate observations and acquisition touches;
- customer deep-link, identity merge, review-prompt and analytics modules;
- `docs/ANALYTICS-DICTIONARY.md`, copy matrix and partner operating guide;
- admin acquisition/FX health reporting where operator action is needed;
- EAS/release configuration only where a new production build is required.

## Slice A — truthful trust copy now

Audit onboarding, Help, checkout, payment methods, currency settings, order
receipt, store listing and investor/deck copy.

Required contract:

- all orders are charged and settled in EGP;
- another currency is an approximate display convenience;
- a stale/manual rate is never described as daily or live;
- cards are not described as accepted until the controlled rollout in Package
  04 reaches its enablement gate;
- cash instructions explain the exact amount due in EGP;
- refund timing and channel match the real payment method;
- service area, support hours and delivery expectations are honest.

Create one source-of-truth copy matrix with EN source, AR/RU/IT/DE translations,
screen locations, legal/owner approval and screenshot status. Machine
translation is a draft; customer-critical Arabic and high-volume tourist
languages need a named human reviewer.

## Slice B — trustworthy display FX

The safest v1 is still EGP charging plus optional converted display. Do not
change the money schema or settlement currency.

Suggested model:

```text
fx_rates
  base_currency = EGP
  quote_currency
  rate
  source
  effective_at
  fetched_at
  stale_after
  status active|stale|disabled
  unique(base_currency, quote_currency, effective_at)
```

Use sufficient decimal precision in the FX table, but conversion is presentation
only. No client-supplied rate is accepted by `place_order`, payments, refunds or
settlements.

Implementation:

1. Owner approves a primary and backup rate source, licence and update cadence.
2. Scheduled server function fetches only the supported quote currencies.
3. Validate response shape, positive bounds, timestamp and rate jump.
4. Insert immutable observations and atomically choose the current active rate.
5. Serve a small public read RPC/cache with rate, source, effective time and
   stale status; no public writes.
6. Customer caches last-known rates with their effective time.
7. If stale beyond policy, show EGP only or label the conversion “approximate,
   last updated …”; never silently present it as current.
8. Order receipt snapshots the display currency/rate used for that view only,
   while the legal/order totals remain EGP.

The current static-rate module remains the offline fallback only if it is labeled
as approximate and has a deliberate expiry/release process. It must not compete
with a server rate as a second invisible source of truth.

Security and operations:

- service-role-only rate ingestion;
- explicit RLS/grants on the public table;
- alert on feed failure, stale rate, implausible jump and missing currency;
- log metadata, not provider credentials or full raw payloads;
- manual admin override requires source, reason, expiry and audit.

## Slice C — tourist onboarding and confidence

Build a short trust path around the first order:

- language and display currency can be chosen before sign-in;
- location/service-area result explains what happens if the hotel pin is wrong;
- hotel/room handoff instructions are distinct from kitchen notes;
- COD amount and change expectations are clear;
- support entry is visible before and after checkout;
- allergy information explains it is communicated, not a medical guarantee;
- ETA/status meanings match real operations;
- the app identifies company-owned brands neutrally.

Do not add more onboarding pages by default. Measure where confidence is missing,
then place the explanation at that decision point.

## Slice D — acquisition attribution

Use a first-touch plus order-touch model:

```text
acquisition_touches
  anonymous_install_id
  user_id null
  source
  medium
  campaign
  partner_code null
  creative null
  deep_link null
  occurred_at

orders.acquisition_touch_id null
```

Approved sources include:

- hotel/concierge QR;
- airport/taxi/driver card;
- merchant table tent/bag insert;
- referral code;
- paid social/search campaign;
- organic app-store/web;
- unknown/direct.

Requirements:

- signed/allow-listed partner codes; never trust an arbitrary commission value;
- preserve anonymous first touch across registration without overwriting a
  known earlier source;
- record a bounded last campaign/order touch separately;
- deep links validate destinations;
- consent/privacy policy covers identifiers and retention;
- referrals remain distinct from paid partner attribution;
- fraud signals for self-referral, repeated devices and code abuse.

Admin reporting:

- installs/opens, activated users, first order and repeat order by source;
- contribution-based CAC/payback, not revenue-only payback;
- hotel/partner order count and quality;
- unknown attribution rate;
- no personally identifiable customer export by default.

## Slice E — conversion and retention measurement

Before running experiments, prove one real device funnel reaches PostHog:

```text
app_open
→ service_area_checked
→ restaurant_viewed
→ item_added
→ checkout_started
→ order_placed
→ order_delivered
→ second_order
```

Add stable properties:

- app version/build/release SHA;
- locale and display currency;
- anonymous/authenticated ID merge result;
- acquisition source/campaign;
- restaurant/vertical/zone IDs;
- payment method and fulfillment type;
- order/message attribution IDs where applicable.

Never send address, phone, message text, allergy notes, push token or payment
credentials to analytics.

Create a versioned event dictionary with owner, producer, meaning, allowed
properties and test. Dashboard definitions live beside the dictionary so metric
names cannot drift.

Experiment rules:

- one hypothesis and primary metric;
- guardrails for cancellation, support and margin;
- server or release-controlled assignment, not an operator-only fake switch;
- sticky cohort and exposure event;
- sample-size/time limit declared before reading results;
- holdout where lifecycle messaging is evaluated;
- archive losing variants and stale flags.

## Slice F — app-store review prompt

Trigger the native review prompt only when all are true:

- the customer has at least one delivered order;
- no cancellation, refund, open urgent support case or severe SLA failure is
  attached to the recent experience;
- the app is eligible to request a review;
- the user has not been prompted inside the configured cooldown;
- prompt occurs after a positive completion moment, never during checkout.

Do not ask “are you happy?” and route unhappy users away from the store; that is
review gating. Provide the same visible Support path to everyone.

Store locally and, if cross-device frequency matters, server-side:

```text
review_prompt_state
  user_id
  eligible_after_order_id
  last_prompted_at
  prompt_count
  app_version
```

The OS may choose not to show the prompt. Analytics records eligibility and
request, not a claimed displayed/reviewed result.

## Slice G — partner and tourist operations

For hotel/concierge pilots:

- unique QR/link per approved partner/location;
- printable five-language mini-guide;
- tested hotel pin and handoff instructions;
- partner contact/issue route;
- weekly report with attributed orders, failures and repeat behavior;
- no payout model until attribution accuracy and unit economics are proven;
- commission/payout, if later approved, uses an audited ledger rather than CSV
  arithmetic.

## Tests and verification

Client:

- EGP remains the charged total across every display currency;
- rounding/display consistency across menu, cart, checkout and receipt;
- offline/stale/missing FX;
- five-language/RTL copy and truncation;
- anonymous-to-user attribution merge;
- malicious deep links/partner codes;
- review eligibility/cooldown and negative-experience suppression.

Server:

- rate feed validation, duplicate observations, jump/stale alerts;
- public read/private write RLS;
- partner attribution idempotency/fraud;
- no cross-user review state;
- order attribution cannot be rewritten by the customer.

Production proof:

- one fresh release sends the expected event dictionary;
- PostHog identity merge does not double-count the user;
- one partner QR reaches an attributed test order;
- rate timestamp/source/stale behavior is visible;
- one eligible device reaches the native review request without false success
  claims.

## Rollout and rollback

1. Correct misleading copy immediately.
2. Verify PostHog on a fresh device build.
3. Add acquisition links and event dashboards.
4. Add server FX feed in shadow beside labeled static display.
5. Switch display to server rates after stale/failure tests.
6. Enable review eligibility after delivered-order evidence.
7. Pilot partner attribution before any payout promise.

Rollback falls back to clearly labeled approximate/static display or EGP only.
It never changes charged order totals. Attribution and review features can be
disabled without losing order/payment functionality.

## Acceptance

- No customer-facing surface claims live FX or card acceptance without evidence.
- Menu, cart, checkout and receipt show consistent EGP authority and display
  conversion.
- Rate freshness and failures are observable and degrade honestly.
- One production device produces a complete, privacy-safe conversion funnel.
- Acquisition survives registration and attaches to orders without client
  authority.
- Review prompting is positive-moment, frequency-capped and not review-gated.
- A partner QR can be measured from first touch through repeat order and
  contribution.
