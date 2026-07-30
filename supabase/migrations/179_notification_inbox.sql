-- 179_notification_inbox.sql
--
-- Package 03 Slice H — the notification inbox, read side.
--
-- ================= THIS SHIPS AGAINST AN EMPTY TABLE, DELIBERATELY =================
-- The spec gates this slice twice: "build only on push_messages AFTER the transport
-- is truthful", and "add inbox only if pilot evidence justifies it". Neither gate is
-- met at the time of writing: push_messages has ZERO rows, because the expo-push
-- deploy that writes them has not happened, so every notification still goes out via
-- the old direct-send path that records nothing.
--
-- The owner chose to build it anyway, knowing that. What follows is therefore
-- correct against the SCHEMA but has never been exercised against a real message,
-- and the client half ships behind a flag that defaults OFF — an always-on inbox
-- that renders blank for every customer reads as a broken feature, not an empty one.
--
-- ================= WHY READ-STATE IS A SEPARATE TABLE =================
-- push_messages is ONE ROW PER LOGICAL EVENT (mig 171), not per recipient: a single
-- 'order_placed_merchant' message addresses every staff member of a restaurant. So
-- read-state cannot be a column on it — five people would share one read_at, and the
-- first to open would mark it read for everyone.
--
-- notification_reads is therefore per (user, message). It also keeps the two
-- timestamps honestly separate:
--   * push_messages.opened_at  — attribution. WHEN THE PUSH WAS TAPPED. Written by
--     record_notification_open (mig 175), first-open-wins, never moved.
--   * notification_reads.read_at — the customer's own UI state. They may read a
--     message in the inbox having never tapped the push, or tap the push and never
--     open the inbox. Conflating them would corrupt attribution with UI activity.
--
-- ================= WHAT THE INBOX MUST NOT SHOW =================
-- The spec: "inbox presence does not bypass marketing consent." A marketing message
-- that was SUPPRESSED (no consent, quiet hours, cap) must never appear — surfacing
-- it in an inbox is delivering the marketing by another route, and the consent the
-- customer withheld would be meaningless.
--
-- So the read path filters on status: only messages that actually went somewhere
-- (complete / partly_failed) are listed. 'suppressed' and 'failed' are excluded, as
-- is anything past retain_until, which is what makes retention real rather than
-- decorative.

-- ---------------------------------------------------------------------------
-- 1. Per-recipient read state
-- ---------------------------------------------------------------------------
create table if not exists public.notification_reads (
  user_id    uuid not null references public.users(id) on delete cascade,
  message_id uuid not null references public.push_messages(id) on delete cascade,
  read_at    timestamptz not null default now(),
  primary key (user_id, message_id)
);

comment on table public.notification_reads is
  'Per-recipient inbox read state. Separate from push_messages because that table is one row per LOGICAL event, not per recipient — a merchant message addressed to five staff would otherwise share one read_at and the first opener would mark it read for everyone. Also kept distinct from push_messages.opened_at, which is push-tap ATTRIBUTION (mig 175): a customer may read in the inbox without ever tapping, or tap without ever opening the inbox, and conflating the two would corrupt attribution with UI activity. Package 03 Slice H, mig 179.';

create index if not exists notification_reads_user_idx
  on public.notification_reads (user_id, read_at desc);

-- House rule 5b: ALTER DEFAULT PRIVILEGES grants arwdDxtm to anon/authenticated on
-- every new public table, and TRUNCATE ignores RLS. Revoke before granting.
revoke all on table public.notification_reads from public, anon, authenticated;
alter table public.notification_reads enable row level security;

-- Read-state is the customer's OWN data, so unlike every other push table this one
-- gets a real owner policy. Writes still go through the RPC below so a client cannot
-- mark someone else's message read by inserting a row with their user_id.
grant select on table public.notification_reads to authenticated;

drop policy if exists notification_reads_owner_select on public.notification_reads;
create policy notification_reads_owner_select
  on public.notification_reads for select to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 2. Recipiency, factored out
-- ---------------------------------------------------------------------------
-- Mig 175 resolves "is this caller a recipient" inline. Slice H needs the identical
-- rule in two more places, and three copies of a security check is how they drift —
-- so it lives here once and mig 175's logic is mirrored exactly: push_attempts is
-- authoritative (it records real sends), with recipient_user_ids as the fallback for
-- a message that produced no attempt.
create or replace function public.is_notification_recipient(p_user_id uuid, p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select p_user_id is not null and p_message_id is not null and (
    exists (select 1 from public.push_attempts a
             where a.message_id = p_message_id and a.recipient_user_id = p_user_id)
    or
    exists (select 1 from public.push_messages m
             where m.id = p_message_id
               and m.recipient_user_ids is not null
               and p_user_id = any(m.recipient_user_ids))
  );
$function$;

revoke all on function public.is_notification_recipient(uuid, uuid) from public, anon, authenticated;

comment on function public.is_notification_recipient(uuid, uuid) is
  'Was this user a recipient of this message? Factored out of record_notification_open (mig 175) because Slice H needs the identical rule in two more places and three copies of a security check is how they drift. push_attempts is authoritative; recipient_user_ids is the fallback for a message that never produced an attempt. Mig 179.';

-- ---------------------------------------------------------------------------
-- 3. The inbox read
-- ---------------------------------------------------------------------------
-- KEYSET pagination, not OFFSET. An inbox is append-heavy at the head, so OFFSET
-- drifts: a message arriving between page 1 and page 2 shifts everything down and
-- the customer sees a duplicate. (queued_at, id) is stable and indexed.
--
-- NO BODY TEXT IS RETURNED for ordinary events, because none is stored: mig 171 keeps
-- custom_title/custom_body only for campaigns, and every other event localizes at
-- DISPATCH from the edge function's copy.ts. The client therefore receives the event
-- name and localizes it with the same table the push used — which is also what keeps
-- the inbox honest, showing the same words the notification did rather than a second
-- rendering that could drift from it.
create or replace function public.my_notification_inbox(
  p_limit         integer default 20,
  p_before_queued timestamptz default null,
  p_before_id     uuid default null
)
returns table (
  id           uuid,
  event        text,
  category     text,
  order_id     uuid,
  route        text,
  vertical     text,
  custom_title text,
  custom_body  text,
  queued_at    timestamptz,
  opened_at    timestamptz,
  read_at      timestamptz
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select m.id, m.event, m.category, m.order_id, m.route, m.vertical,
         m.custom_title, m.custom_body, m.queued_at, m.opened_at, r.read_at
    from public.push_messages m
    left join public.notification_reads r
      on r.message_id = m.id and r.user_id = (select auth.uid())
   where public.is_notification_recipient((select auth.uid()), m.id)
     -- Only messages that actually went somewhere. 'suppressed' is excluded because
     -- surfacing a suppressed MARKETING message in an inbox delivers it by another
     -- route and makes the withheld consent meaningless — the spec's "inbox presence
     -- does not bypass marketing consent". 'failed' is excluded because the customer
     -- never received it and showing it would be a lie about what we sent.
     and m.status in ('complete', 'partly_failed')
     -- Retention, made real rather than decorative.
     and m.retain_until > now()
     -- Keyset page boundary. Both halves required: queued_at alone is not unique.
     and (p_before_queued is null
          or (m.queued_at, m.id) < (p_before_queued, coalesce(p_before_id, m.id)))
   order by m.queued_at desc, m.id desc
   limit least(greatest(coalesce(p_limit, 20), 1), 50);
$function$;

revoke all on function public.my_notification_inbox(integer, timestamptz, uuid) from public, anon;
grant execute on function public.my_notification_inbox(integer, timestamptz, uuid) to authenticated;

comment on function public.my_notification_inbox(integer, timestamptz, uuid) is
  'The caller''s notification history. Recipiency is resolved server-side from push_attempts/recipient_user_ids — there is no user-id parameter. Excludes SUPPRESSED messages, because surfacing a suppressed marketing message in an inbox delivers it by another route and makes the withheld consent meaningless (the spec''s "inbox presence does not bypass marketing consent"); excludes FAILED ones because the customer never received them; excludes anything past retain_until. Returns the EVENT rather than body text: ordinary events have no stored copy (mig 171 keeps custom_* for campaigns only) and localize at dispatch, so the client localizes with the same table the push used and the inbox cannot drift from what was actually sent. Keyset pagination on (queued_at, id) because an append-heavy inbox makes OFFSET show duplicates. Mig 179.';

-- ---------------------------------------------------------------------------
-- 4. Mark read
-- ---------------------------------------------------------------------------
-- Writes go through here rather than a client INSERT so a caller cannot mark a
-- message read for somebody else by supplying their user_id. Same silence-on-refusal
-- rule as mig 175: a non-recipient gets no error, because a distinct refusal would
-- let someone enumerate real message ids by guessing uuids.
create or replace function public.mark_notification_read(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_user uuid := auth.uid();
begin
  if v_user is null or p_message_id is null then return; end if;
  if not public.is_notification_recipient(v_user, p_message_id) then return; end if;

  -- First read wins and is never moved: "when did they first see this" is the
  -- question, and re-opening a message should not rewrite the answer. Same rule as
  -- opened_at in mig 175, for the same reason.
  insert into public.notification_reads (user_id, message_id)
  values (v_user, p_message_id)
  on conflict (user_id, message_id) do nothing;
end;
$function$;

revoke all on function public.mark_notification_read(uuid) from public, anon;
grant execute on function public.mark_notification_read(uuid) to authenticated;

comment on function public.mark_notification_read(uuid) is
  'Marks one message read for the CALLER. Goes through an RPC rather than a client INSERT so nobody can mark a message read for someone else by supplying their user_id. A non-recipient gets SILENCE, not an error — a distinct refusal would let a caller enumerate real message ids by guessing uuids (the oracle mig 162 closed). First read wins and is never moved, matching opened_at. Mig 179.';

-- ---------------------------------------------------------------------------
-- 5. Unread count
-- ---------------------------------------------------------------------------
-- Its own function so a badge does not have to fetch a page of messages to count
-- them, and so the same visibility rules apply in exactly one place.
create or replace function public.my_unread_notification_count()
returns integer
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select count(*)::int
    from public.push_messages m
   where public.is_notification_recipient((select auth.uid()), m.id)
     and m.status in ('complete', 'partly_failed')
     and m.retain_until > now()
     and not exists (select 1 from public.notification_reads r
                      where r.message_id = m.id and r.user_id = (select auth.uid()));
$function$;

revoke all on function public.my_unread_notification_count() from public, anon;
grant execute on function public.my_unread_notification_count() to authenticated;

comment on function public.my_unread_notification_count() is
  'Unread count for a badge, so the client need not fetch a page to count it — and so the suppressed/failed/retention visibility rules live in one place rather than being re-stated per caller. Mig 179.';
