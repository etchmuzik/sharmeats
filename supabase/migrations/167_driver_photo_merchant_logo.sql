-- 167_driver_photo_merchant_logo.sql
--
-- Adds a driver profile photo and a merchant logo, plus the public 'avatars'
-- bucket that holds the bytes.
--
-- WHY A SEPARATE BUCKET FROM 'kyc':
-- 'kyc' is private by design (mig 075/076) — it holds identity documents, and
-- its read policy is "owner or admin". A driver photo is shown to the CUSTOMER
-- tracking their delivery, and a merchant logo appears in the storefront, so
-- both must be world-readable. Putting them in 'kyc' would either leak identity
-- documents or require weakening that bucket's read policy. A second, public
-- bucket keeps the two classes of image on opposite sides of the privacy line.
--
-- PATH CONVENTION (same as 'kyc', mig 076): avatars/<auth.uid()>/<file>. The
-- first path segment is the uploader's auth uid, which is what the RLS policies
-- below scope ownership on. Writes are restricted to the owner's own prefix;
-- reads are open.
--
-- COLUMN GRANTS: `drivers` and `restaurants` deliberately have COLUMN-LEVEL
-- update grants (migs 081/111) so that authority columns — is_verified,
-- commission, geo — cannot be self-set by the account holder. A new column is
-- therefore NOT writable by default, which is the safe direction. These two are
-- cosmetic and self-owned, so each gets its own narrow grant. Nothing else is
-- widened.

-- NOTE ON TRANSACTIONS: this file deliberately contains NO `begin;`/`commit;`.
-- An embedded commit ends whatever transaction the caller opened, which silently
-- defeats the `BEGIN; \i ...; ROLLBACK;` dry-run that house rule 6 requires —
-- verified the hard way: an earlier draft printed "WARNING: there is no
-- transaction in progress" and left the DDL permanently applied to the scratch
-- clone. Every statement below is idempotent, and the caller (psql or the
-- Supabase migration runner) supplies the transaction.

-- ── Columns ────────────────────────────────────────────────────────────────
alter table public.drivers
  add column if not exists photo_url text;

comment on column public.drivers.photo_url is
  'Public URL of the driver''s profile photo in the avatars bucket. Shown to '
  'customers during an active delivery. Cosmetic — carries no authority.';

alter table public.restaurants
  add column if not exists logo_url text;

comment on column public.restaurants.logo_url is
  'Public URL of the merchant logo in the avatars bucket. Shown in the '
  'storefront and on the kitchen tablet. Cosmetic — carries no authority.';

-- ── Column-level UPDATE grants ─────────────────────────────────────────────
-- Narrow, additive: only these two columns, only for authenticated. Existing
-- RLS (drivers: profile_id = auth.uid(); restaurants: merchant staff) still
-- decides WHICH row, this decides WHICH column.
grant update (photo_url) on public.drivers to authenticated;
grant update (logo_url) on public.restaurants to authenticated;

-- ── Public 'avatars' bucket ────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

-- ── Storage RLS ────────────────────────────────────────────────────────────
-- Reads: open to everyone including anon. The bucket is public by definition —
-- a customer tracking a delivery is authenticated, but a storefront logo is
-- visible pre-login, so anon must be able to read.
drop policy if exists "avatars_read_all" on storage.objects;
create policy "avatars_read_all"
  on storage.objects for select to public
  using (bucket_id = 'avatars');

-- Writes: only under the uploader's own uid prefix.
drop policy if exists "avatars_upload_own" on storage.objects;
create policy "avatars_upload_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Replace an existing photo/logo: owner only.
drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Unlike 'kyc' — where deletion is withheld to preserve an audit trail — a
-- cosmetic avatar SHOULD be removable by the person depicted in it. Own prefix
-- only.
drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
