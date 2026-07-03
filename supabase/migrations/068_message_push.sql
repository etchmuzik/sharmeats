-- 068_message_push.sql
-- Push a notification when a new order message arrives, so the recipient sees
-- it even with the app backgrounded/closed. Companion to 067 (in-app chat).
--
-- MODEL (mirrors notify_order_status_event, mig 040): AFTER INSERT on
-- order_messages, resolve the OTHER parties on the order (everyone but the
-- sender — the customer, the assigned driver's profile, and the restaurant's
-- staff) and POST a `new_message` event to expo-push with those recipient user
-- ids. push_tokens are keyed by auth user id, which for drivers is
-- drivers.profile_id and for staff is merchant_staff.profile_id.
--
-- Companion edge-function change: expo-push COPY gets a `new_message` entry.
-- Best-effort and fail-open: a push failure never blocks sending the message.
-- Non-destructive: one new trigger function + its binding.

create or replace function public.notify_order_message()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_base       text;
  v_secret     text;
  v_headers    jsonb;
  v_order      public.orders;
  v_recipients jsonb;
begin
  select value #>> '{}' into v_base
    from public.platform_settings where key = 'functions_base_url';
  if v_base is null or v_base = '' then return new; end if;

  -- Internal secret from Vault; fail open (no header) if absent — same as 035/040.
  begin
    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'push_internal_secret';
  exception when others then
    v_secret := null;
  end;
  v_headers := '{"Content-Type": "application/json"}'::jsonb;
  if v_secret is not null and v_secret <> '' then
    v_headers := v_headers || jsonb_build_object('x-internal-secret', v_secret);
  end if;

  select * into v_order from public.orders where id = new.order_id;
  if not found then return new; end if;

  -- Recipients = every party on the order EXCEPT the sender:
  --   the customer (orders.user_id),
  --   the assigned driver's profile (drivers.profile_id),
  --   all staff of the restaurant (merchant_staff.profile_id).
  with parties as (
    select v_order.user_id as uid
    union
    select d.profile_id from public.drivers d where d.id = v_order.assigned_driver_id
    union
    select ms.profile_id from public.merchant_staff ms where ms.restaurant_id = v_order.restaurant_id
  )
  select coalesce(jsonb_agg(distinct uid::text), '[]'::jsonb)
    into v_recipients
    from parties
   where uid is not null and uid <> new.sender_id;

  if v_recipients is null or v_recipients = '[]'::jsonb then
    return new;  -- nobody else to notify
  end if;

  perform net.http_post(
    url     := v_base || '/expo-push',
    body    := jsonb_build_object(
                 'event', 'new_message',
                 'orderId', new.order_id::text,
                 'recipientUserIds', v_recipients
               ),
    headers := v_headers
  );
  return new;
exception when others then
  return new;  -- best-effort; never block sending a message
end;
$$;
revoke all on function public.notify_order_message() from public, anon, authenticated;

drop trigger if exists order_messages_push on public.order_messages;
create trigger order_messages_push
  after insert on public.order_messages
  for each row execute function public.notify_order_message();

comment on function public.notify_order_message is
  'AFTER INSERT on order_messages: pushes a new_message event via pg_net -> expo-push to every party on the order except the sender (customer, assigned driver, restaurant staff). Best-effort; never blocks the message insert.';
