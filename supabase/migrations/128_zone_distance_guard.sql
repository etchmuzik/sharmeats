-- 128_zone_distance_guard.sql
--
-- Fix: resolve_zone_nearest silently assigned ANY point on Earth to the
-- nearest Sharm zone — there was no "out of service area" answer. Today the
-- blast radius is bounded (place_order independently rejects out-of-radius
-- dropoffs via delivery_feasibility, mig 079), so the exposure was quoting
-- previews and address/zone resolution — plus the latent city-#2 bug where a
-- Hurghada pin would resolve to a Sharm zone.
--
-- Fix shape (the pragmatic option): beyond a max distance from the nearest
-- active centroid, return NULL and let callers reject/fallback. Zone polygon
-- boundaries (the "correct" fix) need real geometry for 11 zones that does
-- not exist — boundary is populated in 0 of 11 prod rows, so the ST_Contains
-- branch is retained but currently dead; if boundaries are ever drawn it
-- starts working with no further change.
--
-- The threshold is a platform_settings knob (house config pattern, cf.
-- batch_max_pickup_gap_m) so city #2 is a data change: 15 km default is
-- generous for Sharm's ~25 km corridor of 11 zone centroids.
--
-- Caller behaviour on NULL, verified: quote_delivery_fee finds no rule for a
-- NULL zone and returns its 30 EGP default (harmless preview); place_order
-- writes orders.zone (nullable) but its delivery_feasibility gate rejects the
-- order first with OUT_OF_RANGE.
--
-- Body taken from PRODUCTION via pg_get_functiondef (house rule 2).
-- Signature UNCHANGED (geography) -> no second overload (house rule 1); ACL
-- preserved untouched.
--
-- Standalone, additive, idempotent.

insert into public.platform_settings (key, value)
values ('service_zone_max_distance_m', to_jsonb(15000))
on conflict (key) do nothing;

create or replace function public.resolve_zone_nearest(p_geo geography)
returns zone_type
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(
    (select id from public.zones
       where boundary is not null and st_contains(boundary::geometry, p_geo::geometry)
       limit 1),
    (select id from public.zones
       where centroid is not null and is_active
         -- [128] Beyond the service radius there is NO zone: return NULL and
         -- let callers reject, instead of assigning a Cairo pin to Naama.
         and st_distance(centroid, p_geo) <= coalesce(
               (select (value #>> '{}')::int from public.platform_settings
                 where key = 'service_zone_max_distance_m'), 15000)
       order by st_distance(centroid, p_geo) asc
       limit 1)
  );
$function$;

comment on function public.resolve_zone_nearest(geography) is
  'Zone for a point: containing boundary if one is drawn (none are today), else the nearest active centroid WITHIN service_zone_max_distance_m (platform_settings, default 15 km) — NULL beyond that. NULL means "not in the service area"; callers must handle it. Migs 005, 128.';
