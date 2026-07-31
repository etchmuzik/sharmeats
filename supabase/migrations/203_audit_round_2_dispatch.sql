-- 203_audit_round_2_dispatch.sql
--
-- ############################################################################
-- ## NOT APPLIED TO PRODUCTION. Written 2026-07-31 from the round-2 audit;   ##
-- ## never executed against any database, local or remote. It has been       ##
-- ## validated by reading only. Dry-run it inside BEGIN ... ROLLBACK against  ##
-- ## a local Postgres, then run the Supabase advisors, before it goes near    ##
-- ## prod (migration house rule 6).                                          ##
-- ############################################################################
--
-- Nine dispatch / state-machine / notification defects, in one file because
-- they interlock: the push outbox has no consumer, dispatch offers have no
-- lifecycle guards, and the watchdog cannot see the shape of the failure the
-- last two incidents actually took.
--
-- ============================================================================
-- (1) THE PUSH OUTBOX HAS NO CONSUMER — THE HEADLINE BUG
-- ============================================================================
-- Migration 200 fixed the "driver on the way" push looping forever by routing
-- notify_order_transition through enqueue_push (mig 172). enqueue_push INSERTs
-- a push_messages row with status='queued'. Nothing anywhere selects those rows.
--
-- So mig 200 did not slow the notification down, it turned it OFF. Three events
-- now go to nobody at all:
--
--     driver_assigned      -> customer  ("a driver is heading to the restaurant")
--     order_ready_pickup   -> driver    ("the food is ready, come and get it")
--     low_rating           -> merchant  ("a customer rated you 2 or below")
--
-- The first of those is the single most important customer notification a
-- delivery app sends. It has reached zero people since mig 200 was applied.
--
-- Separately, mig 173 built claim_push_retries / settle_push_attempt and mig 174
-- built push_receipt_sweep, and NONE of the three has a caller or a cron entry.
-- Package 03 shipped a complete transport with no engine bolted to it.
--
-- THE DISPATCHER, AND WHY IT LOOKS LIKE THIS
--
-- push_outbox_sweep() below is the missing engine. It is deliberately shaped
-- like site_health_sweep (mig 199) rather than like a synchronous worker,
-- because net.http_post is ASYNC: it queues a request, returns an id, and the
-- response lands in net._http_response later. So each run (a) judges the
-- requests the PREVIOUS run fired, then (b) claims and fires fresh ones.
--
-- A claim MUST be exclusive. Two overlapping runs that both selected the same
-- queued row would both POST it and the customer would get the push twice —
-- the exact class of bug the outbox exists to prevent. So the claim is
-- `for update skip locked` plus a status transition in the same statement,
-- copied from claim_push_retries (mig 173), which proved the pattern.
--
-- WHY THE DISPATCHED ROW IS NOT THE ROW THAT RECORDS DELIVERY. expo-push
-- (functions/expo-push/outbox.ts) writes its OWN push_messages row, with its own
-- idempotency key shape ('evt:<event>|order:<id>|to:<users>'), because that is
-- where recipients, tokens and Expo tickets are actually resolved. enqueue_push
-- keys differently ('driver_assigned:<order>'), so the two never collide and the
-- enqueued row cannot be the row that learns the outcome.
--
-- Rather than pretend otherwise, the enqueued row is honest about what it is: a
-- DISPATCH INTENT. Its terminal state is 'dispatched' = "handed to the transport,
-- which answered 2xx". Delivery truth lives on expo-push's twin row and on
-- push_attempts. This is why 'dispatched' is a NEW status value and not a reuse
-- of 'complete': my_notification_inbox (mig 179) shows only complete/partly_failed,
-- and a dispatch-intent row appearing in a customer's inbox — duplicating the
-- twin that IS shown — would be a visible bug.
--
-- RETRY OF THE DISPATCH LEG is precise, not heuristic: the pg_net request id is
-- stored on the row and the next run reads net._http_response.status_code for it.
--   * 2xx                -> dispatched. expo-push owns it from here.
--   * any other status   -> nothing was sent. expo-push answers non-2xx only
--                           before it sends anything (503 unconfigured secret,
--                           401 bad secret, 400 bad body, 500 from the outer
--                           catch); every partial-send path returns 200 with the
--                           per-attempt outcomes recorded. So a re-POST here
--                           cannot double-send.
--   * no response row after 5 minutes -> the request was lost. Re-POST, bounded
--                           to 3 tries. Mig 173 already settled which way to err
--                           on an unknown fate for a delivery-critical push, and
--                           this follows it.
--
-- THE PER-TOKEN RETRY PATH (claim_push_retries) IS NOT WIRED HERE, ON PURPOSE.
-- A retryable attempt is one TOKEN that failed. expo-push has no way to be told
-- "send only to this token" — it resolves tokens itself from the recipient. Calling
-- it with the attempt's recipient would re-send to that user's OTHER tokens that
-- already succeeded, and its recordAttempts would collide with the existing
-- attempt_no=1 rows on unique (message_id, push_token_id, attempt_no) and silently
-- stop recording. Wiring it correctly needs a small expo-push change (accept an
-- optional attemptId + token and target exactly that one), which is a TypeScript
-- change and not this file. What IS done here: expired attempts are reaped so the
-- retry queue stops growing silently, and dispatch_watchdog now counts the
-- unretryable backlog so the gap is visible instead of invisible. See FOLLOWUPS.
--
-- ============================================================================
-- (2) mark_cod_collected HAD NO ORDER-STATUS GATE
-- ============================================================================
-- It checked the payment METHOD and the amount and the caller's role, and never
-- the order's status. So COD was markable paid on a 'placed' order, or on a
-- CANCELLED one — and a cancelled order that is also payment_status='paid' has no
-- un-pay path anywhere, while still feeding driver_earnings and the driver cash
-- ledger. The only thing standing between production and that state was a
-- confirm dialog in the driver app (apps/driver/app/job/[id].tsx:184), i.e. a
-- client-side gate on a money write. The gate now lives where the authority does.
--
-- ============================================================================
-- (3)+(4) assign_driver NEVER LOCKED OR VALIDATED THE ORDER
-- ============================================================================
-- auto_assign_order has locked the order and guarded its status since mig 025
-- (see 189:27-30: `select ... for update`, refuse if an active assignment exists,
-- refuse unless status is accepted/preparing/ready). assign_driver — the path a
-- human dispatcher uses, under pressure, on the order that is already going wrong
-- — did neither. It would happily offer a delivered or cancelled order, and it
-- raced auto_assign_order into double offers because neither held a lock the
-- other respected.
--
-- (4) is the same function's other half: reassignment repointed
-- orders.assigned_driver_id at the new driver and left the DISPLACED driver on
-- 'on_job' forever. The only release in the system (mig 054) keys off
-- v_order.assigned_driver_id at terminal status — which by then is the NEW
-- driver. The old one silently leaves the dispatchable pool, permanently: mig
-- 054's exact bug, reintroduced through the manual path.
--
-- ============================================================================
-- (5) A DRIVER COULD ACCEPT A CANCELLED ORDER
-- ============================================================================
-- driver_respond checked that the offer row said 'offered' and never read
-- orders.status. Accepting sets drivers.status='on_job'; the release only fires
-- from advance_order_status on a terminal transition, which for an
-- already-cancelled order has already happened. The driver is stuck on_job with
-- no job and drops out of dispatch until someone notices — (4)'s failure mode
-- reached by a different road.
--
-- ============================================================================
-- (6) DISPATCHER OFFERS NEVER EXPIRED
-- ============================================================================
-- auto_assign_order stamps offer_expires_at; assign_driver never has. dispatch_sweep
-- only expires offers `where offer_expires_at is not null`, so a dispatcher-created
-- offer is acceptable FOREVER. Three are live in production right now, two of them
-- on cancelled orders. Fixed at both ends: assign_driver stamps a real TTL, and
-- driver_respond treats a NULL expiry as expired (fail CLOSED — "we do not know
-- when this offer dies" must not mean "it never does"). The existing NULL rows are
-- backfilled below so the sweep can reap them with the machinery it already has.
--
-- ============================================================================
-- (7) auto_accept_sweep IGNORED restaurants.is_open
-- ============================================================================
-- is_open is the headline control in the restaurant app — the one a merchant hits
-- when the kitchen is slammed or closing. place_order honours it (MERCHANT_CLOSED).
-- auto_accept_sweep did not, so an order already at 'placed' when the merchant
-- paused was accepted on their behalf 180 seconds later and dispatched to a kitchen
-- that had just said no. A paused merchant's stale orders now simply sit at
-- 'placed', which is the correct outcome: dispatch_watchdog already pages a human
-- for placed orders past the threshold (mig 133), and a human should decide.
--
-- ============================================================================
-- (8) THE FRESH-PING GATE (MIG 201) EMPTIES THE DRIVER POOL
-- ============================================================================
-- Mig 201 was right about the disease and the dose is wrong. The driver app pings
-- when it goes online and while it is streaming an active job
-- (apps/driver/src/location.ts) — an IDLE online driver with no job does not ping
-- at all. With dispatch_max_ping_age_seconds = 300, every driver waiting for work
-- silently leaves the dispatchable pool five minutes after going online, and the
-- app still shows them "online · receiving offers". That is a total dispatch
-- outage wearing a fix's clothes.
--
-- TWO CHANGES, AND THE DIRECTION ARGUMENT FOR EACH.
--
-- The default moves 300s -> 28800s (8 hours, about one shift). Not "off": the
-- drivers that caused the 3,429-lap incident were two months stale, so eight
-- hours still excludes them, still excludes yesterday's shift, and still excludes
-- a driver who never pinged at all. It only stops excluding the driver who is
-- sitting in the app right now waiting for an offer. It is a platform_setting, so
-- when the idle heartbeat ships OTA this comes back down to ~600s with an UPDATE
-- and no migration.
--
-- A MISSING OR NULL THRESHOLD NOW FAILS OPEN — the gate is skipped entirely
-- rather than falling back to a tight 300s. This is the opposite of house rule 4,
-- and deliberately so: rule 4 is about AUTHORITY (may this actor do this?), where
-- an unknown answer must mean no. This is an AVAILABILITY filter, and the two
-- failure modes are not comparable. Gate absent, drivers stale: some offers land
-- on phones that are not listening, the offer TTL expires, dispatch moves on, and
-- the watchdog sees the churn (see (9) below). Gate present, threshold lost: the
-- candidate list is empty for every order, no driver is ever offered anything,
-- and the platform stops delivering food with no error anywhere — the failure has
-- no symptom except silence. Deleting one settings row must not be able to do
-- that. Availability fails open; authority fails closed.
--
-- ============================================================================
-- (9) dispatch_watchdog WAS BLIND TO OFFER CHURN
-- ============================================================================
-- Its stuck-order test requires `assigned_driver_id is null`. Churn STAMPS that
-- column at offer time, so an order being re-offered every 45 seconds for a day
-- has a non-null assigned_driver_id at almost every instant the watchdog looks.
-- The 3,429-lap order was found by a customer complaining, not by the alert that
-- exists precisely to find it. The watchdog now counts orders accumulating many
-- assignment rows in the window, which is the shape churn actually has.
--
-- ============================================================================
-- HOUSE RULES OBSERVED
-- ============================================================================
--   1. No argument list changes anywhere. Every redefinition below is
--      CREATE OR REPLACE with the identical signature, so no second overload and
--      no PGRST202. push_outbox_sweep(integer) is new and has one signature.
--   2. Every body was rebuilt from the LATEST migration that defines it, located
--      with `grep -rln "function public.<name>" supabase/migrations/`:
--        assign_driver       -> 150 (not 083/081/056/030/027/011)
--        driver_respond      -> 030 (not 027/011)
--        mark_cod_collected  -> 104 (not 050/029/015/011)
--        auto_accept_sweep   -> 026 (only definition)
--        dispatch_watchdog   -> 133 (not 119/066)
--        nearest_drivers     -> 201 (not 011)
--      The deltas are marked [203] inline; everything else is verbatim.
--   3. Every function re-asserts its revoke and its grants below, because
--      CREATE OR REPLACE preserves the old ACL and granting `authenticated` does
--      not revoke the default PUBLIC/anon EXECUTE this database hands out.
--   6. search_path is pinned on every function.

-- ###########################################################################
-- SECTION 1 — THE PUSH OUTBOX CONSUMER
-- ###########################################################################

-- ---------------------------------------------------------------------------
-- Schema the dispatcher needs.
-- ---------------------------------------------------------------------------
-- Two new status values, both unused by any existing row:
--   'dispatching' = claimed by a sweep, POST in flight. Distinct from
--                   'processing' (which expo-push writes on its OWN rows) so the
--                   reclaim query can never touch a row this sweep does not own.
--   'dispatched'  = the transport answered 2xx. Deliberately NOT 'complete':
--                   'complete' means "Expo accepted every attempt" and is what
--                   my_notification_inbox (mig 179) shows a customer.
alter table public.push_messages drop constraint if exists push_messages_status_check;
alter table public.push_messages add constraint push_messages_status_check
  check (status in ('queued','dispatching','dispatched','processing',
                    'complete','partly_failed','failed','suppressed'));

alter table public.push_messages
  add column if not exists dispatch_claimed_at timestamptz,
  add column if not exists dispatch_request_id bigint,
  add column if not exists dispatch_attempts   smallint not null default 0;

comment on column public.push_messages.dispatch_claimed_at is
  'When a push_outbox_sweep run claimed this row for POSTing. Only used to reclaim a claim whose sweep died before firing — without it a crashed claim sits in `dispatching` forever, which is a silently lost notification. Same role as push_attempts.claimed_at (mig 173). Mig 203.';
comment on column public.push_messages.dispatch_request_id is
  'The pg_net request id of the POST to /expo-push. net.http_post is async, so the NEXT sweep reads net._http_response for this id to learn whether the transport accepted the message. Precise, rather than guessing from elapsed time. Mig 203.';
comment on column public.push_messages.dispatch_attempts is
  'How many times this row has been POSTed to /expo-push. Caps the dispatch-leg retry at 3 so a permanently-broken transport cannot re-POST one message forever. Counts DISPATCH attempts, not per-token send attempts — those live on push_attempts. Mig 203.';

-- The reclaim query wants stale claims cheaply. Mirrors push_attempts_stale_claim_idx.
create index if not exists push_messages_dispatching_idx
  on public.push_messages (dispatch_claimed_at) where status = 'dispatching';

-- ---------------------------------------------------------------------------
-- push_outbox_sweep — claim queued messages and hand them to expo-push.
-- ---------------------------------------------------------------------------
create or replace function public.push_outbox_sweep(p_limit integer default 50)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_base      text;
  v_limit     int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_max_tries int := 3;
  v_rec       record;
  v_req       bigint;
  v_status    int;
  v_count     int := 0;
  -- clock_timestamp(), not now(): now() is constant for the whole transaction,
  -- and this value's only job is to be unique to THIS run so the claim can be
  -- read back without a cursor over a data-modifying CTE (see phase 3).
  v_run       timestamptz := clock_timestamp();
begin
  select value #>> '{}' into v_base
    from public.platform_settings where key = 'functions_base_url';
  -- No configured base URL means this environment has no edge functions. Return
  -- quietly rather than raising, so local and staging cron history stays clean —
  -- same reasoning as push_receipt_sweep (mig 174).
  if v_base is null or v_base = '' then
    return 0;
  end if;

  -- -------------------------------------------------------------------------
  -- PHASE 1 — judge the POSTs the PREVIOUS run fired.
  -- -------------------------------------------------------------------------
  for v_rec in
    select m.id, m.dispatch_request_id, m.dispatch_attempts, m.dispatch_claimed_at
      from public.push_messages m
     where m.status = 'dispatching'
     order by m.dispatch_claimed_at asc nulls first
     limit 200
  loop
    begin
      v_status := null;
      if v_rec.dispatch_request_id is not null then
        select r.status_code into v_status
          from net._http_response r
         where r.id = v_rec.dispatch_request_id;
      end if;

      if v_status between 200 and 299 then
        -- The transport has it. Delivery truth now lives on expo-push's own
        -- push_messages row and on push_attempts, not here.
        update public.push_messages
           set status = 'dispatched',
               settled_at = now(),
               dispatch_claimed_at = null
         where id = v_rec.id;

      elsif v_status is not null then
        -- A definitive non-2xx. expo-push only answers non-2xx BEFORE it sends
        -- anything (503 unconfigured / 401 bad secret / 400 bad body / 500 from
        -- the outer catch), so re-POSTing cannot double-send.
        update public.push_messages
           set status = case when v_rec.dispatch_attempts >= v_max_tries then 'failed' else 'queued' end,
               settled_at = case when v_rec.dispatch_attempts >= v_max_tries then now() else settled_at end,
               dispatch_claimed_at = null,
               dispatch_request_id = null
         where id = v_rec.id;

      elsif coalesce(v_rec.dispatch_claimed_at, '-infinity'::timestamptz) < now() - interval '5 minutes' then
        -- No response row at all, long after the fact: the request was lost, or
        -- this sweep died between claiming and firing. Either way nothing is
        -- known to have been sent. Five minutes is far longer than any real
        -- round trip, so this only ever catches a genuine loss.
        update public.push_messages
           set status = case when v_rec.dispatch_attempts >= v_max_tries then 'failed' else 'queued' end,
               settled_at = case when v_rec.dispatch_attempts >= v_max_tries then now() else settled_at end,
               dispatch_claimed_at = null,
               dispatch_request_id = null
         where id = v_rec.id;
      end if;
      -- Anything else is simply still in flight; the next run looks again.
    exception when others then
      -- One row's failure must not stop the rest being judged (mig 199's rule).
      raise warning 'push_outbox_sweep: settling % failed: % (%)', v_rec.id, sqlerrm, sqlstate;
    end;
  end loop;

  -- -------------------------------------------------------------------------
  -- PHASE 2 — retire messages whose business event has gone stale.
  -- -------------------------------------------------------------------------
  -- mig 172 gives every event its own window ("your driver is arriving" is
  -- worthless after 30 minutes). Sending past it is misinformation, not a late
  -- notification, so these are suppressed rather than dispatched.
  update public.push_messages
     set status = 'suppressed',
         suppression_reason = 'expired',
         settled_at = now()
   where status = 'queued'
     and expires_at <= now();

  -- -------------------------------------------------------------------------
  -- PHASE 3 — claim, then fire.
  -- -------------------------------------------------------------------------
  -- The claim is a WRITE in the same statement as the select, under
  -- `for update skip locked`: two overlapping runs must never take the same row,
  -- because two POSTs is two pushes to the customer. Same shape as
  -- claim_push_retries (mig 173).
  --
  -- It is a STANDALONE statement rather than the CTE feeding the loop below,
  -- and that is not a style choice: PL/pgSQL's `for ... in <query>` opens a
  -- cursor, and a cursor may not contain data-modifying statements in WITH
  -- ("DECLARE CURSOR must not contain data-modifying statements in WITH"). The
  -- rows claimed here are then re-read by their claim stamp — v_run is this
  -- run's clock_timestamp(), so it identifies exactly the rows this call took,
  -- and the rows are already exclusively ours by the time we read them back.
  with claimed as (
    select m.id
      from public.push_messages m
     where m.status = 'queued'
       and m.expires_at > now()
     order by m.queued_at asc
     limit v_limit
     for update of m skip locked
  )
  update public.push_messages m
     set status = 'dispatching',
         dispatch_claimed_at = v_run,
         dispatch_attempts = m.dispatch_attempts + 1,
         dispatch_request_id = null
    from claimed c
   where m.id = c.id;

  for v_rec in
    select m.id, m.event, m.order_id, m.recipient_user_ids, m.route,
           m.vertical, m.custom_title, m.custom_body
      from public.push_messages m
     where m.status = 'dispatching'
       and m.dispatch_claimed_at = v_run
  loop
    begin
      -- The request body is exactly expo-push's documented contract
      -- (functions/expo-push/index.ts PushBody). jsonb_strip_nulls because the
      -- function distinguishes an absent field from a null one: absent orderId
      -- means "not about an order", and absent recipientUserIds means "resolve
      -- the order's customer yourself", which is what driver_assigned needs.
      select net.http_post(
        url     := v_base || '/expo-push',
        body    := jsonb_strip_nulls(jsonb_build_object(
                     'event',            v_rec.event,
                     'orderId',          v_rec.order_id::text,
                     'recipientUserIds', to_jsonb(v_rec.recipient_user_ids),
                     'route',            v_rec.route,
                     'vertical',         v_rec.vertical,
                     'title',            v_rec.custom_title,
                     'body',             v_rec.custom_body
                   )),
        headers := public.push_headers()
      ) into v_req;

      update public.push_messages
         set dispatch_request_id = v_req
       where id = v_rec.id;
      v_count := v_count + 1;
    exception when others then
      -- Could not even queue the request. Put the row back so the next run tries
      -- again, unless it has already burned its attempts.
      update public.push_messages
         set status = case when dispatch_attempts >= v_max_tries then 'failed' else 'queued' end,
             settled_at = case when dispatch_attempts >= v_max_tries then now() else settled_at end,
             dispatch_claimed_at = null
       where id = v_rec.id;
      raise warning 'push_outbox_sweep: posting % failed: % (%)', v_rec.id, sqlerrm, sqlstate;
    end;
  end loop;

  -- -------------------------------------------------------------------------
  -- PHASE 4 — reap per-token attempts that can never be retried.
  -- -------------------------------------------------------------------------
  -- claim_push_retries (mig 173) refuses attempts whose message has expired, and
  -- has no caller anyway (see the header). Without this those rows sit in
  -- 'retryable_failed' forever, so the retry backlog only ever grows and the
  -- watchdog count below would be meaningless. 'expired' is already in the
  -- push_attempts vocabulary and had no writer until now.
  update public.push_attempts a
     set status = 'expired',
         settled_at = now(),
         claimed_at = null,
         next_attempt_at = null
    from public.push_messages m
   where m.id = a.message_id
     and a.status in ('queued', 'processing', 'retryable_failed')
     and m.expires_at <= now();

  return v_count;
exception when others then
  -- The sweep is idempotent by construction: whatever this run missed, the next
  -- one picks up. A raise would only make the cron job look broken.
  raise warning 'push_outbox_sweep failed: % (%)', sqlerrm, sqlstate;
  return v_count;
end;
$function$;

revoke all on function public.push_outbox_sweep(integer) from public, anon, authenticated;
grant execute on function public.push_outbox_sweep(integer) to postgres;

comment on function public.push_outbox_sweep(integer) is
  'The missing consumer of the push outbox. Claims queued push_messages rows (for update skip locked, so two overlapping runs cannot double-send) and POSTs each to the expo-push edge function, then judges the previous run''s POSTs via net._http_response — the async self-pipelining shape site_health_sweep (mig 199) uses, because net.http_post returns a request id rather than a response. Terminal state here is ''dispatched'' = the transport accepted it; delivery truth lives on expo-push''s own push_messages row and on push_attempts, and ''complete'' is deliberately left to that row so a dispatch-intent row never appears in my_notification_inbox. Also suppresses messages past their per-event expiry (mig 172) and reaps push_attempts whose message expired. Does NOT drive claim_push_retries: a per-token re-send needs expo-push to accept a token target, which it does not. Written after the round-2 audit found driver_assigned/order_ready_pickup/low_rating had been enqueued and never sent since mig 200. Mig 203.';

-- ---------------------------------------------------------------------------
-- Schedule it — and the receipt poller, which mig 174 built and never scheduled.
-- ---------------------------------------------------------------------------
-- 20 seconds matches dispatch_sweep and auto_accept_sweep. A push is claimed and
-- fired in the SAME run, so worst-case latency to the transport is one tick; only
-- the bookkeeping lags a cycle.
create extension if not exists pg_cron;

-- cron.schedule upserts by name — idempotent on replay (mig 199's note).
select cron.schedule('sharmeats-push-outbox', '20 seconds', $$select public.push_outbox_sweep();$$);

-- push_receipt_sweep (mig 174) has existed with no cron entry since it was
-- written, so no Expo receipt has ever been polled. Every 2 minutes matches its
-- own documented cadence expectations and is well inside Expo's receipt window.
select cron.schedule('sharmeats-push-receipts', '*/2 * * * *', $$select public.push_receipt_sweep();$$);

-- ###########################################################################
-- SECTION 2 — SETTINGS
-- ###########################################################################

-- (6) How long a dispatcher-created offer stays acceptable. Longer than the auto
-- TTL (45s) on purpose: a human picked this specific driver, often to rescue an
-- order auto-dispatch could not place, and 45 seconds is not enough for a driver
-- who is mid-handover to look at their phone. Five minutes is still a bounded
-- window rather than the forever it is today.
insert into public.platform_settings (key, value)
values ('dispatch_manual_offer_ttl_seconds', to_jsonb(300))
on conflict (key) do nothing;

-- (9) How many assignment rows an order may accumulate inside the watchdog
-- window before it is called churn. At the default 45-second offer TTL a healthy
-- order collects one or two in ten minutes; the incident order was collecting
-- roughly thirteen.
insert into public.platform_settings (key, value)
values ('dispatch_churn_offers_threshold', to_jsonb(8))
on conflict (key) do nothing;

-- (8) Raise the ping-freshness window from mig 201's 300s to one shift.
--
-- Conditional on the value still being exactly mig 201's default, so a
-- deliberate operator tuning made between then and now is not silently
-- clobbered. If someone has already moved it, they had a reason and this leaves
-- it alone.
update public.platform_settings
   set value = to_jsonb(28800), updated_at = now()
 where key = 'dispatch_max_ping_age_seconds'
   and value = to_jsonb(300);

-- Belt and braces for a database that never got mig 201's insert.
insert into public.platform_settings (key, value)
values ('dispatch_max_ping_age_seconds', to_jsonb(28800))
on conflict (key) do nothing;

-- ###########################################################################
-- SECTION 3 — nearest_drivers: the freshness gate, survivable
-- ###########################################################################
-- Body from mig 201 (the only later definition than 011), same signature, same
-- return table — no second overload. The single delta is the availability-fails-
-- open reasoning argued at length in the header: an ABSENT threshold now means
-- "do not apply the gate", where before it meant "apply a 300-second one".
create or replace function public.nearest_drivers(
  p_geo geography,
  p_radius_m integer default 4000,
  p_limit integer default 10
)
returns table(driver_id uuid, name text, vehicle vehicle_type, distance_m double precision, status text)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with cfg as (
    -- Read once. nullif so an empty string is treated as unset rather than
    -- raising on the cast.
    select (select nullif(value #>> '{}', '')::int
              from public.platform_settings
             where key = 'dispatch_max_ping_age_seconds') as max_age
  )
  select d.id, d.name, d.vehicle, st_distance(d.current_geo, p_geo) as distance_m, d.status
  from public.drivers d, cfg
  where d.is_active and d.is_verified and d.status = 'online'
    and d.current_geo is not null
    -- [203] The gate applies only when a threshold is actually configured.
    -- Losing the setting must degrade to "dispatch as we did before mig 201",
    -- never to "the fleet is empty and nothing says why" — see the header for
    -- why an availability filter fails open where an authority check fails
    -- closed. A driver who has never pinged is still excluded whenever the gate
    -- IS on, via the -infinity coalesce mig 201 introduced.
    and (
          cfg.max_age is null
       or cfg.max_age <= 0
       or coalesce(d.last_ping_at, '-infinity'::timestamptz)
            > now() - make_interval(secs => cfg.max_age)
        )
    and st_dwithin(d.current_geo, p_geo, p_radius_m)
  order by st_distance(d.current_geo, p_geo) asc
  limit p_limit;
$function$;

-- Grants restated to exactly what mig 201 asserted: service_role only. Anything
-- broader hands every signed-in user the live positions of the whole fleet.
revoke all on function public.nearest_drivers(geography, integer, integer)
  from public, anon, authenticated;
grant execute on function public.nearest_drivers(geography, integer, integer) to service_role;

comment on function public.nearest_drivers(geography, integer, integer) is
  'Dispatchable drivers near a point: active, verified, online, with a position and — when platform_settings.dispatch_max_ping_age_seconds is set — a ping newer than it. Mig 203 raised that default to 28800s (one shift) because the driver app only pings on going online and while streaming a job, so a 300s window silently emptied the pool of every idle driver; and made an ABSENT threshold skip the gate rather than fall back to 300s, because an availability filter that fails closed stops the whole platform with no symptom. Lower it back toward 600s once the driver idle heartbeat ships (a settings UPDATE, not a migration).';

-- ###########################################################################
-- SECTION 4 — assign_driver: lock, validate, expire, release
-- ###########################################################################
-- Body from mig 150 (the latest definition; NOT 083/081/056/030/027/011), same
-- signature. Four deltas, all marked [203]:
--   a. lock and validate the order before anything else;
--   b. remember the driver being displaced;
--   c. stamp a real offer_expires_at;
--   d. release the displaced driver back to 'online'.
create or replace function public.assign_driver(p_order_id uuid, p_driver_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_role app_role := public.auth_role(); v_user uuid := auth.uid();
  v_prof uuid; v_base text;
  v_cap record;
  v_order public.orders;   -- [203]
  v_prev  uuid;            -- [203] the driver this assignment displaces
  v_ttl   int;             -- [203]
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode='check_violation'; end if;
  if coalesce(v_role::text,'') not in ('admin','dispatcher') then raise exception 'NOT_AUTHORIZED' using errcode='check_violation'; end if;

  -- [203a] Lock the order BEFORE any other read or write. Two reasons, both
  -- observed in production:
  --   * auto_assign_order (mig 189) takes exactly this lock first. Without it
  --     the cron sweep and a dispatcher could both pass their "no active
  --     assignment" test and both insert an offer, and only the partial unique
  --     index would decide who lost — after both had already pushed a driver.
  --   * nothing here ever asked what state the order was in, so a delivered or
  --     cancelled order could be offered to a driver who would then be stuck
  --     on_job with no job (see driver_respond below for the other half).
  -- Lock order throughout this migration is ALWAYS orders -> order_assignments,
  -- so assign_driver and driver_respond cannot deadlock against each other.
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode='check_violation'; end if;
  if v_order.status in ('delivered','cancelled','rejected') then
    raise exception 'ORDER_TERMINAL: cannot assign a driver to a % order', v_order.status
      using errcode='check_violation';
  end if;
  -- [203b] Captured before the update below repoints it.
  v_prev := v_order.assigned_driver_id;

  if not exists (select 1 from public.drivers where id=p_driver_id and is_active and is_verified and status<>'offline') then
    raise exception 'DRIVER_NOT_ELIGIBLE: driver must be active, verified and online' using errcode='check_violation'; end if;

  -- [149] COD exposure ceiling. Evaluated INSIDE this transaction so a
  -- concurrent assignment cannot slip past between the check and the insert.
  select * into v_cap from public.driver_cod_capacity(p_driver_id, p_order_id);

  -- ORDER MATTERS. There is no dblink here, so this INSERT lives in the same
  -- transaction as the raise below -- and a raise rolls it back. The assertion
  -- pack caught exactly that: blocked attempts, the events an operator most
  -- needs, were the only ones never recorded.
  --
  -- The fix is ordering, made explicit: log first, and let the CALLER decide to
  -- raise. A blocked assignment is surfaced to the dispatcher through the
  -- ops_alert below (which uses pg_net and therefore survives), while the
  -- durable row is written by the auto path and by every non-blocking outcome.
  perform public.log_cod_limit_event(
    p_driver_id, p_order_id, v_cap.outcome, v_cap.held_egp, v_cap.prospective_egp,
    v_cap.soft_limit_egp, v_cap.hard_limit_egp, v_cap.mode);

  if v_cap.outcome = 'blocked' then
    -- Alert BEFORE raising: ops_alert goes out over pg_net, which is not part
    -- of this transaction, so it survives the rollback that the raise causes.
    -- Without it a hard block would be completely invisible after the fact.
    begin
      perform public.ops_alert(
        '[COD] BLOCKED assignment: driver holds ' || v_cap.held_egp
        || ' EGP, +' || v_cap.prospective_egp || ' EGP this order (hard limit '
        || v_cap.hard_limit_egp || '). A hand-in restores capacity.');
    exception when others then null;
    end;
    -- A dispatcher chose this person; tell them plainly why it was refused and
    -- what fixes it. A stable error code so the UI can localise it.
    raise exception 'COD_LIMIT_EXCEEDED: driver holds % EGP, this order adds % EGP, hard limit is % EGP. A cash hand-in restores capacity.',
      v_cap.held_egp, v_cap.prospective_egp, v_cap.hard_limit_egp
      using errcode='check_violation';
  end if;

  -- [203c] A dispatcher offer now expires like an automatic one. Until this,
  -- assign_driver was the ONLY producer of order_assignments rows with a null
  -- offer_expires_at, and dispatch_sweep's expiry pass skips nulls — so those
  -- offers stayed acceptable forever, including on orders that had since been
  -- cancelled. Three such rows were live in production when this was written.
  select coalesce((value #>> '{}')::int, 300) into v_ttl
    from public.platform_settings where key='dispatch_manual_offer_ttl_seconds';

  update public.order_assignments set status='reassigned', responded_at=now() where order_id=p_order_id and status in ('offered','accepted');
  insert into public.order_assignments (order_id, driver_id, status, assigned_by, assigned_by_id, offer_expires_at)
  values (p_order_id,p_driver_id,'offered','dispatcher',v_user, now() + make_interval(secs => coalesce(v_ttl,300)));
  update public.orders set assigned_driver_id=p_driver_id, rider=public.rider_snapshot(p_driver_id) where id=p_order_id;

  -- [203d] Release the driver this reassignment displaced.
  --
  -- Mig 054 is the only thing in the system that returns a driver to 'online',
  -- and it keys off orders.assigned_driver_id at terminal status — which, after
  -- the update above, is the NEW driver. The displaced one keeps
  -- drivers.status='on_job' forever and silently leaves the dispatchable pool:
  -- mig 054's fleet-decay bug, reached through the manual path.
  --
  -- Guarded exactly like mig 054's release, plus one more condition: only
  -- release a driver who has no OTHER live order. A driver mid-delivery on a
  -- different order is legitimately on_job and must not be handed back to
  -- dispatch. 'on_job' is also required, so a driver who went offline mid-shift
  -- is left where they put themselves.
  if v_prev is not null and v_prev <> p_driver_id then
    update public.drivers d
       set status = 'online'
     where d.id = v_prev
       and d.status = 'on_job'
       and not exists (
             select 1 from public.orders o
              where o.assigned_driver_id = v_prev
                and o.id <> p_order_id
                and o.status in ('accepted','preparing','ready','picked_up','out_for_delivery'));
  end if;

  -- Crossing the soft limit is not a refusal, but ops should see it coming
  -- rather than discover it at the hard limit.
  if v_cap.outcome in ('warned','would_block') then
    begin
      perform public.ops_alert(
        case when v_cap.outcome = 'would_block'
             then '[COD observe] would have BLOCKED assignment: driver holds '
             else '[COD] driver over soft limit: holds ' end
        || v_cap.held_egp || ' EGP, +' || v_cap.prospective_egp
        || ' EGP this order (soft ' || v_cap.soft_limit_egp || ', hard ' || v_cap.hard_limit_egp || ')');
    exception when others then null;
    end;
  end if;

  -- [083] Notify the manually-assigned driver (was silent; recovery path when
  -- auto-dispatch fails). Best-effort; a push failure must not abort the assign.
  begin
    select profile_id into v_prof from public.drivers where id = p_driver_id;
    select value #>> '{}' into v_base from public.platform_settings where key='functions_base_url';
    if v_prof is not null and v_base is not null and v_base <> '' then
      perform net.http_post(
        url := v_base || '/expo-push',
        body := jsonb_build_object('event','new_offer','orderId',p_order_id::text,'recipientUserIds',jsonb_build_array(v_prof::text)),
        headers := public.push_headers());
    end if;
  exception when others then null;
  end;
end; $function$;

revoke all on function public.assign_driver(uuid, uuid) from public, anon;
grant execute on function public.assign_driver(uuid, uuid) to authenticated;

comment on function public.assign_driver(uuid, uuid) is
  'Dispatcher assignment. Applies the COD exposure ceiling and RAISES COD_LIMIT_EXCEEDED when enforcing -- a dispatcher chose this driver, so a refusal must be loud enough to redirect them (migs 083/149/150). Mig 203 added the three guards auto_assign_order has had since mig 025: it LOCKS the order first (same lock, so the cron sweep and a dispatcher can no longer both create an offer), refuses terminal orders, stamps a real offer_expires_at from dispatch_manual_offer_ttl_seconds (it was previously the only producer of never-expiring offers), and RELEASES the displaced driver from on_job when a reassignment repoints the order -- mig 054''s fleet-decay bug, reached through the manual path.';

-- ###########################################################################
-- SECTION 5 — driver_respond: an offer on a dead order is not an offer
-- ###########################################################################
-- Body from mig 030 (the latest definition; NOT 027/011), same signature. Three
-- deltas, all marked [203]: the lock order is inverted to orders-then-assignment,
-- a lapsed or unbounded offer cannot be accepted, and a terminal order cannot be
-- accepted.
create or replace function public.driver_respond(p_assignment_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user  uuid := auth.uid();
  v_asg   public.order_assignments;
  v_drv   public.drivers;
  v_order public.orders;   -- [203]
  v_oid   uuid;            -- [203]
begin
  -- [203] Lock ORDERS first, then the assignment. assign_driver takes the same
  -- two locks in that order; taking them the other way round here is a textbook
  -- ABBA deadlock between a dispatcher reassigning and the displaced driver
  -- accepting. An unlocked read just to learn the order id is safe: the
  -- assignment row is re-read under FOR UPDATE below and everything is decided
  -- from that copy.
  select order_id into v_oid from public.order_assignments where id = p_assignment_id;
  if not found then raise exception 'ASSIGNMENT_NOT_FOUND' using errcode = 'check_violation'; end if;

  select * into v_order from public.orders where id = v_oid for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'check_violation'; end if;

  select * into v_asg from public.order_assignments where id = p_assignment_id for update;
  if not found then raise exception 'ASSIGNMENT_NOT_FOUND' using errcode = 'check_violation'; end if;

  select * into v_drv from public.drivers where id = v_asg.driver_id;
  if v_drv.profile_id is distinct from v_user then
    raise exception 'NOT_YOUR_ASSIGNMENT' using errcode = 'check_violation';
  end if;
  if v_asg.status <> 'offered' then
    raise exception 'ALREADY_RESPONDED' using errcode = 'check_violation';
  end if;

  if p_accept then
    -- [030] only a verified, active driver may ACCEPT work. (Reject falls
    -- through below and is always permitted.)
    if not (v_drv.is_verified and v_drv.is_active) then
      raise exception 'DRIVER_NOT_ELIGIBLE: driver must be active and verified to accept'
        using errcode = 'check_violation';
    end if;

    -- [203] The offer must still be live. A NULL expiry FAILS CLOSED: "we do not
    -- know when this offer dies" must not be read as "it never does". Every
    -- producer stamps one now (auto since mig 025, dispatcher since mig 203),
    -- so a null here means a legacy row -- and the legacy rows in production are
    -- precisely the ones sitting acceptable on cancelled orders. The one-time
    -- backfill at the end of this migration lets dispatch_sweep reap them.
    if v_asg.offer_expires_at is null or v_asg.offer_expires_at < now() then
      raise exception 'OFFER_EXPIRED: this offer is no longer available'
        using errcode = 'check_violation';
    end if;

    -- [203] And the order must still be a job. Without this a driver could
    -- accept an order that was cancelled while the offer sat on their screen,
    -- become drivers.status='on_job' with nothing to do, and stay there: the
    -- release in advance_order_status (mig 054) fires on the terminal
    -- transition, which for this order already happened.
    if v_order.status in ('delivered','cancelled','rejected') then
      raise exception 'ORDER_NOT_AVAILABLE: this order is already %', v_order.status
        using errcode = 'check_violation';
    end if;

    update public.order_assignments set status = 'accepted', responded_at = now() where id = p_assignment_id;
    update public.drivers set status = 'on_job' where id = v_asg.driver_id;
    -- Customer-facing: fill the rider card now that a real driver owns the order.
    update public.orders
       set rider = public.rider_snapshot(v_asg.driver_id)
     where id = v_asg.order_id;
  else
    update public.order_assignments set status = 'rejected', responded_at = now() where id = p_assignment_id;
    -- Clear both the id and the snapshot so the card reverts to "finding a driver".
    -- [203] Scoped to THIS driver: between the offer and the rejection a
    -- dispatcher may have reassigned the order to someone else, and a late
    -- decline must not wipe the new driver off the customer's card.
    update public.orders set assigned_driver_id = null, rider = null
     where id = v_asg.order_id
       and assigned_driver_id = v_asg.driver_id;
  end if;
end;
$function$;

revoke all on function public.driver_respond(uuid, boolean) from public, anon;
grant execute on function public.driver_respond(uuid, boolean) to authenticated;

comment on function public.driver_respond(uuid, boolean) is
  'A driver accepts or rejects an offer. Requires a verified, active driver to accept (mig 030). Mig 203 added: the order is locked BEFORE the assignment (same order as assign_driver, so the two cannot deadlock); an offer whose offer_expires_at has passed OR IS NULL cannot be accepted (null fails closed -- a never-expiring offer on a cancelled order was live in production); a terminal order cannot be accepted, which previously left the driver permanently on_job with no job; and a late rejection only clears orders.assigned_driver_id when it still points at the rejecting driver.';

-- ###########################################################################
-- SECTION 6 — mark_cod_collected: cash is collected at the door
-- ###########################################################################
-- Body from mig 104 (the latest definition; NOT 050/029/015/011), same
-- signature. One delta, marked [203].
create or replace function public.mark_cod_collected(p_order_id uuid, p_amount integer)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user   uuid := auth.uid();
  v_order  public.orders;
  v_drv    public.drivers;
  v_role   app_role := public.auth_role();
  v_is_self boolean;
  v_bonus  int;
  v_cash   int;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'check_violation'; end if;
  if v_order.payment_method <> 'cash_on_delivery' then
    raise exception 'NOT_A_COD_ORDER' using errcode = 'check_violation';
  end if;

  -- [203] The order must be far enough along that cash could physically have
  -- changed hands. Without this, COD was markable paid on a 'placed' order and,
  -- worse, on a CANCELLED one -- and paid+cancelled has no un-pay path anywhere
  -- while still writing driver_earnings and the driver cash ledger, i.e. a
  -- permanent phantom liability against a driver.
  --
  -- The only client gate was a confirm dialog in the driver app
  -- (apps/driver/app/job/[id].tsx:184). This is a money write; the gate belongs
  -- next to the money.
  --
  -- 'picked_up' is included, not just out_for_delivery/delivered, because the
  -- merchant self_delivery path does not always pass through out_for_delivery
  -- and blocking it would break a live flow to fix a different bug. 'delivered'
  -- is included so a retry after a dropped connection still settles.
  if v_order.status not in ('picked_up','out_for_delivery','delivered') then
    raise exception 'COD_TOO_EARLY: cannot collect cash on a % order', v_order.status
      using errcode = 'check_violation';
  end if;

  if p_amount is not null and p_amount <> v_order.total_egp then
    raise exception 'COD_AMOUNT_MISMATCH: expected % got %', v_order.total_egp, p_amount
      using errcode = 'check_violation';
  end if;

  v_is_self := (v_order.fulfillment_type = 'self_delivery');

  select * into v_drv from public.drivers where id = v_order.assigned_driver_id;

  if v_role = 'admin' then
    null;
  elsif v_drv.id is not null and v_drv.profile_id is not distinct from v_user then
    null;
  elsif v_is_self and public.is_merchant_staff(v_order.restaurant_id) then
    null;
  else
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;

  update public.orders set payment_status = 'paid' where id = p_order_id;

  v_cash := coalesce(p_amount, v_order.total_egp);

  if v_order.assigned_driver_id is not null then
    select coalesce(bonus_per_delivery_egp, 0) into v_bonus
      from public.driver_loyalty
     where driver_id = v_order.assigned_driver_id;

    insert into public.driver_earnings (driver_id, order_id, delivery_fee_share, tip, bonus, cod_collected, total)
    values (
      v_order.assigned_driver_id, p_order_id,
      v_order.delivery_fee_egp, v_order.tip_egp,
      coalesce(v_bonus, 0),
      v_cash,
      v_order.delivery_fee_egp + v_order.tip_egp + coalesce(v_bonus, 0)
    )
    on conflict (order_id) do update set cod_collected = excluded.cod_collected;

    -- [104] Credit the driver's cash-custody ledger: they now physically hold this
    -- cash and owe it to the platform. Idempotent per order (partial unique index).
    -- A courier-delivered COD only — for self_delivery the restaurant holds the cash,
    -- not a driver, so skip when there is no assigned driver (already guarded above).
    insert into public.driver_cash_ledger (driver_id, delta_egp, reason, ref_order_id, actor_id)
    values (v_order.assigned_driver_id, v_cash, 'cod_collected', p_order_id, v_user)
    on conflict (ref_order_id) where reason = 'cod_collected' do nothing;
  end if;
end;
$function$;

revoke all on function public.mark_cod_collected(uuid, integer) from public, anon;
grant execute on function public.mark_cod_collected(uuid, integer) to authenticated;

comment on function public.mark_cod_collected(uuid, integer) is
  'Records COD cash taken from the customer: marks the order paid, writes driver_earnings and credits the driver cash-custody ledger (migs 011/015/029/050/104). Mig 203 added the order-status gate the function never had -- cash may only be marked collected once the order is picked_up, out_for_delivery or delivered. Before it, COD was markable paid on a placed or CANCELLED order, and paid+cancelled has no un-pay path while still feeding driver settlement. The only previous gate was a confirm dialog in the driver app.';

-- ###########################################################################
-- SECTION 7 — auto_accept_sweep respects a closed kitchen
-- ###########################################################################
-- Body from mig 026 (the only definition), same signature. One delta, marked
-- [203].
create or replace function public.auto_accept_sweep()
returns int
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_enabled bool;
  v_after   int;
  v_count   int := 0;
  v_rec     record;
begin
  -- Master switch. Inert until ops flips it on.
  select coalesce((value #>> '{}')::bool, false) into v_enabled
    from public.platform_settings where key = 'auto_accept_enabled';
  if not v_enabled then
    return 0;
  end if;

  select coalesce((value #>> '{}')::int, 180) into v_after
    from public.platform_settings where key = 'auto_accept_after_seconds';

  -- Find orders still waiting on the merchant past their grace window.
  -- COD only; card orders must be paid before they're eligible.
  for v_rec in
    select o.id
      from public.orders o
      -- [203] Honour the merchant's own open/closed switch. is_open is the
      -- control the restaurant app puts front and centre -- the one a merchant
      -- hits when the kitchen is slammed or shutting for the night -- and
      -- place_order has always refused a closed merchant (MERCHANT_CLOSED).
      -- This sweep did not, so an order that was already 'placed' when they
      -- paused was accepted on their behalf 180 seconds later and dispatched to
      -- a kitchen that had just said no. Their pause control did not cover the
      -- orders already in flight, which is the only case it needed to.
      --
      -- A paused merchant's stale orders now sit at 'placed'. That is deliberate
      -- and not a new hole: dispatch_watchdog pages a human for placed orders
      -- past the threshold (mig 133), and whether to cancel or wait is a
      -- decision for that human, not for a cron job.
      --
      -- An inner join, so an order whose restaurant row has gone missing is not
      -- auto-accepted either -- an unknown merchant is not an open one.
      join public.restaurants r on r.id = o.restaurant_id
     where o.status = 'placed'
       and r.is_active and r.is_open
       and o.placed_at < now() - make_interval(secs => coalesce(v_after, 180))
       and (
             o.payment_method = 'cash_on_delivery'
          or (o.payment_method = 'card' and o.payment_status = 'paid')
           )
     order by o.placed_at asc
     limit 50  -- bound per-tick work; backlog drains over subsequent ticks
  loop
    begin
      update public.orders
         set status = 'accepted',
             accepted_at = now()
       where id = v_rec.id
         and status = 'placed';  -- re-check under no lock race: merchant may have just accepted

      -- Only count + audit if we actually moved it (merchant didn't beat us).
      -- actor_role is NULL: the app_role enum has no 'system' member, and a NULL
      -- role honestly says "no human actor — the platform did this on a timeout".
      if found then
        insert into public.order_status_events (order_id, status, actor_role, actor_id, note)
        values (v_rec.id, 'accepted', null, null, 'Auto-accepted (merchant timeout)');
        v_count := v_count + 1;
      end if;
    exception when others then
      -- Best-effort per order: one bad row must not abort the whole sweep.
      raise warning 'auto_accept_sweep: order % failed: % (%)', v_rec.id, sqlerrm, sqlstate;
    end;
  end loop;

  return v_count;
end;
$function$;

revoke all on function public.auto_accept_sweep() from public, anon, authenticated;
grant execute on function public.auto_accept_sweep() to postgres;

comment on function public.auto_accept_sweep() is
  'Hybrid acceptance safety net (pg_cron, 20s). When auto_accept_enabled is true, advances COD orders still at ''placed'' past auto_accept_after_seconds to ''accepted'' (system actor) so dispatch_sweep can pick them up; a merchant accepting first pre-empts it. Mig 203: skips merchants that are not is_active AND is_open, because the restaurant app''s pause/close control previously had no effect on orders already in flight -- they were auto-accepted into a kitchen that had just closed. Those orders now sit at ''placed'' and dispatch_watchdog pages a human (mig 133).';

-- ###########################################################################
-- SECTION 8 — dispatch_watchdog can see churn, and can see the push backlog
-- ###########################################################################
-- Body from mig 133 (the latest definition; NOT 119/066), same signature (none),
-- so no second overload. Two new counts, both marked [203], folded into the
-- existing message and the existing mig 119 cooldown.
create or replace function public.dispatch_watchdog()
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_mins          int;
  v_stuck         int := 0;
  v_placed        int := 0;
  v_sweeps_failed int := 0;
  v_churn         int := 0;   -- [203]
  v_churn_min     int;        -- [203]
  v_push_stalled  int := 0;   -- [203]
  v_push_dead     int := 0;   -- [203]
  v_cd            int;
  v_last          timestamptz;
  v_msg           text;
begin
  select coalesce((value #>> '{}')::int, 10) into v_mins
    from public.platform_settings where key = 'dispatch_stuck_order_minutes';

  select count(*) into v_stuck
    from public.orders o
   where o.status in ('accepted','ready')
     and o.assigned_driver_id is null
     and o.placed_at < now() - make_interval(mins => coalesce(v_mins,10));

  -- [133] Placed orders past the threshold mean auto-accept is broken or off
  -- AND the merchant has not acted -- the order is invisible on every screen
  -- that filters on accepted+. Page a human.
  select count(*) into v_placed
    from public.orders o
   where o.status = 'placed'
     and o.placed_at < now() - make_interval(mins => coalesce(v_mins,10));

  -- [203] OFFER CHURN. The v_stuck test above requires assigned_driver_id IS
  -- NULL, and churn STAMPS that column at offer time -- so an order being
  -- re-offered every 45 seconds is non-null almost every instant the watchdog
  -- looks at it, and counts as healthy. That is why the 3,429-lap order was
  -- found by a customer complaint rather than by this function.
  --
  -- Churn's real shape is many assignment rows on ONE order in a short window.
  -- A healthy order collects one or two per ten minutes; the incident order was
  -- collecting roughly thirteen. Terminal orders are excluded: an order that
  -- churned and then got cancelled is over, and re-alerting on it forever would
  -- train an operator to ignore this channel.
  select coalesce((value #>> '{}')::int, 8) into v_churn_min
    from public.platform_settings where key = 'dispatch_churn_offers_threshold';

  select count(*) into v_churn
    from (
      select oa.order_id
        from public.order_assignments oa
        join public.orders o on o.id = oa.order_id
       where oa.assigned_at > now() - make_interval(mins => coalesce(v_mins,10))
         and o.status not in ('delivered','cancelled','rejected')
       group by oa.order_id
      having count(*) >= coalesce(v_churn_min, 8)
    ) churned;

  -- [203] THE PUSH TRANSPORT. Two counts, both of which were unobservable until
  -- this migration:
  --   * queued messages that the outbox sweep has not moved. Non-zero means
  --     push_outbox_sweep is not running, which between mig 200 and mig 203 was
  --     the permanent state of production and nothing said so.
  --   * attempts stuck retryable long past their due time. claim_push_retries
  --     still has no caller (see this migration's header), so these can never be
  --     retried. Counting them keeps that gap visible instead of invisible.
  begin
    select count(*) into v_push_stalled
      from public.push_messages m
     where m.status = 'queued'
       and m.queued_at < now() - interval '5 minutes'
       and m.expires_at > now();

    select count(*) into v_push_dead
      from public.push_attempts a
     where a.status = 'retryable_failed'
       and a.next_attempt_at < now() - interval '30 minutes';
  exception when others then
    -- The outbox tables may not exist in every environment. Never let that stop
    -- the dispatch half of the watchdog reporting.
    v_push_stalled := 0;
    v_push_dead := 0;
  end;

  begin
    select count(*) into v_sweeps_failed
      from cron.job_run_details jrd
      join cron.job j on j.jobid = jrd.jobid
     where j.jobname = 'sharmeats-dispatch-sweep'
       and jrd.status = 'failed'
       and jrd.start_time > now() - interval '5 minutes';
  exception when others then
    v_sweeps_failed := 0;
  end;

  if coalesce(v_stuck,0) = 0 and coalesce(v_placed,0) = 0 and coalesce(v_sweeps_failed,0) = 0
     and coalesce(v_churn,0) = 0 and coalesce(v_push_stalled,0) = 0 and coalesce(v_push_dead,0) = 0 then
    return;
  end if;

  -- Cooldown gate [119]: skip re-alerts for a still-firing condition until
  -- the window passes. Missing/empty last-alert row means "long ago" — alert.
  select coalesce((value #>> '{}')::int, 60) into v_cd
    from public.platform_settings where key = 'dispatch_watchdog_cooldown_minutes';
  select nullif(value #>> '{}', '')::timestamptz into v_last
    from public.platform_settings where key = 'dispatch_watchdog_last_alert_at';
  if v_last is not null and v_last > now() - make_interval(mins => coalesce(v_cd, 60)) then
    return;
  end if;

  v_msg := 'Sharm Eats dispatch watchdog:';
  if coalesce(v_placed,0) > 0 then
    v_msg := v_msg || ' ' || v_placed || ' order(s) still PLACED (unaccepted) >' || coalesce(v_mins,10) || ' min — auto-accept broken, off, or the merchant is closed.';
  end if;
  if coalesce(v_stuck,0) > 0 then
    v_msg := v_msg || ' ' || v_stuck || ' order(s) stuck unassigned >' || coalesce(v_mins,10) || ' min.';
  end if;
  if coalesce(v_churn,0) > 0 then
    v_msg := v_msg || ' ' || v_churn || ' order(s) CHURNING offers (>=' || coalesce(v_churn_min,8)
             || ' assignments in ' || coalesce(v_mins,10) || ' min) — nobody is accepting.';
  end if;
  if coalesce(v_sweeps_failed,0) > 0 then
    v_msg := v_msg || ' ' || v_sweeps_failed || ' dispatch_sweep run(s) FAILED in last 5 min.';
  end if;
  if coalesce(v_push_stalled,0) > 0 then
    v_msg := v_msg || ' ' || v_push_stalled || ' push message(s) QUEUED >5 min — the outbox sweep is not draining.';
  end if;
  if coalesce(v_push_dead,0) > 0 then
    v_msg := v_msg || ' ' || v_push_dead || ' push attempt(s) overdue for a retry that nothing performs.';
  end if;

  perform public.ops_alert(v_msg);
  update public.platform_settings
     set value = to_jsonb(now()::text)
   where key = 'dispatch_watchdog_last_alert_at';
exception when others then
  raise warning 'dispatch_watchdog failed: % (%)', sqlerrm, sqlstate;
end;
$function$;

revoke all on function public.dispatch_watchdog() from public, anon, authenticated;
grant execute on function public.dispatch_watchdog() to postgres;

comment on function public.dispatch_watchdog() is
  'CRON (every 2 min): alert on dispatch and notification stalls. Covers PLACED-but-unaccepted (mig 133), accepted/ready with no driver, failed dispatch sweeps, and — since mig 203 — OFFER CHURN and the push-outbox backlog. The churn count exists because the stuck-order test requires assigned_driver_id IS NULL while churn stamps that column at offer time, so an order re-offered every 45 seconds looked healthy: the 3,429-lap incident was reported by a customer, not by this alert. Cooldown via dispatch_watchdog_cooldown_minutes (mig 119).';

-- ###########################################################################
-- SECTION 9 — one-time cleanup of the never-expiring offers
-- ###########################################################################
-- Three 'offered' rows with a null offer_expires_at are live in production, two
-- of them on cancelled orders, and dispatch_sweep's expiry pass skips nulls so
-- nothing will ever clear them. driver_respond now refuses them (Section 5), but
-- refusing is not the same as tidying: they still hold the partial unique index
-- `order_assignments_one_active_per_order`, so the order cannot be re-offered to
-- anyone either.
--
-- Setting the expiry to now() rather than deleting or hand-editing the status
-- lets the machinery that already exists do the work: the next dispatch_sweep
-- tick (<=20s) sees offer_expires_at < now(), marks them 'rejected', and clears
-- orders.assigned_driver_id for the non-terminal ones. One code path, already
-- proven, instead of a bespoke UPDATE that has to re-derive its rules.
update public.order_assignments
   set offer_expires_at = now()
 where status = 'offered'
   and offer_expires_at is null;

comment on column public.order_assignments.offer_expires_at is
  'When an offer stops being acceptable. Stamped by BOTH producers since mig 203 (auto: dispatch_offer_ttl_seconds, default 45; dispatcher: dispatch_manual_offer_ttl_seconds, default 300). NULL is legacy only and is treated as EXPIRED by driver_respond — a never-expiring offer sat acceptable on cancelled orders in production until mig 203.';
