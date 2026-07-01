-- 037_orders_update_grant_lockdown.sql
-- Close a privilege-escalation hole: any customer can rewrite their own order.
--
-- THE BUG THIS FIXES
-- orders has exactly one UPDATE RLS policy, `orders_owner_update_rating`
-- (002_app_schema.sql:396), scoped only to `auth.uid() = user_id` with NO
-- column restriction — because RLS *cannot* restrict columns. Combined with the
-- Supabase default table grant (GRANT ALL ON ALL TABLES ... TO anon,
-- authenticated in the public schema), both `authenticated` and `anon` hold
-- UPDATE on EVERY column of public.orders. Verified against the live DB:
-- information_schema.column_privileges lists UPDATE on payment_status, status,
-- total_egp, discount_egp, assigned_driver_id, rider, ... for both roles.
--
-- So a logged-in customer can, with only the shipped anon key:
--   PATCH /orders?id=eq.<their-own-order>  { "payment_status": "paid" }   -- COD marked paid, cash never collected
--   ...                                    { "status": "delivered" }       -- fake completion (also fires the referral-reward trigger)
--   ...                                    { "total_egp": 0 }              -- rewrite the amount owed
--   ...                                    { "assigned_driver_id": ... }   -- reassign the rider
-- All of it bypasses the RPC/webhook authority model. The row filter passes
-- (it IS their order); the column write is unconstrained.
--
-- WHY THIS FIX IS SAFE
-- The ONLY legitimate direct client UPDATE on orders is the rating submit in
-- apps/customer/src/data/supabase/orders.ts:submitReview() — it writes exactly
-- rating_food, rating_delivery, rating_comment. Every other write path is a
-- SECURITY DEFINER RPC (place_order, advance_order_status, driver_respond,
-- assign_driver, mark_cod_collected, auto_accept_sweep, ...) or the Paymob
-- webhook via service_role — all of which run as the function/table owner and
-- do NOT depend on the `authenticated`/`anon` UPDATE grant. Reads are governed
-- by the SELECT policies and are untouched here.
--
-- THE FIX (privilege layer — the only place column scoping is enforceable)
--   1. Revoke the broad UPDATE from the app roles.
--   2. Grant back UPDATE on only the three rating columns to `authenticated`.
--      (anon gets nothing: an anonymous session should not be rating orders; the
--      customer app upgrades the anon session to a phone-linked authenticated
--      one before an order can be rated.)
-- The existing `orders_owner_update_rating` RLS policy still applies on top, so a
-- customer can only touch their OWN order's rating columns.

revoke update on public.orders from anon, authenticated;

grant update (rating_food, rating_delivery, rating_comment)
  on public.orders to authenticated;

-- Rename the policy comment intent to match reality now that it truly is
-- rating-only at the column level. (Policy body unchanged — the column lock is
-- the grant above; RLS keeps the owner-row filter.)
comment on policy "orders_owner_update_rating" on public.orders is
  'Owner may UPDATE their own order, but the table grant (mig 037) restricts the'
  ' writable columns to rating_food/rating_delivery/rating_comment only. All'
  ' other order mutations go through SECURITY DEFINER RPCs / the Paymob webhook.';
