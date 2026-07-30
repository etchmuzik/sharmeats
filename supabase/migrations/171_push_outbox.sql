-- 171_push_outbox.sql
--
-- Package 03 Slice C — durable push outbox and per-token attempts.
--
-- ================= THE ACTUAL BUG THIS FIXES =================
-- Not the one the spec describes. The spec says financial/order transactions
-- must commit even when push transport is down, implying they cannot today; all
-- 15 net.http_post senders already carry `exception when others` guards
-- (verified 2026-07-30 against pg_get_functiondef for each), so that is already
-- true. The real defect is in supabase/functions/expo-push/index.ts:
--
--   * tickets are parsed and then DISCARDED (~line 279). No ticket id is stored,
--     so there is nothing to ask Expo about later. Receipt polling is impossible
--     by construction, which is why Slice E could not be built before this.
--   * a non-OK Expo response `continue`s past the whole chunk (~line 274). A
--     batch lost to a 429 or a 5xx is lost SILENTLY and PERMANENTLY -- no row
--     anywhere records that those customers were owed a notification.
--
-- So the point of these tables is to make an undelivered push a durable, visible
-- fact that something can retry, rather than a line in a log nobody reads.
--
-- ================= WHY A MESSAGE IS NOT PER-RECIPIENT =================
-- The spec's field list puts `recipient_user_id` on the message. That does not
-- fit how this system sends. notify_order_status_event posts ONE 'order_placed_
-- merchant' event addressed to EVERY staff member of a restaurant, and for
-- customer events it sends no recipient at all -- the edge function resolves the
-- order's customer itself. Recipients, preferences and tokens are all resolved at
-- DISPATCH time, not by the sender.
--
-- Forcing one row per recipient would therefore mean either fanning out inside
-- each sender (which breaks the natural idempotency key -- the sender does not
-- know the recipient set) or leaving the column null most of the time.
--
-- So: push_messages is ONE ROW PER LOGICAL EVENT. `recipient_user_ids` is an
-- optional hint for the senders that already know their audience; when it is
-- null the dispatcher resolves recipients exactly as expo-push does today.
-- push_attempts then holds the real per-token rows, created at dispatch.
--
-- ================= IDEMPOTENCY =================
-- The key is derived from what the SENDER knows: `order:<id>:status:<status>`.
-- A trigger that fires twice for the same transition therefore enqueues once.
-- It deliberately does NOT include the recipient (unknown at enqueue) or a
-- timestamp (which would defeat the purpose).
--
-- During the parallel-run period senders BOTH enqueue here and keep their
-- existing direct send, so nothing regresses if the dispatcher misbehaves. That
-- makes the unique key load-bearing in a second way: when the direct path is
-- eventually removed, replaying a message cannot double-send.

-- ---------------------------------------------------------------------------
-- push_messages — one logical notification
-- ---------------------------------------------------------------------------
create table if not exists public.push_messages (
  id             uuid primary key default gen_random_uuid(),
  -- Matches the event vocabulary in supabase/functions/expo-push/copy.ts. Kept
  -- as text rather than an enum on purpose: a new event must not require a
  -- migration in lockstep with an edge-function deploy, and an unknown event
  -- already degrades to generic copy rather than failing.
  event          text not null,
  -- Null = "dispatcher resolves the audience", which is what expo-push does for
  -- every customer-facing event today. Non-null = the sender already knew
  -- (merchant staff, driver cohorts).
  recipient_user_ids uuid[] null,
  order_id       uuid null references public.orders(id) on delete set null,
  campaign_id    uuid null,
  -- Deep-link target. Validated against the client allow-list at dispatch, not
  -- here: the allow-list lives with the client that has to honour it.
  route          text null,
  -- Campaign copy overrides the event's own localized copy. NULL for ordinary
  -- events, which localize per recipient at dispatch from copy.ts.
  custom_title   text null,
  custom_body    text null,
  -- Which vertical the push is about, so grocery/pharmacy copy is not phrased in
  -- restaurant language. Mirrors the `vertical` field expo-push already accepts.
  vertical       text null,
  -- operational vs marketing decides which consent rule applies at dispatch.
  -- Marketing fails CLOSED (no consent, no send); operational fails OPEN.
  category       text not null default 'operational'
                 check (category in ('operational', 'marketing')),
  idempotency_key text not null unique,
  status         text not null default 'queued'
                 check (status in ('queued','processing','complete','partly_failed','failed','suppressed')),
  -- Why nothing was sent, when status = 'suppressed'. Bounded vocabulary so it
  -- can be counted in operator UI; never free text from an error.
  suppression_reason text null
                 check (suppression_reason is null or suppression_reason in
                        ('no_consent','quiet_hours','no_token','frequency_cap','opted_out','expired','no_recipient')),
  queued_at      timestamptz not null default now(),
  -- After this, the business event is stale and retrying is worse than giving up:
  -- a "your driver is arriving" push six hours late is misinformation, not a
  -- late notification. The dispatcher refuses to send past this.
  expires_at     timestamptz not null default now() + interval '6 hours',
  settled_at     timestamptz null,
  -- Retention horizon, separate from expires_at: expiry stops SENDING, retention
  -- governs DELETION. Kept longer so an operator can still investigate why a
  -- customer never heard about an order.
  retain_until   timestamptz not null default now() + interval '30 days'
);

comment on column public.push_messages.idempotency_key is
  'Derived from what the sender knows, e.g. order:<id>:status:<status>. Excludes the recipient (unknown at enqueue) and any timestamp (which would defeat it). Load-bearing twice: it dedupes a trigger that fires twice, and it stops a replay double-sending once the parallel direct-send path is removed. Mig 171.';
comment on column public.push_messages.expires_at is
  'Stops SENDING. A delivery-critical push hours late is misinformation, not a late notification, so the dispatcher refuses past this. Distinct from retain_until, which governs deletion. Mig 171.';
comment on column public.push_messages.category is
  'operational vs marketing. Decides the consent rule at dispatch: marketing fails CLOSED (absent consent means no send), operational fails OPEN (a failed preference lookup still sends). Opposite defaults, deliberately — mirrors expo-push/prefs.ts. Mig 171.';

create index if not exists push_messages_claimable_idx
  on public.push_messages (status, queued_at) where status = 'queued';
create index if not exists push_messages_order_idx on public.push_messages (order_id);
create index if not exists push_messages_campaign_idx on public.push_messages (campaign_id);
create index if not exists push_messages_retention_idx on public.push_messages (retain_until);

-- ---------------------------------------------------------------------------
-- push_attempts — one row per (message, token, try)
-- ---------------------------------------------------------------------------
create table if not exists public.push_attempts (
  id             uuid primary key default gen_random_uuid(),
  message_id     uuid not null references public.push_messages(id) on delete cascade,
  -- ON DELETE SET NULL, not cascade: when a dead token is pruned we must KEEP
  -- the attempt row, because "we tried and the device was gone" is exactly the
  -- history an operator needs. Cascading would erase the evidence.
  push_token_id  uuid null references public.push_tokens(id) on delete set null,
  -- The token text is snapshotted because push_token_id goes null on pruning and
  -- the row would otherwise lose all trace of WHERE it was sent.
  token_snapshot text not null,
  recipient_user_id uuid null references public.users(id) on delete set null,
  attempt_no     smallint not null default 1 check (attempt_no between 1 and 10),
  -- The whole reason these tables exist. Null until Expo answers.
  expo_ticket_id text null,
  status         text not null default 'queued'
                 check (status in ('queued','expo_accepted','provider_accepted',
                                   'retryable_failed','permanent_failed','expired')),
  -- Expo's documented error code (DeviceNotRegistered, MessageTooBig, ...).
  error_code     text null,
  -- Bounded detail for operators. NEVER the notification body: a support reply
  -- or an order note would leak private content into a broad operational log.
  error_detail   text null check (error_detail is null or length(error_detail) <= 500),
  next_attempt_at timestamptz null,
  sent_at        timestamptz null,
  receipt_checked_at timestamptz null,
  settled_at     timestamptz null,
  created_at     timestamptz not null default now(),
  -- One row per try per token. Makes a retry explicit rather than an overwrite,
  -- so "this took three attempts" stays visible.
  unique (message_id, push_token_id, attempt_no)
);

comment on table public.push_attempts is
  'Package 03 Slice C. One row per (message, token, attempt). Stores the Expo ticket id that expo-push used to discard, which is the precondition for receipt polling (Slice E). push_token_id is ON DELETE SET NULL and the token text is snapshotted, because pruning a dead token must not erase the evidence that we tried it. error_detail is bounded and must never carry the notification body — a support reply or order note would leak private content into an operational log. Definer/service-role writers only. Mig 171.';
comment on column public.push_attempts.expo_ticket_id is
  'Expo''s ticket id. An Expo ticket means Expo ACCEPTED the message; a later receipt means APNs/FCM accepted it. NEITHER means a device displayed it or a human saw it, and no column here should ever be named "delivered". Mig 171.';
comment on column public.push_attempts.status is
  'queued -> expo_accepted (ticket ok) -> provider_accepted (receipt ok). retryable_failed is re-tried with backoff until the attempt cap or the message expires; permanent_failed never is. Mig 171.';

create index if not exists push_attempts_message_idx on public.push_attempts (message_id);
create index if not exists push_attempts_ticket_idx
  on public.push_attempts (expo_ticket_id) where expo_ticket_id is not null;
-- The receipt poller's query: accepted attempts awaiting a receipt.
create index if not exists push_attempts_awaiting_receipt_idx
  on public.push_attempts (sent_at) where status = 'expo_accepted';
-- The retry query.
create index if not exists push_attempts_retry_idx
  on public.push_attempts (next_attempt_at) where status = 'retryable_failed';

-- ---------------------------------------------------------------------------
-- Grants — REVOKE FIRST
-- ---------------------------------------------------------------------------
-- ALTER DEFAULT PRIVILEGES on this database grants the full arwdDxtm set on every
-- new public table to anon and authenticated (verified 2026-07-27 via
-- pg_default_acl; re-confirmed by mig 139's assert and mig 168's). So NOT
-- granting is a no-op and TRUNCATE — which IGNORES row-level security — would let
-- any anon-key holder erase the entire notification history in one statement.
revoke all on public.push_messages from public, anon, authenticated;
revoke all on public.push_attempts from public, anon, authenticated;

-- No client grant at all, not even SELECT. Both tables are written by SECURITY
-- DEFINER senders and read by the dispatcher/poller under the service role.
-- Customer-visible history is Slice H's job (an inbox over push_messages) and
-- will get its own owner-scoped read path when the transport is truthful; until
-- then there is nothing a client legitimately reads here.
alter table public.push_messages enable row level security;
alter table public.push_attempts enable row level security;

-- RLS on with no policy = deny-all for non-superusers, which is the intent.
-- Stated explicitly because "RLS enabled, no policies" reads like an oversight;
-- combined with the revoke above (TRUNCATE ignores RLS) it is deliberate.
comment on table public.push_messages is
  'Package 03 Slice C. One row per LOGICAL notification, not per recipient: this system resolves recipients, preferences and tokens at dispatch (expo-push resolves an order''s customer itself, and one merchant event addresses every staff member), so a per-recipient row would force senders to fan out without knowing their audience. recipient_user_ids is an optional hint for senders that DO know. Exists because expo-push previously parsed Expo tickets and discarded them, and skipped whole chunks on a non-OK response — so a push lost to a 429 was lost silently with no record that anyone was owed it. RLS is enabled with NO policies deliberately: no client reads these, and the revoke above matters because TRUNCATE ignores RLS. Slice H''s inbox will add an owner-scoped read path. Mig 171.';
