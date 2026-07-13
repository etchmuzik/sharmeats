-- 102 — revoke anon/authenticated write access to public.spatial_ref_sys.
--
-- FOUND (full security audit 2026-07-11): spatial_ref_sys (the PostGIS SRID
-- reference table) is a real public table with RLS OFF and INSERT/UPDATE/DELETE/
-- TRUNCATE granted to anon+authenticated. A caller with only the anon key can
-- corrupt or delete SRID definitions (e.g. WGS84 / 4326) that every geography
-- column and all dispatch/zone/distance math depends on (nearest_drivers,
-- resolve_zone, delivery_feasibility). Availability/integrity risk (no PII, no
-- money) → MEDIUM. Supabase cannot enable RLS on this PostGIS-owned table, so
-- revoking the write grant is the correct lever; reads stay open (PostGIS needs
-- them). Advisor: rls_disabled_in_public (ERROR).
--
-- ⚠️ OWNER-GATED — this migration is a SILENT NO-OP under the standard migration
-- path. The anon/authenticated write privileges were granted BY `supabase_admin`
-- (pg_class.relacl shows `anon=arwdDxtm/supabase_admin`). Postgres only lets the
-- GRANTOR or a superuser revoke a grant. The migration role is `postgres`, which
-- is NOT a member of supabase_admin (verified: pg_has_role = false), so the two
-- REVOKEs below do nothing here and the write grants REMAIN in prod.
--   → To actually close it, run these two statements from the Supabase Dashboard
--     SQL editor (executes with sufficient privilege) or via Supabase support.
-- This file is retained as the record of intent and the exact statements to run.

revoke insert, update, delete, truncate on public.spatial_ref_sys from anon;
revoke insert, update, delete, truncate on public.spatial_ref_sys from authenticated;
