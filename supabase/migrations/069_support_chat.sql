-- 069_support_chat.sql
-- Live support chat: a direct thread between any user (customer, driver, or
-- restaurant staff) and the Sharm Eats support/ops team — no order required.
-- Complements per-order chat (067). This is the "talk to a human" channel that
-- replaces the WhatsApp-only support link with an on-platform, logged thread.
--
-- MODEL
-- One thread per user (the user IS the thread). support_messages rows carry
-- from_support (false = the user wrote it, true = an admin/ops agent wrote it).
-- A user sees only their own thread; admins see all threads. Realtime-published
-- so both sides get live delivery. Admins reply from admin-web.
--
-- Non-destructive: new table + RPCs + policies + realtime. Idempotent.

create table if not exists public.support_messages (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,  -- whose thread this is
  from_support boolean not null default false,                                -- true = written by an ops agent
  author_id    uuid references public.users(id),                              -- who actually wrote it (the agent, when from_support)
  body         text not null check (length(btrim(body)) between 1 and 2000),
  created_at   timestamptz not null default now(),
  read_at      timestamptz
);
create index if not exists support_messages_user_idx on public.support_messages (user_id, created_at);
create index if not exists support_messages_unread_idx on public.support_messages (user_id) where read_at is null;

comment on table public.support_messages is
  'Live support chat, one thread per user. from_support distinguishes user vs ops-agent messages. Users see only their own thread; admins see all. Realtime-published.';

alter table public.support_messages enable row level security;

-- Users read their own thread; admins read all.
create policy support_messages_select on public.support_messages
  for select using (user_id = auth.uid() or public.auth_role() = 'admin');
-- Users update (mark read) their own thread; admins any.
create policy support_messages_update on public.support_messages
  for update using (user_id = auth.uid() or public.auth_role() = 'admin')
  with check (user_id = auth.uid() or public.auth_role() = 'admin');
-- No direct client INSERT policy: all sends go through the RPCs below (which
-- correctly set from_support/author_id), so a user can never forge a support reply.

-- ============================================================================
-- send_support_message — the USER writes to their own support thread.
-- ============================================================================
create or replace function public.send_support_message(p_body text)
returns public.support_messages
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare v_user uuid := auth.uid(); v_msg public.support_messages;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;
  if p_body is null or length(btrim(p_body)) = 0 then raise exception 'EMPTY_MESSAGE' using errcode = 'check_violation'; end if;
  insert into public.support_messages (user_id, from_support, author_id, body)
  values (v_user, false, v_user, btrim(p_body))
  returning * into v_msg;
  return v_msg;
end;
$$;
grant execute on function public.send_support_message(text) to authenticated;

comment on function public.send_support_message is
  'The caller posts a message to their own support thread (from_support=false).';

-- ============================================================================
-- reply_support_message — an ADMIN/ops agent replies into a user's thread.
-- ============================================================================
create or replace function public.reply_support_message(p_user_id uuid, p_body text)
returns public.support_messages
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare v_agent uuid := auth.uid(); v_msg public.support_messages;
begin
  if public.auth_role() <> 'admin' then raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation'; end if;
  if p_body is null or length(btrim(p_body)) = 0 then raise exception 'EMPTY_MESSAGE' using errcode = 'check_violation'; end if;
  insert into public.support_messages (user_id, from_support, author_id, body)
  values (p_user_id, true, v_agent, btrim(p_body))
  returning * into v_msg;
  return v_msg;
end;
$$;
grant execute on function public.reply_support_message(uuid, text) to authenticated;

comment on function public.reply_support_message is
  'An admin/ops agent posts a reply into a user''s support thread (from_support=true, author_id=agent). Admin-only.';

-- ============================================================================
-- mark_support_thread_read — clear the caller's unread badge on their thread.
-- (Marks inbound = from_support messages as read for a user; for an admin the
-- p_user_id targets a specific user's thread and marks the user's messages read.)
-- ============================================================================
create or replace function public.mark_support_thread_read(p_user_id uuid default null)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;
  if public.auth_role() = 'admin' and p_user_id is not null then
    -- Agent viewing a user's thread: mark the user's inbound messages read.
    update public.support_messages set read_at = now()
     where user_id = p_user_id and from_support = false and read_at is null;
  else
    -- User viewing their own thread: mark support's inbound messages read.
    update public.support_messages set read_at = now()
     where user_id = v_user and from_support = true and read_at is null;
  end if;
end;
$$;
grant execute on function public.mark_support_thread_read(uuid) to authenticated;

-- ============================================================================
-- my_support_unread_count — unread support replies for the badge.
-- ============================================================================
create or replace function public.my_support_unread_count()
returns int
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select count(*)::int from public.support_messages
   where user_id = auth.uid() and from_support = true and read_at is null;
$$;
grant execute on function public.my_support_unread_count() to authenticated;

-- Realtime for live delivery on both sides.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'support_messages'
  ) then
    alter publication supabase_realtime add table public.support_messages;
  end if;
end $$;
alter table public.support_messages replica identity full;
