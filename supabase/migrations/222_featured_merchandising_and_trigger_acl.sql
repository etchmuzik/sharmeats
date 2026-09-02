-- Keep editorial merchandising independent from the restaurant loyalty tier.
--
-- `restaurants.featured` remains the customer-facing, materialized carousel
-- flag so existing customer clients and their narrow REST projection keep
-- working. `featured_manual` records an administrator's editorial choice. The
-- effective flag is always `featured_manual OR current Gold tier`; a trigger
-- makes that true for the existing nightly sweep as well as the admin RPC.
--
-- Historic `featured = true` rows are ambiguous. A Gold tier is the only
-- automated producer, so current Gold rows remain loyalty-only and every
-- non-Gold feature is preserved as editorial intent. This avoids accidentally
-- making every Gold venue permanently featured when it later drops a tier.

-- ---------------------------------------------------------------------------
-- 1. Preserve manual intent separately from the customer-facing effective bit.
-- ---------------------------------------------------------------------------
alter table public.restaurants
  add column if not exists featured_manual boolean not null default false;

update public.restaurants r
   set featured_manual = true
 where coalesce(r.merchant_type, 'third_party') <> 'own_brand'
   and coalesce(r.featured, false)
   and not coalesce(r.featured_manual, false)
   and not exists (
     select 1
       from public.restaurant_loyalty rl
      where rl.restaurant_id = r.id
        and rl.tier = 'gold'
   );

-- A historical true flag cannot say whether Gold or an editor produced it.
-- Preserve non-Gold rows as editorial intent, but leave current Gold rows
-- loyalty-only so an old automatic feature does not become permanent. The
-- production scout found no affected rows; make any non-production ambiguity
-- visible to the operator instead of silently guessing.
do $ambiguous_featured_backfill$
declare
  v_ambiguous_count integer;
begin
  select count(*)
    into v_ambiguous_count
    from public.restaurants r
   where coalesce(r.merchant_type, 'third_party') <> 'own_brand'
     and coalesce(r.featured, false)
     and exists (
       select 1
         from public.restaurant_loyalty rl
        where rl.restaurant_id = r.id
          and rl.tier = 'gold'
     );

  if v_ambiguous_count > 0 then
    raise warning '[222] % featured Gold restaurant(s) were classified as loyalty-only because historic data cannot distinguish editorial intent from tier output; review featured_manual after deployment', v_ambiguous_count;
  end if;
end;
$ambiguous_featured_backfill$;

comment on column public.restaurants.featured_manual is
  'Editorial carousel choice. The customer-facing featured bit is materialized as featured_manual OR restaurant_loyalty.tier = gold; own-brand rows are always false. Migration 222.';

-- Normalize the existing materialized bit before installing its trigger. This
-- repairs any Gold/false drift as well as enforcing the own-brand rule for
-- every historical row.
update public.restaurants r
   set featured = case
     when r.merchant_type = 'own_brand' then false
     else coalesce(r.featured_manual, false)
       or exists (
         select 1
           from public.restaurant_loyalty rl
          where rl.restaurant_id = r.id
            and rl.tier = 'gold'
       )
   end;

-- Keep the established constraint name so existing integrity assertions and
-- operational documentation continue to name the one complete ranking rule.
alter table public.restaurants
  drop constraint if exists restaurants_own_brand_never_featured_chk;
alter table public.restaurants
  add constraint restaurants_own_brand_never_featured_chk
    check (
      merchant_type <> 'own_brand'
      or (
        coalesce(featured, false) = false
        and coalesce(featured_manual, false) = false
      )
    ) not valid;
alter table public.restaurants
  validate constraint restaurants_own_brand_never_featured_chk;

comment on constraint restaurants_own_brand_never_featured_chk on public.restaurants is
  'RANKING INTEGRITY (migrations 126, 222): a company-owned brand can never be effectively or manually featured. Customer featured is the materialized editorial-or-Gold carousel flag.';

-- A trigger is safer than copying the long, cron-bound loyalty_tier_sweep()
-- body: the existing sweep still writes `featured = (tier = 'gold')`, and this
-- final write boundary derives the exact effective value from the current tier
-- plus manual intent. It is SECURITY DEFINER only because a trigger must work
-- even when a narrowly granted writer cannot SELECT restaurant_loyalty. It is
-- trigger-only, has a pinned path, schema-qualified reads, and no client
-- EXECUTE grant.
create or replace function public.restaurants_sync_featured()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
begin
  if new.merchant_type = 'own_brand' then
    new.featured_manual := false;
    new.featured := false;
  else
    -- Existing seed/import files predate featured_manual and express editorial
    -- intent by inserting featured=true. Preserve that one-time import
    -- contract, while UPDATE paths remain exact derivations so a nightly
    -- Gold write can never manufacture manual intent.
    if tg_op = 'INSERT' and coalesce(new.featured, false) then
      new.featured_manual := true;
    end if;
    new.featured := coalesce(new.featured_manual, false)
      or exists (
        select 1
          from public.restaurant_loyalty rl
         where rl.restaurant_id = new.id
           and rl.tier = 'gold'
      );
  end if;

  return new;
end;
$function$;

revoke all on function public.restaurants_sync_featured()
  from public, anon, authenticated, service_role;

comment on function public.restaurants_sync_featured() is
  'Trigger-only integrity function: materializes restaurants.featured from editorial intent and the current Gold tier, and forces both flags false for own brands. No client EXECUTE. Migration 222.';

drop trigger if exists restaurants_sync_featured_trg on public.restaurants;
create trigger restaurants_sync_featured_trg
  before insert or update of merchant_type, featured, featured_manual
  on public.restaurants
  for each row
  execute function public.restaurants_sync_featured();

-- Restaurant tiers can be changed by the nightly sweep and by operator repair
-- scripts without touching restaurants.featured. Give that table its own final
-- write boundary so a promotion, demotion, or deleted tier row cannot leave the
-- materialized customer bit stale.
create or replace function public.restaurant_loyalty_sync_featured()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
begin
  if tg_op = 'DELETE' then
    update public.restaurants r
       set featured = coalesce(r.featured_manual, false)
         or exists (
           select 1
             from public.restaurant_loyalty rl
            where rl.restaurant_id = r.id
              and rl.tier = 'gold'
         )
     where r.id = old.restaurant_id;
    return old;
  end if;

  -- Moving a tier row is rare, but keeping both sides exact makes the trigger
  -- safe for an operator correction too.
  if tg_op = 'UPDATE'
     and old.restaurant_id is distinct from new.restaurant_id then
    update public.restaurants r
       set featured = coalesce(r.featured_manual, false)
         or exists (
           select 1
             from public.restaurant_loyalty rl
            where rl.restaurant_id = r.id
              and rl.tier = 'gold'
         )
     where r.id = old.restaurant_id;
  end if;

  update public.restaurants r
     set featured = coalesce(r.featured_manual, false)
       or exists (
         select 1
           from public.restaurant_loyalty rl
          where rl.restaurant_id = r.id
            and rl.tier = 'gold'
       )
   where r.id = new.restaurant_id;
  return new;
end;
$function$;

revoke all on function public.restaurant_loyalty_sync_featured()
  from public, anon, authenticated, service_role;

comment on function public.restaurant_loyalty_sync_featured() is
  'Trigger-only integrity function: rematerializes restaurants.featured after a restaurant loyalty tier change. No client EXECUTE. Migration 222.';

drop trigger if exists restaurant_loyalty_sync_featured_trg
  on public.restaurant_loyalty;
create trigger restaurant_loyalty_sync_featured_trg
  after insert or delete or update of tier, restaurant_id
  on public.restaurant_loyalty
  for each row
  execute function public.restaurant_loyalty_sync_featured();

-- `featured_manual` is editorial-only. `authenticated` is a shared transport
-- role for customers, drivers, merchants, and admins, so even an admin-only UI
-- must not receive it through a direct table projection. A fixed, admin-gated
-- RPC below is the sole client read path. Clear any inherited PUBLIC grant;
-- the assertion at the end deliberately fails closed if a broad authenticated
-- table grant makes this column readable again.
revoke select on table public.restaurants from public;
revoke select (featured_manual)
  on table public.restaurants
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Keep the existing admin transport backward compatible. p_featured stays
--    the legacy *effective* carousel bit, because cached clients do not know
--    about featured_manual. A separate RPC below changes editorial intent.
-- ---------------------------------------------------------------------------
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
declare
  v_current_featured boolean;
  v_current_manual boolean;
  v_is_gold boolean;
  v_merchant_type text;
  v_next_manual boolean;
begin
  if coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'NAME_REQUIRED' using errcode = 'check_violation';
  end if;

  select coalesce(r.featured, false),
         coalesce(r.featured_manual, false),
         exists (
           select 1
             from public.restaurant_loyalty rl
            where rl.restaurant_id = r.id
              and rl.tier = 'gold'
         ),
         r.merchant_type::text
    into v_current_featured,
         v_current_manual,
         v_is_gold,
         v_merchant_type
    from public.restaurants r
   where r.id = p_id
   for update;

  if not found then
    raise exception 'RESTAURANT_NOT_FOUND' using errcode = 'check_violation';
  end if;

  if coalesce(p_featured, false) and v_merchant_type = 'own_brand' then
    raise exception 'OWN_BRAND_CANNOT_BE_FEATURED'
      using errcode = 'check_violation';
  end if;

  -- An unchanged legacy effective flag says nothing about manual intent. This
  -- is the crucial compatibility rule: a cached editor that saves a Gold row
  -- with featured=true must not promote it permanently. A deliberate legacy
  -- change still maps to manual intent on non-Gold rows.
  v_next_manual := v_current_manual;
  if coalesce(p_featured, false) is distinct from v_current_featured then
    v_next_manual := coalesce(p_featured, false) and not v_is_gold;
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
    featured_manual  = v_next_manual,
    promo            = p_promo,
    is_active        = p_is_active
  where id = p_id;
end;
$function$;

revoke all on function public.admin_update_restaurant(
  uuid, text, text, public.food_cuisine_type[], text, text, text,
  public.zone_type, integer, integer, integer, integer, boolean, boolean,
  boolean, boolean, text, boolean
) from public, anon, authenticated, service_role;
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
  'Backward-compatible admin restaurant editor. p_featured remains the legacy effective carousel bit and only changes editorial intent when it differs from the current effective state; use admin_set_restaurant_featured_manual for an unambiguous editorial change. Cuisine writes accept food_cuisine_type[] only; vertical assignment remains admin_assign_merchant_vertical. Migration 222.';

-- New clients must not send an effective bit at all: a Gold demotion between
-- page load and an unrelated detail save would otherwise make stale
-- p_featured=true look like a deliberate editorial promotion. Keep the
-- long-lived RPC above for cached clients, and use this feature-free endpoint
-- for all current dashboard detail writes.
create or replace function public.admin_update_restaurant_details(
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
    promo            = p_promo,
    is_active        = p_is_active
  where id = p_id;

  if not found then
    raise exception 'RESTAURANT_NOT_FOUND' using errcode = 'check_violation';
  end if;
end;
$function$;

revoke all on function public.admin_update_restaurant_details(
  uuid, text, text, public.food_cuisine_type[], text, text, text,
  public.zone_type, integer, integer, integer, integer, boolean, boolean,
  boolean, text, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_restaurant_details(
  uuid, text, text, public.food_cuisine_type[], text, text, text,
  public.zone_type, integer, integer, integer, integer, boolean, boolean,
  boolean, text, boolean
) to authenticated;

comment on function public.admin_update_restaurant_details(
  uuid, text, text, public.food_cuisine_type[], text, text, text,
  public.zone_type, integer, integer, integer, integer, boolean, boolean,
  boolean, text, boolean
) is
  'Current admin restaurant details editor. Intentionally has no featured argument, so a stale effective Gold flag cannot alter editorial intent; use admin_set_restaurant_featured_manual for that explicit write. Migration 222.';

-- New admin clients use an explicit intent RPC so Gold eligibility and an
-- editorial promotion can never be conflated again.
create or replace function public.admin_set_restaurant_featured_manual(
  p_id uuid,
  p_featured_manual boolean
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_merchant_type text;
begin
  if coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;

  select r.merchant_type::text
    into v_merchant_type
    from public.restaurants r
   where r.id = p_id
   for update;

  if not found then
    raise exception 'RESTAURANT_NOT_FOUND' using errcode = 'check_violation';
  end if;
  if coalesce(p_featured_manual, false)
     and v_merchant_type = 'own_brand' then
    raise exception 'OWN_BRAND_CANNOT_BE_FEATURED'
      using errcode = 'check_violation';
  end if;

  update public.restaurants
     set featured_manual = coalesce(p_featured_manual, false)
   where id = p_id;
end;
$function$;

revoke all on function public.admin_set_restaurant_featured_manual(uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_set_restaurant_featured_manual(uuid, boolean)
  to authenticated;

comment on function public.admin_set_restaurant_featured_manual(uuid, boolean) is
  'Admin-only editorial carousel intent. restaurants_sync_featured materializes the customer-facing flag as manual OR current Gold tier. Migration 222.';

-- Return only the editor's fields through an admin-gated exact projection.
-- This is intentionally not a view: a SECURITY DEFINER RPC can enforce the
-- stored application role before bypassing the shared storefront RLS policy.
create or replace function public.admin_restaurant_editor_list()
returns table (
  id uuid,
  slug text,
  name text,
  description text,
  cuisines public.cuisine_type[],
  cuisine_label text,
  cover_image text,
  logo text,
  zone public.zone_type,
  rating numeric,
  rating_count integer,
  prep_time_low integer,
  prep_time_high integer,
  delivery_fee_egp integer,
  min_order_egp integer,
  tourist_safe boolean,
  is_open boolean,
  is_open_24h boolean,
  featured boolean,
  featured_manual boolean,
  promo text,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;

  return query
    select r.id,
           r.slug,
           r.name,
           r.description,
           r.cuisines,
           r.cuisine_label,
           r.cover_image,
           r.logo,
           r.zone,
           r.rating,
           r.rating_count,
           r.prep_time_low,
           r.prep_time_high,
           r.delivery_fee_egp,
           r.min_order_egp,
           r.tourist_safe,
           r.is_open,
           r.is_open_24h,
           r.featured,
           r.featured_manual,
           r.promo,
           r.is_active
      from public.restaurants r
     order by r.name, r.id;
end;
$function$;

revoke all on function public.admin_restaurant_editor_list()
  from public, anon, authenticated, service_role;
grant execute on function public.admin_restaurant_editor_list()
  to authenticated;

comment on function public.admin_restaurant_editor_list() is
  'Admin-only exact restaurant-editor projection, including editorial featured_manual. Shared client roles must not read that column directly. Migration 222.';

comment on function public.loyalty_tier_sweep() is
  'CRON (daily 02:00): recompute customer/driver/restaurant loyalty tiers. Own brands are excluded from the restaurant loop; the restaurants_sync_featured trigger materializes the customer carousel flag from editorial intent OR Gold tier. Owner-privileged; no client grant. Migrations 126, 222.';

-- ---------------------------------------------------------------------------
-- 3. Trigger-only SECURITY DEFINER functions are not client RPCs. PostgreSQL
--    grants new functions EXECUTE to PUBLIC by default, so close each historic
--    trigger helper explicitly and fail the migration if a client path remains.
-- ---------------------------------------------------------------------------
revoke all on function public._guard_spatial_ref_sys()
  from public, anon, authenticated, service_role;
revoke all on function public.notify_order_status_event()
  from public, anon, authenticated, service_role;
revoke all on function public.stamp_order_vertical()
  from public, anon, authenticated, service_role;
revoke all on function public.menu_items_enforce_vertical_capability()
  from public, anon, authenticated, service_role;

do $assertions$
declare
  v_function text;
begin
  foreach v_function in array array[
    'public._guard_spatial_ref_sys()',
    'public.notify_order_status_event()',
    'public.stamp_order_vertical()',
    'public.menu_items_enforce_vertical_capability()',
    'public.restaurants_sync_featured()',
    'public.restaurant_loyalty_sync_featured()'
  ]
  loop
    if has_function_privilege('public', v_function, 'execute')
       or has_function_privilege('anon', v_function, 'execute')
       or has_function_privilege('authenticated', v_function, 'execute')
       or has_function_privilege('service_role', v_function, 'execute') then
      raise exception '[222] trigger-only function % is executable by a client role', v_function;
    end if;
  end loop;

  if has_column_privilege('public', 'public.restaurants', 'featured_manual', 'select')
     or has_column_privilege('anon', 'public.restaurants', 'featured_manual', 'select')
     or has_column_privilege('authenticated', 'public.restaurants', 'featured_manual', 'select') then
    raise exception '[222] a shared client role can read restaurants.featured_manual directly';
  end if;
end;
$assertions$;
