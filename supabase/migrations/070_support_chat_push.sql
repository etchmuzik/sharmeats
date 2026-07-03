-- 070_support_chat_push.sql
-- Push notifications for support chat (069), both directions:
--   * user -> support: notify the ops team (all admins) of a new support message
--   * support -> user: notify the user of an agent's reply
-- Mirrors notify_order_message (068). Best-effort, fail-open. Companion
-- edge-function copy keys: support_new_message (to ops), support_reply (to user).
--
-- Non-destructive: one trigger function + binding.

create or replace function public.notify_support_message()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_base       text;
  v_secret     text;
  v_headers    jsonb;
  v_recipients jsonb;
  v_event      text;
begin
  select value #>> '{}' into v_base
    from public.platform_settings where key = 'functions_base_url';
  if v_base is null or v_base = '' then return new; end if;

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

  if new.from_support then
    -- Agent replied -> notify the user whose thread this is.
    v_event := 'support_reply';
    v_recipients := jsonb_build_array(new.user_id::text);
  else
    -- User wrote in -> notify the ops team (all admins).
    v_event := 'support_new_message';
    select coalesce(jsonb_agg(u.id::text), '[]'::jsonb)
      into v_recipients
      from public.users u where u.role = 'admin';
  end if;

  if v_recipients is null or v_recipients = '[]'::jsonb then
    return new;
  end if;

  perform net.http_post(
    url     := v_base || '/expo-push',
    -- Support chat isn't tied to an order; pass the thread's user_id as orderId
    -- is not applicable, so send a synthetic id the client can ignore. expo-push
    -- requires orderId, so we pass the user_id to satisfy it (clients route on event).
    body    := jsonb_build_object(
                 'event', v_event,
                 'orderId', new.user_id::text,
                 'recipientUserIds', v_recipients
               ),
    headers := v_headers
  );
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function public.notify_support_message() from public, anon, authenticated;

drop trigger if exists support_messages_push on public.support_messages;
create trigger support_messages_push
  after insert on public.support_messages
  for each row execute function public.notify_support_message();

comment on function public.notify_support_message is
  'AFTER INSERT on support_messages: pushes support_reply to the user (agent wrote) or support_new_message to all admins (user wrote). Best-effort; never blocks.';
