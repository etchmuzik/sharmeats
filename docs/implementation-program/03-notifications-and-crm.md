# Package 03 — notifications, consent and lifecycle CRM

## Outcome

Every notification is correctly categorized, consented where required,
traceable through Expo tickets and receipts, retryable when safe, accurately
named in operator UI and attributable when opened.

Expo receipts prove handoff to APNs/FCM, not that a device displayed the
notification or that a human saw it. The schema and copy must preserve that
distinction.

Official implementation reference:
<https://docs.expo.dev/push-notifications/sending-notifications/>.

## Current evidence

- migration 137 and `expo-push` v14 fixed empty-order campaign rejection and
  bad credit/referral routes.
- migration 137 calls an edge-function HTTP 2xx `delivered`; that is transport
  acceptance, not device delivery.
- the edge function parses tickets and prunes immediately rejected dead tokens
  but does not store ticket IDs or poll receipts.
- push permission is requested during root startup before a contextual primer.
- migration 138 and its client preference UI are live in commit `b245b8e`.
  Marketing defaults off, is filtered server-side and respects quiet hours.
- migration 138 nevertheless ships `transactional=false` as a visible/persisted
  choice while the senders intentionally ignore it.
- live `in_quiet_hours()` is declared `IMMUTABLE` while reading `now()`.

## Expected repository surfaces

- corrective and additive migrations after 138, generated DB types and DB
  security tests;
- every current notification-producing RPC/trigger, derived from its deployed
  body before replacement;
- `supabase/functions/expo-push` plus a receipt poller/dispatcher function and
  function tests;
- admin campaign/operator pages and types;
- customer root notification registration, settings, routing and analytics;
- customer data repositories/types, five locale files and device tests;
- cron/scheduler configuration and notification operations runbook.

## Slice A — review and finish notification preferences

Before extending or relying on migration 138, Claude must ship a corrective
migration/client change for these review items:

### A1. No misleading transactional switch

The draft stores `transactional=false` while intentionally ignoring it in all
transactional senders. A switch that says off while order pushes continue is
another fake control.

Choose and implement one explicit contract:

**Recommended v1 contract**

- Order/delivery/security notifications are operational and not individually
  disabled in-app.
- Settings shows their OS permission/status and an “Open device settings”
  action, not an on/off switch.
- Marketing is a true opt-in switch enforced server-side.
- Quiet hours apply only to marketing.

Do not persist an unused transactional preference. Remove the draft column/RPC
parameter/UI toggle unless a complete category-by-category enforcement design
is approved.

If the owner instead chooses a transactional opt-out, define a hard exception
list for active-order safety and make the UI explain it. Every sender must use
the same categorization function.

### A2. Correct function volatility

`in_quiet_hours` reads `now()`. It must not be declared `IMMUTABLE`; use
`STABLE`. Add a test proving results change across controlled wall-clock inputs.
Prefer a pure helper accepting `p_at timestamptz` plus a stable wrapper using
`now()` so tests do not depend on the real clock.

### A3. Consent model

Marketing remains opt-in:

- absent row = false;
- enabling stamps server time, consent policy version and source;
- disabling clears active consent but retains an append-only consent event;
- support/import cannot silently manufacture customer consent;
- locale/timezone changes do not change consent;
- account deletion removes or anonymizes records per the privacy policy.

Use two layers:

```text
notification_preferences  -- effective current state
notification_consent_events -- append-only audit: granted/revoked/version/source
```

Only an owner-bound RPC writes consent provenance. Direct table writes are
revoked. New public tables get explicit grants and RLS.

### A4. Campaign enforcement and operator truth

`send_push_campaign` must:

- resolve raw segment count;
- suppress no consent, quiet hours, cap, invalid/no token separately;
- store each suppression count;
- return a campaign ID plus counts, not one ambiguous integer;
- never expose recipient identities in the admin UI;
- allow dry-run/audience preview without sending;
- use idempotency to prevent a double-click from sending twice.

Admin UI states:

- draft
- scheduled
- resolving
- queued
- provider accepted
- partly failed
- failed
- cancelled

“Delivered” is reserved for a stronger source and should not be used for an
edge-function 2xx or Expo receipt.

## Slice B — contextual permission and device settings

Remove the unconditional permission request from `app/_layout.tsx`.

Flow:

1. Configure notification handlers without prompting.
2. Show a five-language primer at a value moment:
   - after first order placement for order tracking; or
   - when the user explicitly enables marketing.
3. Explain order updates and offers separately.
4. Ask the OS only after the user continues.
5. Register the token only after granted/provisional permission.
6. If denied, show current status and “Open device settings”; do not repeatedly
   prompt.
7. Record `push_permission` with prompt context/result, not token.

Test fresh install, denied, later enabled in Settings, provisional iOS
permission, Android channel setup and shared-device sign-out/token transfer.

## Slice C — durable push outbox and attempts

Add:

```text
push_messages
  id uuid
  event text
  recipient_user_id uuid
  order_id uuid null
  route text null
  title_key/custom_title
  body_key/custom_body
  locale
  category operational|marketing
  idempotency_key text unique
  campaign_id uuid null
  queued_at, expires_at
  status queued|processing|complete|partly_failed|failed|suppressed
  suppression_reason

push_attempts
  id uuid
  message_id uuid
  push_token_id uuid
  attempt_no smallint
  expo_ticket_id text null
  status queued|expo_accepted|provider_accepted|retryable_failed|permanent_failed
  error_code, error_detail
  next_attempt_at
  sent_at, receipt_checked_at, settled_at
  unique(message_id, push_token_id, attempt_no)
```

Security:

- service-role/definer writers only;
- users may read only their own message history if/when inbox ships;
- admins see aggregate/detail needed for operations;
- body copy must not leak private order/support information into broad logs;
- retention period is explicit.

All existing DB triggers/RPCs enqueue one idempotent logical message instead of
calling `net.http_post` independently. The dispatcher owns transport.
Financial/order transactions must commit even when push transport is down.

Use an event-specific idempotency key such as
`order:<id>:status:<status>:recipient:<user>` so retries do not create duplicate
logical messages.

## Slice D — sender, ticket storage and retries

Refactor `expo-push` or add a dedicated dispatcher:

1. claim queued attempts with `FOR UPDATE SKIP LOCKED`/an owner-bound RPC;
2. localize by user locale;
3. validate route against an allow-list;
4. chunk sends at Expo’s 100-message limit;
5. correlate positional tickets to token/attempt rows;
6. store successful ticket IDs;
7. permanently fail invalid payload/credentials errors;
8. remove tokens on `DeviceNotRegistered`;
9. retry HTTP 429/5xx/network and documented retryable codes with capped
   exponential backoff plus jitter;
10. cap attempts and expire stale messages.

Do not retry:

- invalid credentials/payload;
- message too big;
- wrong experience/project token;
- expired business event;
- permanent unregistered token.

Add a dead-letter/operator queue after the retry cap.

## Slice E — receipt poller

Add an internally authenticated Edge Function, for example
`expo-push-receipts`, scheduled by cron.

Behavior:

- select `expo_accepted` attempts at least 15 minutes old and under 24 hours;
- request at most 1,000 receipt IDs per Expo call;
- mark receipt `ok` as `provider_accepted`;
- map permanent/retryable receipt errors;
- prune `DeviceNotRegistered`;
- retry only while the original business event is still valuable;
- mark no receipt by the retention deadline as expired/unconfirmed;
- update parent message/campaign aggregates transactionally;
- alert on credential/project-wide failure, not every individual dead token.

Receipt `ok` means APNs/FCM accepted the notification. It is still not
human/device-display proof.

## Slice F — notification open attribution

Include `messageId`, bounded `event`, and allow-listed `route` in payload data.

Client:

- validate route;
- record `notification_opened` before navigation;
- call an owner-bound idempotent
  `record_notification_open(p_message_id)` RPC;
- store `opened_at`/first-open only for the message’s recipient;
- attach campaign ID and message ID to subsequent funnel events for a bounded
  attribution window;
- never trust a payload’s user ID.

Test killed/background/foreground opens, duplicate taps, old binaries without
message ID and malicious routes.

## Slice G — lifecycle CRM

After consent, outbox and attribution:

- exact reorder reminder;
- abandoned cart;
- favourite restaurant reopened;
- saved item back in stock;
- real saved-item/restaurant offer;
- lapsed-customer win-back.

Every producer uses:

- marketing consent;
- quiet hours;
- global and per-event frequency caps;
- active-order suppression;
- current restaurant/service-area/catalog validity;
- campaign/lifecycle idempotency;
- holdout group support for incremental measurement.

Add admin:

- draft/test send;
- schedule/cancel;
- five-language preview;
- audience preview and suppressions;
- provider-accepted/failure/open/order funnel;
- no raw “sent = segment size” metric.

## Slice H — notification inbox, last

Build only on `push_messages` after the transport is truthful.

- customer reads their own retained messages;
- unread/read state is user-owned;
- operational and marketing labels;
- deep links use the same allow-list;
- expired order actions degrade safely;
- pagination and retention;
- inbox presence does not bypass marketing consent.

## Tests and verification

Database:

- owner/cross-user RLS;
- consent event immutability;
- no-row default marketing false;
- quiet hours including midnight wrap and timezone error;
- campaign raw/eligible/suppressed counts;
- idempotent enqueue and open;
- old binaries/senders.

Edge:

- 100-message chunking and 1,000-receipt chunking;
- positional ticket correlation;
- 429/5xx backoff;
- every Expo error class;
- receipt missing/expired;
- token pruning;
- partial batch failure;
- secret failure closed.

Client:

- primer flow;
- real preference state/retry;
- OS-denied status;
- all routes and malicious route rejection;
- open attribution;
- five locales/RTL.

Physical devices:

- iOS and Android, foreground/background/killed;
- deny then enable in OS settings;
- uninstall/dead-token observation when feasible;
- at least one ticket and later receipt visible in operator UI.

## Rollout order

1. Correct migration 138 volatility and the misleading transactional UI/state.
2. Re-verify the live marketing-default-off server enforcement.
3. Ship client settings/primer.
4. Add outbox/attempt schema.
5. Migrate senders to enqueue.
6. Deploy dispatcher and receipt poller.
7. Add open attribution.
8. Enable one lifecycle job with a holdout.
9. Add campaign scheduling/test send.
10. Add inbox only if pilot evidence justifies it.

## Acceptance gate

- marketing cannot send without recorded consent;
- no visible preference lies about enforcement;
- tickets and receipts are durably correlated per token;
- retryable failures retry and permanent failures do not;
- operator language distinguishes Expo/provider acceptance from user open;
- notification open → order conversion is measurable;
- duplicate logical notifications are prevented;
- old app builds continue safe order routing;
- all five locales and the device matrix pass.
