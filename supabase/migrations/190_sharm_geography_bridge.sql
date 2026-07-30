-- 190_sharm_geography_bridge.sql
--
-- Package 08 Slice 0 (= Package 07 Program E step 1): first-class city and
-- service-area entities, Sharm-only. Package 08 cannot reference a
-- cities/service_areas model as if it existed — it did not (verified
-- 2026-07-30). This bridge creates it and seeds Sharm from the CURRENT
-- authority: is_within_service_area's bbox defaults (no service_area_bbox
-- platform_settings row exists, so the in-function defaults 27.70..28.35 /
-- 34.20..34.70 ARE production behavior).
--
-- Deliberately NOT done here (Program E steps 2+): no shadow FKs on
-- restaurants/drivers/orders, no dual-write, no change to food dispatch or
-- fees, no city two. is_within_service_area is untouched — it remains the food
-- path's compatibility authority until Program E retires it. Package 08 uses
-- resolve_service_area(); the two are proven equivalent on boundary fixtures
-- in the dry run.

create table if not exists public.cities (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name           text not null,
  country_code   text not null default 'EG' check (country_code ~ '^[A-Z]{2}$'),
  timezone       text not null default 'Africa/Cairo',
  default_locale text not null default 'en',
  currency       text not null default 'EGP' check (currency = 'EGP'),
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);

create table if not exists public.service_areas (
  id         uuid primary key default gen_random_uuid(),
  city_id    uuid not null references public.cities(id) on delete restrict,
  slug       text not null check (slug ~ '^[a-z0-9-]{2,40}$'),
  name       text not null,
  boundary   geography(multipolygon, 4326) not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  unique (city_id, slug)
);

create index if not exists service_areas_boundary_gix
  on public.service_areas using gist (boundary);

alter table public.cities enable row level security;
alter table public.service_areas enable row level security;
revoke all on table public.cities from public, anon, authenticated;
revoke all on table public.service_areas from public, anon, authenticated;
-- Geography is public metadata (an app must know where service exists), reads
-- only; writes are migration/owner acts for now.
grant select on table public.cities to anon, authenticated;
grant select on table public.service_areas to anon, authenticated;
grant select, insert, update on table public.cities to service_role;
grant select, insert, update on table public.service_areas to service_role;
create policy cities_public_read on public.cities for select using (true);
create policy service_areas_public_read on public.service_areas for select using (true);

comment on table public.service_areas is
  'First-class service-area geography (Package 08 Slice 0 / Package 07 Program E step 1). Sharm seeded from is_within_service_area''s bbox authority; that helper stays the food compatibility path until Program E retires it. resolve_service_area() is the new resolver — missing/unmapped coordinates fail closed. Mig 190.';

-- ---------------------------------------------------------------------------
-- The resolver: point -> active service area, fail closed on anything else
-- ---------------------------------------------------------------------------
create or replace function public.resolve_service_area(p_point geography)
returns uuid
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select sa.id
    from public.service_areas sa
    join public.cities c on c.id = sa.city_id
   where p_point is not null
     and sa.is_active
     and c.is_active
     and st_covers(sa.boundary, p_point)
   order by sa.created_at
   limit 1;
$$;

revoke all on function public.resolve_service_area(geography) from public, anon;
grant execute on function public.resolve_service_area(geography) to authenticated, service_role;

comment on function public.resolve_service_area(geography) is
  'Point -> active service-area id; NULL for null/outside/inactive — the caller must treat NULL as not serviceable (fail closed). Replaces bbox logic for Package 08; food keeps is_within_service_area during the compatibility window. Mig 190.';

-- ---------------------------------------------------------------------------
-- Seed: Sharm from the production bbox authority
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_city uuid;
  v_lat_min float8; v_lat_max float8; v_lng_min float8; v_lng_max float8;
begin
  -- Same source and defaults as is_within_service_area, so the polygon IS the
  -- current behavior, not a hand-drawn approximation.
  select coalesce((value ->> 'lat_min')::float8, 27.70),
         coalesce((value ->> 'lat_max')::float8, 28.35),
         coalesce((value ->> 'lng_min')::float8, 34.20),
         coalesce((value ->> 'lng_max')::float8, 34.70)
    into v_lat_min, v_lat_max, v_lng_min, v_lng_max
    from (select value from public.platform_settings where key = 'service_area_bbox'
          union all select null::jsonb limit 1) s;

  insert into public.cities (slug, name)
  values ('sharm-el-sheikh', 'Sharm el-Sheikh')
  on conflict (slug) do nothing;
  select id into v_city from public.cities where slug = 'sharm-el-sheikh';

  insert into public.service_areas (city_id, slug, name, boundary)
  select v_city, 'sharm-core', 'Sharm el-Sheikh core',
         st_multi(st_makeenvelope(v_lng_min, v_lat_min, v_lng_max, v_lat_max, 4326))::geography
   where not exists (select 1 from public.service_areas
                      where city_id = v_city and slug = 'sharm-core');
end;
$mig$;
