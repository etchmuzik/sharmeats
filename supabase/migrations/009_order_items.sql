-- 009_order_items.sql
-- Real line items + append-only status audit + payment/fulfillment fields.
--
-- The existing schema stuffs line items into orders.items (JSONB) — fine for a
-- mock, wrong for a platform (no per-line queries, no proper modifier snapshot,
-- can't refund one line). We ADD a real order_items table that snapshots
-- captured price + selected modifiers at order time, so later menu edits never
-- rewrite history. orders.items JSONB STAYS as a compatibility shim; place_order
-- writes BOTH during transition, then the UI cuts over to order_items.
--
-- Also extends order_status_type (+picked_up, +rejected) and adds the
-- payment-method / payment-status / fulfillment-type / dropoff_geo columns the
-- hybrid + dual-payment model needs.
--
-- Non-destructive: enum ADD VALUE, new tables, new columns with safe defaults.

-- ============================================================================
-- Extend order_status_type to match the shared state machine
-- (placed→accepted→preparing→ready→picked_up→out_for_delivery→delivered,
--  + cancelled, + rejected)
-- ============================================================================
alter type order_status_type add value if not exists 'picked_up' after 'ready';
alter type order_status_type add value if not exists 'rejected'  after 'cancelled';

-- ============================================================================
-- ORDERS: payment + fulfillment + geo
-- ============================================================================
alter table public.orders
  add column if not exists payment_method   text not null default 'cash_on_delivery', -- 'card' | 'cash_on_delivery'
  add column if not exists payment_status   text not null default 'pending',          -- pending|paid|failed|refunded
  add column if not exists fulfillment_type text not null default 'platform',          -- 'platform' | 'self_delivery'
  add column if not exists dropoff_geo      geography(Point, 4326),
  add column if not exists zone             zone_type references public.zones(id),
  add column if not exists paymob_order_ref text,
  add column if not exists cancel_reason    text,
  add column if not exists ready_at         timestamptz,
  add column if not exists picked_up_at     timestamptz,
  add column if not exists accepted_at      timestamptz;

alter table public.orders
  add constraint orders_payment_method_chk
    check (payment_method in ('card','cash_on_delivery')) not valid;
alter table public.orders validate constraint orders_payment_method_chk;

alter table public.orders
  add constraint orders_payment_status_chk
    check (payment_status in ('pending','paid','failed','refunded')) not valid;
alter table public.orders validate constraint orders_payment_status_chk;

alter table public.orders
  add constraint orders_fulfillment_type_chk
    check (fulfillment_type in ('platform','self_delivery')) not valid;
alter table public.orders validate constraint orders_fulfillment_type_chk;

create index if not exists orders_payment_status_idx on public.orders (payment_status)
  where payment_status <> 'paid';
create index if not exists orders_dropoff_geo_gix on public.orders using gist (dropoff_geo);

-- ============================================================================
-- ORDER_ITEMS (real line items with snapshots)
-- ============================================================================
create table if not exists public.order_items (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null references public.orders(id) on delete cascade,
  catalog_item_id      uuid references public.menu_items(id) on delete restrict,
  name_snapshot        text not null,
  unit_price_snapshot  int not null check (unit_price_snapshot >= 0),   -- base price at order time (EGP)
  quantity             int not null check (quantity > 0),
  modifiers_snapshot   jsonb not null default '[]'::jsonb,              -- [{modifierName,optionName,priceDeltaEgp}]
  line_total           int not null check (line_total >= 0),            -- (unit_price + modifier deltas) * qty
  notes                text,
  created_at           timestamptz not null default now()
);

create index if not exists order_items_order_idx on public.order_items (order_id);

-- ============================================================================
-- ORDER_STATUS_EVENTS (append-only audit; drives the customer timeline)
-- ============================================================================
create table if not exists public.order_status_events (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  status      order_status_type not null,
  actor_role  app_role,
  actor_id    uuid references public.users(id) on delete set null,
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists order_status_events_order_idx on public.order_status_events (order_id, created_at);

alter table public.order_items         enable row level security;
alter table public.order_status_events enable row level security;

comment on table public.order_items is
  'Real per-line order rows with price + modifier SNAPSHOTS frozen at order time. orders.items JSONB stays as a compat shim until the UI fully cuts over.';
comment on table public.order_status_events is
  'Append-only status history. The only writer is advance_order_status (mig 011). Drives the customer tracking timeline and ops audit.';
comment on column public.orders.payment_method is
  '''card'' (Paymob hosted checkout) or ''cash_on_delivery'' (no gateway; flips to paid on delivery via mark_cod_collected).';
comment on column public.orders.payment_status is
  'card: webhook-driven pending->paid. COD: pending until delivery, then paid. Card orders are hidden from the merchant queue until paid.';
