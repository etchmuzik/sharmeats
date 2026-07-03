-- 067_order_messaging.sql
-- In-app messaging: real chat threads scoped to an order, so the three parties
-- on any order (customer, assigned driver, restaurant staff) can talk without
-- leaving the app or needing a phone/WhatsApp/SIM. (2026-07-03 — closes the
-- "no way for clients to message the driver/restaurant" gap.)
--
-- MODEL
-- One thread per order (the order IS the thread — no separate threads table).
-- Each message names its sender_role so the UI can style/attribute it. Access
-- is authorized by can_access_order_thread(order_id): true iff the caller is the
-- order's customer, its currently-assigned driver, or staff of its restaurant
-- (admins always allowed). RLS uses that helper for both read and insert, so a
-- user can only ever see/send on threads for orders they are a party to.
--
-- Realtime: order_messages is added to supabase_realtime so each app can
-- subscribe to postgres_changes filtered by order_id and render new messages
-- live. Push notifications for new messages are sent by the expo-push function
-- (wired separately); this migration is the data + access layer.
--
-- Non-destructive: new table + helper + policies + realtime entry. Idempotent.

-- ============================================================================
-- can_access_order_thread — the single authorization predicate for a thread.
-- SECURITY DEFINER so it can read drivers/merchant_staff regardless of the
-- caller's own RLS. Returns true for the order's customer, assigned driver,
-- restaurant staff, or an admin.
-- ============================================================================
create or replace function public.can_access_order_thread(p_order_id uuid)
returns boolean
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.orders o
    where o.id = p_order_id
      and (
        o.user_id = auth.uid()                                             -- the customer
        or exists (                                                        -- the assigned driver
          select 1 from public.drivers d
          where d.id = o.assigned_driver_id and d.profile_id = auth.uid()
        )
        or public.is_merchant_staff(o.restaurant_id)                       -- the restaurant
        or public.auth_role() = 'admin'                                    -- ops
      )
  );
$$;
revoke all on function public.can_access_order_thread(uuid) from public, anon;
grant execute on function public.can_access_order_thread(uuid) to authenticated;

comment on function public.can_access_order_thread is
  'True iff the caller is a party to the order (customer, assigned driver, restaurant staff) or an admin. The single authorization predicate for order_messages RLS.';

-- ============================================================================
-- order_messages — the chat. One row per message on an order thread.
-- ============================================================================
create table if not exists public.order_messages (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders(id) on delete cascade,
  sender_id    uuid not null references public.users(id),
  sender_role  app_role not null,             -- customer | driver | merchant_staff | admin (for attribution/styling)
  body         text not null check (length(btrim(body)) between 1 and 2000),
  created_at   timestamptz not null default now(),
  read_at      timestamptz                    -- set by the recipient side; drives unread badges
);
create index if not exists order_messages_order_idx on public.order_messages (order_id, created_at);
create index if not exists order_messages_unread_idx on public.order_messages (order_id) where read_at is null;

comment on table public.order_messages is
  'In-app chat scoped to an order. Any of the order''s three parties (customer, assigned driver, restaurant staff) plus admins can read/write, gated by can_access_order_thread. Realtime-published for live delivery.';

alter table public.order_messages enable row level security;

-- Read: any party to the order.
create policy order_messages_select on public.order_messages
  for select using (public.can_access_order_thread(order_id));

-- Insert: any party to the order, and only as themselves (sender_id = auth.uid()).
-- sender_role is validated to match the caller's actual relationship so nobody
-- can impersonate another role in the thread.
create policy order_messages_insert on public.order_messages
  for insert with check (
    sender_id = auth.uid()
    and public.can_access_order_thread(order_id)
  );

-- Update: only to mark messages read (read_at). A party may mark messages on
-- their thread as read; they cannot edit body (enforced by the app + this being
-- the only column they'd change; body edits are not exposed via any RPC).
create policy order_messages_update on public.order_messages
  for update using (public.can_access_order_thread(order_id))
  with check (public.can_access_order_thread(order_id));

-- ============================================================================
-- send_order_message — convenience RPC that stamps sender_role from the
-- caller's real relationship to the order (so the client can't spoof it).
-- ============================================================================
create or replace function public.send_order_message(p_order_id uuid, p_body text)
returns public.order_messages
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_order public.orders;
  v_role app_role;
  v_msg public.order_messages;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;
  if p_body is null or length(btrim(p_body)) = 0 then raise exception 'EMPTY_MESSAGE' using errcode = 'check_violation'; end if;
  if not public.can_access_order_thread(p_order_id) then raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation'; end if;

  select * into v_order from public.orders where id = p_order_id;

  -- Derive the sender's role from their actual relationship to THIS order.
  if v_order.user_id = v_user then
    v_role := 'customer';
  elsif exists (select 1 from public.drivers d where d.id = v_order.assigned_driver_id and d.profile_id = v_user) then
    v_role := 'driver';
  elsif public.is_merchant_staff(v_order.restaurant_id) then
    v_role := 'merchant_staff';
  else
    v_role := 'admin';
  end if;

  insert into public.order_messages (order_id, sender_id, sender_role, body)
  values (p_order_id, v_user, v_role, btrim(p_body))
  returning * into v_msg;

  return v_msg;
end;
$$;
grant execute on function public.send_order_message(uuid, text) to authenticated;

comment on function public.send_order_message is
  'Sends a message on an order thread, stamping sender_role from the caller''s real relationship to the order (customer/driver/merchant_staff/admin). Authorizes via can_access_order_thread.';

-- ============================================================================
-- mark_order_thread_read — stamp read_at on the caller's inbound messages so
-- unread badges clear. A party marks all messages they did NOT send as read.
-- ============================================================================
create or replace function public.mark_order_thread_read(p_order_id uuid)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;
  if not public.can_access_order_thread(p_order_id) then raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation'; end if;
  update public.order_messages
     set read_at = now()
   where order_id = p_order_id and sender_id <> v_user and read_at is null;
end;
$$;
grant execute on function public.mark_order_thread_read(uuid) to authenticated;

comment on function public.mark_order_thread_read is
  'Marks all inbound (not-sent-by-caller) messages on an order thread as read. Used to clear unread badges.';

-- ============================================================================
-- my_unread_message_count — total unread inbound messages across the caller's
-- active order threads, for a global chat badge.
-- ============================================================================
create or replace function public.my_unread_message_count()
returns int
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select count(*)::int
  from public.order_messages m
  where m.read_at is null
    and m.sender_id <> auth.uid()
    and public.can_access_order_thread(m.order_id);
$$;
grant execute on function public.my_unread_message_count() to authenticated;

-- ============================================================================
-- Realtime: broadcast INSERTs so each app renders new messages live.
-- ============================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'order_messages'
  ) then
    alter publication supabase_realtime add table public.order_messages;
  end if;
end $$;
alter table public.order_messages replica identity full;
