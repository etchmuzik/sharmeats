-- 006_verticals_catalog.sql
-- Multi-category foundation — the "no schema rewrite for groceries/pharmacy" keystone.
--
-- The existing schema is food-only by naming (restaurants, menu_*). We make it
-- category-AGNOSTIC by introducing `verticals` and tagging each merchant
-- (restaurants table) with a vertical_id. A "restaurant" is just a merchant
-- WHERE vertical = 'food'; a grocery store is a merchant WHERE vertical =
-- 'grocery'. The catalog tables (menu_sections / menu_items / modifiers /
-- modifier_options) already work for any vertical — they hang off the merchant.
--
-- Launch: seed 'food' ACTIVE. 'grocery' and 'pharmacy' rows exist but INACTIVE.
-- Adding them later = flip is_active + insert merchants. Zero DDL.
--
-- Also adds the hybrid-fulfillment + payment-acceptance flags per merchant.
-- Non-destructive: new table + ADD COLUMN with safe defaults + backfill.

-- ============================================================================
-- VERTICALS (category-agnostic root)
-- ============================================================================
create table if not exists public.verticals (
  id            text primary key,          -- 'food' | 'grocery' | 'pharmacy' | ...
  name_en       text not null,
  name_ar       text not null,
  icon          text,                      -- icon name / emoji for the UI
  is_active     boolean not null default false,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

insert into public.verticals (id, name_en, name_ar, icon, is_active, sort_order) values
  ('food',     'Food',     'طعام',   'utensils',     true,  10),
  ('grocery',  'Groceries','بقالة',  'shopping-cart',false, 20),
  ('pharmacy', 'Pharmacy', 'صيدلية', 'pill',         false, 30)
on conflict (id) do nothing;

alter table public.verticals enable row level security;
create policy "verticals_public_read"
  on public.verticals for select using (is_active = true);

-- ============================================================================
-- RESTAURANTS (= the polymorphic MERCHANT): vertical + fulfillment + payments
-- ============================================================================
alter table public.restaurants
  add column if not exists vertical_id      text references public.verticals(id) default 'food',
  add column if not exists fulfillment_type text not null default 'platform',     -- 'platform' | 'self_delivery'
  add column if not exists commission_pct   numeric(5,2) not null default 12.0,   -- platform's cut (LOI offer = 12%)
  add column if not exists accepts_cash     boolean not null default true,        -- COD allowed
  add column if not exists accepts_card     boolean not null default true;        -- Paymob card allowed

-- Backfill existing rows to the food vertical explicitly.
update public.restaurants set vertical_id = 'food' where vertical_id is null;

-- Guard rails on the new enum-like text columns.
alter table public.restaurants
  add constraint restaurants_fulfillment_type_chk
    check (fulfillment_type in ('platform', 'self_delivery')) not valid;
alter table public.restaurants validate constraint restaurants_fulfillment_type_chk;

create index if not exists restaurants_vertical_idx on public.restaurants (vertical_id);

-- ============================================================================
-- CATALOG ITEMS: vertical-flex columns (food works now; grocery/pharmacy later)
-- ============================================================================
-- menu_items already has: name, description, price_egp, image, flags, is_available.
-- Add SKU/unit/barcode (grocery) + prescription flag (pharmacy) as nullable —
-- food simply leaves them null. No new table needed.
alter table public.menu_items
  add column if not exists sku                   text,
  add column if not exists barcode               text,
  add column if not exists unit                  text default 'each',  -- 'each' | 'kg' | 'pack' | ...
  add column if not exists requires_prescription boolean not null default false;

comment on table public.verticals is
  'Category-agnostic root. Food active at launch; grocery/pharmacy inactive rows. Adding a vertical later = flip is_active + insert merchants (no DDL).';
comment on column public.restaurants.vertical_id is
  'Which vertical this merchant belongs to. ''food'' now; ''grocery''/''pharmacy'' use the SAME table later.';
comment on column public.restaurants.fulfillment_type is
  'Hybrid fleet: ''platform'' (our drivers, dispatched) or ''self_delivery'' (merchant''s own driver). Default copied onto each order, frozen there.';
comment on column public.restaurants.commission_pct is
  'Platform commission %. Founding-cohort LOI offers 12% (vs Twista 18-22%).';
comment on column public.menu_items.unit is
  'Sale unit. ''each'' for food/most items; ''kg''/''pack'' for grocery weights. price_egp is per-unit.';
comment on column public.menu_items.requires_prescription is
  'Pharmacy: item needs a prescription. Enforced in place_order for vertical=pharmacy (later).';
