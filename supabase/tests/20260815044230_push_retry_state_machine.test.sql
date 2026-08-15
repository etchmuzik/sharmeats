\set ON_ERROR_STOP on

begin;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $roles$;

create schema private;
create schema vault;
create schema net;

create table vault.decrypted_secrets (
  name text primary key,
  decrypted_secret text
);

create table net.recorded_requests (
  id bigint generated always as identity primary key,
  url text not null,
  body jsonb,
  headers jsonb
);

create function net.http_post(
  url text,
  body jsonb default null,
  headers jsonb default null,
  params jsonb default null,
  timeout_milliseconds int default 5000
)
returns bigint
language plpgsql
as $$
declare v_id bigint;
begin
  insert into net.recorded_requests (url, body, headers)
  values (url, body, headers)
  returning id into v_id;
  return v_id;
end;
$$;

create table public.platform_settings (
  key text primary key,
  value jsonb not null
);

create table public.push_tokens (
  id uuid primary key,
  user_id uuid not null,
  token text not null unique
);

create table public.push_messages (
  id uuid primary key,
  event text not null,
  recipient_user_ids uuid[],
  order_id uuid,
  campaign_id uuid,
  route text,
  custom_title text,
  custom_body text,
  vertical text,
  category text not null default 'operational',
  idempotency_key text not null unique,
  status text not null default 'queued'
    check (status in ('queued','processing','complete','partly_failed','failed','suppressed')),
  suppression_reason text,
  queued_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '6 hours',
  settled_at timestamptz,
  retain_until timestamptz not null default now() + interval '30 days'
);

create table public.push_attempts (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.push_messages(id) on delete cascade,
  push_token_id uuid references public.push_tokens(id) on delete set null,
  token_snapshot text not null,
  recipient_user_id uuid,
  attempt_no smallint not null default 1 check (attempt_no between 1 and 10),
  expo_ticket_id text,
  status text not null default 'queued'
    check (status in ('queued','processing','expo_accepted','provider_accepted',
                      'retryable_failed','permanent_failed','expired')),
  error_code text,
  error_detail text,
  next_attempt_at timestamptz,
  sent_at timestamptz,
  receipt_checked_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  unique (message_id, push_token_id, attempt_no)
);

\ir ../migrations/20260815044230_repair_push_retry_state_machine.sql

insert into public.platform_settings (key, value)
values ('functions_base_url', to_jsonb('https://functions.example.test'::text));
insert into vault.decrypted_secrets (name, decrypted_secret)
values ('push_internal_secret', 'test-secret');

-- One user owns two devices, but the logical message has one all-failed attempt.
-- The healthy device exists specifically to catch recipient-level retry fan-out.
insert into public.push_tokens (id, user_id, token) values
  ('10000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000009', 'ExponentPushToken[failed-device]'),
  ('10000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000009', 'ExponentPushToken[healthy-device]');

insert into public.push_messages (
  id, event, recipient_user_ids, order_id, idempotency_key, status, expires_at, settled_at
) values (
  '20000000-0000-0000-0000-000000000001',
  'order_ready',
  array['90000000-0000-0000-0000-000000000009'::uuid],
  '80000000-0000-0000-0000-000000000008',
  'retry-test',
  'failed',
  now() + interval '1 hour',
  now()
);

insert into public.push_attempts (
  id, message_id, push_token_id, token_snapshot, recipient_user_id,
  attempt_no, status, error_code, error_detail, next_attempt_at, settled_at
) values
  (
    '30000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'ExponentPushToken[failed-device]',
    '90000000-0000-0000-0000-000000000009',
    1,
    'retryable_failed',
    'HTTP_503',
    'Expo API returned 503',
    now() - interval '1 minute',
    now() - interval '2 minutes'
  );

-- An all-failed parent is claimable, and claiming creates a new immutable try.
create temporary table claimed_retry as
select * from public.claim_push_retries(10);

do $$
declare
  v_claimed record;
  v_original public.push_attempts;
  v_attempt_numbers smallint[];
begin
  if (select count(*) from claimed_retry) <> 1 then
    raise exception 'FAIL: expected the one failed token to be claimable';
  end if;

  select * into v_claimed from claimed_retry;
  if v_claimed.token <> 'ExponentPushToken[failed-device]' or v_claimed.attempt_no <> 2 then
    raise exception 'FAIL: retry claim targeted %, attempt %', v_claimed.token, v_claimed.attempt_no;
  end if;

  select * into v_original
    from public.push_attempts
   where id = '30000000-0000-0000-0000-000000000001';
  if v_original.attempt_no <> 1
     or v_original.status <> 'retryable_failed'
     or v_original.error_code <> 'HTTP_503'
     or v_original.error_detail <> 'Expo API returned 503'
     or v_original.next_attempt_at is null then
    raise exception 'FAIL: claiming rewrote the historical failed attempt';
  end if;

  select array_agg(attempt_no order by attempt_no) into v_attempt_numbers
    from public.push_attempts
   where message_id = '20000000-0000-0000-0000-000000000001'
     and push_token_id = '10000000-0000-0000-0000-000000000001';
  if v_attempt_numbers <> array[1, 2]::smallint[] then
    raise exception 'FAIL: expected immutable attempts {1,2}, got %', v_attempt_numbers;
  end if;

  raise notice 'PASS: failed parent claimed exact token as a new immutable attempt';
end $$;

-- The database enforces both uniqueness and attempt-number immutability.
do $$
begin
  begin
    insert into public.push_attempts (
      id, message_id, push_token_id, token_snapshot, recipient_user_id, attempt_no, status
    ) values (
      '30000000-0000-0000-0000-000000000099',
      '20000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      'ExponentPushToken[failed-device]',
      '90000000-0000-0000-0000-000000000009',
      2,
      'processing'
    );
    raise exception 'FAIL: duplicate attempt number was accepted';
  exception when unique_violation then
    raise notice 'PASS: duplicate attempt number rejected';
  end;

  begin
    update public.push_attempts
       set attempt_no = 3
     where id = '30000000-0000-0000-0000-000000000001';
    raise exception 'FAIL: historical attempt number was mutable';
  exception when check_violation then
    raise notice 'PASS: historical attempt number is immutable';
  end;
end $$;

-- A stale in-flight attempt is reclaimed under the same id rather than burning
-- another attempt number whose send never actually started.
update public.push_attempts
   set claimed_at = now() - interval '11 minutes'
 where id = (select attempt_id from claimed_retry);

create temporary table reclaimed_retry as
select * from public.claim_push_retries(10);

do $$
declare v_first uuid; v_reclaimed uuid;
begin
  select attempt_id into v_first from claimed_retry;
  select attempt_id into v_reclaimed from reclaimed_retry;
  if v_first is distinct from v_reclaimed then
    raise exception 'FAIL: stale claim created a third attempt (% vs %)', v_first, v_reclaimed;
  end if;
  if (select count(*) from public.push_attempts
       where message_id = '20000000-0000-0000-0000-000000000001'
         and push_token_id = '10000000-0000-0000-0000-000000000001') <> 2 then
    raise exception 'FAIL: stale reclaim changed attempt history cardinality';
  end if;
  raise notice 'PASS: stale processing attempt reclaimed idempotently';
end $$;

-- A parent whose exact-token retry is in flight looks like a crashed outbox
-- dispatch (processing, settled_at null). Mig 202's outbox reclaim must leave
-- it alone, or dispatch_push_outbox re-fans the message out to EVERY device —
-- the healthy one included. Once the retry attempt is settled, the ordinary
-- crashed-dispatcher reclaim applies again.
update public.push_messages
   set queued_at = now() - interval '20 minutes'
 where id = '20000000-0000-0000-0000-000000000001';

do $$
declare v_status text; v_settled timestamptz; v_reclaimed int;
begin
  select status, settled_at into v_status, v_settled
    from public.push_messages where id = '20000000-0000-0000-0000-000000000001';
  if v_status <> 'processing' or v_settled is not null then
    raise exception 'FAIL: fixture drift — claimed parent should be processing/unsettled, got %/%', v_status, v_settled;
  end if;

  v_reclaimed := public.reclaim_stuck_push_messages();
  select status into v_status
    from public.push_messages where id = '20000000-0000-0000-0000-000000000001';
  if v_reclaimed <> 0 or v_status <> 'processing' then
    raise exception 'FAIL: outbox reclaim re-queued a parent with an in-flight retry attempt (n=%, status=%)', v_reclaimed, v_status;
  end if;

  -- Same parent, no in-flight retry attempt any more: a genuinely stuck
  -- dispatcher must still be reclaimed (mig 202 behaviour preserved).
  update public.push_attempts set status = 'queued'
   where message_id = '20000000-0000-0000-0000-000000000001' and status = 'processing';
  v_reclaimed := public.reclaim_stuck_push_messages();
  select status into v_status
    from public.push_messages where id = '20000000-0000-0000-0000-000000000001';
  if v_reclaimed <> 1 or v_status <> 'queued' then
    raise exception 'FAIL: crashed-dispatcher reclaim regressed (n=%, status=%)', v_reclaimed, v_status;
  end if;
  -- restore the in-flight shape the following sections rely on
  update public.push_attempts set status = 'processing'
   where message_id = '20000000-0000-0000-0000-000000000001' and status = 'queued'
     and attempt_no = 2;
  update public.push_messages set status = 'processing', queued_at = now()
   where id = '20000000-0000-0000-0000-000000000001';
  raise notice 'PASS: outbox reclaim ignores parents with an in-flight exact-token retry';
end $$;

-- Dispatch is fire-and-forget. It may only queue the exact attempt for the Edge
-- worker; neither the failed history row nor its new attempt is accepted yet.
delete from net.recorded_requests;
update public.push_attempts
   set claimed_at = now() - interval '11 minutes'
 where id = (select attempt_id from claimed_retry);

select public.dispatch_push_retries(10);

do $$
declare v_body jsonb;
begin
  select body into v_body from net.recorded_requests;
  if jsonb_array_length(v_body -> 'attempts') <> 1
     or v_body #>> '{attempts,0,token}' <> 'ExponentPushToken[failed-device]'
     or v_body::text like '%healthy-device%' then
    raise exception 'FAIL: retry dispatch fanned out beyond the exact failed token: %', v_body;
  end if;
  if exists (
    select 1 from public.push_attempts
     where message_id = '20000000-0000-0000-0000-000000000001'
       and status = 'expo_accepted'
       and push_token_id = '10000000-0000-0000-0000-000000000001'
  ) then
    raise exception 'FAIL: dispatch marked a failed token accepted before Expo outcome';
  end if;
  raise notice 'PASS: dispatch queues only the exact token and does not settle optimistically';
end $$;

-- Only an actual Edge/Expo outcome settles the in-flight attempt. Replaying a
-- delayed outcome is idempotent: the first concrete result wins.
select public.settle_push_attempt(
  (select attempt_id from claimed_retry),
  'expo_accepted',
  'expo-ticket-retry-2',
  null,
  null
);
select public.settle_push_attempt(
  (select attempt_id from claimed_retry),
  'retryable_failed',
  null,
  'LATE_DUPLICATE',
  'must not overwrite the accepted outcome'
);

do $$
declare v_retry public.push_attempts; v_parent text;
begin
  select * into v_retry
    from public.push_attempts
   where id = (select attempt_id from claimed_retry);
  select status into v_parent
    from public.push_messages
   where id = v_retry.message_id;
  if v_retry.status <> 'expo_accepted'
     or v_retry.expo_ticket_id <> 'expo-ticket-retry-2'
     or v_retry.attempt_no <> 2
     or v_parent <> 'complete' then
    raise exception 'FAIL: real/idempotent settlement got attempt %, ticket %, number %, parent %',
      v_retry.status, v_retry.expo_ticket_id, v_retry.attempt_no, v_parent;
  end if;
  if (select status from public.push_attempts
       where id = '30000000-0000-0000-0000-000000000001') <> 'retryable_failed' then
    raise exception 'FAIL: successful retry rewrote the original failed history row';
  end if;
  raise notice 'PASS: real Expo result settles N+1 once and rolls up from latest attempts';
end $$;

-- Backoff remains capped exponential with jitter. Attempt 2 waits nominally two
-- minutes (+/-25%), and attempt 5 dead-letters instead of scheduling attempt 6.
insert into public.push_tokens (id, user_id, token) values
  ('10000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000010', 'ExponentPushToken[backoff-device]'),
  ('10000000-0000-0000-0000-000000000004', '90000000-0000-0000-0000-000000000011', 'ExponentPushToken[cap-device]');

insert into public.push_messages (id, event, idempotency_key, status, expires_at) values
  -- Receipt polling used to leave the parent complete while marking its latest
  -- attempt retryable_failed. The claim must repair that stale roll-up too.
  ('20000000-0000-0000-0000-000000000002', 'order_ready', 'backoff-test', 'complete', now() + interval '1 hour'),
  ('20000000-0000-0000-0000-000000000003', 'order_ready', 'cap-test', 'processing', now() + interval '1 hour');

insert into public.push_attempts (
  id, message_id, push_token_id, token_snapshot, recipient_user_id,
  attempt_no, status, next_attempt_at, claimed_at
) values
  (
    '30000000-0000-0000-0000-000000000003',
    '20000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000003',
    'ExponentPushToken[backoff-device]',
    '90000000-0000-0000-0000-000000000010',
    1,
    'retryable_failed',
    now() - interval '1 minute',
    null
  ),
  (
    '30000000-0000-0000-0000-000000000005',
    '20000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000004',
    'ExponentPushToken[cap-device]',
    '90000000-0000-0000-0000-000000000011',
    5,
    'processing',
    null,
    now()
  );

create temporary table backoff_claim as
select * from public.claim_push_retries(10)
where message_id = '20000000-0000-0000-0000-000000000002';

select public.settle_push_attempt(
  (select attempt_id from backoff_claim),
  'retryable_failed',
  null,
  'HTTP_503',
  'still unavailable'
);
select public.settle_push_attempt(
  '30000000-0000-0000-0000-000000000005',
  'retryable_failed',
  null,
  null,
  null
);

do $$
declare v_backoff public.push_attempts; v_cap public.push_attempts;
begin
  select * into v_backoff from public.push_attempts
   where id = (select attempt_id from backoff_claim);
  if v_backoff.attempt_no <> 2
     or v_backoff.status <> 'retryable_failed'
     or v_backoff.next_attempt_at not between now() + interval '80 seconds'
                                           and now() + interval '160 seconds' then
    raise exception 'FAIL: attempt-2 backoff outside jittered two-minute window: %',
      v_backoff.next_attempt_at;
  end if;

  select * into v_cap from public.push_attempts
   where id = '30000000-0000-0000-0000-000000000005';
  if v_cap.status <> 'permanent_failed' or v_cap.next_attempt_at is not null then
    raise exception 'FAIL: attempt 5 did not dead-letter: %, %', v_cap.status, v_cap.next_attempt_at;
  end if;
  raise notice 'PASS: exponential jittered backoff and attempt cap preserved';
end $$;

rollback;
