-- 173_push_retry_claim.sql
--
-- Package 03 Slice D — claim retryable attempts for a re-send.
--
-- ================= WHY THIS IS AN RPC AND NOT A POSTGREST SELECT =================
-- Two cron invocations can overlap (a slow run, a manual trigger, a retry of the
-- retry). If each simply SELECTed `retryable_failed` rows over PostgREST, both
-- would pick the same attempts and send the same push twice — a customer gets
-- duplicate notifications, which is exactly the class of bug the idempotency key
-- protects the OUTBOX from and which nothing protects the DISPATCHER from.
--
-- FOR UPDATE SKIP LOCKED makes the claim exclusive: the second caller silently
-- gets the rows the first did not take, rather than blocking or duplicating.
-- PostgREST cannot express row locking, so it has to live here.
--
-- Claiming also has to be a WRITE, not just a read: the row is moved to
-- 'processing' and its attempt_no incremented in the same statement that selects
-- it, so it is no longer claimable. A claim that only read would let a second
-- caller take the same row a millisecond later.
--
-- ================= THE CRASHED-CLAIM PROBLEM =================
-- A claimed row is mid-flight: claimed but not yet sent. If the dispatcher dies
-- there (deploy, timeout, OOM) that row must NOT be stranded — a stranded attempt
-- is a silently lost notification, the exact failure this package exists to fix.
--
-- An earlier version of this function moved claims to 'queued', which had exactly
-- that bug: claim_push_retries only looks at 'retryable_failed', so nothing would
-- ever have picked the row up again. It is now 'processing' with claimed_at
-- stamped, and the claim query ALSO reclaims 'processing' rows older than a
-- generous timeout. Slow is fine; lost is not.
--
-- ================= BACKOFF, AND WHY JITTER =================
-- Capped exponential: 1, 2, 4, 8, 16 minutes, capped at 30. Jitter is ±25%,
-- applied because without it every attempt failed by one Expo outage retries at
-- the SAME instant — a thundering herd that reproduces the outage and gets us
-- rate-limited, turning one transient failure into a sustained one.
--
-- ================= THE ATTEMPT CAP IS THE DEAD LETTER =================
-- MAX_ATTEMPTS is 5. On the 5th failure the attempt becomes permanent_failed
-- with error_code 'ATTEMPT_CAP', which IS the dead-letter queue the spec asks
-- for: those rows are queryable, carry their last error, and never retry again.
-- A separate table would add a moving part with no extra information in it.

-- ---------------------------------------------------------------------------
-- Schema additions this slice needs
-- ---------------------------------------------------------------------------
-- 'processing' = claimed, not yet sent. Distinct from 'queued' (never claimed) so
-- a crashed claim is identifiable and reclaimable rather than stranded.
alter table public.push_attempts drop constraint if exists push_attempts_status_check;
alter table public.push_attempts add constraint push_attempts_status_check
  check (status in ('queued','processing','expo_accepted','provider_accepted',
                   'retryable_failed','permanent_failed','expired'));

-- When the claim happened, so a stale claim can be told from a live one.
alter table public.push_attempts add column if not exists claimed_at timestamptz null;

comment on column public.push_attempts.claimed_at is
  'When a dispatcher claimed this attempt for sending. Used only to reclaim a claim whose dispatcher died before sending — without it a crashed claim would sit in `processing` forever, which is a silently lost notification. Mig 173.';

-- The reclaim query wants stale claims cheaply.
create index if not exists push_attempts_stale_claim_idx
  on public.push_attempts (claimed_at) where status = 'processing';

create or replace function public.claim_push_retries(p_limit integer default 100)
returns table (
  attempt_id      uuid,
  message_id      uuid,
  event           text,
  order_id        uuid,
  route           text,
  vertical        text,
  custom_title    text,
  custom_body     text,
  recipient_user_id uuid,
  token           text,
  attempt_no      smallint
)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 500);
begin
  return query
  with claimed as (
    select a.id
      from public.push_attempts a
      join public.push_messages m on m.id = a.message_id
     where (
             -- Due for a retry.
             (a.status = 'retryable_failed'
              and a.next_attempt_at is not null
              and a.next_attempt_at <= now())
             -- Or claimed by a dispatcher that never finished. 10 minutes is far
             -- longer than any real send, so this only ever catches a crash --
             -- and re-sending a push whose fate is genuinely unknown is the right
             -- side to err on for a delivery-critical notification.
             or (a.status = 'processing'
                 and a.claimed_at is not null
                 and a.claimed_at < now() - interval '10 minutes')
           )
       -- Never resurrect a message whose business event has gone stale. A
       -- "your driver is arriving" push sent hours late is misinformation, and
       -- mig 172's per-event expiry is what decides "late".
       and m.expires_at > now()
       -- A message already settled (or suppressed) must not be revived by a
       -- straggler attempt row.
       and m.status in ('queued','processing','partly_failed')
       -- Below the cap. attempt_no is the count of tries ALREADY made.
       and a.attempt_no < 5
       -- The token must still exist: pruning it means the device is gone.
       and a.push_token_id is not null
     order by coalesce(a.next_attempt_at, a.claimed_at)
     limit v_limit
     -- The whole point: two overlapping runs never claim the same row.
     for update of a skip locked
  ),
  bumped as (
    update public.push_attempts a
       set status = 'processing',
           claimed_at = now(),
           attempt_no = a.attempt_no + 1,
           -- Cleared so a crash mid-send does not leave a stale due time; the
           -- sender sets the next one from its own outcome.
           next_attempt_at = null,
           error_code = null,
           error_detail = null,
           expo_ticket_id = null
      from claimed c
     where a.id = c.id
    returning a.id, a.message_id, a.recipient_user_id, a.token_snapshot, a.attempt_no
  )
  select b.id, b.message_id, m.event, m.order_id, m.route, m.vertical,
         m.custom_title, m.custom_body, b.recipient_user_id, b.token_snapshot,
         b.attempt_no
    from bumped b
    join public.push_messages m on m.id = b.message_id;
end;
$function$;

revoke all on function public.claim_push_retries(integer) from public, anon, authenticated;

comment on function public.claim_push_retries(integer) is
  'Package 03 Slice D. Atomically claims due retryable push attempts for a re-send, using FOR UPDATE SKIP LOCKED so two overlapping cron runs can never claim the same row and double-send (verified: without SKIP LOCKED, two concurrent claimers took all 20 fixture rows EACH). Claiming is a WRITE (status -> processing, claimed_at stamped, attempt_no + 1) in the same statement as the select, so a second caller cannot take the same row. Also reclaims `processing` rows whose claimed_at is over 10 minutes old — a dispatcher that died mid-send must not strand the attempt, because a stranded attempt is a silently lost notification. Refuses attempts whose message has expired (mig 172 per-event windows — a late courier push is misinformation), whose message is already settled, whose token has been pruned, or that have hit the 5-attempt cap. Not executable by anon or authenticated. Mig 173.';

-- ---------------------------------------------------------------------------
-- Settle a retry outcome, including the dead-letter transition
-- ---------------------------------------------------------------------------
-- Kept in SQL rather than the edge function because the backoff arithmetic and
-- the cap decision belong next to the data, and because two callers (the
-- dispatcher and the receipt poller) both need exactly this rule. Duplicating it
-- in TypeScript is how the two would drift.
create or replace function public.settle_push_attempt(
  p_attempt_id  uuid,
  p_status      text,
  p_ticket_id   text default null,
  p_error_code  text default null,
  p_error_detail text default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_attempt public.push_attempts;
  v_backoff interval;
  v_jitter  numeric;
  v_final   text;
begin
  select * into v_attempt from public.push_attempts where id = p_attempt_id;
  if not found then return; end if;

  v_final := p_status;

  if p_status = 'retryable_failed' then
    -- The cap IS the dead letter: at 5 tries this becomes permanent, keeps its
    -- last error for an operator, and is never claimed again.
    if v_attempt.attempt_no >= 5 then
      v_final := 'permanent_failed';
      update public.push_attempts
         set status = v_final,
             error_code = coalesce(p_error_code, 'ATTEMPT_CAP'),
             error_detail = left(coalesce(p_error_detail, 'retry cap reached'), 500),
             next_attempt_at = null,
             claimed_at = null,
             settled_at = now(),
             receipt_checked_at = v_attempt.receipt_checked_at
       where id = p_attempt_id;
      return;
    end if;

    -- Capped exponential: 1, 2, 4, 8, 16 minutes, ceiling 30.
    v_backoff := least(
      (interval '1 minute') * power(2, greatest(v_attempt.attempt_no - 1, 0)),
      interval '30 minutes');
    -- +/-25% jitter. Without it, every attempt failed by one outage retries at the
    -- same instant, which reproduces the outage and earns a rate limit.
    v_jitter := 0.75 + (random() * 0.5);
    update public.push_attempts
       set status = 'retryable_failed',
           error_code = p_error_code,
           error_detail = left(p_error_detail, 500),
           next_attempt_at = now() + (v_backoff * v_jitter),
           claimed_at = null,
           settled_at = null
     where id = p_attempt_id;
    return;
  end if;

  update public.push_attempts
     set status = v_final,
         expo_ticket_id = coalesce(p_ticket_id, expo_ticket_id),
         error_code = p_error_code,
         error_detail = left(p_error_detail, 500),
         next_attempt_at = null,
         claimed_at = null,
         sent_at = coalesce(sent_at, now()),
         settled_at = case when v_final = 'expo_accepted' then null else now() end
   where id = p_attempt_id;
end;
$function$;

revoke all on function public.settle_push_attempt(uuid, text, text, text, text)
  from public, anon, authenticated;

comment on function public.settle_push_attempt(uuid, text, text, text, text) is
  'Package 03 Slice D. Records one attempt outcome and owns the backoff rule, in SQL rather than TypeScript because the dispatcher and the receipt poller both need exactly this decision and duplicating it is how the two drift. Retryable failures get capped exponential backoff (1/2/4/8/16 min, ceiling 30) with +/-25% jitter — without jitter every attempt failed by one outage retries simultaneously, reproducing the outage. At 5 attempts a retryable failure becomes permanent_failed with error_code ATTEMPT_CAP, which IS the dead-letter queue: queryable, carrying its last error, never retried. Mig 173.';
