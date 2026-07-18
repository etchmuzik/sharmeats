-- 119_watchdog_alert_cooldown.sql
--
-- The dispatch watchdog (cron every 2 min, jobid 6) had NO re-alert dedupe:
-- a persisting stuck condition pinged the ops Telegram chat on every run —
-- observed live 2026-07-18: 21 sends/hour for the same 8 stale unassigned
-- orders, the moment the webhook came alive (migs 115-117). That's clutter,
-- not signal.
--
-- Fix: keep DETECTION at every 2 min (a genuinely stuck new order still
-- surfaces fast) but cap ALERTS to one per cooldown window (default 60 min,
-- tunable via platform_settings.dispatch_watchdog_cooldown_minutes). The
-- last-alert timestamp lives in platform_settings.dispatch_watchdog_last_alert_at
-- (written by the watchdog itself; runs as postgres, the table owner).
--
-- Tradeoff, accepted deliberately: a NEW failure type (e.g. sweep failures
-- starting while stuck-order alerts are in cooldown) waits out the same
-- window. At most one alert per hour is the point.
--
-- Body reproduced from the CURRENT prod def (house rule 2); signature
-- (dispatch_watchdog() -> void) and grants unchanged — CREATE OR REPLACE
-- preserves the existing ACL (internal-only: postgres).

insert into public.platform_settings (key, value) values
  ('dispatch_watchdog_cooldown_minutes', to_jsonb(60)),
  ('dispatch_watchdog_last_alert_at',    to_jsonb(''::text))
on conflict (key) do nothing;

create or replace function public.dispatch_watchdog()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mins          int;
  v_stuck         int := 0;
  v_sweeps_failed int := 0;
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

  if coalesce(v_stuck,0) = 0 and coalesce(v_sweeps_failed,0) = 0 then
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
  if coalesce(v_stuck,0) > 0 then
    v_msg := v_msg || ' ' || v_stuck || ' order(s) stuck unassigned >' || coalesce(v_mins,10) || ' min.';
  end if;
  if coalesce(v_sweeps_failed,0) > 0 then
    v_msg := v_msg || ' ' || v_sweeps_failed || ' dispatch_sweep run(s) FAILED in last 5 min.';
  end if;

  perform public.ops_alert(v_msg);
  update public.platform_settings
     set value = to_jsonb(now()::text)
   where key = 'dispatch_watchdog_last_alert_at';
exception when others then
  raise warning 'dispatch_watchdog failed: % (%)', sqlerrm, sqlstate;
end;
$$;
