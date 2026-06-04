-- 005_extensions_postgis.sql
-- Geo foundation for the delivery super-app.
--
-- Adds PostGIS and geography(Point/Polygon, 4326) columns so we can:
--   * resolve a dropoff/pickup to a Sharm zone,
--   * compute real-meter distances for dispatch (nearest driver),
--   * drop GPS pins from the customer app and driver app without reprojection.
--
-- We use `geography` (not `geometry`) so ST_DWithin / ST_Distance return METERS,
-- and SRID 4326 (WGS84 lat/lng) to match every GPS device and map API.
--
-- Non-destructive: only enables an extension and ADDs nullable columns +
-- backfills zone centroids. Existing rows/data untouched.

-- ============================================================================
-- Extension
-- ============================================================================
create extension if not exists postgis;

-- ============================================================================
-- ZONES: centroid (point) + boundary (polygon, nullable for MVP)
-- ============================================================================
alter table public.zones
  add column if not exists centroid geography(Point, 4326),
  add column if not exists boundary geography(Polygon, 4326),
  add column if not exists dispatch_mode text;  -- per-zone override; null = use platform default

-- Approximate centroids for Sharm el-Sheikh neighborhoods (lng, lat order!).
-- These are good-enough anchors for zone resolution + fee lookup at MVP;
-- precise polygons can be added later by setting `boundary`.
update public.zones set centroid = st_setsrid(st_makepoint(34.3300, 27.9100), 4326)::geography where id = 'naama';
update public.zones set centroid = st_setsrid(st_makepoint(34.3000, 27.8600), 4326)::geography where id = 'hadaba';
update public.zones set centroid = st_setsrid(st_makepoint(34.4200, 27.9900), 4326)::geography where id = 'nabq';
update public.zones set centroid = st_setsrid(st_makepoint(34.2950, 27.8550), 4326)::geography where id = 'old_market';
update public.zones set centroid = st_setsrid(st_makepoint(34.3270, 27.9170), 4326)::geography where id = 'soho';
update public.zones set centroid = st_setsrid(st_makepoint(34.3480, 27.9230), 4326)::geography where id = 'sharks_bay';
update public.zones set centroid = st_setsrid(st_makepoint(34.3120, 27.8780), 4326)::geography where id = 'el_salam';
update public.zones set centroid = st_setsrid(st_makepoint(34.3050, 27.8700), 4326)::geography where id = 'mubarak_7';
update public.zones set centroid = st_setsrid(st_makepoint(34.3150, 27.8900), 4326)::geography where id = 'el_rowaisat';
update public.zones set centroid = st_setsrid(st_makepoint(34.3080, 27.8820), 4326)::geography where id = 'hay_el_nour';
update public.zones set centroid = st_setsrid(st_makepoint(34.2980, 27.8620), 4326)::geography where id = 'el_hadaba_residential';

-- ============================================================================
-- RESTAURANTS: pickup location (for dispatch distance)
-- ============================================================================
alter table public.restaurants
  add column if not exists geo geography(Point, 4326);

-- Spatial index for nearest-merchant / distance queries.
create index if not exists restaurants_geo_gix on public.restaurants using gist (geo);

-- ============================================================================
-- ADDRESSES: a GPS pin is captured for EVERY address kind (even hotels),
-- so the driver always has a map point regardless of structured fields.
-- ============================================================================
alter table public.addresses
  add column if not exists geo geography(Point, 4326);

create index if not exists addresses_geo_gix on public.addresses using gist (geo);

-- Zone spatial index (for ST_Contains when polygons exist).
create index if not exists zones_boundary_gix on public.zones using gist (boundary);
create index if not exists zones_centroid_gix on public.zones using gist (centroid);

comment on column public.zones.centroid is
  'Approximate zone center (WGS84). Used for zone resolution by nearest-centroid until precise `boundary` polygons are added.';
comment on column public.zones.boundary is
  'Optional precise zone polygon (WGS84). When set, zone resolution uses ST_Contains; otherwise falls back to nearest centroid.';
comment on column public.zones.dispatch_mode is
  'Per-zone dispatch override (''manual''|''auto''). NULL = inherit platform_settings.dispatch_mode. Lets you pilot auto-dispatch in one zone.';
comment on column public.restaurants.geo is
  'Merchant pickup location (WGS84). Source for dispatch distance (nearest_drivers).';
comment on column public.addresses.geo is
  'Delivery drop GPS pin (WGS84). Captured for ALL address kinds — even hotels get a pin so the driver has a map point.';
