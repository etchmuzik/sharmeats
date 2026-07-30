-- 20260730162600_p07_governance_hardening.sql
--
-- Package 07 governance hardening after the E0/C0 peer review.
--
-- This closes four authority gaps without removing the legacy cuisine enum
-- values (old clients may still know how to decode them):
--   1. the grocery/pharmacy private-stage repair now runs behind the canonical
--      vertical advisory locks, in deterministic order;
--   2. lifecycle producers share that lock with stage/access transitions and
--      re-check visibility after acquiring it;
--   3. vertical_not_visible is a first-class suppression-ledger reason;
--   4. restaurants.cuisines is food-only in the database, RPC write domain,
--      generated client domain, admin UI, and compatibility decoder.
--
-- Existing cuisine arrays are normalized by removing only the two values that
-- are vertical identities. All actual food cuisine tags and every row survive.

-- ===========================================================================
-- 1. Repeat the Package 07 private-stage repair behind the canonical locks.
-- ===========================================================================
-- Migration 187 performed this update directly. Repeating it here is not just
-- idempotency: taking both vertical locks creates a barrier behind any order
-- transaction that began before the original repair, and gives fresh installs
-- a lock-correct, auditable repair primitive.
create or replace function private.enforce_package07_private_verticals()
returns integer
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
declare
  v_vertical text;
  v_previous_stage text;
  v_is_active boolean;
  v_changed integer := 0;
begin
  -- Acquire the full key set before writing, in the same total order used by
  -- merchant reassignment. No transaction can observe a half-repaired pair.
  for v_vertical in
    select value
      from unnest(array['grocery','pharmacy']::text[]) as verticals(value)
     order by value
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('vertical:' || v_vertical, 0)
    );
  end loop;

  for v_vertical in
    select value
      from unnest(array['grocery','pharmacy']::text[]) as verticals(value)
     order by value
  loop
    select launch_stage, is_active
      into v_previous_stage, v_is_active
      from public.verticals
     where id = v_vertical
     for update;

    if found and v_previous_stage is distinct from 'private' then
      insert into public.vertical_launch_events (
        vertical_id, previous_stage, new_stage,
        previous_is_active, new_is_active,
        reason, evidence_reference, actor_user_id, occurred_at
      ) values (
        v_vertical, v_previous_stage, 'private',
        v_is_active, v_is_active,
        'Package 07 governance hardening: lock-correct private pilot repair',
        'migration 20260730162600', null, now()
      );

      update public.verticals
         set launch_stage = 'private'
       where id = v_vertical;
      v_changed := v_changed + 1;
    end if;
  end loop;

  return v_changed;
end;
$function$;

revoke all on function private.enforce_package07_private_verticals()
  from public, anon, authenticated;

comment on function private.enforce_package07_private_verticals() is
  'Database-owner Package 07 repair. Locks vertical:grocery then vertical:pharmacy before any stage write, rechecks rows FOR UPDATE, and audits every actual change. Not a client API. Migration 20260730162600.';

select private.enforce_package07_private_verticals();

-- ===========================================================================
-- 2. Suppression decisions must be ledgerable.
-- ===========================================================================
alter table public.lifecycle_sends
  drop constraint if exists lifecycle_sends_suppression_reason_check;

alter table public.lifecycle_sends
  add constraint lifecycle_sends_suppression_reason_check
  check (
    suppression_reason is null
    or suppression_reason in (
      'no_consent','quiet_hours','global_cap','event_cap','active_order',
      'subject_invalid','already_sent','holdout','no_recipient',
      'vertical_not_visible'
    )
  );

-- ===========================================================================
-- 3. Food cuisine is an authoritative write domain, not a vertical alias.
-- ===========================================================================
do $migration$
begin
  if not exists (
    select 1
      from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'food_cuisine_type'
  ) then
    create type public.food_cuisine_type as enum (
      'italian','seafood','egyptian','sushi','healthy','burgers','cafe','asian',
      'pizza','breakfast','late_night','street_food','sweets'
    );
  end if;
end;
$migration$;

-- Preserve rows and every real cuisine. grocery/pharmacy already have a home
-- in restaurants.vertical_id; keeping them in cuisines duplicates identity and
-- lets food filters accidentally become vertical navigation.
update public.restaurants
   set cuisines = array_remove(
                    array_remove(cuisines, 'grocery'::public.cuisine_type),
                    'pharmacy'::public.cuisine_type
                  )
 where cuisines && array['grocery','pharmacy']::public.cuisine_type[];

alter table public.restaurants
  drop constraint if exists restaurants_cuisines_food_only;

alter table public.restaurants
  add constraint restaurants_cuisines_food_only
  check (
    not (
      cuisines
      && array['grocery','pharmacy']::public.cuisine_type[]
    )
  ) not valid;

alter table public.restaurants
  validate constraint restaurants_cuisines_food_only;

comment on constraint restaurants_cuisines_food_only on public.restaurants is
  'Cuisine is food taxonomy only. grocery/pharmacy are restaurants.vertical_id values and cannot be stored in cuisines. Migration 20260730162600.';

-- Replace, do not overload, the admin write RPC. The public name and argument
-- names stay stable, so existing food-only callers keep working; generated
-- clients now receive the narrower food_cuisine_type[] contract.
drop function if exists public.admin_update_restaurant(
  uuid, text, text, public.cuisine_type[], text, text, text, public.zone_type,
  integer, integer, integer, integer, boolean, boolean, boolean, boolean,
  text, boolean
);

create or replace function public.admin_update_restaurant(
  p_id uuid,
  p_name text,
  p_description text,
  p_cuisines public.food_cuisine_type[],
  p_cuisine_label text,
  p_cover_image text,
  p_logo text,
  p_zone public.zone_type,
  p_prep_time_low integer,
  p_prep_time_high integer,
  p_delivery_fee_egp integer,
  p_min_order_egp integer,
  p_tourist_safe boolean,
  p_is_open boolean,
  p_is_open_24h boolean,
  p_featured boolean,
  p_promo text,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'NAME_REQUIRED' using errcode = 'check_violation';
  end if;

  if coalesce(p_featured, false) and exists (
    select 1
      from public.restaurants
     where id = p_id and merchant_type = 'own_brand'
  ) then
    raise exception 'OWN_BRAND_CANNOT_BE_FEATURED'
      using errcode = 'check_violation';
  end if;

  update public.restaurants set
    name             = btrim(p_name),
    description      = p_description,
    cuisines         = p_cuisines::text[]::public.cuisine_type[],
    cuisine_label    = p_cuisine_label,
    cover_image      = p_cover_image,
    logo             = p_logo,
    zone             = p_zone,
    prep_time_low    = p_prep_time_low,
    prep_time_high   = p_prep_time_high,
    delivery_fee_egp = p_delivery_fee_egp,
    min_order_egp    = p_min_order_egp,
    tourist_safe     = p_tourist_safe,
    is_open          = p_is_open,
    is_open_24h      = p_is_open_24h,
    featured         = p_featured,
    promo            = p_promo,
    is_active        = p_is_active
  where id = p_id;

  if not found then
    raise exception 'RESTAURANT_NOT_FOUND' using errcode = 'check_violation';
  end if;
end;
$function$;

revoke all on function public.admin_update_restaurant(
  uuid, text, text, public.food_cuisine_type[], text, text, text,
  public.zone_type, integer, integer, integer, integer, boolean, boolean,
  boolean, boolean, text, boolean
) from public, anon;
grant execute on function public.admin_update_restaurant(
  uuid, text, text, public.food_cuisine_type[], text, text, text,
  public.zone_type, integer, integer, integer, integer, boolean, boolean,
  boolean, boolean, text, boolean
) to authenticated;

comment on function public.admin_update_restaurant(
  uuid, text, text, public.food_cuisine_type[], text, text, text,
  public.zone_type, integer, integer, integer, integer, boolean, boolean,
  boolean, boolean, text, boolean
) is
  'Admin restaurant editor. Cuisine writes accept food_cuisine_type[] only; vertical assignment remains admin_assign_merchant_vertical. Migration 20260730162600.';

-- Same compatibility policy for self-onboarding: stable RPC name/field names,
-- narrowed generated input domain, no surviving broad overload.
drop function if exists public.apply_as_restaurant(
  text, text, public.cuisine_type[], text, text, public.zone_type,
  double precision, double precision, boolean, integer, integer,
  text, text, text, text, text, text
);

create or replace function public.apply_as_restaurant(
  p_name text,
  p_description text,
  p_cuisines public.food_cuisine_type[],
  p_phone text,
  p_address text,
  p_zone public.zone_type,
  p_lat double precision,
  p_lng double precision,
  p_is_open_24h boolean,
  p_prep_low integer,
  p_prep_high integer,
  p_payout_method text,
  p_payout_bank_name text,
  p_payout_iban text,
  p_payout_wallet text,
  p_payout_holder text,
  p_terms_version text
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

  select restaurant_id
    into v_existing
    from public.merchant_staff
   where profile_id = v_uid
   limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  select coalesce(role::text, '')
    into v_role
    from public.users
   where id = v_uid;
  if v_role is distinct from 'customer' then
    raise exception 'NOT_ELIGIBLE' using errcode = 'check_violation';
  end if;

  if p_name is null or length(btrim(p_name)) not between 2 and 120 then
    raise exception 'INVALID_NAME' using errcode = 'check_violation';
  end if;
  if p_phone is null or length(btrim(p_phone)) not between 6 and 20 then
    raise exception 'INVALID_PHONE' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.zones where id = p_zone and is_active
  ) then
    raise exception 'ZONE_NOT_SERVED' using errcode = 'check_violation';
  end if;
  if not public.is_within_service_area(p_lat, p_lng) then
    raise exception 'GEO_OUT_OF_AREA' using errcode = 'check_violation';
  end if;
  if p_terms_version is null or btrim(p_terms_version) = '' then
    raise exception 'TERMS_REQUIRED' using errcode = 'check_violation';
  end if;

  v_base_slug := btrim(
    regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g'),
    '-'
  );
  if v_base_slug = '' then
    v_base_slug := 'restaurant';
  end if;
  v_slug := v_base_slug;
  while exists (select 1 from public.restaurants where slug = v_slug) loop
    v_slug := v_base_slug || '-'
      || substr(md5(clock_timestamp()::text || random()::text), 1, 4);
  end loop;

  insert into public.restaurants (
    slug, name, description, cuisines, cuisine_label, cover_image, zone, geo,
    phone, address, is_open_24h, prep_time_low, prep_time_high,
    payout_method, payout_bank_name, payout_iban, payout_wallet, payout_holder,
    is_active, is_open, onboarding_status, commission_pct, tourist_safe,
    terms_version, terms_accepted_at
  ) values (
    v_slug,
    btrim(p_name),
    coalesce(btrim(p_description), ''),
    coalesce(
      p_cuisines,
      '{}'::public.food_cuisine_type[]
    )::text[]::public.cuisine_type[],
    '',
    '',
    p_zone,
    st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
    btrim(p_phone),
    nullif(btrim(coalesce(p_address, '')), ''),
    coalesce(p_is_open_24h, false),
    coalesce(nullif(p_prep_low, 0), 10),
    coalesce(nullif(p_prep_high, 0), 30),
    nullif(btrim(coalesce(p_payout_method, '')), ''),
    nullif(btrim(coalesce(p_payout_bank_name, '')), ''),
    nullif(btrim(coalesce(p_payout_iban, '')), ''),
    nullif(btrim(coalesce(p_payout_wallet, '')), ''),
    nullif(btrim(coalesce(p_payout_holder, '')), ''),
    false,
    false,
    'submitted',
    15.0,
    false,
    btrim(p_terms_version),
    now()
  )
  returning id into v_restaurant_id;

  insert into public.merchant_staff (profile_id, restaurant_id, staff_role)
  values (v_uid, v_restaurant_id, 'owner');

  update public.users
     set role = 'merchant_staff', updated_at = now()
   where id = v_uid;

  begin
    perform public.ops_alert(
      '🍽️ New restaurant application: '
      || btrim(p_name)
      || ' ('
      || p_zone::text
      || ')'
    );
  exception when others then
    null;
  end;

  return v_restaurant_id;
end;
$function$;

revoke all on function public.apply_as_restaurant(
  text, text, public.food_cuisine_type[], text, text, public.zone_type,
  double precision, double precision, boolean, integer, integer,
  text, text, text, text, text, text
) from public, anon;
grant execute on function public.apply_as_restaurant(
  text, text, public.food_cuisine_type[], text, text, public.zone_type,
  double precision, double precision, boolean, integer, integer,
  text, text, text, text, text, text
) to authenticated;

comment on function public.apply_as_restaurant(
  text, text, public.food_cuisine_type[], text, text, public.zone_type,
  double precision, double precision, boolean, integer, integer,
  text, text, text, text, text, text
) is
  'Restaurant self-onboarding with the shared service-area gate and a food-only cuisine input domain. Grocery/pharmacy onboarding uses vertical assignment, not cuisine tags. Migration 20260730162600.';

-- ===========================================================================
-- 4. Lifecycle producers serialize visibility with vertical transitions.
-- ===========================================================================
-- Shared locks let reminder producers run together while contending with the
-- exclusive lock used by launch-stage/access changes. Each query is ordered by
-- the vertical lock key so a producer that visits more than one vertical has
-- the same total order as every other multi-vertical path.
create or replace function public.abandoned_cart_sweep()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_idle_hours int;
  v_live boolean := public.lifecycle_is_live();
  v_rec record;
  v_gate record;
  v_msg uuid;
  v_count int := 0;
  v_vertical_lock boolean := false;
begin
  select coalesce(
    (
      select (value #>> '{}')::int
        from public.platform_settings
       where key = 'lifecycle_cart_idle_hours'
    ),
    24
  ) into v_idle_hours;

  for v_rec in
    select
      c.user_id,
      c.restaurant_id,
      c.items,
      c.updated_at,
      r.is_active,
      r.is_open,
      r.name as restaurant_name,
      r.vertical_id
      from public.customer_carts c
      join public.restaurants r on r.id = c.restaurant_id
     where c.restaurant_id is not null
       and c.user_id is not null
       and jsonb_array_length(c.items) > 0
       and c.updated_at < now() - make_interval(hours => v_idle_hours)
       and c.expires_at > now()
     order by r.vertical_id, c.user_id
  loop
    begin
      v_vertical_lock := false;
      if not (v_rec.is_active and v_rec.is_open) then
        perform public.lifecycle_record(
          v_rec.user_id,
          'abandoned_cart',
          v_rec.restaurant_id,
          false,
          'subject_invalid',
          public.lifecycle_holdout_group(v_rec.user_id, 'abandoned_cart')
        );
        continue;
      end if;

      -- The lock and re-check form one linearized visibility decision with
      -- set_vertical_launch_stage and grant/revoke/expiry paths.
      -- Mark the scoped acquisition BEFORE entering LockAcquire. A cancellation
      -- can arrive after PostgreSQL grants a session lock but before PERFORM
      -- returns; pre-marking makes the query_canceled handler attempt cleanup
      -- on both sides of that boundary (unlocking a not-yet-acquired key is a
      -- harmless false return).
      v_vertical_lock := true;
      perform pg_advisory_lock_shared(
        hashtextextended('vertical:' || v_rec.vertical_id, 0)
      );
      if not public.user_can_view_vertical(
        v_rec.user_id,
        v_rec.vertical_id
      ) then
        perform pg_advisory_unlock_shared(
          hashtextextended('vertical:' || v_rec.vertical_id, 0)
        );
        v_vertical_lock := false;
        perform public.lifecycle_record(
          v_rec.user_id,
          'abandoned_cart',
          v_rec.restaurant_id,
          false,
          'vertical_not_visible',
          public.lifecycle_holdout_group(v_rec.user_id, 'abandoned_cart')
        );
        continue;
      end if;

      select *
        into v_gate
        from public.lifecycle_eligible(
          v_rec.user_id,
          'abandoned_cart',
          v_rec.restaurant_id
        );

      if not v_gate.allowed then
        perform pg_advisory_unlock_shared(
          hashtextextended('vertical:' || v_rec.vertical_id, 0)
        );
        v_vertical_lock := false;
        perform public.lifecycle_record(
          v_rec.user_id,
          'abandoned_cart',
          v_rec.restaurant_id,
          false,
          v_gate.reason,
          v_gate.holdout_group
        );
        continue;
      end if;

      v_msg := null;
      if v_live then
        v_msg := public.enqueue_push(
          p_event := 'cart_reminder',
          p_order_id := null,
          p_recipient_user_ids := array[v_rec.user_id],
          p_idempotency_key := 'lifecycle:abandoned_cart:'
            || v_rec.user_id
            || ':'
            || v_rec.restaurant_id,
          p_route := '/(tabs)/cart',
          p_vertical := v_rec.vertical_id,
          p_category := 'marketing'
        );
      end if;

      -- Release BEFORE lifecycle_record: its user_id FK takes a KEY SHARE row
      -- lock, while private-access RPCs lock users rows before the exclusive
      -- vertical advisory. Holding vertical -> users here would invert that
      -- canonical users -> vertical hierarchy and deadlock.
      perform pg_advisory_unlock_shared(
        hashtextextended('vertical:' || v_rec.vertical_id, 0)
      );
      v_vertical_lock := false;

      perform public.lifecycle_record(
        v_rec.user_id,
        'abandoned_cart',
        v_rec.restaurant_id,
        true,
        null,
        v_gate.holdout_group,
        v_msg
      );
      v_count := v_count + 1;
    exception when query_canceled then
      -- OTHERS deliberately excludes query_canceled. Explicit cleanup prevents
      -- a statement timeout from leaking a session advisory lock into a pooled
      -- backend.
      if v_vertical_lock then
        perform pg_advisory_unlock_shared(
          hashtextextended('vertical:' || v_rec.vertical_id, 0)
        );
      end if;
      raise;
    when others then
      if v_vertical_lock then
        perform pg_advisory_unlock_shared(
          hashtextextended('vertical:' || v_rec.vertical_id, 0)
        );
      end if;
      raise warning 'abandoned_cart_sweep user(%) failed: %',
        v_rec.user_id,
        sqlerrm;
    end;
  end loop;

  return v_count;
end;
$function$;

revoke all on function public.abandoned_cart_sweep()
  from public, anon, authenticated;

comment on function public.abandoned_cart_sweep() is
  'Lifecycle abandoned-cart producer. Visits verticals in deterministic order, takes the shared canonical vertical lock, and re-checks visibility before enqueue. Migration 20260730162600.';

create or replace function public.reorder_cadence_sweep()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_live boolean := public.lifecycle_is_live();
  v_rec record;
  v_gate record;
  v_msg uuid;
  v_count int := 0;
  v_vertical_lock boolean := false;
begin
  for v_rec in
    select
      o.id,
      o.user_id,
      o.restaurant_id,
      o.vertical_id,
      r.is_active,
      r.is_open
      from public.orders o
      join public.restaurants r on r.id = o.restaurant_id
     where o.status = 'delivered'
       and o.delivered_at is not null
       and o.user_id is not null
       and (
         o.delivered_at between now() - interval '9 days'
                            and now() - interval '7 days'
         or o.delivered_at between now() - interval '16 days'
                            and now() - interval '14 days'
       )
       and o.id is not distinct from (
         select o2.id
           from public.orders o2
          where o2.user_id = o.user_id
            and o2.restaurant_id = o.restaurant_id
            and o2.status = 'delivered'
          order by o2.delivered_at desc
          limit 1
       )
     order by o.vertical_id, o.id
  loop
    begin
      v_vertical_lock := false;
      if not (v_rec.is_active and v_rec.is_open) then
        perform public.lifecycle_record(
          v_rec.user_id,
          'reorder_cadence',
          v_rec.id,
          false,
          'subject_invalid',
          public.lifecycle_holdout_group(v_rec.user_id, 'reorder_cadence')
        );
        continue;
      end if;

      v_vertical_lock := true;
      perform pg_advisory_lock_shared(
        hashtextextended('vertical:' || v_rec.vertical_id, 0)
      );
      if not public.user_can_view_vertical(
        v_rec.user_id,
        v_rec.vertical_id
      ) then
        perform pg_advisory_unlock_shared(
          hashtextextended('vertical:' || v_rec.vertical_id, 0)
        );
        v_vertical_lock := false;
        perform public.lifecycle_record(
          v_rec.user_id,
          'reorder_cadence',
          v_rec.id,
          false,
          'vertical_not_visible',
          public.lifecycle_holdout_group(v_rec.user_id, 'reorder_cadence')
        );
        continue;
      end if;

      select *
        into v_gate
        from public.lifecycle_eligible(
          v_rec.user_id,
          'reorder_cadence',
          v_rec.id
        );

      if not v_gate.allowed then
        perform pg_advisory_unlock_shared(
          hashtextextended('vertical:' || v_rec.vertical_id, 0)
        );
        v_vertical_lock := false;
        perform public.lifecycle_record(
          v_rec.user_id,
          'reorder_cadence',
          v_rec.id,
          false,
          v_gate.reason,
          v_gate.holdout_group
        );
        continue;
      end if;

      v_msg := null;
      if v_live then
        v_msg := public.enqueue_push(
          p_event := 'reorder_reminder',
          p_order_id := v_rec.id,
          p_recipient_user_ids := array[v_rec.user_id],
          p_idempotency_key := 'lifecycle:reorder_cadence:' || v_rec.id,
          p_vertical := v_rec.vertical_id,
          p_category := 'marketing'
        );
      end if;

      perform pg_advisory_unlock_shared(
        hashtextextended('vertical:' || v_rec.vertical_id, 0)
      );
      v_vertical_lock := false;

      perform public.lifecycle_record(
        v_rec.user_id,
        'reorder_cadence',
        v_rec.id,
        true,
        null,
        v_gate.holdout_group,
        v_msg
      );
      v_count := v_count + 1;
    exception when query_canceled then
      if v_vertical_lock then
        perform pg_advisory_unlock_shared(
          hashtextextended('vertical:' || v_rec.vertical_id, 0)
        );
      end if;
      raise;
    when others then
      if v_vertical_lock then
        perform pg_advisory_unlock_shared(
          hashtextextended('vertical:' || v_rec.vertical_id, 0)
        );
      end if;
      raise warning 'reorder_cadence_sweep order(%) failed: %',
        v_rec.id,
        sqlerrm;
    end;
  end loop;

  return v_count;
end;
$function$;

revoke all on function public.reorder_cadence_sweep()
  from public, anon, authenticated;

comment on function public.reorder_cadence_sweep() is
  'Lifecycle reorder producer. Visits verticals in deterministic order, takes the shared canonical vertical lock, and re-checks visibility before enqueue. Migration 20260730162600.';
