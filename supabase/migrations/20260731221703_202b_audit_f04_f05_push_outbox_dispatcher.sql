-- ============================================================================
-- TRANSCRIPT OF AN ALREADY-APPLIED MIGRATION — DO NOT RE-APPLY TO PRODUCTION.
--
--   prod ledger version : 20260731221703
--   prod ledger name    : 202b_audit_f04_f05_push_outbox_dispatcher
--   applied to prod     : 2026-07-31 (directly, with no file in this repo)
--   reconstructed       : 2026-08-01, from
--                         supabase_migrations.schema_migrations.statements
--
-- WHY THIS FILE EXISTS. On 2026-07-31 eleven migrations were applied straight to
-- production and never committed. The repo therefore no longer described the
-- database. This file is a byte-exact copy of what production recorded, written
-- back so that (a) the repo describes production again, and (b) a fresh database
-- rebuilt by replaying supabase/migrations/ ends up in the same state.
--
-- WHAT IT IS NOT. It is not a change. Production ALREADY has everything below.
-- Do not point this at production, do not "re-run it to be sure", and do not
-- edit it to fix a defect — a later, higher-numbered migration does that. Editing
-- a transcript makes the repo lie about production a second time.
--
-- READ THIS BEFORE WRITING ANY PUSH MIGRATION. The cron job scheduled below is
-- named 'sharmeats-push-outbox-dispatch'. cron.schedule UPSERTS BY NAME, so any
-- new migration that schedules the same query under a DIFFERENT name (e.g.
-- 'sharmeats-push-outbox') creates a SECOND consumer racing this one on the same
-- queue rather than replacing it. Match the name above or unschedule first.
--
-- The body below this marker is reproduced verbatim, including its own original
-- header comments (which refer to a "202" file that was never committed) and its
-- own numbering claims. Those are left untouched on purpose: this records what
-- ran, not what we wish had run. Verified byte-for-byte against the prod ledger
-- (md5 ede039aff06888cc7d6ae6d743626c96).
-- ============================================================================
-- ===== BEGIN TRANSCRIPT =====
-- 202 section F-04 / F-05 — the push outbox gets a dispatcher.
--
-- Mig 200 stopped an infinite driver_assigned push loop by routing three events
-- (driver_assigned, order_ready_pickup, low_rating) through enqueue_push()
-- instead of net.http_post. enqueue_push only INSERTs a `queued` row: nothing
-- ever selected those rows to send them, so since 2026-07-31 customers were not
-- told a driver was coming, drivers were not told an order was ready, and
-- merchants heard nothing about low ratings — silently, because rows expire.
-- Mig 173's claim_push_retries had the same problem: no caller.

create or replace function public.dispatch_push_outbox(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_limit   int := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_base    text;
  v_secret  text;
  v_headers jsonb;
  v_sent    int := 0;
  r         record;
begin
  select value #>> '{}' into v_base
    from public.platform_settings where key = 'functions_base_url';
  if v_base is null or v_base = '' then
    return 0;  -- not configured (fresh/staging DB); nothing to do, no error
  end if;

  -- Same Vault read as every other push caller (mig 035). Degrades to no header
  -- rather than failing: expo-push only enforces it when its own secret is set.
  begin
    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'push_internal_secret';
  exception when others then
    v_secret := null;
  end;

  v_headers := '{"Content-Type": "application/json"}'::jsonb;
  if v_secret is not null and v_secret <> '' then
    v_headers := v_headers || jsonb_build_object('x-internal-secret', v_secret);
  end if;

  -- Pass 0: drop a queued duplicate of a message already sent. The key rewrite
  -- in pass 2 is UNIQUE-constrained; if expo-push already created the canonical
  -- row, the rewrite would raise and abort the tick. The match is the FULL
  -- identity expo-push keys on (event + order + campaign + recipients) — a
  -- prefix match would collapse genuinely different messages.
  update public.push_messages q
     set status = 'suppressed',
         suppression_reason = 'no_recipient',
         settled_at = now()
   where q.status = 'queued'
     and exists (
       select 1 from public.push_messages c
        where c.id <> q.id
          and c.status <> 'queued'
          and c.event = q.event
          and c.order_id is not distinct from q.order_id
          and c.campaign_id is not distinct from q.campaign_id
          and c.recipient_user_ids is not distinct from q.recipient_user_ids
     );

  -- Pass 1: expire what is already too late to be true. A "your driver is
  -- arriving" push six hours late is misinformation, which is why mig 172 gave
  -- every event its own window.
  update public.push_messages
     set status = 'suppressed',
         suppression_reason = 'expired',
         settled_at = now()
   where status = 'queued'
     and expires_at <= now();

  -- Pass 2: claim and send.
  --
  -- THE KEY MUST MATCH WHAT expo-push WILL COMPUTE. The edge function calls
  -- recordMessage(), which INSERTs its own push_messages row and relies on a
  -- 23505 unique violation to "adopt" an existing one (outbox.ts:126-129). Its
  -- key is idempotencyKey() = evt:<event>[|order:<uuid>][|campaign:<uuid>]
  -- [|to:<sorted,ids>], while enqueue_push's callers pass their own shapes
  -- ('driver_assigned:<id>', mig 200). Those never collide — so without this
  -- rewrite expo-push would insert a SECOND row, settle that one, and leave the
  -- row we claimed stuck in `processing` forever, reclaimed and re-sent every 10
  -- minutes: an infinite push loop, the very bug mig 200 existed to stop.
  for r in
    with claimed as (
      select m.id
        from public.push_messages m
       where m.status = 'queued'
         and m.expires_at > now()
       order by m.queued_at
       limit v_limit
       for update of m skip locked
    ),
    bumped as (
      update public.push_messages m
         set status = 'processing',
             idempotency_key =
               'evt:' || m.event
               || case when m.order_id is not null then '|order:' || m.order_id::text else '' end
               || case when m.campaign_id is not null then '|campaign:' || m.campaign_id::text else '' end
               || case
                    when m.campaign_id is null
                     and m.recipient_user_ids is not null
                     and array_length(m.recipient_user_ids, 1) > 0
                    then '|to:' || (
                      select string_agg(u::text, ',' order by u::text)
                        from unnest(m.recipient_user_ids) u
                    )
                    else ''
                  end
        from claimed c
       where m.id = c.id
      returning m.id, m.event, m.order_id, m.recipient_user_ids,
                m.route, m.vertical, m.custom_title, m.custom_body
    )
    select * from bumped
  loop
    -- expo-push resolves the audience itself when recipientUserIds is absent,
    -- which is the contract every customer-facing event already relies on.
    perform net.http_post(
      url     := v_base || '/expo-push',
      body    := jsonb_strip_nulls(jsonb_build_object(
                   'event',            r.event,
                   'orderId',          r.order_id::text,
                   'recipientUserIds', case
                                         when r.recipient_user_ids is null then null
                                         else to_jsonb(r.recipient_user_ids)
                                       end,
                   'route',            r.route,
                   'vertical',         r.vertical,
                   'title',            r.custom_title,
                   'body',             r.custom_body,
                   'messageId',        r.id::text
                 )),
      headers := v_headers
    );
    v_sent := v_sent + 1;
  end loop;

  return v_sent;
exception when others then
  -- Never let a notification sweep raise into the cron runner: a failed tick
  -- must be retried on the next one, not left as a stuck job.
  return v_sent;
end;
$function$;

comment on function public.dispatch_push_outbox(integer) is
  'Claims queued push_messages (FOR UPDATE SKIP LOCKED, so overlapping cron ticks cannot double-send) and hands each to the expo-push edge function, which resolves recipients, applies prefs/quiet hours and localizes copy. Also settles messages past their per-event expiry as suppressed/expired. Without this, everything mig 200 routed through enqueue_push (driver_assigned, order_ready_pickup, low_rating) was queued and never sent. Mig 202, audit F-04.';

revoke all on function public.dispatch_push_outbox(integer) from public, anon, authenticated;
grant execute on function public.dispatch_push_outbox(integer) to service_role;

-- A dispatcher that dies mid-send must not strand the message. Mirrors mig
-- 173's 10-minute reclaim for attempts.
create or replace function public.reclaim_stuck_push_messages()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_n int;
begin
  update public.push_messages
     set status = 'queued'
   where status = 'processing'
     and queued_at < now() - interval '10 minutes'
     and settled_at is null
     and expires_at > now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

comment on function public.reclaim_stuck_push_messages is
  'Returns push_messages stuck in `processing` (dispatcher crashed mid-send) to `queued`, provided they have not expired. Mirrors mig 173''s stale-claim rule for attempts. Mig 202, audit F-04.';

revoke all on function public.reclaim_stuck_push_messages() from public, anon, authenticated;
grant execute on function public.reclaim_stuck_push_messages() to service_role;

-- The claim query wants queued rows cheaply.
create index if not exists push_messages_queued_dispatch_idx
  on public.push_messages (queued_at) where status = 'queued';

-- F-05: the retry pass. claim_push_retries (mig 173) has had no caller since it
-- shipped, so every 429/5xx from Expo was recorded as retryable_failed and never
-- retried — the exact silent loss the outbox exists to prevent.
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
    from public.platform_settings where key = 'functions_base_url';
  if v_base is null or v_base = '' then return 0; end if;

  begin
    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'push_internal_secret';
  exception when others then
    v_secret := null;
  end;

  v_headers := '{"Content-Type": "application/json"}'::jsonb;
  if v_secret is not null and v_secret <> '' then
    v_headers := v_headers || jsonb_build_object('x-internal-secret', v_secret);
  end if;

  -- Claiming is a WRITE inside claim_push_retries (status -> processing,
  -- attempt_no + 1), so this is already safe against overlapping runs.
  select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
    into v_claimed
    from public.claim_push_retries(p_limit) c;

  if v_claimed = '[]'::jsonb then return 0; end if;

  perform net.http_post(
    url     := v_base || '/expo-push',
    body    := jsonb_build_object('mode', 'retry', 'attempts', v_claimed),
    headers := v_headers
  );

  return jsonb_array_length(v_claimed);
exception when others then
  return 0;
end;
$function$;

comment on function public.dispatch_push_retries(integer) is
  'Runs mig 173''s claim_push_retries and hands the claimed attempts to expo-push for re-send. Without this, retryable_failed attempts (Expo 429/5xx, network blips) were never retried and the ATTEMPT_CAP dead-letter was unreachable. Mig 202, audit F-05.';

revoke all on function public.dispatch_push_retries(integer) from public, anon, authenticated;
grant execute on function public.dispatch_push_retries(integer) to service_role;

-- Every 30 seconds: fast enough that "your driver is on the way" is still true
-- when it lands, slow enough to be nothing next to the 20s dispatch sweeps.
select cron.schedule(
  'sharmeats-push-outbox-dispatch',
  '30 seconds',
  $$select public.dispatch_push_outbox(200)$$
);

select cron.schedule(
  'sharmeats-push-outbox-reclaim',
  '*/5 * * * *',
  $$select public.reclaim_stuck_push_messages()$$
);

select cron.schedule(
  'sharmeats-push-retry-dispatch',
  '*/2 * * * *',
  $$select public.dispatch_push_retries(200)$$
);

-- push_receipt_sweep was scheduled by hand and exists in no migration, so a
-- rebuilt database loses receipt processing silently. cron.schedule upserts by
-- name — idempotent against the live job.
select cron.schedule(
  'sharmeats-push-receipts',
  '*/15 * * * *',
  $$select public.push_receipt_sweep()$$
);
