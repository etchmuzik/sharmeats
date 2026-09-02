\set ON_ERROR_STOP on

-- Regression fixture for migration 222. The pre-migration state intentionally
-- has one overloaded feature bit: loyalty writes it nightly and the admin
-- editor writes it manually. The migration must preserve both meanings without
-- exposing the editorial flag to storefront callers.
begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end;
$$;

create type public.zone_type as enum ('naama');
create type public.cuisine_type as enum ('egyptian');
create type public.food_cuisine_type as enum ('egyptian');

create table public.restaurants (
  id uuid primary key,
  slug text not null default '',
  name text not null,
  description text,
  cuisines public.cuisine_type[] not null default '{}'::public.cuisine_type[],
  cuisine_label text,
  cover_image text,
  logo text,
  zone public.zone_type not null default 'naama',
  rating numeric not null default 0,
  rating_count integer not null default 0,
  prep_time_low integer,
  prep_time_high integer,
  delivery_fee_egp integer,
  min_order_egp integer,
  tourist_safe boolean not null default false,
  is_open boolean not null default true,
  is_open_24h boolean not null default false,
  featured boolean not null default false,
  promo text,
  is_active boolean not null default true,
  merchant_type text not null default 'third_party'
);

create table public.restaurant_loyalty (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  tier text not null default 'bronze' check (tier in ('bronze', 'silver', 'gold'))
);

-- The current RPC checks this stored application role. Keeping it session based
-- makes the fixture independent from the full auth/users schema.
create function public.auth_role()
returns text
language sql
stable
as $$
  select nullif(current_setting('test.auth_role', true), '');
$$;

-- Model the current P07 identity. Migration 222 must replace this exact
-- function rather than adding an old-cuisine overload that PostgREST cannot
-- resolve deterministically.
create function public.admin_update_restaurant(
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
set search_path = public, pg_temp
as $$
begin
  null;
end;
$$;

-- Simulate a stale pre-P07 overload that can survive a manual production
-- repair. Migration 222 must remove it as well as replace the current one.
create function public.admin_update_restaurant(
  p_id uuid,
  p_name text,
  p_description text,
  p_cuisines public.cuisine_type[],
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
set search_path = public, pg_temp
as $$
begin
  null;
end;
$$;

create function public.loyalty_tier_sweep()
returns integer
language sql
as $$
  select 0;
$$;

-- Model the four pre-existing trigger-only SECURITY DEFINER functions that
-- PostgreSQL exposes to PUBLIC unless a migration explicitly revokes EXECUTE.
create function public._guard_spatial_ref_sys()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return new;
end;
$$;

create function public.notify_order_status_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return new;
end;
$$;

create function public.stamp_order_vertical()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return new;
end;
$$;

create function public.menu_items_enforce_vertical_capability()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return new;
end;
$$;

grant usage on schema public to anon, authenticated, service_role;

insert into public.restaurants (id, name, featured, merchant_type)
values
  -- Featured before a loyalty row exists is existing editorial intent.
  ('22200000-0000-0000-0000-000000000001', 'Manual legacy', true, 'third_party'),
  -- Gold's existing effective feature must not become permanent editorial intent.
  ('22200000-0000-0000-0000-000000000002', 'Gold legacy', true, 'third_party'),
  ('22200000-0000-0000-0000-000000000003', 'Bronze', false, 'third_party'),
  ('22200000-0000-0000-0000-000000000004', 'Own brand', false, 'own_brand');

insert into public.restaurant_loyalty (restaurant_id, tier)
values ('22200000-0000-0000-0000-000000000002', 'gold');

\ir ../migrations/222_featured_merchandising_and_trigger_acl.sql

-- The migration must remove every client entry point to trigger-only definer
-- functions and keep the editorial bit out of the storefront role's column
-- projection while allowing the authenticated admin transport to read it.
do $$
declare
  v_function text;
  v_count integer;
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
      raise exception 'trigger-only function % is still client executable', v_function;
    end if;
  end loop;

  if has_column_privilege('public', 'public.restaurants', 'featured_manual', 'select')
     or has_column_privilege('anon', 'public.restaurants', 'featured_manual', 'select') then
    raise exception 'storefront roles can read restaurants.featured_manual';
  end if;
  if has_column_privilege('authenticated', 'public.restaurants', 'featured_manual', 'select') then
    raise exception 'a shared authenticated role can directly read restaurants.featured_manual';
  end if;
  if has_column_privilege('anon', 'public.restaurants', 'featured_manual', 'update')
     or has_column_privilege('authenticated', 'public.restaurants', 'featured_manual', 'update') then
    raise exception 'a client role can directly update restaurants.featured_manual';
  end if;

  select count(*) into v_count
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'admin_update_restaurant';
  if v_count <> 1 then
    raise exception 'admin_update_restaurant has % overloads after migration 222', v_count;
  end if;
  if has_function_privilege(
       'public',
       'public.admin_update_restaurant(uuid,text,text,public.food_cuisine_type[],text,text,text,public.zone_type,integer,integer,integer,integer,boolean,boolean,boolean,boolean,text,boolean)',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'public.admin_update_restaurant(uuid,text,text,public.food_cuisine_type[],text,text,text,public.zone_type,integer,integer,integer,integer,boolean,boolean,boolean,boolean,text,boolean)',
       'execute'
     )
     or not has_function_privilege(
       'authenticated',
       'public.admin_update_restaurant(uuid,text,text,public.food_cuisine_type[],text,text,text,public.zone_type,integer,integer,integer,integer,boolean,boolean,boolean,boolean,text,boolean)',
       'execute'
     ) then
    raise exception 'admin_update_restaurant has the wrong client ACL';
  end if;

  if has_function_privilege('public', 'public.admin_set_restaurant_featured_manual(uuid,boolean)', 'execute')
     or has_function_privilege('anon', 'public.admin_set_restaurant_featured_manual(uuid,boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.admin_set_restaurant_featured_manual(uuid,boolean)', 'execute') then
    raise exception 'admin_set_restaurant_featured_manual has the wrong client ACL';
  end if;
  if has_function_privilege(
       'public',
       'public.admin_update_restaurant_details(uuid,text,text,public.food_cuisine_type[],text,text,text,public.zone_type,integer,integer,integer,integer,boolean,boolean,boolean,text,boolean)',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'public.admin_update_restaurant_details(uuid,text,text,public.food_cuisine_type[],text,text,text,public.zone_type,integer,integer,integer,integer,boolean,boolean,boolean,text,boolean)',
       'execute'
     )
     or not has_function_privilege(
       'authenticated',
       'public.admin_update_restaurant_details(uuid,text,text,public.food_cuisine_type[],text,text,text,public.zone_type,integer,integer,integer,integer,boolean,boolean,boolean,text,boolean)',
       'execute'
     ) then
    raise exception 'admin_update_restaurant_details has the wrong client ACL';
  end if;
  if has_function_privilege('public', 'public.admin_restaurant_editor_list()', 'execute')
     or has_function_privilege('anon', 'public.admin_restaurant_editor_list()', 'execute')
     or not has_function_privilege('authenticated', 'public.admin_restaurant_editor_list()', 'execute') then
    raise exception 'admin_restaurant_editor_list has the wrong client ACL';
  end if;

  if (select featured_manual from public.restaurants where id = '22200000-0000-0000-0000-000000000001') is not true then
    raise exception 'pre-existing non-Gold feature was not preserved as editorial intent';
  end if;
  if (select featured_manual from public.restaurants where id = '22200000-0000-0000-0000-000000000002') is not false then
    raise exception 'pre-existing Gold feature was incorrectly made permanent editorial intent';
  end if;
end;
$$;

-- Server-side seed/import files historically inserted a true effective bit.
-- Preserve that explicit editorial intent on INSERT only; ordinary UPDATEs
-- remain derived from manual intent plus the current tier.
insert into public.restaurants (id, name, featured, merchant_type)
values (
  '22200000-0000-0000-0000-000000000005',
  'Legacy seed import',
  true,
  'third_party'
);

do $$
begin
  if (select featured_manual from public.restaurants where id = '22200000-0000-0000-0000-000000000005') is not true
     or (select featured from public.restaurants where id = '22200000-0000-0000-0000-000000000005') is not true then
    raise exception 'legacy featured=true import was not preserved as editorial intent';
  end if;
end;
$$;

-- The transport role is shared by customers, drivers, merchants, and admins;
-- only the stored admin role may receive the editorial projection.
set local role authenticated;
set local test.auth_role = 'customer';

do $$
begin
  perform * from public.admin_restaurant_editor_list();
  raise exception 'non-admin unexpectedly read the editorial restaurant list';
exception
  when check_violation then
    if sqlerrm <> 'NOT_AUTHORIZED' then
      raise;
    end if;
end;
$$;

do $$
begin
  perform public.admin_set_restaurant_featured_manual(
    '22200000-0000-0000-0000-000000000003',
    true
  );
  raise exception 'non-admin unexpectedly changed editorial intent';
exception
  when check_violation then
    if sqlerrm <> 'NOT_AUTHORIZED' then
      raise;
    end if;
end;
$$;

do $$
begin
  perform public.admin_update_restaurant_details(
    '22200000-0000-0000-0000-000000000003',
    'Bronze', '', array['egyptian']::public.food_cuisine_type[], '', '', null,
    'naama', 10, 20, 25, 0, false, true, false, null, true
  );
  raise exception 'non-admin unexpectedly changed restaurant details';
exception
  when check_violation then
    if sqlerrm <> 'NOT_AUTHORIZED' then
      raise;
    end if;
end;
$$;

reset role;

set local role authenticated;
set local test.auth_role = 'admin';

do $$
declare
  v_manual boolean;
begin
  select featured_manual into v_manual
    from public.admin_restaurant_editor_list()
   where id = '22200000-0000-0000-0000-000000000001';
  if v_manual is not true then
    raise exception 'admin editor projection did not return editorial intent';
  end if;
end;
$$;

reset role;

-- A nightly Gold/bronze write must never erase manual merchandising.
update public.restaurants
   set featured = false
 where id = '22200000-0000-0000-0000-000000000001';

do $$
begin
  if (select featured from public.restaurants where id = '22200000-0000-0000-0000-000000000001') is not true then
    raise exception 'loyalty-style write erased a manual feature';
  end if;
end;
$$;

-- The materialized customer flag is exact, not simply sticky: even a stale
-- direct true must clear for a bronze restaurant with no editorial feature.
update public.restaurants
   set featured = true,
       featured_manual = false
 where id = '22200000-0000-0000-0000-000000000003';

do $$
begin
  if (select featured from public.restaurants where id = '22200000-0000-0000-0000-000000000003') then
    raise exception 'a bronze restaurant retained a stale effective feature';
  end if;
end;
$$;

-- The stable RPC still accepts the legacy effective flag. It keeps old clients
-- working without letting an unchanged Gold=true save create manual intent.
set local role authenticated;
set local test.auth_role = 'admin';

select public.admin_update_restaurant(
  '22200000-0000-0000-0000-000000000003',
  'Bronze', '', array['egyptian']::public.food_cuisine_type[], '', '', null,
  'naama', 10, 20, 25, 0, false, true, false, true, null, true
);

select public.admin_update_restaurant(
  '22200000-0000-0000-0000-000000000002',
  'Gold legacy', '', array['egyptian']::public.food_cuisine_type[], '', '', null,
  -- A cached legacy editor only knows the effective flag. Its unchanged true
  -- must preserve Gold-only state rather than promoting it permanently.
  'naama', 10, 20, 25, 0, false, true, false, true, null, true
);

reset role;

-- A sweep-style write still preserves manual-on for Bronze.
update public.restaurants
   set featured = false
 where id = '22200000-0000-0000-0000-000000000003';

do $$
begin
  if (select featured_manual from public.restaurants where id = '22200000-0000-0000-0000-000000000003') is not true
     or (select featured from public.restaurants where id = '22200000-0000-0000-0000-000000000003') is not true then
    raise exception 'admin editorial feature did not become effective';
  end if;
  if (select featured_manual from public.restaurants where id = '22200000-0000-0000-0000-000000000002') is not false
     or (select featured from public.restaurants where id = '22200000-0000-0000-0000-000000000002') is not true then
    raise exception 'legacy effective-feature save permanently promoted a Gold restaurant';
  end if;
end;
$$;

-- A current dashboard never sends the rendered effective flag. If Gold is
-- removed after load but before an unrelated save, its details write must not
-- turn that stale true into editorial intent.
update public.restaurant_loyalty
   set tier = 'bronze'
 where restaurant_id = '22200000-0000-0000-0000-000000000002';

set local role authenticated;
set local test.auth_role = 'admin';

select public.admin_update_restaurant_details(
  '22200000-0000-0000-0000-000000000002',
  'Gold legacy renamed', '', array['egyptian']::public.food_cuisine_type[], '', '', null,
  'naama', 10, 20, 25, 0, false, true, false, null, true
);

reset role;

do $$
begin
  if (select featured_manual from public.restaurants where id = '22200000-0000-0000-0000-000000000002')
     or (select featured from public.restaurants where id = '22200000-0000-0000-0000-000000000002') then
    raise exception 'current detail save promoted a Gold-to-Bronze stale feature into editorial intent';
  end if;
end;
$$;

update public.restaurant_loyalty
   set tier = 'gold'
 where restaurant_id = '22200000-0000-0000-0000-000000000002';

set local role authenticated;
set local test.auth_role = 'admin';

select public.admin_update_restaurant(
  '22200000-0000-0000-0000-000000000003',
  'Bronze', '', array['egyptian']::public.food_cuisine_type[], '', '', null,
  'naama', 10, 20, 25, 0, false, true, false, false, null, true
);

reset role;

do $$
begin
  if (select featured_manual from public.restaurants where id = '22200000-0000-0000-0000-000000000003')
     or (select featured from public.restaurants where id = '22200000-0000-0000-0000-000000000003') then
    raise exception 'admin manual-off did not remove a Bronze restaurant from the carousel';
  end if;
end;
$$;

-- The versioned editorial RPC is the only way the new admin UI changes manual
-- intent. Gold stays effective when that intent is removed.
set local role authenticated;
set local test.auth_role = 'admin';

select public.admin_set_restaurant_featured_manual(
  '22200000-0000-0000-0000-000000000002',
  true
);

reset role;

do $$
begin
  if (select featured_manual from public.restaurants where id = '22200000-0000-0000-0000-000000000002') is not true
     or (select featured from public.restaurants where id = '22200000-0000-0000-0000-000000000002') is not true then
    raise exception 'versioned editorial feature did not persist for Gold';
  end if;
end;
$$;

set local role authenticated;
set local test.auth_role = 'admin';

select public.admin_set_restaurant_featured_manual(
  '22200000-0000-0000-0000-000000000002',
  false
);

reset role;

do $$
begin
  if (select featured_manual from public.restaurants where id = '22200000-0000-0000-0000-000000000002')
     or (select featured from public.restaurants where id = '22200000-0000-0000-0000-000000000002') is not true then
    raise exception 'removing editorial intent incorrectly removed a Gold restaurant';
  end if;
end;
$$;

-- The exact derivation also refuses a stale direct clear while the loyalty
-- tier remains Gold. The real nightly sweep performs this same write.
update public.restaurants
   set featured = false
 where id = '22200000-0000-0000-0000-000000000002';

do $$
begin
  if (select featured from public.restaurants where id = '22200000-0000-0000-0000-000000000002') is not true then
    raise exception 'a Gold restaurant lost its effective feature on a stale direct write';
  end if;
end;
$$;

-- Tier writes have their own final write boundary: a direct demotion, upgrade,
-- or tier-row deletion cannot leave the materialized customer bit stale.
update public.restaurant_loyalty
   set tier = 'bronze'
 where restaurant_id = '22200000-0000-0000-0000-000000000002';

do $$
begin
  if (select featured from public.restaurants where id = '22200000-0000-0000-0000-000000000002') then
    raise exception 'direct Gold-to-Bronze tier update left featured stale';
  end if;
end;
$$;

update public.restaurant_loyalty
   set tier = 'gold'
 where restaurant_id = '22200000-0000-0000-0000-000000000002';

delete from public.restaurant_loyalty
 where restaurant_id = '22200000-0000-0000-0000-000000000002';

do $$
begin
  if (select featured from public.restaurants where id = '22200000-0000-0000-0000-000000000002') then
    raise exception 'deleting a Gold tier row left featured stale';
  end if;
end;
$$;

-- The trigger also applies the own-brand ranking promise at every write path.
update public.restaurants
   set featured = true,
       featured_manual = true
 where id = '22200000-0000-0000-0000-000000000004';

do $$
begin
  if (select featured from public.restaurants where id = '22200000-0000-0000-0000-000000000004')
     or (select featured_manual from public.restaurants where id = '22200000-0000-0000-0000-000000000004') then
    raise exception 'own brand can still become manually featured';
  end if;
end;
$$;

rollback;
