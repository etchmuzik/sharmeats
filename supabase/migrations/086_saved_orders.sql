-- 086_saved_orders.sql
-- Customer-curated named order presets (IKEA Effect). Owner-only RLS.
-- Non-destructive: new table + RLS only.

create table if not exists public.saved_orders (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name          text not null,
  items         jsonb not null,   -- CartItem[] snapshot; same shape as orders.items
  created_at    timestamptz not null default now()
);

create index if not exists saved_orders_user_idx on public.saved_orders (user_id);

alter table public.saved_orders enable row level security;

create policy "saved_orders_owner_all"
  on public.saved_orders for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table public.saved_orders is
  'Named order presets per customer (IKEA Effect). Owner-only RLS; the app inserts/deletes directly.';
