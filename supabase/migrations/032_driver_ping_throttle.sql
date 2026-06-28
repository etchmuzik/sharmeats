-- 032_driver_ping_throttle.sql
-- Add a SQL-level throttle to driver_ping (audit M3, defense in depth).
--
-- THE PROBLEM THIS FIXES
-- driver_ping had no server-side rate limit; only the client throttles to 25s
-- (apps/driver/src/location.ts). A misbehaving or hostile client could call it
-- rapidly. Each call is a single-row UPDATE (no table bloat), but high frequency
-- churns the GiST geo index on drivers.current_geo. This adds a SQL guard so the
-- limit holds regardless of client behaviour.
--
-- THE FIX
-- If the driver pinged within the last 15s, SKIP the geo/location write — BUT
-- still apply an explicit status change if one was passed (so toggling
-- online/offline/on_job is never swallowed by the throttle). A normal ping at
-- the 25s client cadence is always > 15s, so the real flow is unaffected.
--
-- Non-destructive: CREATE OR REPLACE of one function.

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
  if v_last is not null and now() - v_last < interval '15 seconds' then
    if p_status is not null and p_status <> '' then
      update public.drivers set status = p_status where profile_id = v_user;
    end if;
    return;
  end if;

  update public.drivers set
    current_geo = st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
    last_ping_at = now(),
    status = coalesce(nullif(p_status,''), status)
   where profile_id = v_user;
end;
$$;

grant execute on function public.driver_ping(double precision, double precision, text) to authenticated;
