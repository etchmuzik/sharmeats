-- 115_ops_alert_provider_agnostic.sql
--
-- Final-audit follow-up (2026-07-16): the ops alerting pipeline is fully wired
-- (dispatch_watchdog runs every 2 min → ops_alert → net.http_post to
-- platform_settings.ops_alert_webhook_url), but the webhook URL is empty in prod
-- so every alert has been silently dropped. The owner is now creating the webhook.
--
-- Problem this migration fixes ahead of that: ops_alert POSTs `{"text": p_text}`,
-- which ONLY Slack (and Slack-compatible endpoints like Mattermost) accept. A
-- Discord webhook expects `{"content": ...}` and would 400 the `text`-only body —
-- so if the owner pasted a Discord URL, alerts would fail silently forever (the
-- exact class of failure the audit flagged). Send BOTH keys: Slack reads `text`
-- and ignores `content`, Discord reads `content` and ignores `text`, and a generic
-- endpoint reading `text` still works. Now whatever webhook URL the owner sets works.
--
-- (Telegram is intentionally not covered — its bot API needs chat_id, not a plain
--  incoming webhook. Use a Slack or Discord incoming webhook.)
--
-- Body reproduced from the current prod def (house rule); only the `body` arg
-- changes. Signature unchanged (ops_alert(text) → void); grants preserved
-- (postgres + service_role only — never anon/authenticated).

create or replace function public.ops_alert(p_text text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_url text;
begin
  select value #>> '{}' into v_url
    from public.platform_settings where key = 'ops_alert_webhook_url';
  if v_url is null or v_url = '' then
    return;
  end if;
  perform net.http_post(
    url     := v_url,
    -- dual-key: 'text' for Slack/generic, 'content' for Discord — receiver reads
    -- its own key and ignores the other, so one URL setting works for either.
    body    := jsonb_build_object('text', p_text, 'content', p_text),
    headers := jsonb_build_object('Content-Type', 'application/json')
  );
exception when others then
  raise warning 'ops_alert failed: % (%)', sqlerrm, sqlstate;
end;
$function$;
