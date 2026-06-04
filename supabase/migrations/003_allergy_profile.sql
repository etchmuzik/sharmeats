-- 003_allergy_profile.sql
-- Adds the structured allergy profile + per-order kitchen briefing.
--
-- Driven by the customer-app changes that surface a user-level allergy profile
-- (Settings → Allergies), apply it as pre-selected chips on every item modal,
-- aggregate allergens across the cart at checkout, and persist both the
-- aggregated allergen list and a free-text kitchen note on the order.

-- ============================================================================
-- ENUM for structured allergens (mirrors AllergyKey in apps/customer/src/data/types.ts)
-- ============================================================================

create type allergy_key_type as enum (
  'nuts',
  'gluten',
  'dairy',
  'shellfish',
  'eggs',
  'soy',
  'spicy',
  'sesame'
);

-- ============================================================================
-- USERS: allergy_profile
-- ============================================================================

alter table public.users
  add column allergy_profile allergy_key_type[] not null default '{}';

comment on column public.users.allergy_profile is
  'Structured allergy profile. Pre-selected on every item modal in the customer app; aggregated into Order.aggregate_allergens at checkout. Empty array = no warnings shown.';

-- ============================================================================
-- ORDERS: kitchen_notes + aggregate_allergens
-- ============================================================================

alter table public.orders
  add column kitchen_notes text,
  add column aggregate_allergens allergy_key_type[];

comment on column public.orders.kitchen_notes is
  'Order-wide free-text instructions captured at checkout. Separate from per-line CartItem.notes.';
comment on column public.orders.aggregate_allergens is
  'Deduplicated union of all CartItem.allergens across this order. The kitchen reads this as the authoritative allergy briefing.';

-- Helpful index for analytics (which allergens are most-flagged in orders?).
create index orders_aggregate_allergens_gin on public.orders using gin (aggregate_allergens);
