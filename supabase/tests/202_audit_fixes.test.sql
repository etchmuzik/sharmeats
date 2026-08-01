\set ON_ERROR_STOP on

begin;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $roles$;

-- Minimal scaffolding so migration 202 can be PARSED and its plpgsql bodies
-- validated on a bare Postgres. This is a syntax/shape harness only: it proves
-- the migration is well-formed SQL and that every function body compiles, not
-- that the business logic is right (that is what the prod-shaped suites do).

create schema if not exists auth;
-- `private` exists in prod (migs 191-193); it holds definer helpers that must
-- not be reachable by client roles, so it deliberately grants no USAGE.
create schema if not exists private;
create schema if not exists extensions;
create schema if not exists vault;
create schema if not exists net;
create schema if not exists cron;

create type app_role as enum ('customer','driver','merchant_staff','dispatcher','admin');
create type order_status_type as enum ('pending','placed','accepted','preparing','ready','picked_up','out_for_delivery','delivered','cancelled','rejected','refunded','failed');
create type dropoff_preference as enum ('hand_to_me','leave_at_door','no_bell');

create table auth.users (id uuid primary key, email text, last_sign_in_at timestamptz);
create table auth.mfa_factors (id uuid primary key, user_id uuid, status text);
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;

create table vault.decrypted_secrets (name text, decrypted_secret text);

create function net.http_post(url text, body jsonb default null, headers jsonb default null, params jsonb default null, timeout_milliseconds int default 5000)
returns bigint language sql as $$ select 1::bigint $$;

create function cron.schedule(job_name text, schedule text, command text)
returns bigint language sql as $$ select 1::bigint $$;

create table public.users (id uuid primary key, role app_role, locale text, phone text, display_name text);
create table public.platform_settings (key text primary key, value jsonb);
create table public.restaurants (id uuid primary key, is_active boolean default true);
create table public.drivers (
  id uuid primary key, profile_id uuid, status text, is_active boolean default true,
  is_verified boolean default false, display_name text, phone text, photo_url text,
  last_ping_at timestamptz
);
create table public.orders (
  id uuid primary key, user_id uuid, restaurant_id uuid, status order_status_type,
  payment_method text, payment_status text, total_egp int, delivery_fee_egp int,
  tip_egp int, assigned_driver_id uuid, fulfillment_type text, placed_at timestamptz,
  scheduled_for timestamptz, dropoff_preference dropoff_preference, rider jsonb,
  dispatch_mode text
);
-- Column list mirrors PRODUCTION exactly (checked against
-- information_schema before mig 202 was applied). An earlier draft of this
-- harness invented an `offered_at` column that prod does not have, so
-- dispatch_stuck_report() passed here and would have failed live. Keep this in
-- lockstep with the real table.
create table public.order_assignments (
  id uuid primary key default gen_random_uuid(), order_id uuid, driver_id uuid,
  status text, assigned_by text, assigned_by_id uuid, assigned_at timestamptz default now(),
  responded_at timestamptz, offer_expires_at timestamptz
);
create table public.driver_earnings (
  driver_id uuid, order_id uuid unique, delivery_fee_share int, tip int, bonus int,
  cod_collected int, total int
);
create table public.driver_cash_ledger (
  id uuid primary key default gen_random_uuid(), driver_id uuid, delta_egp int,
  reason text, ref_order_id uuid, actor_id uuid, created_at timestamptz default now()
);
create unique index driver_cash_ledger_one_collection_per_order
  on public.driver_cash_ledger (ref_order_id) where reason = 'cod_collected';
create table public.driver_loyalty (driver_id uuid, bonus_per_delivery_egp int);
create table public.delivery_proofs (
  id uuid primary key default gen_random_uuid(), order_id uuid, driver_id uuid,
  storage_path text, dropoff_preference text
);
create table public.delivery_jobs (
  id uuid primary key, assigned_driver_id uuid, requester_user_id uuid, service_area_id uuid
);
create table public.push_messages (
  id uuid primary key default gen_random_uuid(), event text, recipient_user_ids uuid[],
  order_id uuid, campaign_id uuid, route text, custom_title text, custom_body text,
  vertical text, category text default 'operational', idempotency_key text unique,
  status text default 'queued', suppression_reason text,
  queued_at timestamptz default now(), expires_at timestamptz default now() + interval '6 hours',
  settled_at timestamptz
);
create table public.push_attempts (
  id uuid primary key default gen_random_uuid(), message_id uuid, push_token_id uuid,
  recipient_user_id uuid, token_snapshot text, status text, attempt_no smallint default 0,
  next_attempt_at timestamptz, claimed_at timestamptz, error_code text, error_detail text,
  expo_ticket_id text
);
create table public.__pre_mig126_129_snapshot (x int);

create function public.auth_role() returns app_role language sql stable as $$ select null::app_role $$;
create function public.ops_alert(p_text text) returns void language sql as $$ select $$;
create function public.push_headers() returns jsonb language sql as $$ select '{}'::jsonb $$;
create function public.is_merchant_staff(p_restaurant_id uuid) returns boolean language sql as $$ select false $$;
create function public.rider_snapshot(p_driver_id uuid) returns jsonb language sql as $$ select '{}'::jsonb $$;
create function public.push_receipt_sweep() returns int language sql as $$ select 0 $$;
create function public.driver_cod_capacity(p_driver_id uuid, p_order_id uuid)
returns table (outcome text, held_egp int, prospective_egp int, soft_limit_egp int, hard_limit_egp int, mode text)
language sql as $$ select 'ok'::text, 0, 0, 0, 0, 'enforce'::text $$;
create function public.log_cod_limit_event(uuid, uuid, text, int, int, int, int, text)
returns void language sql as $$ select $$;
create function public.claim_push_retries(p_limit integer default 100)
returns table (attempt_id uuid, message_id uuid, event text, order_id uuid, route text,
               vertical text, custom_title text, custom_body text, recipient_user_id uuid,
               token text, attempt_no smallint)
language sql as $$ select null::uuid, null::uuid, null::text, null::uuid, null::text,
                          null::text, null::text, null::text, null::uuid, null::text, null::smallint
                   where false $$;
create function private.delivery_encrypt(p text) returns bytea language sql as $$ select null::bytea $$;
create function private.delivery_decrypt(p bytea) returns text language sql as $$ select null::text $$;

\ir ../migrations/202_audit_20260731_p0_p1_fixes.sql

-- Behavioural checks for migration 202 against the stub harness.
-- Each assertion states expected vs got, so a failure names itself.
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 1. Every function the migration claims to create actually EXISTS, exactly
--    once (house rule 1: a second overload is how PGRST202 happens in prod).
--    The behavioural sections below then execute the bodies, which is a
--    stronger check than a static one.
-- ---------------------------------------------------------------------------
do $$
declare
  r record; v_missing text := '';
begin
  for r in
    select unnest(array['auth_aal','has_verified_mfa_factor','require_admin',
                        'admin_mfa_posture','dispatch_push_outbox',
                        'reclaim_stuck_push_messages','dispatch_push_retries',
                        'mark_cod_collected','record_delivery_proof','assign_driver',
                        'driver_respond','assert_scheduled_orders_allowed',
                        'orders_reject_unsupported_schedule','dispatch_stuck_report',
                        'dispatch_churn_watchdog']) as fn
  loop
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = r.fn
    ) then
      v_missing := v_missing || ' ' || r.fn;
    end if;
  end loop;
  if v_missing <> '' then
    raise exception 'FAIL: migration did not create:%', v_missing;
  end if;
  raise notice 'PASS  all 15 migration-202 functions exist';
end $$;

-- No accidental overloads on the four functions we REPLACED.
do $$
declare r record;
begin
  for r in
    select p.proname, count(*) as n
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('mark_cod_collected','record_delivery_proof','assign_driver','driver_respond')
     group by p.proname having count(*) > 1
  loop
    raise exception 'FAIL: % has % overloads — PGRST202 risk (house rule 1)', r.proname, r.n;
  end loop;
  raise notice 'PASS  no duplicate overloads on replaced functions';
end $$;

-- ---------------------------------------------------------------------------
-- 2. F-10 — the proof-path guard now fails CLOSED on a suffix-less path.
--    This is the exact bypass mig 194 shipped: substring() returns NULL, the
--    comparison goes NULL, and the raise never fired.
-- ---------------------------------------------------------------------------
do $$
declare
  v_uid uuid := '11111111-1111-1111-1111-111111111111';
  v_oid uuid := '22222222-2222-2222-2222-222222222222';
  v_did uuid := '33333333-3333-3333-3333-333333333333';
  v_got text;
begin
  insert into public.users (id, role) values (v_uid, 'driver');
  insert into public.drivers (id, profile_id, status, is_active, is_verified)
    values (v_did, v_uid, 'on_job', true, true);
  insert into public.orders (id, status, assigned_driver_id, dropoff_preference)
    values (v_oid, 'out_for_delivery', v_did, 'leave_at_door');

  -- auth.uid() is stubbed to NULL, so re-point it at our fixture driver.
  create or replace function auth.uid() returns uuid language sql stable as
    $f$ select '11111111-1111-1111-1111-111111111111'::uuid $f$;
  create or replace function public.auth_role() returns app_role language sql stable as
    $f$ select 'driver'::app_role $f$;

  -- (a) A path with NO -<digits>.<ext> suffix must be REJECTED.
  begin
    perform public.record_delivery_proof(v_oid, 'not-a-real-path');
    raise exception 'FAIL F-10(a): suffix-less path was ACCEPTED (the mig-194 bypass is still open)';
  exception when check_violation then
    raise notice 'PASS  F-10(a) suffix-less path rejected';
  end;

  -- (b) Someone else's prefix, correctly suffixed, must still be rejected.
  begin
    perform public.record_delivery_proof(v_oid, '99999999-9999-9999-9999-999999999999/' || v_oid::text || '-1750000000.jpg');
    raise exception 'FAIL F-10(b): foreign prefix was ACCEPTED';
  exception when check_violation then
    raise notice 'PASS  F-10(b) foreign prefix rejected';
  end;

  -- (c) The legitimate path must still WORK — a guard that rejects everything
  --     would "pass" (a) and (b) while breaking proof of delivery entirely.
  perform public.record_delivery_proof(v_oid, v_uid::text || '/' || v_oid::text || '-1750000000.jpg');
  select storage_path into v_got from public.delivery_proofs where order_id = v_oid;
  if v_got is null then
    raise exception 'FAIL F-10(c): a VALID path was rejected — the guard is now too strict';
  end if;
  raise notice 'PASS  F-10(c) valid path still accepted';
end $$;

-- ---------------------------------------------------------------------------
-- 3. F-06 — COD cannot be settled on a non-delivered order, and settles once.
-- ---------------------------------------------------------------------------
do $$
declare
  v_uid uuid := '44444444-4444-4444-4444-444444444444';
  v_oid uuid := '55555555-5555-5555-5555-555555555555';
  v_did uuid := '66666666-6666-6666-6666-666666666666';
  v_rows int;
begin
  insert into public.users (id, role) values (v_uid, 'driver');
  insert into public.drivers (id, profile_id, status, is_active, is_verified)
    values (v_did, v_uid, 'on_job', true, true);
  insert into public.orders (id, status, payment_method, payment_status, total_egp,
                             delivery_fee_egp, tip_egp, assigned_driver_id, fulfillment_type)
    values (v_oid, 'out_for_delivery', 'cash_on_delivery', 'pending', 445, 30, 0, v_did, 'platform');

  create or replace function auth.uid() returns uuid language sql stable as
    $f$ select '44444444-4444-4444-4444-444444444444'::uuid $f$;
  create or replace function public.auth_role() returns app_role language sql stable as
    $f$ select 'driver'::app_role $f$;

  -- (a) Not delivered yet -> refused.
  begin
    perform public.mark_cod_collected(v_oid, 445);
    raise exception 'FAIL F-06(a): COD settled on an out_for_delivery order';
  exception when check_violation then
    raise notice 'PASS  F-06(a) pre-delivery COD refused';
  end;

  -- (b) Cancelled -> refused (the paid+cancelled state that had no un-pay path).
  update public.orders set status = 'cancelled' where id = v_oid;
  begin
    perform public.mark_cod_collected(v_oid, 445);
    raise exception 'FAIL F-06(b): COD settled on a CANCELLED order';
  exception when check_violation then
    raise notice 'PASS  F-06(b) cancelled-order COD refused';
  end;

  -- (c) Delivered -> settles, exactly once, and still writes the ledger row.
  update public.orders set status = 'delivered' where id = v_oid;
  perform public.mark_cod_collected(v_oid, 445);
  perform public.mark_cod_collected(v_oid, 445);   -- retry must be harmless
  select count(*) into v_rows from public.driver_cash_ledger
   where ref_order_id = v_oid and reason = 'cod_collected';
  if v_rows <> 1 then
    raise exception 'FAIL F-06(c): expected exactly 1 cash-ledger row, got %', v_rows;
  end if;
  if (select payment_status from public.orders where id = v_oid) <> 'paid' then
    raise exception 'FAIL F-06(c): delivered COD did not settle';
  end if;
  raise notice 'PASS  F-06(c) delivered COD settles exactly once (ledger rows = 1)';
end $$;

-- ---------------------------------------------------------------------------
-- 4. F-14 — a scheduled order is refused while the lifecycle cannot honour it.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into public.orders (id, status, scheduled_for)
    values ('77777777-7777-7777-7777-777777777777', 'placed', now() + interval '2 days');
    raise exception 'FAIL F-14: a scheduled order was accepted while scheduling is disabled';
  exception when check_violation then
    raise notice 'PASS  F-14 scheduled order refused server-side';
  end;

  -- An UNscheduled order must still insert — the trigger must not block normal orders.
  insert into public.orders (id, status) values ('88888888-8888-8888-8888-888888888888', 'placed');
  raise notice 'PASS  F-14 ordinary (unscheduled) order still accepted';

  -- And flipping the setting re-enables it, so this is an ops action not a migration.
  update public.platform_settings set value = to_jsonb(true) where key = 'scheduled_orders_enabled';
  insert into public.orders (id, status, scheduled_for)
  values ('99999999-9999-9999-9999-999999999999', 'placed', now() + interval '2 days');
  raise notice 'PASS  F-14 setting flip re-enables scheduling';
  update public.platform_settings set value = to_jsonb(false) where key = 'scheduled_orders_enabled';
end $$;

-- ---------------------------------------------------------------------------
-- 5. F-01 — require_admin() fails closed, and MFA arms on enrolment.
-- ---------------------------------------------------------------------------
do $$
declare
  v_admin uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
begin
  insert into public.users (id, role) values (v_admin, 'admin');
  insert into auth.users (id, email) values (v_admin, 'admin@example.test');

  create or replace function auth.uid() returns uuid language sql stable as
    $f$ select 'aaaaaaaa-0000-0000-0000-000000000001'::uuid $f$;
  create or replace function public.auth_role() returns app_role language sql stable as
    $f$ select 'admin'::app_role $f$;

  -- (a) No factor enrolled -> allowed (deploying this must not lock the only
  --     admin out before anyone can enrol).
  perform public.require_admin();
  raise notice 'PASS  F-01(a) admin without a factor is not locked out';

  -- (b) A VERIFIED factor + an aal1 session -> refused. auth_aal() reads the JWT
  --     claim, which is absent here, i.e. exactly the PostgREST-direct attack.
  insert into auth.mfa_factors (id, user_id, status)
  values (gen_random_uuid(), v_admin, 'verified');
  begin
    perform public.require_admin();
    raise exception 'FAIL F-01(b): aal1 session passed require_admin() despite an enrolled factor';
  exception when check_violation then
    raise notice 'PASS  F-01(b) enrolled admin on an aal1 session is refused';
  end;

  -- (c) A non-admin is refused regardless.
  create or replace function public.auth_role() returns app_role language sql stable as
    $f$ select 'customer'::app_role $f$;
  begin
    perform public.require_admin();
    raise exception 'FAIL F-01(c): a customer passed require_admin()';
  exception when check_violation then
    raise notice 'PASS  F-01(c) non-admin refused';
  end;

  -- (d) A NULL role fails CLOSED (house rule 4).
  create or replace function public.auth_role() returns app_role language sql stable as
    $f$ select null::app_role $f$;
  begin
    perform public.require_admin();
    raise exception 'FAIL F-01(d): a NULL role passed require_admin() — fails OPEN';
  exception when check_violation then
    raise notice 'PASS  F-01(d) NULL role fails closed';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 6. F-04 — the outbox dispatcher claims queued rows and expires stale ones.
-- ---------------------------------------------------------------------------
do $$
declare v_sent int; v_expired int; v_queued int;
begin
  insert into public.platform_settings (key, value)
  values ('functions_base_url', to_jsonb('https://example.test/functions/v1'::text))
  on conflict (key) do update set value = excluded.value;

  insert into public.push_messages (event, idempotency_key, status, expires_at)
  values ('driver_assigned', 'k-live-1',    'queued', now() + interval '30 minutes'),
         ('order_ready_pickup','k-live-2',  'queued', now() + interval '30 minutes'),
         ('low_rating',       'k-stale-1',  'queued', now() - interval '1 minute');

  v_sent := public.dispatch_push_outbox(100);

  select count(*) into v_expired from public.push_messages
   where status = 'suppressed' and suppression_reason = 'expired';
  select count(*) into v_queued from public.push_messages where status = 'queued';

  if v_sent <> 2 then
    raise exception 'FAIL F-04: expected 2 live messages dispatched, got %', v_sent;
  end if;
  if v_expired <> 1 then
    raise exception 'FAIL F-04: expected 1 message expired, got %', v_expired;
  end if;
  if v_queued <> 0 then
    raise exception 'FAIL F-04: % message(s) left queued after a dispatch run', v_queued;
  end if;
  raise notice 'PASS  F-04 dispatcher sent 2, expired 1, left 0 queued';

  -- A second run must not re-send what is already processing (no double-send).
  v_sent := public.dispatch_push_outbox(100);
  if v_sent <> 0 then
    raise exception 'FAIL F-04: second run re-sent % message(s) — double-send risk', v_sent;
  end if;
  raise notice 'PASS  F-04 second run re-sent nothing';

  -- A crashed dispatcher's rows come back after the reclaim window.
  update public.push_messages set queued_at = now() - interval '20 minutes'
   where status = 'processing';
  if public.reclaim_stuck_push_messages() <> 2 then
    raise exception 'FAIL F-04: stuck-message reclaim did not return both rows';
  end if;
  raise notice 'PASS  F-04 stuck messages reclaimed';
end $$;

-- 6b. The claimed row's key must be REWRITTEN to the exact string
--     expo-push's idempotencyKey() computes. If it is not, the edge function's
--     insert does not collide, it creates a SECOND row and settles that one,
--     and the row we claimed is stuck in `processing` forever — reclaimed and
--     re-sent every 10 minutes. That is an infinite push loop, i.e. precisely
--     the incident mig 200 was written to stop.
do $$
declare
  v_key text;
  v_oid uuid := '1a1a1a1a-0000-0000-0000-000000000001';
  v_u1  uuid := '2b2b2b2b-0000-0000-0000-000000000002';
  v_u2  uuid := '2b2b2b2b-0000-0000-0000-000000000001';  -- deliberately < v_u1
begin
  -- (a) order-only event: evt:<event>|order:<uuid>
  insert into public.push_messages (event, order_id, idempotency_key, status, expires_at)
  values ('driver_assigned', v_oid, 'driver_assigned:' || v_oid::text, 'queued', now() + interval '30 minutes');
  perform public.dispatch_push_outbox(10);

  select idempotency_key into v_key from public.push_messages
   where event = 'driver_assigned' and order_id = v_oid;
  if v_key is distinct from 'evt:driver_assigned|order:' || v_oid::text then
    raise exception 'FAIL F-04 key(a): got %, expected evt:driver_assigned|order:%', v_key, v_oid;
  end if;
  raise notice 'PASS  F-04 order-event key canonicalised for expo-push adoption';

  -- (b) explicit recipients are folded in SORTED, matching the JS
  --     `[...ids].sort().join(',')` — an unsorted list would produce a
  --     different key for the same logical message.
  insert into public.push_messages (event, recipient_user_ids, idempotency_key, status, expires_at)
  values ('low_rating', array[v_u1, v_u2], 'low_rating:custom', 'queued', now() + interval '30 minutes');
  perform public.dispatch_push_outbox(10);

  -- Scoped to the row with recipients: an earlier block left a `low_rating`
  -- fixture behind, and matching on event alone picked that one up.
  select idempotency_key into v_key from public.push_messages
   where event = 'low_rating' and recipient_user_ids is not null;
  if v_key is distinct from 'evt:low_rating|to:' || v_u2::text || ',' || v_u1::text then
    raise exception 'FAIL F-04 key(b): recipients not sorted into the key — got %', v_key;
  end if;
  raise notice 'PASS  F-04 recipient key sorted like expo-push';
end $$;

-- 6c. A queued duplicate of an ALREADY-SENT message is suppressed rather than
--     aborting the tick on the unique constraint.
do $$
declare
  v_oid uuid := '3c3c3c3c-0000-0000-0000-000000000001';
  v_status text;
  v_sent int;
begin
  -- The canonical row expo-push would have written.
  insert into public.push_messages (event, order_id, idempotency_key, status, settled_at, expires_at)
  values ('order_ready_pickup', v_oid, 'evt:order_ready_pickup|order:' || v_oid::text,
          'complete', now(), now() + interval '30 minutes');
  -- ...and a queued copy from a DB-side sender.
  insert into public.push_messages (event, order_id, idempotency_key, status, expires_at)
  values ('order_ready_pickup', v_oid, 'order_ready_pickup:' || v_oid::text,
          'queued', now() + interval '30 minutes');

  v_sent := public.dispatch_push_outbox(10);   -- must not raise

  -- Scoped to THIS fixture's order: an earlier block left another
  -- order_ready_pickup row behind, and `status <> 'complete'` alone matched it.
  select status into v_status from public.push_messages
   where event = 'order_ready_pickup' and order_id = v_oid and status <> 'complete';
  if v_status <> 'suppressed' then
    raise exception 'FAIL F-04 dup: queued duplicate ended as %, expected suppressed', v_status;
  end if;
  raise notice 'PASS  F-04 duplicate of a sent message suppressed, tick survived';
end $$;

-- ---------------------------------------------------------------------------
-- 7. F-11/F-12/F-13 — assignment lifecycle.
-- ---------------------------------------------------------------------------
do $$
declare
  v_disp uuid := 'bbbbbbbb-0000-0000-0000-000000000001';
  v_d1   uuid := 'cccccccc-0000-0000-0000-000000000001';
  v_d2   uuid := 'cccccccc-0000-0000-0000-000000000002';
  v_p1   uuid := 'dddddddd-0000-0000-0000-000000000001';
  v_p2   uuid := 'dddddddd-0000-0000-0000-000000000002';
  v_oid  uuid := 'eeeeeeee-0000-0000-0000-000000000001';
  v_asg  uuid;
  v_status text;
begin
  insert into public.users (id, role) values (v_disp,'dispatcher'), (v_p1,'driver'), (v_p2,'driver');
  insert into public.drivers (id, profile_id, status, is_active, is_verified) values
    (v_d1, v_p1, 'on_job', true, true),
    (v_d2, v_p2, 'online', true, true);
  insert into public.orders (id, status, assigned_driver_id, placed_at)
    values (v_oid, 'ready', v_d1, now() - interval '5 minutes');

  create or replace function auth.uid() returns uuid language sql stable as
    $f$ select 'bbbbbbbb-0000-0000-0000-000000000001'::uuid $f$;
  create or replace function public.auth_role() returns app_role language sql stable as
    $f$ select 'dispatcher'::app_role $f$;

  -- F-12: reassigning away from d1 must return d1 to the dispatch pool.
  perform public.assign_driver(v_oid, v_d2);
  select status into v_status from public.drivers where id = v_d1;
  if v_status <> 'online' then
    raise exception 'FAIL F-12: displaced driver left as % — still stranded out of dispatch', v_status;
  end if;
  raise notice 'PASS  F-12 displaced driver returned to online';

  -- F-11: a terminal order can no longer be assigned.
  update public.orders set status = 'cancelled' where id = v_oid;
  begin
    perform public.assign_driver(v_oid, v_d1);
    raise exception 'FAIL F-11: a CANCELLED order accepted a manual assignment';
  exception when check_violation then
    raise notice 'PASS  F-11 terminal order refuses assignment';
  end;

  -- F-13: a driver cannot accept an offer whose order was cancelled meanwhile.
  insert into public.order_assignments (id, order_id, driver_id, status, assigned_at)
  values (gen_random_uuid(), v_oid, v_d2, 'offered', now()) returning id into v_asg;

  create or replace function auth.uid() returns uuid language sql stable as
    $f$ select 'dddddddd-0000-0000-0000-000000000002'::uuid $f$;
  create or replace function public.auth_role() returns app_role language sql stable as
    $f$ select 'driver'::app_role $f$;
  begin
    perform public.driver_respond(v_asg, true);
    raise exception 'FAIL F-13: a driver ACCEPTED a cancelled order';
  exception when check_violation then
    raise notice 'PASS  F-13 accept-after-cancel refused';
  end;

  select status into v_status from public.drivers where id = v_d2;
  if v_status = 'on_job' then
    raise exception 'FAIL F-13: driver was left on_job by a refused accept';
  end if;
  raise notice 'PASS  F-13 driver not stranded on_job by the refusal';
end $$;

-- ---------------------------------------------------------------------------
-- 8. F-15 — the watchdog sees churn and stale manual offers.
-- ---------------------------------------------------------------------------
do $$
declare v_churn int; v_stale int;
begin
  -- An order re-offered repeatedly and never accepted, WITH a driver stamped —
  -- exactly the shape mig 133 cannot see.
  insert into public.orders (id, status, assigned_driver_id, placed_at)
  values ('ffffffff-0000-0000-0000-000000000001', 'ready',
          'cccccccc-0000-0000-0000-000000000001', now() - interval '30 minutes');
  insert into public.order_assignments (order_id, driver_id, status, assigned_at)
  select 'ffffffff-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
         'rejected', now() - interval '20 minutes'
    from generate_series(1,4);

  -- Read through the PRIVATE query here: the public wrapper is admin/dispatcher
  -- only, and auth_role() is stubbed per-block in this harness.
  select count(*) into v_churn from private.dispatch_stuck_rows() where shape = 'offer_churn';
  if v_churn < 1 then
    raise exception 'FAIL F-15: offer-churn order is still invisible to the watchdog';
  end if;
  raise notice 'PASS  F-15 offer churn detected';

  -- A manual offer nobody ever answered.
  insert into public.orders (id, status, placed_at)
  values ('ffffffff-0000-0000-0000-000000000002', 'ready', now() - interval '40 minutes');
  insert into public.order_assignments (order_id, driver_id, status, assigned_at)
  values ('ffffffff-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000002',
          'offered', now() - interval '30 minutes');

  select count(*) into v_stale from private.dispatch_stuck_rows() where shape = 'stale_offer';
  if v_stale < 1 then
    raise exception 'FAIL F-15: never-answered manual offer is still invisible';
  end if;
  raise notice 'PASS  F-15 stale manual offer detected';

  -- The operator-facing wrapper must REFUSE a non-staff caller: it is SECURITY
  -- DEFINER over every live order, so an ungated grant to `authenticated` would
  -- let any signed-in customer enumerate order ids and dispatch state.
  create or replace function public.auth_role() returns app_role language sql stable as
    $f$ select 'customer'::app_role $f$;
  begin
    perform * from public.dispatch_stuck_report();
    raise exception 'FAIL F-15: a customer could read the stuck-order report';
  exception when check_violation then
    raise notice 'PASS  F-15 stuck-order report refused to a customer';
  end;

  -- ...and ALLOW a dispatcher.
  create or replace function public.auth_role() returns app_role language sql stable as
    $f$ select 'dispatcher'::app_role $f$;
  perform * from public.dispatch_stuck_report();
  raise notice 'PASS  F-15 stuck-order report readable by a dispatcher';

  -- The cron watchdog runs as postgres (auth_role() NULL). It must still see the
  -- rows — if it raised, its `exception when others then return 0` would swallow
  -- that into a permanent silent "all clear", the very failure F-15 ends.
  create or replace function public.auth_role() returns app_role language sql stable as
    $f$ select null::app_role $f$;
  if public.dispatch_churn_watchdog() < 1 then
    raise exception 'FAIL F-15: the cron watchdog reported all-clear despite stuck orders';
  end if;
  raise notice 'PASS  F-15 cron watchdog still sees stuck orders as postgres';
end $$;

do $$ begin raise notice '--- ALL MIGRATION 202 ASSERTIONS PASSED ---'; end $$;

rollback;
