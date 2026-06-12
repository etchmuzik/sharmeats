-- 021_favorites.sql
-- Customer favorites (saved restaurants).
--
-- One row per (user, restaurant). Owner-only RLS, same pattern as push_tokens.
-- Non-destructive: new table + RLS.

create table if not exists public.favorites (
  user_id       uuid not null references public.users(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (user_id, restaurant_id)
);

create index if not exists favorites_user_idx on public.favorites (user_id);

alter table public.favorites enable row level security;

create policy "favorites_owner_all"
  on public.favorites for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table public.favorites is
  'Saved restaurants per customer. Owner-only RLS; the app upserts/deletes directly.';
