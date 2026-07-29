-- 175_notification_open.sql
--
-- Package 03 Slice F — record that a notification was opened.
--
-- ================= WHY THIS IS THE FIRST CLIENT-CALLABLE PUSH RPC =================
-- Migrations 171-174 gave the push tables NO client grant at all: they are written
-- by definer senders and read by the dispatcher under the service role. This one is
-- different, and deliberately so — only the device that received a notification
-- knows it was tapped, so the client has to be able to say so.
--
-- That makes the ownership check the whole security story. The rules:
--
--   * the message id comes from an UNTRUSTED payload. It is a uuid, so a caller
--     could guess or replay someone else's. Therefore the function records an open
--     only when auth.uid() is genuinely a recipient of THAT message;
--   * "recipient" is resolved from the message itself, never from anything the
--     client sends. There is no p_user_id parameter, for the same reason
--     upsert_my_cart has none;
--   * a non-recipient caller gets SILENCE, not an error. A distinct "not your
--     message" response would be an existence oracle: guess uuids, and the error
--     tells you which ones are real. The same reasoning mig 162 applied to hidden
--     merchants.
--
-- ================= WHY RECIPIENCY IS TWO CASES =================
-- push_messages.recipient_user_ids is populated only when the SENDER knew the
-- audience (merchant staff, driver cohorts). For every customer-facing event it is
-- null and the audience was resolved at dispatch — so the only durable record of
-- who a message actually went to is push_attempts.recipient_user_id.
--
-- Both are therefore checked. Attempts are authoritative (they record real sends);
-- the array is the fallback for a message whose attempts were pruned or which was
-- suppressed before any attempt existed.
--
-- ================= IDEMPOTENT, AND FIRST-OPEN ONLY =================
-- A tap can fire more than once for one notification: iOS delivers the launch
-- response again on some cold starts, and a user can tap a notification twice
-- before the app settles. So:
--   * opened_at is written ONCE and never moved. "When did they first act on this"
--     is the attribution question; a later re-open would overwrite the answer;
--   * open_count increments, so duplicate taps are visible rather than hidden —
--     which is how you tell "one keen customer" from "the listener firing twice",
--     a bug worth being able to see.

alter table public.push_messages
  add column if not exists opened_at  timestamptz null,
  add column if not exists open_count integer not null default 0;

comment on column public.push_messages.opened_at is
  'When the recipient FIRST opened this notification. Written once and never moved — attribution asks when they first acted, and a re-open would overwrite that answer. Null means never opened (or opened by an old binary that sends no messageId). Mig 175.';
comment on column public.push_messages.open_count is
  'How many times an open was recorded. Increments on every call so duplicate taps stay VISIBLE rather than hidden — that is how a keen customer is told apart from a listener firing twice. Mig 175.';

-- "Which messages were opened", for funnel/campaign reporting.
create index if not exists push_messages_opened_idx
  on public.push_messages (opened_at) where opened_at is not null;

create or replace function public.record_notification_open(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user uuid := auth.uid();
  v_ok   boolean;
begin
  -- No session, no attribution. Anonymous browsing is normal in this app, but an
  -- anonymous caller has no notification of their own to have opened.
  if v_user is null or p_message_id is null then
    return;
  end if;

  -- Is this caller genuinely a recipient? Attempts first (they record real sends),
  -- then the sender-supplied array for messages that never produced an attempt.
  select exists (
           select 1 from public.push_attempts a
            where a.message_id = p_message_id
              and a.recipient_user_id = v_user
         )
         or exists (
           select 1 from public.push_messages m
            where m.id = p_message_id
              and m.recipient_user_ids is not null
              and v_user = any(m.recipient_user_ids)
         )
    into v_ok;

  -- SILENCE for a non-recipient, not an error: a distinct refusal would let a
  -- caller enumerate real message ids by guessing uuids.
  if not v_ok then
    return;
  end if;

  update public.push_messages
     set -- First open wins, permanently.
         opened_at  = coalesce(opened_at, now()),
         open_count = open_count + 1
   where id = p_message_id;
end;
$function$;

-- Client-callable, unlike every other push RPC — see the header. Revoke first,
-- because granting to `authenticated` does not remove the default PUBLIC/anon
-- EXECUTE this database hands out (house rule 3).
revoke all on function public.record_notification_open(uuid) from public, anon, authenticated;
grant execute on function public.record_notification_open(uuid) to authenticated;

comment on function public.record_notification_open(uuid) is
  'Package 03 Slice F. Records that the RECIPIENT opened a notification. The only client-callable push RPC, because only the device that received a notification knows it was tapped — so the ownership check is the whole security story: recipiency is resolved from push_attempts (authoritative) or the sender-supplied recipient_user_ids, never from a client-sent user id, and there is no p_user_id parameter. A non-recipient gets SILENCE rather than an error, because a distinct refusal would let a caller enumerate real message ids by guessing uuids (the oracle mig 162 closed for merchants). Idempotent: opened_at is written once and never moved (attribution asks when they FIRST acted), while open_count increments so duplicate taps stay visible. Mig 175.';
