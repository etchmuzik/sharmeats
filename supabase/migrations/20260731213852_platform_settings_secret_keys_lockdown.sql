-- ============================================================================
-- TRANSCRIPT OF AN ALREADY-APPLIED MIGRATION — DO NOT RE-APPLY TO PRODUCTION.
--
--   prod ledger version : 20260731213852
--   prod ledger name    : platform_settings_secret_keys_lockdown
--   applied to prod     : 2026-07-31 (directly, with no file in this repo)
--   reconstructed       : 2026-08-01, from
--                         supabase_migrations.schema_migrations.statements
--
-- WHY THIS FILE EXISTS. On 2026-07-31 eleven migrations were applied straight to
-- production and never committed. The repo therefore no longer described the
-- database. This file is a byte-exact copy of what production recorded, written
-- back so that (a) the repo describes production again, and (b) a fresh database
-- rebuilt by replaying supabase/migrations/ ends up in the same state.
--
-- WHAT IT IS NOT. It is not a change. Production ALREADY has everything below.
-- Do not point this at production, do not "re-run it to be sure", and do not
-- edit it to fix a defect — a later, higher-numbered migration does that. Editing
-- a transcript makes the repo lie about production a second time.
--
-- The body below this marker is reproduced verbatim, including its own original
-- header comments (which refer to a "202" file that was never committed) and its
-- own numbering claims. Those are left untouched on purpose: this records what
-- ran, not what we wish had run. Verified byte-for-byte against the prod ledger
-- (md5 c71da9a2f8d9cd0dcead4ffa83a6b09e, 1597 bytes).
-- ============================================================================
-- ===== BEGIN TRANSCRIPT =====
-- 202_platform_settings_secret_keys_lockdown.sql
-- (full commentary in the repo file; short form here)
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
