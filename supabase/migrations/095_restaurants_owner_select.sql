-- 095_restaurants_owner_select.sql
-- Bug (found 2026-07-10 via the restaurant app): the ONLY SELECT policy on
-- public.restaurants was `is_active = true`, so a merchant whose restaurant is
-- deactivated cannot read THEIR OWN restaurant row. The app's
-- `merchant_staff -> restaurants(name, is_open)` embed silently returns null,
-- the header falls back to "Your restaurant", and the open/closed pill falls
-- back to Closed regardless of the real is_open value — while the toggle WRITE
-- still succeeds (restaurants_merchant_update has no is_active arm). Net
-- effect: toggle open -> refresh -> pill flips back to Closed, forever.
-- Also hits the Apple-review demo restaurant (deliberately is_active=false so
-- it never appears to real customers).
--
-- Fix: owners/staff of a restaurant (and admin) can always SELECT it. Public
-- browsing stays restricted to active restaurants — customers see no change.
-- Single permissive SELECT policy (F10 discipline), initplan-wrapped auth call
-- (F5 discipline). Idempotent via drop-if-exists. Rollback: recreate
-- restaurants_public_read with `using (is_active = true)`.

drop policy if exists restaurants_public_read on public.restaurants;
drop policy if exists restaurants_read on public.restaurants;
create policy restaurants_read on public.restaurants for select using (
  (is_active = true)
  or public.is_merchant_staff(id)
  or ((select auth_role()) = 'admin'::public.app_role)
);