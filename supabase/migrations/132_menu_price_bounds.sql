-- 132_menu_price_bounds.sql
--
-- Structural bounds on menu prices.
--
-- MenuManager.tsx writes menu_items directly (no RPC), and RLS cannot
-- restrict columns (house rule 5) -- so price_egp was freely writable by
-- merchant staff with no bounds at all. price_egp sits upstream of every
-- money figure: place_order snapshots it into order_items, commission is
-- computed from the resulting subtotal, settlement aggregates from there.
-- A fat-fingered 100000 (or a malicious 1) flows straight through.
--
-- A CHECK constraint is the right shape for this: it binds EVERY writer --
-- MenuManager, the future CSV importer, raw SQL -- rather than only a
-- blessed RPC path. Bounds are deliberately generous plausibility rails,
-- not pricing policy: prod today spans 25..780 EGP across ~1,000 items, so
-- 1..10000 leaves room for banquet platters while stopping the errors that
-- corrupt commission math. Same for modifier options: -2000..2000 covers
-- any real add-on/discount delta.
--
-- Standalone, additive, idempotent. NOT VALID then VALIDATE (house pattern,
-- no full-table rewrite lock). Rollback: drop the two constraints.

alter table public.menu_items
  drop constraint if exists menu_items_price_bounds_chk;
alter table public.menu_items
  add constraint menu_items_price_bounds_chk
    check (price_egp between 1 and 10000) not valid;
alter table public.menu_items
  validate constraint menu_items_price_bounds_chk;

comment on constraint menu_items_price_bounds_chk on public.menu_items is
  'Plausibility rails, not pricing policy (mig 132): price_egp feeds order subtotals and therefore commission + settlement. Binds every writer, since MenuManager writes the table directly and RLS cannot restrict columns.';

alter table public.modifier_options
  drop constraint if exists modifier_options_delta_bounds_chk;
alter table public.modifier_options
  add constraint modifier_options_delta_bounds_chk
    check (price_delta_egp between -2000 and 2000) not valid;
alter table public.modifier_options
  validate constraint modifier_options_delta_bounds_chk;

comment on constraint modifier_options_delta_bounds_chk on public.modifier_options is
  'Plausibility rails for modifier price deltas (mig 132). Same rationale as menu_items_price_bounds_chk.';
