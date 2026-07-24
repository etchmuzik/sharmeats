\set ON_ERROR_STOP on

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
create policy "kyc_read_own_or_admin"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'kyc'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "kyc_update_own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'kyc'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'kyc'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create type public.kyc_subject_type as enum ('driver', 'restaurant');
create type public.kyc_doc_status as enum ('pending', 'approved', 'rejected');

create table public.users (
  id uuid primary key
);

create table public.drivers (
  id uuid primary key,
  profile_id uuid references public.users(id)
);
grant select on public.drivers to authenticated;

create table public.kyc_documents (
  id uuid primary key default gen_random_uuid(),
  subject_type public.kyc_subject_type not null,
  subject_id uuid not null,
  doc_type text not null,
  storage_path text not null,
  status public.kyc_doc_status not null default 'pending',
  review_note text,
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.kyc_documents enable row level security;
grant select, insert on public.kyc_documents to authenticated;
create policy kyc_documents_select
  on public.kyc_documents for select to authenticated
  using (
    subject_type = 'driver'
    and exists (
      select 1
        from public.drivers as driver
       where driver.id = subject_id
         and driver.profile_id = (select auth.uid())
    )
  );

create function public.is_merchant_staff(subject uuid)
returns boolean
language sql
stable
as $$
  select subject = '52000000-0000-0000-0000-000000000001'::uuid
     and auth.uid() = '50000000-0000-0000-0000-000000000002'::uuid
$$;

\ir ../migrations/20260724120946_kyc_upload_hardening.sql

insert into public.users (id)
values
  ('50000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000002');

insert into public.drivers (id, profile_id)
values (
  '51000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001'
);

do $$
begin
  if not exists (
    select 1
      from storage.buckets
     where id = 'kyc'
       and public = false
       and file_size_limit = 5 * 1024 * 1024
       and allowed_mime_types = array[
         'image/jpeg',
         'image/png',
         'image/webp'
       ]::text[]
  ) then
    raise exception 'KYC bucket limits are not hardened';
  end if;

  if (
    select convalidated
      from pg_constraint
     where conname = 'kyc_documents_subject_doc_type_check'
  ) then
    raise exception 'legacy KYC constraint should remain NOT VALID';
  end if;

  if exists (
    select 1
      from pg_policies
     where schemaname = 'storage'
       and tablename = 'objects'
       and policyname = 'kyc_update_own'
  ) then
    raise exception 'mutable KYC update policy still exists';
  end if;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  '50000000-0000-0000-0000-000000000001',
  true
);
set local role authenticated;

insert into storage.objects (bucket_id, name)
values (
  'kyc',
  '50000000-0000-0000-0000-000000000001/driver-national_id-1721800000000.jpg'
);

insert into public.kyc_documents (
  subject_type,
  subject_id,
  doc_type,
  storage_path
)
values (
  'driver',
  '51000000-0000-0000-0000-000000000001',
  'national_id',
  '50000000-0000-0000-0000-000000000001/driver-national_id-1721800000000.jpg'
);

do $$
declare
  affected_rows int;
begin
  update storage.objects
     set name = '50000000-0000-0000-0000-000000000001/driver-national_id-1721800000999.jpg'
   where name = '50000000-0000-0000-0000-000000000001/driver-national_id-1721800000000.jpg';
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'indexed KYC evidence remained mutable';
  end if;

  delete from storage.objects
   where name = '50000000-0000-0000-0000-000000000001/driver-national_id-1721800000000.jpg';
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'indexed KYC evidence was client-deletable';
  end if;

  begin
    insert into public.kyc_documents (
      subject_type,
      subject_id,
      doc_type,
      storage_path,
      status,
      reviewed_at
    )
    values (
      'driver',
      '51000000-0000-0000-0000-000000000001',
      'driving_license',
      '50000000-0000-0000-0000-000000000001/driver-driving_license-1721800000001.jpg',
      'approved',
      now()
    );
    raise exception 'client forged an approved KYC row';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    insert into public.kyc_documents (
      subject_type,
      subject_id,
      doc_type,
      storage_path
    )
    values (
      'driver',
      '51000000-0000-0000-0000-000000000001',
      'passport',
      '50000000-0000-0000-0000-000000000001/driver-passport-1721800000002.pdf'
    );
    raise exception 'invalid document type and extension were accepted';
  exception
    when check_violation or insufficient_privilege then
      null;
  end;

  begin
    insert into storage.objects (bucket_id, name)
    values (
      'kyc',
      '50000000-0000-0000-0000-000000000001/driver-national_id-1721800000003.pdf'
    );
    raise exception 'invalid Storage object extension was accepted';
  exception
    when insufficient_privilege then
      null;
  end;
end;
$$;

insert into storage.objects (bucket_id, name)
values (
  'kyc',
  '50000000-0000-0000-0000-000000000001/driver-driving_license-1721800000004.png'
);
delete from storage.objects
 where name = '50000000-0000-0000-0000-000000000001/driver-driving_license-1721800000004.png';

reset role;

do $$
begin
  if exists (
    select 1
      from storage.objects
     where name = '50000000-0000-0000-0000-000000000001/driver-driving_license-1721800000004.png'
  ) then
    raise exception 'orphan KYC cleanup was blocked';
  end if;
end;
$$;

rollback;

\echo '20260724120946_kyc_upload_hardening.test.sql: PASS'
