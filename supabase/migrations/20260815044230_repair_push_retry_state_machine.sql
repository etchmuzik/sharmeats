-- Repair the durable push retry state machine.
--
-- Migrations 173 and 208 mutated a failed attempt in place, then re-drove the
-- normal recipient fan-out path and optimistically marked that historical row
-- expo_accepted as soon as pg_net queued a request. That has four consequences:
--
--   * a parent whose only token failed is `failed`, but the claim function only
--     accepted queued/processing/partly_failed parents, so it was stranded;
--   * retrying one failed device sent again to every token owned by the user;
--   * recordAttempts() tried to insert attempt_no=1 again and collided with the
--     original row, while claim_push_retries had overwritten that row's number;
--   * net.http_post success means only "request queued", not "Expo accepted".
--
-- A retry is now a real new attempt row. The failed row remains immutable,
-- claim_push_retries creates attempt N+1 for that exact token, and expo-push's
-- retry entry point owns the actual Expo exchange and settlement.

-- ---------------------------------------------------------------------------
-- Attempt identity is append-only history
-- ---------------------------------------------------------------------------
create or replace function private.enforce_push_attempt_identity_immutable()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.message_id is distinct from old.message_id
     or new.token_snapshot is distinct from old.token_snapshot
     or new.attempt_no is distinct from old.attempt_no
     or new.created_at is distinct from old.created_at then
    raise check_violation using
      message = 'push attempt identity/history is immutable';
  end if;
  return new;
end;
$function$;

revoke all on function private.enforce_push_attempt_identity_immutable()
  from public, anon, authenticated;

drop trigger if exists push_attempt_identity_immutable on public.push_attempts;
create trigger push_attempt_identity_immutable
before update of message_id, token_snapshot, attempt_no, created_at
on public.push_attempts
for each row execute function private.enforce_push_attempt_identity_immutable();

comment on function private.enforce_push_attempt_identity_immutable() is
  'A push_attempt is one historical transport try. Its message, snapshotted token, attempt number and creation time cannot be rewritten; retries append a new row. Migration 20260815044230.';

-- ---------------------------------------------------------------------------
-- Atomically claim due retries without rewriting their history
-- ---------------------------------------------------------------------------
create or replace function public.claim_push_retries(p_limit integer default 100)
returns table (
  attempt_id        uuid,
  message_id        uuid,
  event             text,
  order_id          uuid,
  route             text,
  vertical          text,
  custom_title      text,
  custom_body       text,
  recipient_user_id uuid,
  token             text,
  attempt_no        smallint
)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
begin
  return query
  with candidates as materialized (
    select a.id,
           a.message_id,
           a.push_token_id,
           a.token_snapshot,
           a.recipient_user_id,
           a.attempt_no,
           a.status
      from public.push_attempts a
      join public.push_messages m on m.id = a.message_id
     where (
             (a.status = 'retryable_failed'
              and a.next_attempt_at is not null
              and a.next_attempt_at <= now()
              and a.attempt_no < 5)
             or
             (a.status = 'processing'
              and a.claimed_at is not null
              and a.claimed_at < now() - interval '10 minutes')
           )
       and a.push_token_id is not null
       and m.expires_at > now()
       -- `failed` is load-bearing: an all-failed, one-token message is the most
       -- important retry case, and mig 173 accidentally excluded it.
       -- Receipt polling historically updates only the attempt. A parent can
       -- therefore still say complete after its latest receipt became
       -- retryable_failed; latest-only attempt selection makes accepting that
       -- stale parent state safe.
       and m.status in ('queued','processing','complete','partly_failed','failed')
       -- Only the newest try for a token may advance the chain. Historical
       -- retryable rows deliberately retain their original next_attempt_at.
       and not exists (
         select 1
           from public.push_attempts newer
          where newer.message_id = a.message_id
            and newer.push_token_id = a.push_token_id
            and newer.attempt_no > a.attempt_no
       )
     order by coalesce(a.next_attempt_at, a.claimed_at), a.created_at
     limit v_limit
     for update of a skip locked
  ),
  -- A dispatcher may die before the Edge worker reports an outcome. Reclaim
  -- that SAME in-flight attempt; creating N+1 would claim a send that never got
  -- an outcome as a completed try and burn the cap without evidence.
  reclaimed as (
    update public.push_attempts a
       set claimed_at = now()
      from candidates c
     where c.status = 'processing'
       and a.id = c.id
    returning a.id,
              a.message_id,
              a.push_token_id,
              a.token_snapshot,
              a.recipient_user_id,
              a.attempt_no
  ),
  -- A due failure becomes a NEW row. The old row is untouched: its error,
  -- due-time and attempt number remain truthful historical evidence.
  appended as (
    insert into public.push_attempts as a (
      message_id,
      push_token_id,
      token_snapshot,
      recipient_user_id,
      attempt_no,
      status,
      claimed_at
    )
    select c.message_id,
           c.push_token_id,
           c.token_snapshot,
           c.recipient_user_id,
           (c.attempt_no + 1)::smallint,
           'processing',
           now()
      from candidates c
     where c.status = 'retryable_failed'
    returning a.id,
              a.message_id,
              a.push_token_id,
              a.token_snapshot,
              a.recipient_user_id,
              a.attempt_no
  ),
  claimed as (
    select * from reclaimed
    union all
    select * from appended
  ),
  mark_parents_processing as (
    update public.push_messages m
       set status = 'processing',
           settled_at = null
     where m.id in (select distinct c.message_id from claimed c)
    returning m.id
  )
  select c.id,
         c.message_id,
         m.event,
         m.order_id,
         m.route,
         m.vertical,
         m.custom_title,
         m.custom_body,
         c.recipient_user_id,
         c.token_snapshot,
         c.attempt_no
    from claimed c
    join public.push_messages m on m.id = c.message_id
   where exists (select 1 from mark_parents_processing mp where mp.id = m.id);
end;
$function$;

revoke all on function public.claim_push_retries(integer)
  from public, anon, authenticated;

comment on function public.claim_push_retries(integer) is
  'Claims due retry chains with FOR UPDATE SKIP LOCKED. A retryable failure appends attempt N+1 for the exact token without changing attempt N; a stale processing row is reclaimed under the same id. Includes failed parents, enforces expiry/cap/latest-only rules, and marks claimed parents processing. Migration 20260815044230.';

-- ---------------------------------------------------------------------------
-- Settle the actual outcome reported by the retry Edge worker
-- ---------------------------------------------------------------------------
create or replace function public.settle_push_attempt(
  p_attempt_id   uuid,
  p_status       text,
  p_ticket_id    text default null,
  p_error_code   text default null,
  p_error_detail text default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_attempt      public.push_attempts;
  v_backoff      interval;
  v_jitter       numeric;
  v_final        text;
  v_has_inflight boolean;
  v_all_success  boolean;
  v_has_success  boolean;
  v_has_retry    boolean;
  v_parent       text;
begin
  if p_status not in ('expo_accepted','retryable_failed','permanent_failed') then
    raise check_violation using message = 'invalid retry push attempt outcome';
  end if;

  select * into v_attempt
    from public.push_attempts
   where id = p_attempt_id
   for update;
  if not found then return; end if;

  -- An async pg_net request can be reclaimed after a worker crash. If both the
  -- original and replacement request eventually arrive, the first real outcome
  -- wins; a delayed duplicate must not overwrite accepted with failed or vice
  -- versa.
  if v_attempt.status <> 'processing' then return; end if;

  v_final := p_status;
  if p_status = 'retryable_failed' and v_attempt.attempt_no >= 5 then
    v_final := 'permanent_failed';
  end if;

  if v_final = 'retryable_failed' then
    v_backoff := least(
      interval '1 minute' * power(2, greatest(v_attempt.attempt_no - 1, 0)),
      interval '30 minutes'
    );
    v_jitter := 0.75 + random() * 0.5;

    update public.push_attempts
       set status = 'retryable_failed',
           expo_ticket_id = null,
           error_code = p_error_code,
           error_detail = left(p_error_detail, 500),
           next_attempt_at = now() + v_backoff * v_jitter,
           sent_at = coalesce(sent_at, now()),
           settled_at = now()
     where id = p_attempt_id;
  elsif v_final = 'expo_accepted' then
    update public.push_attempts
       set status = 'expo_accepted',
           expo_ticket_id = p_ticket_id,
           error_code = null,
           error_detail = null,
           next_attempt_at = null,
           sent_at = coalesce(sent_at, now()),
           settled_at = null
     where id = p_attempt_id;
  else
    update public.push_attempts
       set status = 'permanent_failed',
           expo_ticket_id = p_ticket_id,
           error_code = case
                          when p_status = 'retryable_failed'
                            then coalesce(p_error_code, 'ATTEMPT_CAP')
                          else p_error_code
                        end,
           error_detail = left(
             coalesce(
               p_error_detail,
               case when p_status = 'retryable_failed' then 'retry cap reached' end
             ),
             500
           ),
           next_attempt_at = null,
           sent_at = coalesce(sent_at, now()),
           settled_at = now()
     where id = p_attempt_id;
  end if;

  -- Roll the logical message up from the newest attempt for each token. Old
  -- failures stay visible but cannot make a successful retry look failed.
  with latest as (
    select distinct on (coalesce(a.push_token_id::text, 'snapshot:' || a.token_snapshot))
           a.status
      from public.push_attempts a
     where a.message_id = v_attempt.message_id
     order by coalesce(a.push_token_id::text, 'snapshot:' || a.token_snapshot),
              a.attempt_no desc,
              a.created_at desc
  )
  select coalesce(bool_or(status in ('queued','processing')), false),
         coalesce(bool_and(status in ('expo_accepted','provider_accepted')), false),
         coalesce(bool_or(status in ('expo_accepted','provider_accepted')), false),
         coalesce(bool_or(status = 'retryable_failed'), false)
    into v_has_inflight, v_all_success, v_has_success, v_has_retry
    from latest;

  v_parent := case
    when v_has_inflight then 'processing'
    when v_all_success then 'complete'
    when v_has_success then 'partly_failed'
    else 'failed'
  end;

  update public.push_messages
     set status = v_parent,
         settled_at = case
           when v_has_inflight or v_has_retry then null
           else now()
         end
   where id = v_attempt.message_id;
end;
$function$;

revoke all on function public.settle_push_attempt(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.settle_push_attempt(uuid, text, text, text, text)
  to service_role;

comment on function public.settle_push_attempt(uuid, text, text, text, text) is
  'Settles only an in-flight retry attempt after the Edge worker has a real Expo outcome. Preserves capped exponential backoff with jitter, makes the first outcome idempotently win, and rolls the parent up from each token latest attempt. Migration 20260815044230.';

-- ---------------------------------------------------------------------------
-- Hand the claimed exact-token attempts to the Edge retry entry point
-- ---------------------------------------------------------------------------
create or replace function public.dispatch_push_retries(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_base    text;
  v_secret  text;
  v_headers jsonb;
  v_claimed jsonb;
begin
  select value #>> '{}' into v_base
    from public.platform_settings
   where key = 'functions_base_url';
  if v_base is null or v_base = '' then return 0; end if;

  begin
    select decrypted_secret into v_secret
      from vault.decrypted_secrets
     where name = 'push_internal_secret';
  exception when others then
    v_secret := null;
  end;

  v_headers := '{"Content-Type":"application/json"}'::jsonb;
  if v_secret is not null and v_secret <> '' then
    v_headers := v_headers || jsonb_build_object('x-internal-secret', v_secret);
  end if;

  select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
    into v_claimed
    from public.claim_push_retries(p_limit) c;

  if v_claimed = '[]'::jsonb then return 0; end if;

  perform net.http_post(
    url     := v_base || '/expo-push',
    body    := jsonb_build_object('mode', 'retry', 'attempts', v_claimed),
    headers := v_headers
  );

  -- Queued for the worker, not accepted by Expo. Attempts remain processing
  -- until the worker calls settle_push_attempt with the real ticket outcome.
  return jsonb_array_length(v_claimed);
exception when others then
  -- The enclosing exception block rolls back claims made in this invocation,
  -- leaving them eligible for the next cron tick.
  return 0;
end;
$function$;

revoke all on function public.dispatch_push_retries(integer)
  from public, anon, authenticated;
grant execute on function public.dispatch_push_retries(integer)
  to service_role;

comment on function public.dispatch_push_retries(integer) is
  'Atomically claims exact-token retry attempts and queues one authenticated mode=retry request. Queueing pg_net never marks an attempt accepted; expo-push settles the actual Expo outcome. Migration 20260815044230.';

-- ---------------------------------------------------------------------------
-- A retry in flight must not look like a crashed outbox dispatch
-- ---------------------------------------------------------------------------
-- Claiming (above) and settle_push_attempt's roll-up both put the parent back
-- into status='processing', settled_at=null while attempt N+1 is in flight.
-- Mig 202's reclaim_stuck_push_messages() (cron */5) treats exactly that shape,
-- once queued_at is older than 10 minutes, as a dispatcher that died mid-send
-- and re-queues the parent — and dispatch_push_outbox then re-drives the FRESH
-- fan-out to every device of every recipient, i.e. the duplicate delivery this
-- migration exists to remove (from roughly the third backoff step onward, and
-- for every receipt-driven retry, queued_at is always that old).
--
-- Only claim_push_retries creates attempts in status 'processing' (the fresh
-- path records 'queued'), so an in-flight retry attempt is an unambiguous
-- marker. A retry whose worker really died is reclaimed by claim_push_retries
-- itself under the same attempt id after 10 minutes, so nothing strands.
-- Same zero-argument signature as mig 202: create or replace is safe.
create or replace function public.reclaim_stuck_push_messages()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_n int;
begin
  update public.push_messages m
     set status = 'queued'
   where m.status = 'processing'
     and m.queued_at < now() - interval '10 minutes'
     and m.settled_at is null
     and m.expires_at > now()
     and not exists (
       select 1
         from public.push_attempts a
        where a.message_id = m.id
          and a.status = 'processing'
     );
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

revoke all on function public.reclaim_stuck_push_messages()
  from public, anon, authenticated;
grant execute on function public.reclaim_stuck_push_messages()
  to service_role;

comment on function public.reclaim_stuck_push_messages() is
  'Returns push_messages stuck in `processing` (dispatcher crashed mid-send) to `queued`, provided they have not expired and no exact-token retry attempt is currently in flight — an in-flight retry is settled by expo-push, not re-fanned-out by the outbox. Mig 202 (audit F-04), narrowed by migration 20260815044230.';

-- House rule 1: replacing a signature must not leave a PostgREST-ambiguous
-- overload behind.
do $$
declare v_name text;
begin
  foreach v_name in array array['claim_push_retries','settle_push_attempt','dispatch_push_retries','reclaim_stuck_push_messages']
  loop
    if (
      select count(*)
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = v_name
    ) <> 1 then
      raise exception '[20260815044230] % has an unexpected overload', v_name;
    end if;
  end loop;
end $$;
