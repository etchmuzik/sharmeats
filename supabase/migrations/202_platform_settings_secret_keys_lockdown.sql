-- 202_platform_settings_secret_keys_lockdown.sql
--
-- Stop serving the Telegram bot token to anyone who asks.
--
-- FOUND 2026-07-31 during post-migration verification: platform_settings had
-- SELECT policy `using (true)` for {public} AND an anon SELECT grant, so
-- `/rest/v1/platform_settings?select=*` with the anon key — the key that ships
-- inside every app bundle by design — returned, among 70 rows of harmless
-- tunables, three that are not harmless:
--
--   ops_alert_webhook_url        a full Telegram BOT TOKEN in the URL
--   telegram_webhook_secret      authenticates Telegram -> telegram-bot fn
--   ops_alert_telegram_chat_id   where the ops alerts go
--
-- With the token an attacker owns the ops alert bot: send messages as it into
-- the ops chat, delete its webhook, or poll getUpdates and silently read what
-- the operator is told. With the secret they can forge telegram-bot webhook
-- calls. THE LOCKDOWN DOES NOT UN-LEAK THEM — both must be rotated (BotFather
-- for the token; re-set the webhook with a fresh secret_token). This migration
-- stops the endpoint re-serving whatever they are rotated to.
--
-- WHO ACTUALLY READS THIS TABLE (verified before writing, not assumed):
--   * admin-web dispatch board: dispatch_max_ping_age_seconds, as an
--     authenticated admin/dispatcher — a non-secret key, still readable below.
--   * telegram-bot edge function: reads the secret keys via service_role,
--     which bypasses RLS — unaffected.
--   * Watchdog/alert DB functions: SECURITY DEFINER, run as the table owner —
--     unaffected.
--   * Mobile apps: zero runtime reads; every reference is a comment mirroring
--     seeded values.
--   * anon: NOTHING legitimate. The grants were ALTER DEFAULT PRIVILEGES
--     residue (house rule 5b), not a decision. lifecycle_holdout_group had an
--     anon EXECUTE grant of the same provenance; no anon path calls it, and if
--     one ever does, a loud permission error beats a silent read.
--
-- Policy shape: a DENY-LIST of secret keys plus a `secret_` NAME PREFIX
-- convention, rather than staff-gating the whole table. The tunables
-- (radii, fees, thresholds) are product constants the apps already mirror in
-- code — hiding them buys nothing and breaks any future invoker-path read by a
-- signed-in customer. The prefix is the rot-guard: the next secret does not
-- depend on someone remembering to extend this list — name it secret_* and it
-- is born admin-only. Keys are non-null (primary key), so the non-secret
-- branch cannot NULL its way open; the admin branch fails closed on a missing
-- role exactly as house rule 4 demands.

-- 1. anon: out entirely. Verbs first (they were policy-gated but should not
--    exist), then the invoker-function grant of the same residue.
revoke all on table public.platform_settings from anon;
revoke execute on function public.lifecycle_holdout_group(uuid, text) from anon;

-- 2. The read policy. Same name so the diff is obvious to the next reader.
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
