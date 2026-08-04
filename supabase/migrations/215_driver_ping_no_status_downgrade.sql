-- 215_driver_ping_no_status_downgrade.sql
--
-- A ping may prove presence; it may not put a busy driver back in the dispatch
-- pool.
--
-- FOUND 2026-08-05 (full-stack audit): the idle heartbeat (client half of mig
-- 201, [202 F-02]) called driver_ping with p_status='online' on every beat.
-- For a driver with an ACTIVE JOB whose delivery stream is not running — the
-- app-restart-mid-delivery case, where the in-memory isStreaming() flag resets
-- to false — the beat stamped status='online' over 'on_job', and
-- nearest_drivers (status = 'online' + fresh ping) happily offered them a
-- second order. This is the same trust-intent-over-evidence bug class mig 201
-- fixed for ghost drivers, reintroduced from the opposite direction.
--
-- TWO HALVES, both required:
--   * client (apps/driver/src/location.ts, same change set): the heartbeat now
--     pings with NO status — presence only, status preserved.
--   * server (this migration): even a stale or hostile client claiming 'online'
--     cannot downgrade 'on_job'. The ONLY legitimate on_job -> online
--     transition is the terminal-status release inside advance_order_status
--     (migs 054/103), which does a direct UPDATE and never passes through this
--     function — so the clamp cannot strand a driver after delivery.
--     on_job -> offline stays allowed: a driver going off shift mid-job is an
--     explicit act the dispatcher tooling must see, not something to mask.
--
-- Same signature as prod (checked via pg_get_functiondef 2026-08-05, identical
-- to mig 032): CREATE OR REPLACE is safe, no overload risk (house rule 1).
-- Body started from the live definition, not a file copy (house rule 2).

create or replace function public.driver_ping(p_lng double precision, p_lat double precision, p_status text default null)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_last timestamptz;
begin
  select last_ping_at into v_last from public.drivers where profile_id = v_user;

  -- [032] Throttle the location write to at most once per 15s. A status change
  -- (if provided) is always applied so offline/online toggles aren't dropped.
  -- [215] ...except on_job -> online, which no ping is entitled to claim.
  if v_last is not null and now() - v_last < interval '15 seconds' then
    if p_status is not null and p_status <> '' then
      update public.drivers
         set status = case
               when status = 'on_job' and p_status = 'online' then status
               else p_status
             end
       where profile_id = v_user;
    end if;
    return;
  end if;

  update public.drivers set
    current_geo = st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
    last_ping_at = now(),
    status = case
      when status = 'on_job' and nullif(p_status,'') = 'online' then status
      else coalesce(nullif(p_status,''), status)
    end
   where profile_id = v_user;
end;
$$;

-- Grants restated to EXACTLY what production had, checked via pg_proc.proacl
-- before writing (postgres/authenticated/service_role). CREATE OR REPLACE
-- keeps existing grants, but restating makes the narrow set obvious and
-- closes mig 032's gap of never revoking the default PUBLIC execute
-- (house rule 3).
revoke all on function public.driver_ping(double precision, double precision, text) from public, anon;
grant execute on function public.driver_ping(double precision, double precision, text) to authenticated, service_role;

comment on function public.driver_ping(double precision, double precision, text) is
  'Driver presence + position heartbeat, 15s server-side throttle (mig 032). Since mig 215 a ping can never downgrade status on_job -> online: that transition belongs exclusively to the terminal-status release in advance_order_status (migs 054/103). Prevents a restarted driver app (or hostile client) from re-entering the dispatch pool mid-delivery.';
