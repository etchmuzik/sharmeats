-- 211_ops_alert_delivery_check.sql
--
-- Notice when the alert channel itself dies.
--
-- ops_alert is the single throat for EIGHTEEN callers — dispatch watchdog,
-- churn watchdog, site health, FX health, push receipts, COD ceiling, daily
-- digest and more. It ends like this:
--
--   perform net.http_post(url := v_url, body := v_body, ...);
--   exception when others then
--     raise warning 'ops_alert failed: % (%)', sqlerrm, sqlstate;
--
-- `perform` DISCARDS the request id net.http_post returns, and the response is
-- never looked at. Telegram answering 401 (revoked token) or 400 (wrong chat)
-- is indistinguishable from success: the post is fire-and-forget, the warning
-- only fires for errors raised locally, and warnings go to a log nobody reads.
--
-- So the failure mode is total and silent: every watchdog keeps "alerting",
-- every alert vanishes, and the platform looks quiet because nothing can tell
-- you it has gone deaf. This is the same shape as the launchd backup that was
-- dead for three days while `launchctl list` printed a healthy-looking row, and
-- the same shape as a log file that stops being appended to.
--
-- IMMEDIATE RELEVANCE: the Telegram bot token is about to be rotated because it
-- leaked. A rotation that lands a wrong value in ops_alert_webhook_url silences
-- every watchdog, and without this migration the only symptom is an inbox that
-- gets quieter — which reads like good news.
--
-- WHAT THIS DOES
--
--   1. ops_alert now KEEPS the request id and records the alert. The table is
--      an outbox-of-record as well as a delivery log: even with the channel
--      completely dead the alert text survives in the database, so nothing is
--      lost, only delayed. That is deliberately more than the delivery check
--      asked for — knowing an alert failed is useful, still having its contents
--      is what lets you act on it.
--
--   2. check_ops_alert_deliveries() joins those request ids against
--      net._http_response and records the outcome. It runs every 5 minutes
--      because PG_NET PRUNES AGGRESSIVELY: measured on this database at
--      2026-08-01, only 214 responses were retained with the oldest ~5h old.
--      A slower cadence would find the evidence already deleted.
--
-- WHY IT DOES NOT ALERT ABOUT ALERT FAILURES. There is exactly one channel; a
-- broken channel cannot carry news of itself. Anything else would be theatre.
-- What this gives you instead is a durable, queryable answer:
--
--   select created_at, status_code, detail, left(alert_text, 80)
--     from public.ops_alert_deliveries
--    where ok is not true order by created_at desc limit 20;
--
-- The genuine out-of-band heartbeat (a GitHub Action pinging Telegram directly
-- on a schedule, so a silent channel is caught from outside the database) is
-- the remaining half and is NOT in this migration — it needs a secret the
-- database cannot hold.
--
-- House rules: ops_alert keeps its exact argument list, so no second overload
-- (rule 1); its body was taken from prod's prosrc, not an older migration
-- (rule 2); every function REVOKEd then granted narrowly (rule 3); the new
-- table is revoked from public/anon/authenticated BEFORE its real grants,
-- because ALTER DEFAULT PRIVILEGES on this database grants arwdDxtm to
-- anon/authenticated on every new table and TRUNCATE ignores RLS (rule 5b).

-- ---------------------------------------------------------------------------
-- 1. The record
-- ---------------------------------------------------------------------------
create table if not exists public.ops_alert_deliveries (
  id          bigserial primary key,
  request_id  bigint,                       -- pg_net id; null if the post never fired
  alert_text  text        not null,
  created_at  timestamptz not null default now(),
  checked_at  timestamptz,
  status_code integer,
  -- true = 2xx. false = definitely failed. NULL after checked_at is set means
  -- the response was pruned before we looked — unknown, NOT a silent success.
  ok          boolean,
  detail      text
);

revoke all on table public.ops_alert_deliveries from public, anon, authenticated;
revoke all on sequence public.ops_alert_deliveries_id_seq from public, anon, authenticated;
grant select, insert, update, delete on table public.ops_alert_deliveries to service_role;
grant usage, select on sequence public.ops_alert_deliveries_id_seq to service_role;

alter table public.ops_alert_deliveries enable row level security;
-- No policies, matching order_financials_failures: service_role bypasses RLS,
-- everyone else is denied. The REVOKE above is what makes that real.

create index if not exists ops_alert_deliveries_created_idx
  on public.ops_alert_deliveries (created_at desc);
-- Partial index on the rows anyone ever hunts for: the failures.
create index if not exists ops_alert_deliveries_bad_idx
  on public.ops_alert_deliveries (created_at desc) where ok is not true;
-- The checker's own working set.
create index if not exists ops_alert_deliveries_unchecked_idx
  on public.ops_alert_deliveries (created_at) where checked_at is null;

comment on table public.ops_alert_deliveries is
  'Every ops_alert send, with its pg_net request id and the delivered outcome. Doubles as an outbox-of-record: if the Telegram channel is dead the alert TEXT still survives here. Added 2026-08-01 — ops_alert discarded the request id and swallowed errors, so a revoked token silenced all 18 callers with no symptom. Find failures: select * from ops_alert_deliveries where ok is not true order by created_at desc.';

-- ---------------------------------------------------------------------------
-- 2. ops_alert keeps the receipt
-- ---------------------------------------------------------------------------
create or replace function public.ops_alert(p_text text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_url  text;
  v_chat text;
  v_body jsonb;
  v_req  bigint;   -- [211] the id `perform` used to throw away
begin
  select value #>> '{}' into v_url
    from public.platform_settings where key = 'ops_alert_webhook_url';
  if v_url is null or v_url = '' then
    -- [211] Record it anyway. "No webhook configured" is itself an alerting
    -- outage, and it used to return in silence.
    begin
      insert into public.ops_alert_deliveries (request_id, alert_text, checked_at, ok, detail)
      values (null, p_text, now(), false, 'ops_alert_webhook_url is unset');
    exception when others then null;
    end;
    return;
  end if;

  if position('api.telegram.org' in v_url) > 0 then
    select value #>> '{}' into v_chat
      from public.platform_settings where key = 'ops_alert_telegram_chat_id';
    if v_chat is null or v_chat = '' then
      raise warning 'ops_alert: telegram URL set but ops_alert_telegram_chat_id is empty';
      begin
        insert into public.ops_alert_deliveries (request_id, alert_text, checked_at, ok, detail)
        values (null, p_text, now(), false, 'ops_alert_telegram_chat_id is empty');
      exception when others then null;
      end;
      return;
    end if;
    v_body := jsonb_build_object('chat_id', v_chat, 'text', p_text);
  else
    v_body := jsonb_build_object('text', p_text, 'content', p_text);
  end if;

  -- [211] select ... into, not perform: keep the id so the response can be
  -- matched later. Everything else about this call is unchanged.
  select net.http_post(
    url     := v_url,
    body    := v_body,
    headers := jsonb_build_object('Content-Type', 'application/json')
  ) into v_req;

  -- Recording must never be able to break an alert, which must never be able
  -- to break the caller. Its own block, swallowing its own errors.
  begin
    insert into public.ops_alert_deliveries (request_id, alert_text)
    values (v_req, p_text);
  exception when others then null;
  end;
exception when others then
  raise warning 'ops_alert failed: % (%)', sqlerrm, sqlstate;
end;
$function$;

revoke all on function public.ops_alert(text) from public, anon, authenticated;
grant execute on function public.ops_alert(text) to service_role;

comment on function public.ops_alert(text) is
  'Send an operational alert to the configured webhook AND record it in ops_alert_deliveries. Before migration 211 the pg_net request id was discarded and the response never inspected, so a revoked Telegram token silenced all 18 callers with no symptom at all.';

-- ---------------------------------------------------------------------------
-- 3. The check
-- ---------------------------------------------------------------------------
create or replace function public.check_ops_alert_deliveries()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_failed int := 0;
begin
  -- Resolve everything pg_net has answered. The 20s floor avoids racing a
  -- request that is still in flight and marking it unknown.
  update public.ops_alert_deliveries d
     set checked_at  = now(),
         status_code = r.status_code,
         ok          = (r.status_code between 200 and 299
                        and coalesce(r.timed_out, false) = false),
         detail      = case
                         when coalesce(r.timed_out,false) then 'timed out'
                         when r.error_msg is not null then r.error_msg
                         when r.status_code between 200 and 299 then null
                         -- Telegram puts the real reason in the body; keep a
                         -- slice so "401" is actionable without a second hop.
                         else left(coalesce(r.content, ''), 300)
                       end
    from net._http_response r
   where r.id = d.request_id
     and d.checked_at is null
     and d.created_at < now() - interval '20 seconds';

  -- Give up on anything pg_net has already pruned. ok stays NULL: unknown is
  -- not success, and pretending otherwise is the exact habit this migration
  -- exists to break.
  update public.ops_alert_deliveries
     set checked_at = now(),
         detail     = 'no pg_net response found before it was pruned'
   where checked_at is null
     and created_at < now() - interval '2 hours';

  select count(*) into v_failed
    from public.ops_alert_deliveries
   where ok is not true
     and checked_at > now() - interval '10 minutes';

  -- Retention. Without this the outbox grows forever; 30 days is far longer
  -- than any investigation and still small.
  delete from public.ops_alert_deliveries where created_at < now() - interval '30 days';

  return v_failed;
exception when others then
  -- A broken checker must never break the cron runner that also drives
  -- dispatch on this database.
  raise warning 'check_ops_alert_deliveries failed: % (%)', sqlerrm, sqlstate;
  return 0;
end;
$function$;

revoke all on function public.check_ops_alert_deliveries() from public, anon, authenticated;
grant execute on function public.check_ops_alert_deliveries() to service_role;

comment on function public.check_ops_alert_deliveries() is
  'Matches ops_alert sends against net._http_response and records the outcome. Runs every 5 minutes because pg_net prunes responses within hours (measured 2026-08-01: 214 retained, oldest ~5h). Returns the number of non-OK deliveries in the last 10 minutes.';

-- ---------------------------------------------------------------------------
-- 4. Schedule it
-- ---------------------------------------------------------------------------
select cron.unschedule('sharmeats-ops-alert-delivery-check')
 where exists (select 1 from cron.job where jobname = 'sharmeats-ops-alert-delivery-check');

select cron.schedule(
  'sharmeats-ops-alert-delivery-check',
  '*/5 * * * *',
  $cron$select public.check_ops_alert_deliveries()$cron$
);
