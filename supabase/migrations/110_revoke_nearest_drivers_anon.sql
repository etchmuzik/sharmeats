-- 110_revoke_nearest_drivers_anon.sql
--
-- CRITICAL (final audit 2026-07-16): public.nearest_drivers is a SECURITY DEFINER
-- function that returns every online driver's real NAME + live GPS position +
-- online status, and it carries the historical default EXECUTE grant to `anon`
-- and `authenticated`. The anon key ships in every app bundle, so ANYONE could
-- call it with arbitrary coordinates and enumerate/triangulate the identity and
-- real-time location of all on-shift drivers with no login. A driver-safety and
-- personal-data breach reachable right now.
--
-- No client calls nearest_drivers — it is invoked only by the dispatch RPCs
-- (auto_assign_order / assign flows), which run as SECURITY DEFINER owned by
-- postgres and therefore do NOT need the anon/authenticated grant. So the fix is
-- a pure REVOKE (same class as the mig 094 public_drivers write-revoke) — we do
-- NOT rewrite the body, per the house rule that create-or-replace of an old body
-- can silently revert later hardening.
--
-- Also bundles a trivial cleanup: driver_cash_balance is a read-only view that
-- picked up stray INSERT/UPDATE/DELETE grants from a blanket GRANT; revoke them.

revoke execute on function public.nearest_drivers(geography, integer, integer)
  from anon, authenticated, public;

-- keep dispatch working: postgres (definer owner) and service_role retain execute
-- via the =X/postgres and service_role=X grants that remain after this revoke.

-- Defense-in-depth cleanup: no one can (or should) write to this view.
revoke insert, update, delete on public.driver_cash_balance from anon, authenticated;
