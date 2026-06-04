-- 001_waitlist.sql
-- Waitlist signups from the landing page.
-- Anon clients NEVER write here directly; inserts go through the Next.js API route
-- using the service role key, after Zod validation.

create extension if not exists "pgcrypto";

create table if not exists public.waitlist (
  id            uuid        primary key default gen_random_uuid(),
  email         text        not null,
  whatsapp      text        null,
  locale        text        not null check (locale in ('en','ar','ru','it','de')),
  source        text        not null default 'landing',
  referrer      text        null,
  ip            inet        null,
  user_agent    text        null,
  created_at    timestamptz not null default now(),
  constraint waitlist_email_lower check (email = lower(email)),
  constraint waitlist_email_unique unique (email)
);

create index if not exists waitlist_created_at_idx on public.waitlist (created_at desc);
create index if not exists waitlist_locale_idx on public.waitlist (locale);

-- Lock the table down. Service role bypasses RLS, so the API route still works.
alter table public.waitlist enable row level security;

-- No anon select / insert / update / delete. Intentionally no policies.
-- Only the service role key (used from the Next.js server) can touch this table.

comment on table public.waitlist is
  'Landing page waitlist signups. Writes via Next.js /api/waitlist using service role key only.';
