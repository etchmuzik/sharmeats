-- 133_watchdog_placed_orders.sql
--
-- Extend the dispatch watchdog to cover `placed` orders.
--
-- The watchdog only counted ('accepted','ready') orders with no driver. A
-- `placed` order that never gets accepted paged nobody. In prod today the
-- exposure is bounded -- auto_accept_enabled=true auto-accepts after 180s,
-- so placed orders cannot normally linger -- but that makes the gap WORSE
-- when it matters: a placed order older than the threshold means the
-- auto-accept sweep itself is broken or was turned off, which is exactly
-- when a human must be paged. Defense in depth for the single most likely
-- launch-week failure (merchant tablet asleep + a regressed flag).
--
-- Body taken from PRODUCTION via pg_get_functiondef (house rule 2), one
-- addition: a v_placed count over status='placed' older than the same
-- threshold (regardless of driver assignment -- placed orders never have
-- one), folded into the same alert + cooldown. Signature UNCHANGED () ->
-- no second overload (house rule 1); ACL preserved.
--
-- Standalone, additive, idempotent.

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

  if coalesce(v_stuck,0) = 0 and coalesce(v_placed,0) = 0 and coalesce(v_sweeps_failed,0) = 0 then
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
    v_msg := v_msg || ' ' || v_placed || ' order(s) still PLACED (unaccepted) >' || coalesce(v_mins,10) || ' min — auto-accept broken or off.';
  end if;
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
$function$;

comment on function public.dispatch_watchdog() is
  'CRON (every 2 min): alert on stuck orders. Covers PLACED-but-unaccepted (mig 133 — fires when auto-accept is broken/off), accepted/ready with no driver, and failed dispatch sweeps. Cooldown via dispatch_watchdog_cooldown_minutes (mig 119).';
