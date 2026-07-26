-- 129_service_area_single_source.sql
--
-- Consolidate the Sharm service-area bounding box into ONE source of truth.
--
-- The box (lat 27.70-28.35, lng 34.20-34.70) existed as three independent
-- copies: apply_as_restaurant (mig 123), admin_upsert_kitchen (mig 126), and
-- a client-side advisory copy in apps/merchant-web/src/lib/wizardDraft.ts.
-- Three copies drift, and expanding to city #2 (Hurghada: docs/FINANCIALS.md
-- §5's growth path) would mean hunting hardcoded geography. After this
-- migration the box is a platform_settings row read by one helper; city #2
-- becomes a data change. The client copy remains, marked advisory-only --
-- the server is authoritative.
--
-- SQL bodies: apply_as_restaurant taken from PRODUCTION via
-- pg_get_functiondef (house rule 2); admin_upsert_kitchen from migration 126
-- (not yet in prod -- 129 applies after 126 in sequence). One change each:
-- the inline box test becomes a call to is_within_service_area(). Signatures
-- UNCHANGED (17 args / 11 args) -> no second overload (house rule 1); ACLs
-- preserved by CREATE OR REPLACE except where explicitly restated.
--
-- Standalone, additive, idempotent.

-- ---------------------------------------------------------------------------
-- 1) The box as data.
-- ---------------------------------------------------------------------------
insert into public.platform_settings (key, value)
values ('service_area_bbox',
        jsonb_build_object('lat_min', 27.70, 'lat_max', 28.35,
                           'lng_min', 34.20, 'lng_max', 34.70))
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2) The one reader. SECURITY INVOKER on purpose: it holds no privilege --
-- inside a SECURITY DEFINER caller it runs as that definer and reads the
-- settings row; the hardcoded fallback keeps it fail-safe if the row is ever
-- deleted or unreadable. A NULL input is OUT of area (fail closed).
-- ---------------------------------------------------------------------------
create or replace function public.is_within_service_area(p_lat double precision, p_lng double precision)
returns boolean
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select p_lat is not null and p_lng is not null
     and p_lat between coalesce((select (value ->> 'lat_min')::float8 from public.platform_settings where key = 'service_area_bbox'), 27.70)
                   and coalesce((select (value ->> 'lat_max')::float8 from public.platform_settings where key = 'service_area_bbox'), 28.35)
     and p_lng between coalesce((select (value ->> 'lng_min')::float8 from public.platform_settings where key = 'service_area_bbox'), 34.20)
                   and coalesce((select (value ->> 'lng_max')::float8 from public.platform_settings where key = 'service_area_bbox'), 34.70);
$function$;

revoke all on function public.is_within_service_area(double precision, double precision) from public, anon;
grant execute on function public.is_within_service_area(double precision, double precision) to authenticated;

comment on function public.is_within_service_area(double precision, double precision) is
  'THE service-area gate: point inside the service_area_bbox platform_settings row (hardcoded Sharm fallback). NULL input = false (fail closed). City #2 = update the settings row. Single source of truth since mig 129 -- do not re-inline the box anywhere.';

-- ---------------------------------------------------------------------------
-- 3) apply_as_restaurant -- prod body verbatim, box check swapped.
-- ---------------------------------------------------------------------------
create or replace function public.apply_as_restaurant(
  p_name text, p_description text, p_cuisines cuisine_type[], p_phone text,
  p_address text, p_zone zone_type, p_lat double precision, p_lng double precision,
  p_is_open_24h boolean, p_prep_low integer, p_prep_high integer,
  p_payout_method text, p_payout_bank_name text, p_payout_iban text,
  p_payout_wallet text, p_payout_holder text, p_terms_version text
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_existing uuid;
  v_slug text;
  v_base_slug text;
  v_restaurant_id uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;

  -- Idempotent: an account already linked to a restaurant returns that id.
  select restaurant_id into v_existing
    from public.merchant_staff where profile_id = v_uid limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  -- Fail closed on role: only plain customers may apply (admin/driver/dispatcher
  -- accounts are operational identities, not merchant prospects).
  select coalesce(role::text, '') into v_role from public.users where id = v_uid;
  if v_role is distinct from 'customer' then
    raise exception 'NOT_ELIGIBLE' using errcode = 'check_violation';
  end if;

  -- Input validation (fail fast, typed codes the web maps to copy).
  if p_name is null or length(btrim(p_name)) not between 2 and 120 then
    raise exception 'INVALID_NAME' using errcode = 'check_violation';
  end if;
  if p_phone is null or length(btrim(p_phone)) not between 6 and 20 then
    raise exception 'INVALID_PHONE' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.zones where id = p_zone and is_active) then
    raise exception 'ZONE_NOT_SERVED' using errcode = 'check_violation';
  end if;
  -- Service-area plausibility gate, not a service-radius proof (admin verifies
  -- on review). [129] Single source: is_within_service_area().
  if not public.is_within_service_area(p_lat, p_lng) then
    raise exception 'GEO_OUT_OF_AREA' using errcode = 'check_violation';
  end if;
  if p_terms_version is null or btrim(p_terms_version) = '' then
    raise exception 'TERMS_REQUIRED' using errcode = 'check_violation';
  end if;

  -- Unique slug from the name; collision gets a short random suffix.
  v_base_slug := btrim(regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g'), '-');
  if v_base_slug = '' then v_base_slug := 'restaurant'; end if;
  v_slug := v_base_slug;
  while exists (select 1 from public.restaurants where slug = v_slug) loop
    v_slug := v_base_slug || '-' || substr(md5(clock_timestamp()::text || random()::text), 1, 4);
  end loop;

  insert into public.restaurants (
    slug, name, description, cuisines, cuisine_label, cover_image, zone, geo,
    phone, address, is_open_24h, prep_time_low, prep_time_high,
    payout_method, payout_bank_name, payout_iban, payout_wallet, payout_holder,
    is_active, is_open, onboarding_status, commission_pct, tourist_safe,
    terms_version, terms_accepted_at
  ) values (
    v_slug, btrim(p_name), coalesce(btrim(p_description), ''), coalesce(p_cuisines, '{}'), '',
    '',  -- cover_image seeded by admin during menu review (RestaurantEditor)
    p_zone,
    st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
    btrim(p_phone), nullif(btrim(coalesce(p_address, '')), ''),
    coalesce(p_is_open_24h, false),
    coalesce(nullif(p_prep_low, 0), 10), coalesce(nullif(p_prep_high, 0), 30),
    nullif(btrim(coalesce(p_payout_method, '')), ''),
    nullif(btrim(coalesce(p_payout_bank_name, '')), ''),
    nullif(btrim(coalesce(p_payout_iban, '')), ''),
    nullif(btrim(coalesce(p_payout_wallet, '')), ''),
    nullif(btrim(coalesce(p_payout_holder, '')), ''),
    false,  -- is_active: invisible to customers until approve_restaurant
    false,  -- is_open: merchant flips Open from the dashboard once actually ready
    'submitted',
    15.0,
    false,
    btrim(p_terms_version),
    now()
  )
  returning id into v_restaurant_id;

  insert into public.merchant_staff (profile_id, restaurant_id, staff_role)
  values (v_uid, v_restaurant_id, 'owner');

  update public.users set role = 'merchant_staff', updated_at = now()
   where id = v_uid;

  -- Ops heads-up (Telegram via ops_alert). Best-effort: never block the apply.
  begin
    perform public.ops_alert(
      '🍽️ New restaurant application: ' || btrim(p_name) || ' (' || p_zone::text || ')'
    );
  exception when others then null;
  end;

  return v_restaurant_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4) admin_upsert_kitchen -- mig-126 body, box check swapped.
-- ---------------------------------------------------------------------------
create or replace function public.admin_upsert_kitchen(
  p_slug             text,
  p_name             text,
  p_zone             zone_type,
  p_address          text    default null,
  p_lat              numeric default null,
  p_lng              numeric default null,
  p_monthly_rent_egp int     default null,
  p_lease_start      date    default null,
  p_lease_end        date    default null,
  p_is_active        boolean default null,
  p_notes            text    default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_id  uuid;
  v_geo geography(Point, 4326);
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;
  if coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  if p_slug is null or btrim(p_slug) = '' or p_name is null or btrim(p_name) = '' then
    raise exception 'SLUG_AND_NAME_REQUIRED' using errcode = 'check_violation';
  end if;
  if coalesce(p_monthly_rent_egp, 0) < 0 then
    raise exception 'INVALID_RENT' using errcode = 'check_violation';
  end if;

  -- Service-area gate. [129] Single source: is_within_service_area().
  if p_lat is not null and p_lng is not null then
    if not public.is_within_service_area(p_lat::float8, p_lng::float8) then
      raise exception 'GEO_OUT_OF_AREA' using errcode = 'check_violation';
    end if;
    v_geo := st_setsrid(st_makepoint(p_lng::float8, p_lat::float8), 4326)::geography;
  end if;

  insert into public.kitchens (slug, name, zone, address, geo, monthly_rent_egp,
                               lease_start, lease_end, is_active, notes)
  values (btrim(p_slug), btrim(p_name), p_zone, p_address, v_geo,
          coalesce(p_monthly_rent_egp, 0), p_lease_start, p_lease_end,
          coalesce(p_is_active, true), p_notes)
  on conflict (slug) do update set
    name             = excluded.name,
    zone             = excluded.zone,
    -- NULL param = keep the stored value (referencing the raw p_* params, not
    -- excluded.*, because the VALUES row already coalesced the NOT NULL
    -- columns and would masquerade as a real value). To CLEAR an optional
    -- field, update the row directly -- this RPC only sets or keeps.
    address          = coalesce(p_address, public.kitchens.address),
    geo              = coalesce(v_geo, public.kitchens.geo),
    monthly_rent_egp = coalesce(p_monthly_rent_egp, public.kitchens.monthly_rent_egp),
    lease_start      = coalesce(p_lease_start, public.kitchens.lease_start),
    lease_end        = coalesce(p_lease_end, public.kitchens.lease_end),
    is_active        = coalesce(p_is_active, public.kitchens.is_active),
    notes            = coalesce(p_notes, public.kitchens.notes),
    updated_at       = now()
  returning id into v_id;

  return v_id;
end;
$function$;

comment on function public.admin_upsert_kitchen(text, text, zone_type, text, numeric, numeric, int, date, date, boolean, text) is
  'ADMIN: create or update a physical kitchen, keyed on slug. NULL optionals preserve stored values. Service area via is_within_service_area (mig 129). Only writer of public.kitchens. Migs 126, 129.';
