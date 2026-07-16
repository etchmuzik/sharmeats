-- 111_drivers_status_update_grant.sql
--
-- HIGH (final audit 2026-07-16): the driver online/offline toggle is broken.
-- apps/driver/src/jobs.ts:setOnline() does `update drivers set status=... where
-- profile_id = <self>`, but the column-level UPDATE grant on drivers.status was
-- silently wiped by mig 094 (094_f7_public_drivers_writeguard) and never
-- restored — so every toggle fails with a 42501 permission error. Offline
-- drivers cannot come online to receive offers; online drivers cannot go offline
-- from the switch. This is the recurring "hardening won, UI lost" pattern.
--
-- Safe to re-grant: the drivers_self_update RLS policy already restricts UPDATE
-- to `profile_id = auth.uid()` (or admin), so a driver can only flip their OWN
-- status row. mig 081 had intentionally scoped a per-column grant to exactly this
-- column; mig 094's blanket revoke clobbered it. Restore the single-column grant.
--
-- Authority columns (is_verified, commission, geo) are deliberately NOT granted —
-- those are mutated only by SECURITY DEFINER RPCs. `status` is driver-owned state.

grant update (status) on public.drivers to authenticated;
