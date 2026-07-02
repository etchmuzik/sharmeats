-- 053_users_update_grant_lockdown.sql
-- Close a privilege-escalation hole: any customer can make themselves admin.
--
-- THE BUG THIS FIXES (same class as 037, on the users table this time)
-- public.users has one UPDATE RLS policy, `users_update_self`
-- (002_app_schema.sql:377), scoped only to `auth.uid() = id` with NO column
-- restriction — because RLS *cannot* restrict columns. Combined with the
-- Supabase default table grant, both `authenticated` and `anon` hold UPDATE on
-- EVERY column of public.users, including `role` (added 007_roles_merchant_staff)
-- and `referral_code`. Verified against the live DB: column_privileges lists
-- UPDATE on role + referral_code for both roles.
--
-- So a logged-in customer can, with only the shipped anon key:
--   PATCH /users?id=eq.<their-own-id>  { "role": "admin" }   -- full admin
--   PATCH /users?id=eq.<their-own-id>  { "referral_code": "..." }  -- poison promo resolution
-- The row filter passes (it IS their row); the column write is unconstrained.
-- `auth_role()` (007) then reads users.role and unlocks assign_driver, admin
-- force-cancel in advance_order_status, mark_cod_collected on any order, and
-- every admin RLS branch platform-wide.
--
-- WHY THIS FIX IS SAFE
-- The ONLY legitimate direct client UPDATEs on users write these columns:
--   auth.ts:verifyOtp   -> phone
--   user.ts:update      -> display_name, email, default_address_id,
--                          default_payment_method_id, preferred_currency,
--                          locale, allergy_profile
--   user.ts (defaults)  -> default_address_id, default_payment_method_id
-- Nothing in any app writes role, referral_code, id, created_at, or updated_at.
-- role is set server-side (default 'customer'; staff/admin provisioned by the
-- Sharm Eats team via service_role). referral_code is minted server-side.
-- Reads are governed by the SELECT policies and are untouched here.
--
-- THE FIX (privilege layer — the only place column scoping is enforceable)
--   1. Revoke the broad UPDATE from the app roles.
--   2. Grant back UPDATE on only the legitimate self-service profile columns to
--      `authenticated`. (anon gets nothing: an anonymous session upgrades to a
--      phone-linked authenticated one before it writes profile data — the sole
--      anon-era users write is the phone mirror in verifyOtp, which runs AFTER
--      verifyOtp has upgraded the session to authenticated.)
-- The existing `users_update_self` RLS policy still applies on top, so a user can
-- only touch their OWN row, and now only its non-privileged columns.

revoke update on public.users from anon, authenticated;

grant update (phone, display_name, email, default_address_id,
              default_payment_method_id, preferred_currency, locale, allergy_profile)
  on public.users to authenticated;

comment on policy "users_update_self" on public.users is
  'Owner may UPDATE their own users row, but the table grant (mig 053) restricts'
  ' the writable columns to profile fields only (phone, display_name, email,'
  ' default_address_id, default_payment_method_id, preferred_currency, locale,'
  ' allergy_profile). role and referral_code are server-managed and NOT'
  ' client-writable — this closes the self-escalation-to-admin hole.';
