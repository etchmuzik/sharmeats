-- 144_admin_test_ops_alert.sql
--
-- Package 01 §5 — deliberate monitoring exercise.
--
-- THE PROBLEM: the Telegram alert path is fully wired (mig 115/116, and both
-- ops_alert_webhook_url and ops_alert_telegram_chat_id ARE populated in
-- production), but it has only ever been exercised by real incidents. Nobody
-- has deliberately fired an alert and confirmed a human received it. An alert
-- channel that has never been tested on purpose is indistinguishable from a
-- broken one until the night it matters.
--
-- The obvious way to test it -- calling ops_alert() directly -- is correctly
-- impossible from a client: ops_alert is SECURITY DEFINER and granted only to
-- postgres/service_role, with no `authenticated` grant. That is right and is
-- not being changed here. This migration adds a narrow, admin-only, read-only
-- doorway instead.
--
-- WHAT THIS FUNCTION WILL NOT DO
--   * it takes no free text -- the operator cannot use it to send arbitrary
--     content through the ops channel, so it is not a message-injection tool
--     for a compromised admin session;
--   * it writes NOTHING. No order, no ledger, no settings, no alert history.
--     Its only effect is one outbound webhook POST;
--   * it is rate-limited to one call per minute across the whole platform, so
--     a stuck client or a bored admin cannot flood the operator's phone (and
--     get the bot rate-limited by Telegram, which would suppress REAL alerts).
--
-- WHY THE [TEST] PREFIX IS NOT COSMETIC
-- Incident metrics and the on-call runbook both key off ops alerts. A test
-- alert that looks like a real one corrupts the incident record. The prefix is
-- prepended server-side and cannot be overridden by the caller.

create or replace function public.admin_test_ops_alert()
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_last timestamptz;
  v_msg  text;
  v_env  text;
begin
  -- House rule 4: both checks fail CLOSED. auth_role() returning NULL for a
  -- caller with no row must not evaluate to "not admin is false".
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;
  if coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;

  -- Platform-wide cooldown. Mirrors mig 119's watchdog cooldown rationale:
  -- on 2026-07-18 an uncooled alerter sent 21 messages in an hour and the
  -- operator started ignoring the channel. A test tool must not be able to
  -- recreate that.
  select (value #>> '{}')::timestamptz into v_last
    from public.platform_settings where key = 'ops_test_alert_last_at';

  if v_last is not null and v_last > now() - interval '1 minute' then
    raise exception 'RATE_LIMITED' using errcode = 'check_violation';
  end if;

  -- Name the environment so a test fired from a scratch/staging database is
  -- never mistaken for one fired at production. There is no `environment` key
  -- today, so this SELECT finds no row and leaves v_env NULL -- a coalesce
  -- INSIDE the select would not help, because it never executes. Hence the
  -- coalesce at the point of use below.
  select value #>> '{}' into v_env
    from public.platform_settings where key = 'environment';

  v_msg := '[TEST] Sharm Eats ops alert — deliberate monitoring check. '
        || 'env=' || coalesce(v_env, 'unknown')
        || ' at=' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
        || ' db=' || current_database()
        || E'\nNo action required. Acknowledge per docs/OPS-RUNBOOK.md.';

  -- Definer-to-definer: runs as owner, so ops_alert's revoked client ACL does
  -- not apply. ops_alert already swallows its own transport errors, so a dead
  -- webhook cannot make this raise.
  perform public.ops_alert(v_msg);

  insert into public.platform_settings (key, value)
  values ('ops_test_alert_last_at', to_jsonb(now()))
  on conflict (key) do update set value = excluded.value;

  return v_msg;
end;
$function$;

-- Granting to `authenticated` does NOT revoke the default PUBLIC/anon EXECUTE
-- that ALTER DEFAULT PRIVILEGES hands out on this database. Revoke first, then
-- grant narrowly. (The trap behind the 2026-07-03 CRITICAL anon exploit.)
revoke all on function public.admin_test_ops_alert() from public, anon;
grant execute on function public.admin_test_ops_alert() to authenticated;

comment on function public.admin_test_ops_alert() is
  'Package 01 §5. Fires ONE [TEST]-prefixed ops alert so an operator can prove the Telegram path works without waiting for a real incident. Admin-only (fails closed), takes no caller text, writes no order/finance state, and is rate-limited to one call per minute platform-wide so it cannot flood the channel and get the bot throttled. The [TEST] prefix is server-side: exclude these from incident metrics. Mig 144.';
