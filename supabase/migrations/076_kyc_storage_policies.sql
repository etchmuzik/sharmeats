-- 076_kyc_storage_policies.sql
-- Storage RLS for the private 'kyc' bucket (created alongside mig 075).
-- KYC files are uploaded under a per-user prefix: kyc/<auth.uid()>/<file>.
-- An authenticated user may upload/read/update files under THEIR OWN uid prefix;
-- admins may read all (for review). Nobody else can read another user's docs.
-- The file bytes are private; the kyc_documents table row (075) is the index.
--
-- Note: storage.objects RLS is the gate on the actual bytes. The convention is
-- that the first path segment is the uploader's auth uid, so
-- (storage.foldername(name))[1] = auth.uid()::text scopes ownership.
--
-- Idempotent (drop policy if exists + create). storage.objects already has RLS
-- enabled by Supabase.

-- Upload: authenticated user writes only under their own uid prefix in 'kyc'.
drop policy if exists "kyc_upload_own" on storage.objects;
create policy "kyc_upload_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'kyc'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Read: owner reads their own; admin reads all.
drop policy if exists "kyc_read_own_or_admin" on storage.objects;
create policy "kyc_read_own_or_admin"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'kyc'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.auth_role() = 'admin'
    )
  );

-- Update (e.g. re-upload/replace): owner only.
drop policy if exists "kyc_update_own" on storage.objects;
create policy "kyc_update_own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'kyc'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'kyc'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- No DELETE policy: KYC evidence should not be client-deletable (audit trail).
