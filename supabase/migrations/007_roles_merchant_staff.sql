-- 007_roles_merchant_staff.sql
-- Identity & roles for the four-surface app on one database.
--
-- Role model (the RLS foundation):
--   * users.role          -> COARSE role, one per user (a driver isn't a merchant).
--   * merchant_staff       -> which merchant a merchant_staff user belongs to.
--   * drivers (mig 008)    -> driver identity/availability.
--
-- auth_role() is a SECURITY DEFINER helper that reads the caller's role WITHOUT
-- triggering RLS recursion (it bypasses RLS on users), with a pinned search_path
-- for safety. RLS policies in 012 use it to gate admin/dispatcher access.
--
-- Non-destructive: new enum, ADD COLUMN with default, new table, new function.

-- ============================================================================
-- app_role enum + users.role
-- ============================================================================
do $$ begin
  create type app_role as enum ('customer','driver','merchant_staff','dispatcher','admin');
exception when duplicate_object then null;
end $$;

alter table public.users
  add column if not exists role app_role not null default 'customer';

create index if not exists users_role_idx on public.users (role) where role <> 'customer';

-- ============================================================================
-- merchant_staff (links a staff profile to ONE merchant; gates merchant RLS)
-- ============================================================================
create table if not exists public.merchant_staff (
  profile_id    uuid not null references public.users(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  staff_role    text not null default 'staff',  -- 'owner' | 'manager' | 'staff'
  created_at    timestamptz not null default now(),
  primary key (profile_id, restaurant_id)
);

create index if not exists merchant_staff_restaurant_idx on public.merchant_staff (restaurant_id);
create index if not exists merchant_staff_profile_idx on public.merchant_staff (profile_id);

alter table public.merchant_staff enable row level security;

-- ============================================================================
-- auth_role() — recursion-safe role lookup for policies
-- ============================================================================
create or replace function public.auth_role()
returns app_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.users where id = auth.uid();
$$;

-- Helper: is the current user staff of a given merchant?
create or replace function public.is_merchant_staff(p_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.merchant_staff
    where profile_id = auth.uid() and restaurant_id = p_restaurant_id
  );
$$;

-- Helper: set of merchant ids the current user staffs (for IN (...) policies).
create or replace function public.my_merchant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select restaurant_id from public.merchant_staff where profile_id = auth.uid();
$$;

-- ============================================================================
-- Update the signup trigger to honor a role hint in metadata (defaults customer)
-- ============================================================================
create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.users (id, phone, display_name, locale, preferred_currency, role)
  values (
    new.id,
    coalesce(new.phone, ''),
    coalesce(new.raw_user_meta_data->>'display_name', 'Guest'),
    coalesce((new.raw_user_meta_data->>'locale')::locale_type, 'ar'),
    coalesce((new.raw_user_meta_data->>'preferred_currency')::currency_type, 'EGP'),
    coalesce((new.raw_user_meta_data->>'role')::app_role, 'customer')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

comment on table public.merchant_staff is
  'Links a merchant_staff user to the merchant(s) they operate. The merchant RLS gate: a staffer can only see orders/menus where restaurant_id IN my_merchant_ids().';
comment on function public.auth_role is
  'Recursion-safe (SECURITY DEFINER, pinned search_path) lookup of the caller''s coarse role. Used by RLS policies for admin/dispatcher gating.';
