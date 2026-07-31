-- 201_dispatch_requires_fresh_ping.sql
--
-- A driver is only dispatchable if their phone has said so recently.
--
-- FOUND 2026-07-31 while tracing why one order had been re-assigned 176 times
-- and another 3,429 times without ever being accepted:
--
--   Ahmed Hassan  = online  / last ping 06-04 09:38
--   Mostafa Ali   = online  / last ping 06-04 09:38
--
-- Two seed drivers flagged status='online' whose apps last reported nearly two
-- months earlier. nearest_drivers filtered on is_active, is_verified,
-- status='online' and a non-null current_geo — but never asked how OLD that
-- position was. So dispatch offered to phones that were not listening, the
-- 45-second offer expired, the sweep re-offered, and the cycle ran until the
-- re-offer cooldown blocked every driver, paused an hour, then resumed.
--
-- `status` is a flag the driver app sets when going on shift. It is a statement
-- of intent, and it survives the app being force-quit, the phone dying, or a
-- crash. `last_ping_at` is evidence: the app was running and reporting that
-- recently. Dispatch should trust the evidence, not the intent — an offer sent
-- to a driver who cannot see it is worse than no offer, because it consumes the
-- order's dispatch cycle and the driver's re-offer cooldown.
--
-- The threshold is a platform_setting rather than a constant so it can be tuned
-- without a migration. 300s is deliberately generous: driver_ping is throttled
-- (mig 026-ish) and a driver in a tunnel or a lift should not be dropped for a
-- brief gap, but two months is not a brief gap.
--
-- NOT a schema change and NOT a signature change: same arguments, same return
-- table, so no second overload (house rule 1). Body started from the live
-- pg_get_functiondef output, not an older migration (house rule 2).
--
-- Interaction with mig 200: that stopped the CUSTOMER being notified on every
-- lap. This stops the laps happening at all when nobody is really online, which
-- is the underlying waste — 3,429 assignment rows, 3,429 pg_net calls, and a
-- driver cooldown table full of offers nobody ever saw.

insert into public.platform_settings (key, value)
values ('dispatch_max_ping_age_seconds', to_jsonb(300))
on conflict (key) do nothing;

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
  select d.id, d.name, d.vehicle, st_distance(d.current_geo, p_geo) as distance_m, d.status
  from public.drivers d
  where d.is_active and d.is_verified and d.status = 'online'
    and d.current_geo is not null
    -- The new condition. coalesce to -infinity so a driver who has never
    -- pinged is excluded rather than included by a null comparison — "no
    -- evidence" must fail closed, the same way role checks do (house rule 4).
    and coalesce(d.last_ping_at, '-infinity'::timestamptz)
        > now() - make_interval(secs => coalesce(
            (select (value #>> '{}')::int from public.platform_settings
              where key = 'dispatch_max_ping_age_seconds'), 300))
    and st_dwithin(d.current_geo, p_geo, p_radius_m)
  order by st_distance(d.current_geo, p_geo) asc
  limit p_limit;
$function$;

-- Grants restated to EXACTLY what production already had, checked before
-- writing this rather than assumed: service_role only. An earlier draft of this
-- migration granted `authenticated` as well, on the lazy reasoning that a
-- signed-in user might need it — which would have handed every logged-in
-- customer the live positions of every online driver. CREATE OR REPLACE keeps
-- existing grants, so the safe move is to re-assert the narrow set explicitly
-- and let the diff be obvious to the next reader (house rules 3 and 5).
revoke all on function public.nearest_drivers(geography, integer, integer)
  from public, anon, authenticated;
grant execute on function public.nearest_drivers(geography, integer, integer) to service_role;

comment on function public.nearest_drivers(geography, integer, integer) is
  'Dispatchable drivers near a point. Requires a recent driver_ping (platform_settings.dispatch_max_ping_age_seconds, default 300) as well as online/verified/active: status is intent and survives a force-quit, last_ping_at is evidence. Added 2026-07-31 after seed drivers flagged online since June caused orders to re-dispatch thousands of times to phones that were not listening.';
