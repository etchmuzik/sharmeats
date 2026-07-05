-- 094_f7_public_drivers_writeguard.sql
-- F7 (2026-07-05 audit, ESCALATED then SCOPED): public.public_drivers is a
-- SECURITY DEFINER view (security_invoker OFF => runs as owner `postgres`). On
-- PG 17.6 with drivers.relforcerowsecurity = false, the owner BYPASSES RLS. The
-- view is auto-updatable (single-table projection; is_insertable/is_updatable =
-- YES) and anon + authenticated hold INSERT/UPDATE/DELETE on it. That is a
-- WRITE-BYPASS path: a client could write through the view to public.drivers as
-- the owner, sidestepping the drivers RLS write policies (admin-insert /
-- self-update / no-delete).
--
-- Why we do NOT flip security_invoker on:
--   The view's SELECT is a deliberate PUBLIC projection (id, name, photo,
--   vehicle, rating of active drivers) consumed via PostgREST FK-embedding
--   (orders -> public_drivers) so a customer can see their assigned driver's
--   safe columns. drivers RLS (drivers_self_select) only exposes a driver row to
--   that driver / admin / dispatcher, so security_invoker=on would make the
--   embed return NOTHING for customers — an access-NARROWING regression. The
--   definer SELECT is intentional and leaks no phone/PII. The advisor
--   `security_definer_view` will keep flagging this by design; it is documented
--   here as an accepted, read-only public projection.
--
-- The ACTUAL vulnerability is the write path, closed here by removing every
-- write privilege on the view. Direct writes on public.drivers are already
-- contained by RLS (no DELETE policy => denied; INSERT admin-only; UPDATE
-- self/admin), so the base-table client write grants are unreachable debt —
-- revoked too for hygiene.
--
-- Idempotent: REVOKE of an absent privilege is a no-op. SELECT is preserved.
-- Rollback: re-grant (not recommended — this view must stay read-only).

revoke insert, update, delete, truncate, references, trigger
  on public.public_drivers from anon, authenticated;

revoke insert, update, delete, truncate, references, trigger
  on public.drivers from anon, authenticated;
