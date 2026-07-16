-- 116_ops_alert_telegram.sql
--
-- Owner wants Telegram (not Slack/Discord) for ops alerts. Telegram is NOT a plain
-- incoming webhook: it's the Bot API, where sendMessage needs BOTH a bot token
-- (in the URL: https://api.telegram.org/bot<TOKEN>/sendMessage) AND a chat_id, and
-- the JSON body must be {"chat_id": ..., "text": ...} — neither the Slack (`text`)
-- nor Discord (`content`) shape from mig 115 works.
--
-- Make ops_alert provider-aware:
--   * api.telegram.org URL -> body {"chat_id": <ops_alert_telegram_chat_id>, "text"}
--   * anything else        -> dual-key {"text","content"} (Slack / Discord / generic)
-- Telegram needs a second setting (chat_id) since the token alone can't say WHERE
-- to send; seed an empty ops_alert_telegram_chat_id row for the owner to fill.
--
-- Body reproduced from the current prod def (house rule); signature (ops_alert(text)
-- -> void) and internal-only grants (postgres + service_role) unchanged.

insert into public.platform_settings (key, value)
values ('ops_alert_telegram_chat_id', to_jsonb(''::text))
on conflict (key) do nothing;

create or replace function public.ops_alert(p_text text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_url  text;
  v_chat text;
  v_body jsonb;
begin
  select value #>> '{}' into v_url
    from public.platform_settings where key = 'ops_alert_webhook_url';
  if v_url is null or v_url = '' then
    return;
  end if;

  if position('api.telegram.org' in v_url) > 0 then
    -- Telegram Bot API: sendMessage requires chat_id + text in the body.
    select value #>> '{}' into v_chat
      from public.platform_settings where key = 'ops_alert_telegram_chat_id';
    if v_chat is null or v_chat = '' then
      raise warning 'ops_alert: telegram URL set but ops_alert_telegram_chat_id is empty';
      return;
    end if;
    -- chat_id sent as text; Telegram accepts a numeric id or an @channel string.
    v_body := jsonb_build_object('chat_id', v_chat, 'text', p_text);
  else
    -- Slack ('text') / Discord ('content') / generic — send both; each receiver
    -- reads its own key and ignores the other.
    v_body := jsonb_build_object('text', p_text, 'content', p_text);
  end if;

  perform net.http_post(
    url     := v_url,
    body    := v_body,
    headers := jsonb_build_object('Content-Type', 'application/json')
  );
exception when others then
  raise warning 'ops_alert failed: % (%)', sqlerrm, sqlstate;
end;
$function$;
