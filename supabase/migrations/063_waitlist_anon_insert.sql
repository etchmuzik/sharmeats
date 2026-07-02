-- 063_waitlist_anon_insert.sql
-- Re-enable landing-page waitlist capture on static hosting (2026-07-03 P0 gap).
--
-- THE PROBLEM
-- The landing site is a Next.js static export (output: 'export') on Hostinger,
-- so the /api/waitlist route that used the service-role key can no longer run —
-- there is no server. That route was deleted and the form unmounted, leaving
-- public.waitlist unwritable: RLS is ON (mig 001) with ZERO policies, so the
-- anon role is denied every insert. Waitlist capture is dead.
--
-- THE FIX
-- Let the browser insert directly with the anon key — the exact pattern the
-- customer app already uses. Add an INSERT-only RLS policy for the anon role.
-- The WITH CHECK constrains rows to non-null, lowercased email from the landing
-- source, so the public key can only append legitimate signups.
--
-- WHAT WE DELIBERATELY DO NOT DO
-- No SELECT / UPDATE / DELETE policy for anon: the list must never be readable,
-- editable, or erasable with the public key. Reads stay service-role only.
-- The existing unique(email) constraint (mig 001) makes duplicate signups a
-- clean 23505 the client handles gracefully — no upsert, no data leak.
-- Non-destructive and idempotent.

-- ============================================================================
-- INSERT-only policy for the anon (public) role.
-- ============================================================================
drop policy if exists "waitlist_anon_insert" on public.waitlist;

create policy "waitlist_anon_insert"
  on public.waitlist
  for insert
  to anon
  with check (
    email is not null
    and email = lower(email)
    and source = 'landing'
  );

comment on policy "waitlist_anon_insert" on public.waitlist is
  'Landing page signups: anon may INSERT only (non-null lowercased email, source=landing). No anon SELECT/UPDATE/DELETE — the list is never readable with the public key.';
