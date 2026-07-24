-- KYC upload hardening.
--
-- Forward-only controls:
--   * the private bucket accepts only JPEG/PNG/WebP images up to 5 MiB;
--   * object names are restricted to the authenticated user's known KYC types;
--   * uploaded evidence is immutable once indexed;
--   * clients cannot forge an approved/reviewed kyc_documents row;
--   * an unindexed object may be deleted only by its owner, allowing the app to
--     clean up if the metadata insert fails.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'kyc',
  'kyc',
  false,
  5 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "kyc_upload_own" on storage.objects;
create policy "kyc_upload_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'kyc'
    and name ~ (
      '^' || (select auth.uid())::text ||
      '/(driver-(national_id|driving_license|vehicle_reg)|restaurant-(commercial_reg|tax_card|food_license))-[0-9]+\.(jpg|png|webp)$'
    )
  );

-- Reviewed evidence is immutable. Re-submission always creates a new object and
-- a new pending row.
drop policy if exists "kyc_update_own" on storage.objects;

-- The indexed-check must bypass the caller's RLS on kyc_documents: an owner who
-- has lost read access to the metadata row (e.g. a removed merchant staffer)
-- must still be barred from deleting reviewed evidence. A plain NOT EXISTS in
-- the policy runs under the caller's RLS and would let them delete indexed
-- objects they can no longer see.
create or replace function public.kyc_storage_path_indexed(p_name text)
returns boolean
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.kyc_documents where storage_path = p_name
  );
$$;
revoke all on function public.kyc_storage_path_indexed(text) from public, anon;
grant execute on function public.kyc_storage_path_indexed(text) to authenticated;

drop policy if exists "kyc_delete_unindexed_own" on storage.objects;
create policy "kyc_delete_unindexed_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'kyc'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not public.kyc_storage_path_indexed(name)
  );

-- NOT VALID avoids a risky rollout failure if legacy rows contain a historical
-- custom document type. PostgreSQL still enforces this constraint for every new
-- row immediately; the release preflight reports legacy violations before a
-- later migration validates the full history.
alter table public.kyc_documents
  drop constraint if exists kyc_documents_subject_doc_type_check;
alter table public.kyc_documents
  add constraint kyc_documents_subject_doc_type_check
  check (
    (
      subject_type = 'driver'
      and doc_type in ('national_id', 'driving_license', 'vehicle_reg')
      and storage_path ~ (
        '/driver-' || doc_type || '-[0-9]+\.(jpg|png|webp)$'
      )
    )
    or
    (
      subject_type = 'restaurant'
      and doc_type in ('commercial_reg', 'tax_card', 'food_license')
      and storage_path ~ (
        '/restaurant-' || doc_type || '-[0-9]+\.(jpg|png|webp)$'
      )
    )
  ) not valid;

drop policy if exists kyc_documents_insert on public.kyc_documents;
create policy kyc_documents_insert
  on public.kyc_documents for insert to authenticated
  with check (
    status = 'pending'
    and review_note is null
    and reviewed_by is null
    and reviewed_at is null
    and storage_path like ((select auth.uid())::text || '/%')
    and (
      (
        subject_type = 'driver'
        and doc_type in ('national_id', 'driving_license', 'vehicle_reg')
        and exists (
          select 1
            from public.drivers as driver
           where driver.id = subject_id
             and driver.profile_id = (select auth.uid())
        )
      )
      or
      (
        subject_type = 'restaurant'
        and doc_type in ('commercial_reg', 'tax_card', 'food_license')
        and public.is_merchant_staff(subject_id)
      )
    )
  );

comment on constraint kyc_documents_subject_doc_type_check
  on public.kyc_documents is
  'New KYC rows must use the required driver/restaurant document types and an immutable typed image path. Added NOT VALID so legacy custom rows can be audited before validation.';
