-- 014_push_tokens.sql
-- Expo push tokens for status notifications (customer + driver apps).
--
-- One row per (user, device token). The expo-push edge function reads this to
-- fan out order notifications. Users register their token on app launch.
--
-- Non-destructive: new table + RLS.

create table if not exists public.push_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  token       text not null,
  platform    text,                          -- 'ios' | 'android' | 'web'
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, token)
);

create index if not exists push_tokens_user_idx on public.push_tokens (user_id);

create trigger push_tokens_touch_updated_at before update on public.push_tokens
  for each row execute function public.touch_updated_at();

alter table public.push_tokens enable row level security;

-- Users manage their own tokens.
create policy "push_tokens_owner_all"
  on public.push_tokens for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table public.push_tokens is
  'Expo push tokens per user/device. expo-push edge function reads this (service-role) to deliver order status notifications.';
