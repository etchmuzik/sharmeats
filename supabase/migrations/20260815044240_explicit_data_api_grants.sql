-- Make Data API access portable across Supabase projects created before and
-- after the platform stopped auto-exposing new public relations.
--
-- PostgreSQL privileges and RLS are independent gates: RLS answers "which
-- rows?", while these ACLs answer "which relations, verbs and columns?". This
-- migration intentionally grants only operations used by the checked-in
-- browser/mobile clients and Edge Functions as of 2026-08-15. Adding a new
-- direct `.from(...)` operation now requires a matching explicit grant.
--
-- RPCs are intentionally not granted schema-wide. The call-site inventory was
-- checked signature by signature; seven old read/self-service RPCs that only
-- added a role grant (and therefore retained PostgreSQL's PUBLIC EXECUTE) are
-- normalized below. All other called RPCs already have revoke-first ACLs in
-- their defining/hardening migration. Future functions start closed below.

-- ---------------------------------------------------------------------------
-- 1. Future objects: remove the historical implicit Data API grants.
-- ---------------------------------------------------------------------------
-- Supabase's migration role is `postgres`, so this is the default ACL that
-- migrations can authoritatively repair. Revoke both globally and in `public`:
-- per-schema defaults are additive and cannot subtract PostgreSQL's built-in
-- global PUBLIC EXECUTE on functions. Omitting the global revoke leaves every
-- future function callable through PUBLIC despite the named-role revokes.
alter default privileges for role postgres
  revoke all privileges on tables
  from public, anon, authenticated, service_role;
alter default privileges for role postgres
  revoke all privileges on sequences
  from public, anon, authenticated, service_role;
alter default privileges for role postgres
  revoke all privileges on functions
  from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all privileges on tables
  from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences
  from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all privileges on functions
  from public, anon, authenticated, service_role;

-- LEGACY HOSTED-PROJECT FOLLOW-UP (cannot always be completed by a migration):
-- old projects can also have a pg_default_acl row owned by `supabase_admin`.
-- Hosted `postgres` is deliberately not a superuser/member of that role, so an
-- unconditional ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin would abort
-- the release. Repair it when this execution context is authorized; otherwise
-- emit a visible warning. After deploy, inspect pg_default_acl as a platform
-- owner and run the same global + public-schema REVOKEs FOR ROLE
-- supabase_admin (or ask Supabase
-- support/platform tooling to do so). House rule 5b remains mandatory even
-- after that repair: every new public table is revoke-first, grant-second.
-- LIVE VERIFY: pg_default_acl joined to aclexplode(defaclacl) must show no
-- supabase_admin-owned table/sequence/function privilege for PUBLIC, anon,
-- authenticated or service_role. The authorized branch below contains the six
-- exact global + schema statements needed if any such rows remain.
do $supabase_admin_defaults$
declare
  can_manage_supabase_admin boolean := false;
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    select current_user = 'supabase_admin'
           or pg_has_role(current_user, 'supabase_admin', 'MEMBER')
           or coalesce((select rolsuper from pg_roles where rolname = current_user), false)
      into can_manage_supabase_admin;

    if can_manage_supabase_admin then
      execute 'alter default privileges for role supabase_admin
                 revoke all privileges on tables
                 from public, anon, authenticated, service_role';
      execute 'alter default privileges for role supabase_admin
                 revoke all privileges on sequences
                 from public, anon, authenticated, service_role';
      execute 'alter default privileges for role supabase_admin
                 revoke all privileges on functions
                 from public, anon, authenticated, service_role';
      execute 'alter default privileges for role supabase_admin in schema public
                 revoke all privileges on tables
                 from public, anon, authenticated, service_role';
      execute 'alter default privileges for role supabase_admin in schema public
                 revoke all privileges on sequences
                 from public, anon, authenticated, service_role';
      execute 'alter default privileges for role supabase_admin in schema public
                 revoke all privileges on functions
                 from public, anon, authenticated, service_role';
    else
      raise warning using message =
        '[20260815044240] supabase_admin default ACL not changed: migration role lacks authority. Complete the documented live follow-up.';
    end if;
  end if;
end;
$supabase_admin_defaults$;

-- Data API roles may resolve explicitly granted objects, but may never create
-- objects in the exposed schema.
revoke create on schema public from public, anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Existing relations: erase legacy defaults, then rebuild the allow-list.
-- ---------------------------------------------------------------------------
-- This is the complete checked-in direct Data API relation inventory. Include
-- service_role in the reset: bypassing RLS does not imply unlimited SQL ACLs.
revoke all privileges on table
  public.addresses,
  public.customer_carts,
  public.driver_cash_balance,
  public.driver_earnings,
  public.driver_settlements,
  public.drivers,
  public.favorite_items,
  public.favorites,
  public.hotels,
  public.kyc_documents,
  public.menu_items,
  public.menu_sections,
  public.merchant_staff,
  public.modifier_options,
  public.modifiers,
  public.notification_prefs,
  public.order_assignments,
  public.order_messages,
  public.order_refunds,
  public.order_shares,
  public.order_status_events,
  public.orders,
  public.payment_attempts,
  public.payment_methods,
  public.platform_settings,
  public.public_drivers,
  public.push_attempts,
  public.push_messages,
  public.push_tokens,
  public.restaurant_settlements,
  public.restaurants,
  public.saved_orders,
  public.saved_orders_visible,
  public.support_messages,
  public.users,
  public.zones
from public, anon, authenticated, service_role;

-- Anonymous catalog and deliberately public-safe compatibility surfaces.
grant select on table
  public.hotels,
  public.zones,
  public.restaurants,
  public.menu_sections,
  public.menu_items,
  public.modifiers,
  public.modifier_options,
  public.public_drivers,
  public.favorite_items,
  public.customer_carts,
  public.notification_prefs
to anon;
grant insert, delete on table public.favorite_items to anon;

-- Authenticated reads used by mobile/web queries, embedded PostgREST joins,
-- and Realtime subscriptions. Row visibility remains governed by RLS.
grant select on table
  public.users,
  public.addresses,
  public.payment_methods,
  public.hotels,
  public.zones,
  public.restaurants,
  public.menu_sections,
  public.menu_items,
  public.modifiers,
  public.modifier_options,
  public.orders,
  public.drivers,
  public.order_assignments,
  public.driver_earnings,
  public.merchant_staff,
  public.kyc_documents,
  public.push_tokens,
  public.favorites,
  public.favorite_items,
  public.saved_orders,
  public.saved_orders_visible,
  public.customer_carts,
  public.order_messages,
  public.support_messages,
  public.restaurant_settlements,
  public.driver_settlements,
  public.driver_cash_balance,
  public.order_shares,
  public.platform_settings,
  public.public_drivers,
  public.notification_prefs
to authenticated;

-- Direct client writes with no authority-bearing columns.
grant insert, delete on table public.addresses to authenticated;
grant insert on table public.restaurants to authenticated;
grant insert, update, delete on table
  public.menu_sections,
  public.menu_items,
  public.favorites
to authenticated;
grant insert on table public.kyc_documents to authenticated;
grant delete on table public.push_tokens to authenticated;
grant insert, delete on table
  public.favorite_items,
  public.saved_orders
to authenticated;

-- Column-level grants are security boundaries. Keep every earlier restriction:
-- RLS chooses the row, while these lists prevent self-promotion, commission /
-- verification edits, order-state forgery and message-body edits.
grant update (
  phone,
  display_name,
  email,
  default_address_id,
  default_payment_method_id,
  preferred_currency,
  locale,
  allergy_profile,
  terms_accepted_version,
  terms_accepted_at
) on table public.users to authenticated;
grant update (is_default)
  on table public.addresses to authenticated;
grant update (is_default)
  on table public.payment_methods to authenticated;
grant update (rating_food, rating_delivery, rating_comment)
  on table public.orders to authenticated;
grant update (
  status,
  payout_method,
  payout_bank_name,
  payout_iban,
  payout_wallet,
  payout_holder,
  photo_url
) on table public.drivers to authenticated;
grant update (
  is_open,
  payout_method,
  payout_bank_name,
  payout_iban,
  payout_wallet,
  payout_holder,
  logo_url
) on table public.restaurants to authenticated;
grant update (read_at)
  on table public.order_messages, public.support_messages to authenticated;

-- Preserve the refund projection from migration 180: provider_detail and
-- actor_id are operational fields and must never enter the client projection.
grant select (
  id,
  order_id,
  amount_egp,
  reason,
  status,
  created_at,
  updated_at
) on table public.order_refunds to authenticated;

-- Edge Functions use the service key for these direct operations. Everything
-- else is reached through a signature-specific SECURITY DEFINER RPC.
grant select on table
  public.users,
  public.orders,
  public.notification_prefs,
  public.platform_settings
to service_role;
grant select, delete on table public.push_tokens to service_role;
grant select, insert, update on table
  public.push_messages,
  public.push_attempts
to service_role;
grant insert on table public.order_status_events to service_role;
grant select, insert, update on table
  public.payment_attempts,
  public.order_refunds
to service_role;

-- scripts/import-menu.mjs (bulk merchant onboarding) drives PostgREST with the
-- service key: it reads the merchant by slug, reads the existing sections and
-- items, and inserts the missing ones. It never updates or deletes.
grant select on table public.restaurants to service_role;
grant select, insert on table
  public.menu_sections,
  public.menu_items
to service_role;

-- ---------------------------------------------------------------------------
-- 3. Legacy RPC ACL omissions found by the call-site inventory.
-- ---------------------------------------------------------------------------
-- A GRANT to authenticated/anon does not replace PostgreSQL's default PUBLIC
-- EXECUTE. Revoke every inherited path first, then restore only the intended
-- callers. Exact signatures avoid creating or ambiguously targeting overloads.
revoke all on function public.get_restaurant_reviews(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.get_restaurant_reviews(uuid, integer)
  to anon, authenticated;

revoke all on function public.quote_delivery_fee(uuid, geography, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.quote_delivery_fee(uuid, geography, integer)
  to anon, authenticated;

revoke all on function public.my_loyalty_status()
  from public, anon, authenticated, service_role;
revoke all on function public.my_loyalty_history(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.my_driver_tier()
  from public, anon, authenticated, service_role;
revoke all on function public.my_restaurant_tier()
  from public, anon, authenticated, service_role;
revoke all on function public.my_referral_code()
  from public, anon, authenticated, service_role;
grant execute on function
  public.my_loyalty_status(),
  public.my_loyalty_history(integer),
  public.my_driver_tier(),
  public.my_restaurant_tier(),
  public.my_referral_code()
to authenticated;

comment on schema public is
  'Application/Data API schema. Migration 20260815044240 replaces legacy implicit ACLs with an explicit relation/verb allow-list and closes postgres-owned future-object defaults. Legacy supabase_admin-owned default ACLs require the documented platform-owner follow-up when the migration role lacks authority.';
