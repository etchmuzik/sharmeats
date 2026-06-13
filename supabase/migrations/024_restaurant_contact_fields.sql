-- 024_restaurant_contact_fields.sql — real-world contact/location metadata.
--
-- Adds the fields needed to back restaurants with REAL directory data (sourced
-- from Google Maps) rather than the fictional pilot seed: a public phone, a
-- human-readable street address, an optional website, and a stable source ref
-- (Google Maps place id) so re-imports are idempotent and de-duplicated.
--
-- Additive + idempotent: existing `select *` reads and the restaurants_public_read
-- RLS policy are unaffected. Safe to re-run.

alter table public.restaurants
  add column if not exists phone    text,
  add column if not exists address  text,
  add column if not exists website  text,
  add column if not exists place_id text;  -- Google Maps place id / source ref

-- At most one restaurant per source place (nulls allowed — pilot rows have none).
create unique index if not exists restaurants_place_id_uniq
  on public.restaurants (place_id) where place_id is not null;
