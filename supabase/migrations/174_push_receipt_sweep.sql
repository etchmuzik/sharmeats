-- 174_push_receipt_sweep.sql
--
-- Package 03 Slice E — cron entry point for the receipt poller.
--
-- ================= WHY A SQL WRAPPER AND NOT A DIRECT CRON HTTP CALL =================
-- Every existing pg_cron job on this database calls a `public.*_sweep()` SQL
-- function, never net.http_post directly. Matching that convention is not just
-- tidiness: the internal secret lives in the vault, and `public.push_headers()`
-- (a STABLE SECURITY DEFINER function) is the one place that reads it. Putting the
-- URL and headers in a cron command string instead would either duplicate that
-- secret-reading logic or, worse, embed the secret in `cron.job.command` where it
-- is readable by anyone who can select from that table.
--
-- ================= FIRE AND FORGET, DELIBERATELY =================
-- net.http_post is asynchronous: it queues the request and returns an id. This
-- function therefore does NOT know whether the poller succeeded, and that is
-- correct — the poller is itself idempotent (an attempt it fails to settle is
-- simply picked up on the next run), so there is nothing useful to do with a
-- failure here. The sweep's own success only means "the request was queued".
--
-- The returned request id is passed back so an operator can correlate a run with
-- net._http_response if they need to debug a specific invocation.

create or replace function public.push_receipt_sweep()
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_base text;
  v_req  bigint;
begin
  select value #>> '{}' into v_base
    from public.platform_settings where key = 'functions_base_url';
  -- No configured base URL means this environment has no edge functions. Returning
  -- quietly rather than raising keeps the cron history clean in local/staging
  -- databases where the poller does not exist.
  if v_base is null or v_base = '' then
    return null;
  end if;

  select net.http_post(
    url     := v_base || '/expo-push-receipts',
    body    := '{}'::jsonb,
    headers := public.push_headers()
  ) into v_req;

  return v_req;
exception when others then
  -- A failed enqueue must not make the cron job look broken: the poller is
  -- idempotent, so the next run picks up whatever this one missed.
  raise warning 'push_receipt_sweep failed: % (%)', sqlerrm, sqlstate;
  return null;
end;
$function$;

revoke all on function public.push_receipt_sweep() from public, anon, authenticated;

comment on function public.push_receipt_sweep() is
  'Package 03 Slice E. Cron entry point that invokes the expo-push-receipts edge function, reusing public.push_headers() so the vault-held internal secret is read in exactly one place and never embedded in cron.job.command (where it would be readable by anyone who can select that table). Fire-and-forget: net.http_post is asynchronous and the poller is idempotent, so a failed run is simply retried by the next one. Returns the net request id for correlating against net._http_response. Not executable by anon or authenticated — cron runs it as the job owner. Mig 174.';
