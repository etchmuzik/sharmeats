-- 004_scheduled_orders.sql
-- Adds the scheduled-for timestamp on orders.
--
-- Drives the customer-app "schedule for later" flow (Checkout → Timing →
-- 30-minute slots). When null, the order is ASAP. When set, the order
-- countdown is hidden and tracking shows "Scheduled for {time}".

alter table public.orders
  add column scheduled_for timestamptz;

comment on column public.orders.scheduled_for is
  'When the customer asked the kitchen to start. NULL = ASAP. Set = preferred handoff time; tracking suppresses the live ETA countdown in favor of this.';

create index orders_scheduled_for_idx on public.orders (scheduled_for)
  where scheduled_for is not null;
