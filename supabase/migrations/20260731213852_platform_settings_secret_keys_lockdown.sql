-- 20260731213852_platform_settings_secret_keys_lockdown.sql
--
-- BACK-FILL: this migration was applied to production 2026-07-31 21:38 UTC
-- (ledger version 20260731213852) but its file was never committed — the
-- 2026-07-31 audit flagged it as repo-vs-prod drift (§1b "New drift observed
-- during the apply"). This file is the ledger's recorded content, verbatim,
-- so the repo can reproduce production again. Do NOT re-apply to prod; the
-- ledger already has this version.
--
-- What it does:
-- platform_settings was world-readable incl. ops_alert_webhook_url (embeds the
-- Telegram bot token), telegram_webhook_secret, ops_alert_telegram_chat_id.
-- Deny-list those three + a secret_ prefix convention behind admin-only;
-- tunables stay readable to signed-in users; anon stripped entirely.
-- Rotation of the leaked token/secret is still required and is manual.

revoke all on table public.platform_settings from anon;
revoke execute on function public.lifecycle_holdout_group(uuid, text) from anon;

drop policy if exists platform_settings_read on public.platform_settings;
create policy platform_settings_read on public.platform_settings
  for select
  using (
    (
      key not in ('ops_alert_webhook_url', 'telegram_webhook_secret', 'ops_alert_telegram_chat_id')
      and key not like 'secret\_%'
    )
    or (select public.auth_role()) = 'admin'::app_role
  );

comment on table public.platform_settings is
  'Operational tunables, readable by signed-in users (apps mirror most of them in code anyway). EXCEPTIONS: ops_alert_webhook_url, telegram_webhook_secret, ops_alert_telegram_chat_id and any key named secret_* are admin-only via the platform_settings_read policy — the webhook URL embeds the Telegram bot token, which was publicly readable until 2026-07-31 (migration 202). Put future credentials under a secret_ prefix (or better, in edge function env vars), never in a plainly-named row. Writes are admin-only (policies from earlier migrations, unchanged here).';
