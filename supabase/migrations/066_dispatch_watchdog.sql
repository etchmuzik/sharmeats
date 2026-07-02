-- 066_dispatch_watchdog.sql
-- Turn SILENT dispatch failures into a webhook alert (two related P0 gaps).
--
-- THE GAP: auto-dispatch (025 + 038/048/060) runs as the pg_cron job
-- 'sharmeats-dispatch-sweep' every ~20s. When it can't find a driver it retries
-- forever — no alert, no comms — and if the cron job itself starts FAILING,
-- nobody is paged. docs/LAUNCH-MONITOR.md has the heartbeat SQL, but it only
-- helps if a human happens to run it. This migration adds a cheap server-side
-- watchdog that does two things every 2 minutes:
--   1) counts orders stuck unassigned too long (accepted/ready, no driver), and
--   2) checks whether recent dispatch_sweep cron runs FAILED,
-- and fires ONE concise webhook alert (Slack/Discord-compatible {"text": ...})
-- only when there is something to say.
--
-- SAFE BY DEFAULT — ALERTING IS OFF UNTIL CONFIGURED:
--   ops_alert_webhook_url seeds to '' (empty). ops_alert() is a NO-OP while the
--   URL is empty, so this migration changes NOTHING operationally until an owner
--   sets the real webhook in prod:
--     update platform_settings set value = to_jsonb('https://hooks.slack.com/services/XXX'::text)
--      where key = 'ops_alert_webhook_url';
--   (Re-disable at any time by setting it back to '' — instant kill switch.)
--
-- DEFENSIVE: every external call is wrapped so a webhook outage can NEVER throw
-- into the sweep or the watchdog. This migration does NOT touch the existing
-- dispatch functions — it only ADDS the alert primitive, the watchdog, and one
-- new cron job.
--
-- Non-destructive: 2 seeded settings + 2 functions + 1 cron job.

-- ============================================================================
-- Tunables in platform_settings so ops can adjust without a deploy.
--   * ops_alert_webhook_url        — '' = alerting disabled (safe default).
--   * dispatch_stuck_order_minutes — an accepted/ready order with no driver this
--                                    long counts as "stuck".
-- value is NOT NULL, so the empty default is stored as a JSON empty string.
-- ============================================================================
insert into public.platform_settings (key, value) values
  ('ops_alert_webhook_url',        to_jsonb(''::text)),
  ('dispatch_stuck_order_minutes', to_jsonb(10))
on conflict (key) do nothing;

-- ============================================================================
-- ops_alert — fire-and-forget alert to the ops webhook. NO-OP when unconfigured.
--
-- Posts a Slack/Discord-compatible {"text": <message>} body. If the webhook URL
-- is empty (the default), returns silently — alerting is opt-in. Any failure
-- (bad URL, pg_net hiccup) is swallowed with a WARNING so a broken webhook can
-- never propagate an error into a caller (the watchdog, or any future caller).
-- Internal only: never granted to client roles.
-- ============================================================================
create or replace function public.ops_alert(p_text text)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_url text;
begin
  select value #>> '{}' into v_url
    from public.platform_settings where key = 'ops_alert_webhook_url';

  -- Unconfigured => no-op. This is the safe default: nothing is sent until an
  -- owner pastes a real Slack/Discord webhook URL into platform_settings.
  if v_url is null or v_url = '' then
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    body    := jsonb_build_object('text', p_text),
    headers := jsonb_build_object('Content-Type', 'application/json')
  );
exception when others then
  -- Alerting is best-effort: a webhook failure must never break the caller.
  -- Emit a WARNING so the failed alert is at least visible in the Postgres logs.
  raise warning 'ops_alert failed: % (%)', sqlerrm, sqlstate;
end;
$$;

comment on function public.ops_alert is
  'Fire-and-forget ops alert to the ops_alert_webhook_url platform_setting (Slack/Discord {"text": ...}). NO-OP when the URL is empty (the default) so alerting is opt-in. Wrapped so a webhook failure never throws. Internal only.';

-- ============================================================================
-- dispatch_watchdog — the cheap heartbeat. Runs every 2 min (pg_cron).
--
--   (a) Counts orders stuck unassigned: status in ('accepted','ready') AND
--       assigned_driver_id IS NULL AND placed_at older than the configured
--       stuck threshold. These are orders auto-dispatch keeps retrying but can't
--       place (thin/busy driver pool) — invisible without this.
--   (b) Checks dispatch_sweep cron HEALTH via cron.job_run_details: did the sweep
--       FAIL in the last few minutes? A failing sweep = dispatch is down. Guarded
--       so an unreadable cron schema can never break the stuck-order check.
--
-- Fires ONE alert only when there's something to report (stuck > 0 OR a recent
-- sweep failure) — never spams a healthy system every tick. Returns void.
-- ============================================================================
create or replace function public.dispatch_watchdog()
returns void
language plpgsql
security definer set search_path = public, pg_temp, cron
as $$
declare
  v_mins          int;
  v_stuck         int := 0;
  v_sweeps_failed int := 0;
  v_msg           text;
begin
  select coalesce((value #>> '{}')::int, 10) into v_mins
    from public.platform_settings where key = 'dispatch_stuck_order_minutes';

  -- (a) Stuck orders: eligible-to-move but still without a driver past threshold.
  select count(*) into v_stuck
    from public.orders o
   where o.status in ('accepted','ready')
     and o.assigned_driver_id is null
     and o.placed_at < now() - make_interval(mins => coalesce(v_mins,10));

  -- (b) Cron health: recent dispatch_sweep failures (see docs/LAUNCH-MONITOR.md).
  -- Guarded independently — if cron.job_run_details isn't queryable, we still
  -- alert on stuck orders rather than aborting the whole watchdog.
  begin
    select count(*) into v_sweeps_failed
      from cron.job_run_details jrd
      join cron.job j on j.jobid = jrd.jobid
     where j.jobname = 'sharmeats-dispatch-sweep'
       and jrd.status = 'failed'
       and jrd.start_time > now() - interval '5 minutes';
  exception when others then
    v_sweeps_failed := 0;  -- cron schema unreadable; skip this signal
  end;

  -- Only alert when there's something to say (don't spam a healthy platform).
  if coalesce(v_stuck,0) = 0 and coalesce(v_sweeps_failed,0) = 0 then
    return;
  end if;

  v_msg := 'Sharm Eats dispatch watchdog:';
  if coalesce(v_stuck,0) > 0 then
    v_msg := v_msg || ' ' || v_stuck || ' order(s) stuck unassigned >' || coalesce(v_mins,10) || ' min.';
  end if;
  if coalesce(v_sweeps_failed,0) > 0 then
    v_msg := v_msg || ' ' || v_sweeps_failed || ' dispatch_sweep run(s) FAILED in last 5 min.';
  end if;

  perform public.ops_alert(v_msg);
exception when others then
  -- Watchdog is best-effort: never let it error the cron worker. Surface a
  -- WARNING so a real bug (bad query, permission) shows up in the Postgres logs.
  raise warning 'dispatch_watchdog failed: % (%)', sqlerrm, sqlstate;
end;
$$;

comment on function public.dispatch_watchdog is
  'Ops heartbeat (pg_cron, every 2 min). Alerts via ops_alert() when orders are stuck unassigned (accepted/ready, no assigned_driver_id, older than dispatch_stuck_order_minutes) OR when sharmeats-dispatch-sweep cron runs failed recently. Silent when healthy and when the ops webhook is unconfigured. Never throws.';

-- These functions are for the cron job only; never granted to client roles.
-- postgres (the migration executor + owner) runs them. Match the 025/045 pattern.
revoke all on function public.ops_alert(text)     from public, anon, authenticated;
revoke all on function public.dispatch_watchdog() from public, anon, authenticated;
grant execute on function public.ops_alert(text)     to postgres;
grant execute on function public.dispatch_watchdog() to postgres;

-- ============================================================================
-- Schedule it. Standard cron syntax (matches 045's cadence style); every 2 min
-- is cheap and plenty responsive for an ops alert. Idempotent unschedule first
-- (id reuse on re-run), same wrapper the other jobs use.
-- ============================================================================
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('sharmeats-dispatch-watchdog');
exception when others then
  null;  -- not scheduled yet
end $$;

select cron.schedule('sharmeats-dispatch-watchdog', '*/2 * * * *', $$select public.dispatch_watchdog();$$);
