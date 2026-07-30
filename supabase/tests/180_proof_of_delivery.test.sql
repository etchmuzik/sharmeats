\set ON_ERROR_STOP on

-- Transaction-wrapped so nothing persists (migration house rule 6).
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

-- ---------------------------------------------------------------------------
-- Minimal stubs for the Supabase surface the migration touches.
-- ---------------------------------------------------------------------------
create schema auth;
create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

create schema storage;
create function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select string_to_array(name, '/')
$$;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets(id),
  name text not null unique
);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;

create type app_role as enum ('customer','driver','merchant_staff','dispatcher','admin');

-- Role comes from a GUC so each block below can act as a different principal.
create function public.auth_role()
returns app_role
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')::app_role
$$;
grant execute on function public.auth_role() to authenticated;

-- Faithful to production: these are ENUMs, not text. The enum-vs-text mismatch
-- is exactly the class of bug this dry run exists to catch.
create type order_status_type as enum (
  'placed','accepted','preparing','ready','picked_up','out_for_delivery',
  'delivered','cancelled','rejected'
);
create type public.dropoff_preference as enum (
  'hand_to_me','leave_at_door','meet_outside','no_bell','call_on_arrival'
);

create table public.users (id uuid primary key);

create table public.drivers (
  id uuid primary key,
  profile_id uuid references public.users(id)
);
grant select on public.drivers to authenticated;

create table public.orders (
  id                 uuid primary key,
  short_code         text not null unique,
  status             order_status_type not null default 'placed',
  assigned_driver_id uuid references public.drivers(id),
  dropoff_preference public.dropoff_preference,
  payment_method     text not null default 'cash_on_delivery',
  total_egp          int not null default 0,
  delivered_at       timestamptz
);
grant select on public.orders to authenticated;

\ir ../migrations/180_proof_of_delivery.sql

-- ---------------------------------------------------------------------------
-- Fixtures. driver 1 is assigned to both orders; driver 2 is assigned nothing.
-- ---------------------------------------------------------------------------
insert into public.users (id) values
  ('50000000-0000-0000-0000-000000000001'),   -- driver 1 profile
  ('50000000-0000-0000-0000-000000000002'),   -- driver 2 profile
  ('50000000-0000-0000-0000-000000000003');   -- ops

insert into public.drivers (id, profile_id) values
  ('51000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001'),
  ('51000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002');

insert into public.orders (id, short_code, status, assigned_driver_id, dropoff_preference, delivered_at) values
  ('52000000-0000-0000-0000-000000000001', 'AAA111', 'out_for_delivery',
   '51000000-0000-0000-0000-000000000001', 'leave_at_door', null),
  -- delivered, required a photo, will deliberately never get one
  ('52000000-0000-0000-0000-000000000002', 'BBB222', 'delivered',
   '51000000-0000-0000-0000-000000000001', 'no_bell', now()),
  -- delivered, hand_to_me so no photo is expected: must NOT be reported
  ('52000000-0000-0000-0000-000000000003', 'CCC333', 'delivered',
   '51000000-0000-0000-0000-000000000001', 'hand_to_me', now()),
  -- still preparing: not at handoff
  ('52000000-0000-0000-0000-000000000004', 'DDD444', 'preparing',
   '51000000-0000-0000-0000-000000000001', 'leave_at_door', null);

-- ---------------------------------------------------------------------------
-- Bucket hardening + the required-preference definition.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from storage.buckets
     where id = 'delivery-proof'
       and public = false
       and file_size_limit = 5 * 1024 * 1024
       and allowed_mime_types = array['image/jpeg','image/png','image/webp']::text[]
  ) then
    raise exception 'delivery-proof bucket is not private/limited';
  end if;

  if not public.delivery_proof_required('leave_at_door')
     or not public.delivery_proof_required('no_bell') then
    raise exception 'proof should be required when nobody is at the door';
  end if;
  if public.delivery_proof_required('hand_to_me')
     or public.delivery_proof_required('meet_outside')
     or public.delivery_proof_required('call_on_arrival') then
    raise exception 'proof should not be required for an in-person handoff';
  end if;
  -- Fails closed on a NULL/unknown preference: no photo demanded for something
  -- we cannot classify.
  if public.delivery_proof_required(null) then
    raise exception 'a null preference should not require proof';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Evidence is immutable and ops-only: no UPDATE or DELETE policy may exist, and
-- authenticated must hold no write grant on the table.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'delivery_proofs'
       and cmd in ('UPDATE','DELETE')
  ) then
    raise exception 'delivery_proofs must have no UPDATE/DELETE policy';
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'delivery_proofs'
       and grantee in ('anon','authenticated','PUBLIC')
       and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
  ) then
    raise exception 'delivery_proofs must grant no write privilege to anon/authenticated';
  end if;

  -- TRUNCATE ignores RLS, so this is not covered by the policy checks above.
  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'delivery_proofs'
       and grantee = 'anon'
  ) then
    raise exception 'anon must hold no grant at all on delivery_proofs';
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'delivery_proof_update_own'
  ) then
    raise exception 'delivery-proof objects must not be updatable';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- A driver may upload only under their own uid prefix, with a conforming name.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '50000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'driver', true);
set local role authenticated;

-- Well-formed: own prefix, real order id, epoch-ms, allowed extension.
insert into storage.objects (bucket_id, name) values
  ('delivery-proof',
   '50000000-0000-0000-0000-000000000001/52000000-0000-0000-0000-000000000001-1721800000000.jpg');

do $$
begin
  -- Another driver's prefix.
  begin
    insert into storage.objects (bucket_id, name) values
      ('delivery-proof',
       '50000000-0000-0000-0000-000000000002/52000000-0000-0000-0000-000000000001-1721800000001.jpg');
    raise exception 'upload under another uid prefix should be denied';
  exception when insufficient_privilege then null;
  end;

  -- Disallowed extension.
  begin
    insert into storage.objects (bucket_id, name) values
      ('delivery-proof',
       '50000000-0000-0000-0000-000000000001/52000000-0000-0000-0000-000000000001-1721800000002.pdf');
    raise exception 'a non-image extension should be denied';
  exception when insufficient_privilege then null;
  end;

  -- Free-form name that is not <uid>/<order-uuid>-<ts>.<ext>.
  begin
    insert into storage.objects (bucket_id, name) values
      ('delivery-proof', '50000000-0000-0000-0000-000000000001/whatever.jpg');
    raise exception 'a non-conforming object name should be denied';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- Read scope: the uploader sees their OWN prefix (required for the cleanup
-- delete to be reachable at all — Postgres applies SELECT policies to a DELETE
-- with a WHERE clause) but nothing under anybody else's.
do $$
begin
  if not exists (
    select 1 from storage.objects
     where name like '50000000-0000-0000-0000-000000000001/%'
  ) then
    raise exception 'uploader should see their own delivery-proof objects';
  end if;
end;
$$;

-- Seed an object under driver 2's prefix as driver 2, then confirm driver 1
-- cannot see it.
reset role;
insert into storage.objects (bucket_id, name) values
  ('delivery-proof',
   '50000000-0000-0000-0000-000000000002/52000000-0000-0000-0000-000000000001-1721800000050.jpg');

select set_config('request.jwt.claim.sub', '50000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'driver', true);
set local role authenticated;
do $$
begin
  if exists (
    select 1 from storage.objects
     where name like '50000000-0000-0000-0000-000000000002/%'
  ) then
    raise exception 'a driver must not read another driver''s proof objects';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_delivery_proof authority.
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid;
begin
  -- Happy path: assigned driver, order out_for_delivery.
  v_id := public.record_delivery_proof(
    '52000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000001/52000000-0000-0000-0000-000000000001-1721800000000.jpg');
  if v_id is null then
    raise exception 'record_delivery_proof should return the new row id';
  end if;

  -- Path pointing at somebody else's prefix must be refused even though the
  -- caller is the assigned driver: bytes and index are separate statements.
  begin
    perform public.record_delivery_proof(
      '52000000-0000-0000-0000-000000000001',
      '50000000-0000-0000-0000-000000000002/52000000-0000-0000-0000-000000000001-1721800000009.jpg');
    raise exception 'a foreign-prefix path should be refused';
  exception when check_violation then null;
  end;

  -- Path whose order id does not match the order being recorded.
  begin
    perform public.record_delivery_proof(
      '52000000-0000-0000-0000-000000000001',
      '50000000-0000-0000-0000-000000000001/52000000-0000-0000-0000-000000000099-1721800000010.jpg');
    raise exception 'a path for a different order should be refused';
  exception when check_violation then null;
  end;

  -- Not at handoff yet.
  begin
    perform public.record_delivery_proof(
      '52000000-0000-0000-0000-000000000004',
      '50000000-0000-0000-0000-000000000001/52000000-0000-0000-0000-000000000004-1721800000011.jpg');
    raise exception 'recording proof before handoff should be refused';
  exception when check_violation then null;
  end;
end;
$$;

-- The snapshot is written server-side from the order, not supplied by the client.
reset role;
do $$
begin
  if not exists (
    select 1 from public.delivery_proofs
     where order_id = '52000000-0000-0000-0000-000000000001'
       and driver_id = '51000000-0000-0000-0000-000000000001'
       and dropoff_preference = 'leave_at_door'
  ) then
    raise exception 'proof row should snapshot the order dropoff preference';
  end if;
end;
$$;

-- A driver who is NOT the assigned driver cannot record proof for the order.
select set_config('request.jwt.claim.sub', '50000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claim.role', 'driver', true);
set local role authenticated;
do $$
begin
  begin
    perform public.record_delivery_proof(
      '52000000-0000-0000-0000-000000000001',
      '50000000-0000-0000-0000-000000000002/52000000-0000-0000-0000-000000000001-1721800000020.jpg');
    raise exception 'an unassigned driver should be refused';
  exception when check_violation then null;
  end;
end;
$$;

-- A customer role must be refused even for their own order (fails closed).
select set_config('request.jwt.claim.role', 'customer', true);
do $$
begin
  begin
    perform public.record_delivery_proof(
      '52000000-0000-0000-0000-000000000001',
      '50000000-0000-0000-0000-000000000002/52000000-0000-0000-0000-000000000001-1721800000021.jpg');
    raise exception 'a non-driver role should be refused';
  exception when check_violation then null;
  end;
end;
$$;

-- House rule 4: a NULL role must fail CLOSED rather than pass a NULL guard.
select set_config('request.jwt.claim.role', '', true);
do $$
begin
  begin
    perform public.record_delivery_proof(
      '52000000-0000-0000-0000-000000000001',
      '50000000-0000-0000-0000-000000000002/52000000-0000-0000-0000-000000000001-1721800000022.jpg');
    raise exception 'a null role should fail closed';
  exception when check_violation then null;
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ops report: only the delivery that required a photo and has none.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '50000000-0000-0000-0000-000000000003', true);
select set_config('request.jwt.claim.role', 'dispatcher', true);
do $$
declare
  v_codes text[];
begin
  select array_agg(short_code order by short_code)
    into v_codes
    from public.ops_deliveries_missing_proof(now() - interval '1 day');

  if v_codes is distinct from array['BBB222'] then
    raise exception 'ops report should list only BBB222, got %', coalesce(v_codes::text, 'null');
  end if;

  -- Ops can read the evidence index.
  if not exists (select 1 from public.delivery_proofs) then
    raise exception 'dispatcher should be able to read delivery_proofs';
  end if;
end;
$$;

-- A driver calling the ops report gets nothing rather than an error.
select set_config('request.jwt.claim.sub', '50000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'driver', true);
do $$
begin
  if exists (select 1 from public.ops_deliveries_missing_proof(now() - interval '1 day')) then
    raise exception 'a driver must not see the ops report';
  end if;
  -- And cannot read the evidence index either.
  if exists (select 1 from public.delivery_proofs) then
    raise exception 'a driver must not read delivery_proofs';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Orphan cleanup: an UNINDEXED own object may be deleted (so the app can tidy up
-- when the metadata insert fails), an INDEXED one may never be.
-- ---------------------------------------------------------------------------
-- Both objects below are visible to this driver (own prefix), so a DELETE that
-- matches zero rows now means the DELETE POLICY refused it rather than the row
-- simply being invisible. That distinction is what makes these assertions real:
-- before the own-prefix read clause existed, both deletes returned 0 and the
-- indexed-object assertion passed vacuously.
insert into storage.objects (bucket_id, name) values
  ('delivery-proof',
   '50000000-0000-0000-0000-000000000001/52000000-0000-0000-0000-000000000001-1721800000030.jpg');

do $$
declare
  v_deleted int;
begin
  -- Unindexed orphan: deletable.
  delete from storage.objects
   where name = '50000000-0000-0000-0000-000000000001/52000000-0000-0000-0000-000000000001-1721800000030.jpg';
  get diagnostics v_deleted = row_count;
  if v_deleted <> 1 then
    raise exception 'orphan cleanup of an unindexed object was blocked (deleted %)', v_deleted;
  end if;

  -- Indexed evidence: visible, but the delete policy must refuse it.
  if not exists (
    select 1 from storage.objects
     where name = '50000000-0000-0000-0000-000000000001/52000000-0000-0000-0000-000000000001-1721800000000.jpg'
  ) then
    raise exception 'precondition: the indexed object should be visible to its uploader';
  end if;

  delete from storage.objects
   where name = '50000000-0000-0000-0000-000000000001/52000000-0000-0000-0000-000000000001-1721800000000.jpg';
  get diagnostics v_deleted = row_count;
  if v_deleted <> 0 then
    raise exception 'an INDEXED proof object must not be deletable by the driver';
  end if;
end;
$$;

reset role;

do $$
begin
  if not exists (
    select 1 from storage.objects
     where name = '50000000-0000-0000-0000-000000000001/52000000-0000-0000-0000-000000000001-1721800000000.jpg'
  ) then
    raise exception 'indexed evidence disappeared';
  end if;
end;
$$;

rollback;

\echo '180_proof_of_delivery.test.sql: PASS'
