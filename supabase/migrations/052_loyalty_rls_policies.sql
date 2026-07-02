-- 052_loyalty_rls_policies.sql
-- Defensive hygiene: add owner-scoped SELECT policies to driver_loyalty and
-- restaurant_loyalty, closing the `rls_enabled_no_policy` advisor WARN on the
-- two loyalty tier tables that migration 043 left policy-free.
--
-- WHY THIS IS SAFE / NON-BEHAVIORAL:
--   The driver and restaurant apps read tier data ONLY through the
--   SECURITY DEFINER RPCs my_driver_tier()/my_restaurant_tier() (migration
--   046), which bypass RLS entirely. Nothing selects these tables directly
--   with an anon/authenticated key today, so adding a permissive SELECT
--   policy grants no new access path in practice — it just makes the intended
--   "read your own row only" model enforced by the schema instead of relying
--   on every future caller remembering to go through the RPC. All writes
--   remain server-side (the nightly loyalty_tier_sweep() and earn/clawback
--   triggers are SECURITY DEFINER); no INSERT/UPDATE/DELETE policy is added,
--   so with RLS on and no permissive write policy, direct client writes stay
--   denied — same authority-by-absence principle as orders (012).
--
--   Migration 043 deliberately withheld these policies, reasoning that a row
--   policy "can't express 'my own row' without a join." That is ergonomically
--   true but not a hard RLS limitation: a correlated EXISTS subquery in the
--   USING clause expresses exactly this, and the codebase already does it for
--   driver_earnings (driver_earnings_self_select, 012) and orders_driver_select
--   (012). We follow those precedents verbatim.
--
--   customer_loyalty already has its owner policy (customer_loyalty_read_own,
--   043); this migration brings the driver/restaurant siblings to parity.
--
-- Non-destructive: adds two SELECT policies only. Idempotent (drop-if-exists
-- then create) so re-running the migration chain is safe.

-- ============================================================================
-- driver_loyalty — a driver reads their own tier row; admin/dispatcher read all.
-- subject key is drivers.id, resolved to the caller via drivers.profile_id,
-- exactly like driver_earnings_self_select (012).
-- ============================================================================
drop policy if exists "driver_loyalty_self_select" on public.driver_loyalty;
create policy "driver_loyalty_self_select"
  on public.driver_loyalty for select
  using (
    exists (
      select 1 from public.drivers d
       where d.id = driver_loyalty.driver_id
         and d.profile_id = auth.uid()
    )
    or public.auth_role() in ('admin','dispatcher')
  );

-- ============================================================================
-- restaurant_loyalty — merchant staff read their own restaurant's tier row;
-- admin reads all. Uses the canonical is_merchant_staff() helper (007), the
-- same merchant-scope check used across the catalog policies (012) and by
-- my_restaurant_tier() (046).
-- ============================================================================
drop policy if exists "restaurant_loyalty_staff_select" on public.restaurant_loyalty;
create policy "restaurant_loyalty_staff_select"
  on public.restaurant_loyalty for select
  using (
    public.is_merchant_staff(restaurant_loyalty.restaurant_id)
    or public.auth_role() = 'admin'
  );

comment on policy "driver_loyalty_self_select" on public.driver_loyalty is
  'Defense-in-depth: a driver may read only their own tier row (drivers.profile_id = auth.uid()); admin/dispatcher read all. Reads still normally go through my_driver_tier() (046); this policy makes the own-row model schema-enforced. Added by 052.';
comment on policy "restaurant_loyalty_staff_select" on public.restaurant_loyalty is
  'Defense-in-depth: merchant staff may read only their own restaurant''s tier row (is_merchant_staff); admin reads all. Reads still normally go through my_restaurant_tier() (046). Added by 052.';

-- ============================================================================
-- Intentionally NOT changed by this migration (reviewed, deliberately locked):
--
--   * promo_codes / promo_redemptions (019) — RLS on, NO policy BY DESIGN.
--     A client SELECT policy on promo_codes would create a coupon-enumeration
--     oracle; redemptions must not be cross-readable. Access is only via the
--     validate_promo() SECURITY DEFINER function. Leave locked.
--
--   * waitlist (001) — RLS on, NO policy BY DESIGN. Landing-page signups are
--     inserted only by the Next.js /api/waitlist route using the service-role
--     key (which bypasses RLS) after Zod validation. No client access is
--     intended. Leave locked.
--
--   * riders (002) — RLS on, NO policy. Legacy table superseded by the drivers
--     fleet table + the curated public_drivers view (008), which is the actual
--     public read path (name/photo/vehicle/rating only). The customer app reads
--     rider identity from orders.rider JSONB snapshots and public_drivers, never
--     from riders directly. riders also carries `plate`; a broad public-read
--     policy would EXPAND exposure, not fix a gap. Leave locked.
--
--   * spatial_ref_sys — PostGIS built-in reference table; the advisor flag is a
--     known false positive. Do NOT enable RLS or add policies (it is not ours to
--     own and doing so can break PostGIS).
--
-- These four remain intentional `rls_enabled_no_policy` entries; documenting
-- them here records that they were reviewed in this pass, not overlooked.
-- ============================================================================
