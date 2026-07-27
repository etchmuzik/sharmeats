-- Prod-faithful fixture for migration 136 validation (LEAD ENGINEER pass).
-- Built from the REAL DDL: 002 (menu_items/sections/modifiers/modifier_options/
-- restaurants/merchant_staff), 006:67-71 (sku/barcode/unit/requires_prescription),
-- 105/126 (payout_*), 132 (price CHECKs), 090 (policy set), 095
-- (restaurants_read), 081:119-120 + 126:162-163 (column-level UPDATE grants).

create schema if not exists auth;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('customer','driver','merchant_staff','dispatcher','admin');
  end if;
  if not exists (select 1 from pg_type where typname = 'item_flag_type') then
    create type public.item_flag_type as enum ('vegan','vegetarian','spicy','halal','gluten_free','new','popular');
  end if;
end $$;

create table public.users (
  id uuid primary key,
  role public.app_role not null default 'customer'
);

create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_open boolean not null default true,
  is_active boolean not null default true,
  commission_pct numeric not null default 15,
  featured boolean default false,
  payout_method text,
  payout_bank_name text,
  payout_iban text,
  payout_wallet text,
  payout_holder text
);

create table public.merchant_staff (
  profile_id uuid not null references public.users(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  staff_role text not null default 'staff',
  created_at timestamptz not null default now(),
  primary key (profile_id, restaurant_id)
);

create table public.menu_sections (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null,
  sort_order int not null default 0
);

-- ALL 15 prod columns: 002:219-231 plus the four added by 006:67-71.
create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  section_id uuid not null references public.menu_sections(id) on delete cascade,
  name text not null,
  description text not null default '',
  price_egp int not null check (price_egp >= 0),
  image text not null default '',
  flags public.item_flag_type[] not null default '{}',
  is_available boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  sku text,
  barcode text,
  unit text default 'each',
  requires_prescription boolean not null default false
);
alter table public.menu_items
  add constraint menu_items_price_bounds_chk check (price_egp between 1 and 10000);

create table public.modifiers (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.menu_items(id) on delete cascade,
  name text not null,
  required boolean not null default false
);

create table public.modifier_options (
  id uuid primary key default gen_random_uuid(),
  modifier_id uuid not null references public.modifiers(id) on delete cascade,
  name text not null,
  price_delta_egp int not null default 0
);
alter table public.modifier_options
  add constraint modifier_options_delta_bounds_chk check (price_delta_egp between -2000 and 2000);

create table public.ops_alerts (id bigserial primary key, msg text, at timestamptz default now());
create or replace function public.ops_alert(p_msg text) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.ops_alerts (msg) values (p_msg);
$$;

-- 007:47-55, 58-69, 71-79 verbatim.
create or replace function public.auth_role() returns public.app_role
language sql stable security definer set search_path = public, pg_temp as $$
  select role from public.users where id = auth.uid();
$$;

create or replace function public.is_merchant_staff(p_restaurant_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.merchant_staff
                 where profile_id = auth.uid() and restaurant_id = p_restaurant_id);
$$;

create or replace function public.my_merchant_ids() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select restaurant_id from public.merchant_staff where profile_id = auth.uid();
$$;

alter table public.users             enable row level security;
alter table public.restaurants       enable row level security;
alter table public.merchant_staff    enable row level security;
alter table public.menu_sections     enable row level security;
alter table public.menu_items        enable row level security;
alter table public.modifiers         enable row level security;
alter table public.modifier_options  enable row level security;

-- ===== 090 policy set (verbatim shape) =====
create policy menu_items_read on public.menu_items for select using (
  (is_available = true) or public.is_merchant_staff(restaurant_id)
  or ((select auth_role()) = 'admin'::public.app_role));
create policy menu_items_merchant_insert on public.menu_items for insert
  with check (public.is_merchant_staff(restaurant_id) or ((select auth_role()) = 'admin'::public.app_role));
create policy menu_items_merchant_update on public.menu_items for update
  using (public.is_merchant_staff(restaurant_id) or ((select auth_role()) = 'admin'::public.app_role))
  with check (public.is_merchant_staff(restaurant_id) or ((select auth_role()) = 'admin'::public.app_role));
create policy menu_items_merchant_delete on public.menu_items for delete
  using (public.is_merchant_staff(restaurant_id) or ((select auth_role()) = 'admin'::public.app_role));

create policy menu_sections_read on public.menu_sections for select using (true);
create policy menu_sections_merchant_insert on public.menu_sections for insert
  with check (public.is_merchant_staff(restaurant_id) or ((select auth_role()) = 'admin'::public.app_role));
create policy menu_sections_merchant_update on public.menu_sections for update
  using (public.is_merchant_staff(restaurant_id) or ((select auth_role()) = 'admin'::public.app_role))
  with check (public.is_merchant_staff(restaurant_id) or ((select auth_role()) = 'admin'::public.app_role));
create policy menu_sections_merchant_delete on public.menu_sections for delete
  using (public.is_merchant_staff(restaurant_id) or ((select auth_role()) = 'admin'::public.app_role));

create policy modifiers_read on public.modifiers for select using (true);
create policy modifiers_merchant_insert on public.modifiers for insert
  with check (exists (select 1 from public.menu_items mi where mi.id = modifiers.item_id
    and (public.is_merchant_staff(mi.restaurant_id) or ((select auth_role()) = 'admin'::public.app_role))));
create policy modifiers_merchant_update on public.modifiers for update
  using (exists (select 1 from public.menu_items mi where mi.id = modifiers.item_id
    and (public.is_merchant_staff(mi.restaurant_id) or ((select auth_role()) = 'admin'::public.app_role))))
  with check (exists (select 1 from public.menu_items mi where mi.id = modifiers.item_id
    and (public.is_merchant_staff(mi.restaurant_id) or ((select auth_role()) = 'admin'::public.app_role))));
create policy modifiers_merchant_delete on public.modifiers for delete
  using (exists (select 1 from public.menu_items mi where mi.id = modifiers.item_id
    and (public.is_merchant_staff(mi.restaurant_id) or ((select auth_role()) = 'admin'::public.app_role))));

create policy modifier_options_read on public.modifier_options for select using (true);
create policy modifier_options_merchant_insert on public.modifier_options for insert
  with check (exists (select 1 from public.modifiers m join public.menu_items mi on mi.id = m.item_id
    where m.id = modifier_options.modifier_id
      and (public.is_merchant_staff(mi.restaurant_id) or ((select auth_role()) = 'admin'::public.app_role))));
create policy modifier_options_merchant_update on public.modifier_options for update
  using (exists (select 1 from public.modifiers m join public.menu_items mi on mi.id = m.item_id
    where m.id = modifier_options.modifier_id
      and (public.is_merchant_staff(mi.restaurant_id) or ((select auth_role()) = 'admin'::public.app_role))))
  with check (exists (select 1 from public.modifiers m join public.menu_items mi on mi.id = m.item_id
    where m.id = modifier_options.modifier_id
      and (public.is_merchant_staff(mi.restaurant_id) or ((select auth_role()) = 'admin'::public.app_role))));
create policy modifier_options_merchant_delete on public.modifier_options for delete
  using (exists (select 1 from public.modifiers m join public.menu_items mi on mi.id = m.item_id
    where m.id = modifier_options.modifier_id
      and (public.is_merchant_staff(mi.restaurant_id) or ((select auth_role()) = 'admin'::public.app_role))));

create policy merchant_staff_self_select on public.merchant_staff for select
  using (profile_id = (select auth.uid()) or ((select auth_role()) = 'admin'::public.app_role));
create policy merchant_staff_admin_insert on public.merchant_staff for insert
  with check ((select auth_role()) = 'admin'::public.app_role);
create policy merchant_staff_admin_update on public.merchant_staff for update
  using ((select auth_role()) = 'admin'::public.app_role)
  with check ((select auth_role()) = 'admin'::public.app_role);
create policy merchant_staff_admin_delete on public.merchant_staff for delete
  using ((select auth_role()) = 'admin'::public.app_role);

-- 095:21-25
create policy restaurants_read on public.restaurants for select using (
  (is_active = true) or public.is_merchant_staff(id)
  or ((select auth_role()) = 'admin'::public.app_role));
-- 012:22 as altered by 089:169-171
create policy restaurants_merchant_update on public.restaurants for update
  using (public.is_merchant_staff(id) or ((select auth_role()) = 'admin'::public.app_role))
  with check (public.is_merchant_staff(id) or ((select auth_role()) = 'admin'::public.app_role));

create policy users_self_select on public.users for select using (id = (select auth.uid()));

-- ===== roles + grants (081:119-120, 126:162-163) =====
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema public, auth to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
grant execute on function auth.uid() to anon, authenticated;
revoke update on public.restaurants from anon, authenticated;
grant update (is_open, payout_method, payout_bank_name, payout_iban, payout_wallet, payout_holder)
  on public.restaurants to authenticated;

-- ===== seed =====
insert into public.users (id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'merchant_staff'),  -- owner   @ r1
  ('aaaaaaaa-0000-0000-0000-000000000002', 'merchant_staff'),  -- staff   @ r1
  ('aaaaaaaa-0000-0000-0000-000000000003', 'merchant_staff'),  -- manager @ r1
  ('aaaaaaaa-0000-0000-0000-000000000004', 'merchant_staff'),  -- staff-only @ r2 (1c target)
  ('aaaaaaaa-0000-0000-0000-000000000005', 'merchant_staff'),  -- ' Owner ' @ r3 (1a)
  ('aaaaaaaa-0000-0000-0000-000000000006', 'merchant_staff'),  -- 'cook'    @ r4 (1b)
  ('aaaaaaaa-0000-0000-0000-000000000009', 'admin');

insert into public.restaurants (id, name) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'R1'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'R2'),
  ('bbbbbbbb-0000-0000-0000-000000000003', 'R3'),
  ('bbbbbbbb-0000-0000-0000-000000000004', 'R4');

insert into public.merchant_staff (profile_id, restaurant_id, staff_role, created_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','owner',   now() - interval '3 day'),
  ('aaaaaaaa-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000001','staff',   now() - interval '2 day'),
  ('aaaaaaaa-0000-0000-0000-000000000003','bbbbbbbb-0000-0000-0000-000000000001','manager', now() - interval '1 day'),
  ('aaaaaaaa-0000-0000-0000-000000000004','bbbbbbbb-0000-0000-0000-000000000002','staff',   now() - interval '5 day'),
  ('aaaaaaaa-0000-0000-0000-000000000005','bbbbbbbb-0000-0000-0000-000000000003',' Owner ', now()),
  ('aaaaaaaa-0000-0000-0000-000000000006','bbbbbbbb-0000-0000-0000-000000000004','cook',    now());

insert into public.menu_sections (id, restaurant_id, name) values
  ('cccccccc-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','Mains'),
  ('cccccccc-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000001','Drinks'),
  ('cccccccc-0000-0000-0000-000000000003','bbbbbbbb-0000-0000-0000-000000000002','R2 Mains');

insert into public.menu_items (id, restaurant_id, section_id, name, price_egp) values
  ('dddddddd-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','Koshari',120),
  ('dddddddd-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-000000000003','R2 Item',90);

insert into public.modifiers (id, item_id, name) values
  ('eeeeeeee-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001','Size');
insert into public.modifier_options (id, modifier_id, name, price_delta_egp) values
  ('ffffffff-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001','Large',20);
