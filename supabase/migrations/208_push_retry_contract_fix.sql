-- ============================================================================
-- 208 — Fix the push retry contract (confirmed reliability P1)
--
-- dispatch_push_retries (mig 202, the F-05 fix) POSTs {mode:'retry', attempts}
-- to /expo-push. The DEPLOYED expo-push (v17, byte-identical to the repo) never
-- reads `mode` or `attempts` — it requires body.event and returns 400
-- "event required" on the retry POST. So every retryable failure is CLAIMED
-- (attempt moved to processing, attempt_no incremented, cap consumed) and then
-- the re-send is silently dropped; ~10 min later claim_push_retries re-claims
-- the stale processing row and burns another attempt, until the cap strands it
-- in processing — never re-sent, never cleanly dead-lettered. F-05 did not
-- actually fix F-05: the "retry entry point" it calls was never built.
--
-- FIX (recon Option b1 — DB-only, no edge redeploy): re-drive the FRESH-send
-- path expo-push already implements, once per claimed attempt, scoped to the
-- single failed recipient, then settle the claimed attempt. expo-push resolves
-- the token, applies prefs, records its own attempt row and settles it — so the
-- retry genuinely re-sends. The claimed attempt is settled 'expo_accepted'
-- (it has been handed back to the send path); at attempt_no >= 5 the cap logic
-- inside settle_push_attempt still dead-letters it as before.
--
-- Trade-off (documented): the retry's re-send creates a NEW attempt row that
-- carries the real receipt; the original claimed attempt is closed
-- optimistically rather than tracked through Expo again. This is a best-effort
-- re-send — strictly better than today (which sends nothing) and it never
-- fans out to healthy tokens (single recipient per claim). A fuller fix (a real
-- mode:'retry' branch in expo-push with exact per-attempt receipts) is a larger
-- edge change deferred to a follow-up; it is not needed to stop the loss.
-- ============================================================================

create or replace function public.dispatch_push_retries(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_base    text;
  v_secret  text;
  v_headers jsonb;
  v_rec     record;
  v_sent    int := 0;
begin
  select value #>> '{}' into v_base
    from public.platform_settings where key = 'functions_base_url';
  if v_base is null or v_base = '' then return 0; end if;

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

  -- claim_push_retries is a WRITE (status -> processing, attempt_no + 1), so
  -- this is safe against overlapping runs. Re-drive one fresh, single-recipient
  -- send per claimed attempt to the endpoint expo-push actually speaks.
  for v_rec in select * from public.claim_push_retries(p_limit) loop
    -- No token or no recipient we can target: settle so it stops being reclaimed
    -- (attempt_no >= 5 dead-letters via settle_push_attempt's own cap logic).
    if v_rec.recipient_user_id is null then
      perform public.settle_push_attempt(
        v_rec.attempt_id, 'retryable_failed', null, 'NO_RECIPIENT',
        'retry runner: claimed attempt has no recipient to target');
      continue;
    end if;

    perform net.http_post(
      url     := v_base || '/expo-push',
      body    := jsonb_strip_nulls(jsonb_build_object(
                   'event',            v_rec.event,
                   'orderId',          v_rec.order_id::text,
                   'recipientUserIds', to_jsonb(array[v_rec.recipient_user_id]),
                   'route',            v_rec.route,
                   'vertical',         v_rec.vertical,
                   'title',            v_rec.custom_title,
                   'body',             v_rec.custom_body)),
      headers := v_headers
    );

    -- The claimed attempt has been handed back to the fresh-send path (which
    -- records and settles its OWN attempt row). Close this one so it is not
    -- reclaimed; the cap logic in settle_push_attempt still applies.
    perform public.settle_push_attempt(
      v_rec.attempt_id, 'expo_accepted', null, null,
      'retry runner: re-driven through the fresh-send path');
    v_sent := v_sent + 1;
  end loop;

  return v_sent;
exception when others then
  return v_sent;
end;
$function$;

comment on function public.dispatch_push_retries(integer) is
  'Re-sends retryable push failures by re-driving the fresh-send path per claimed attempt (one single-recipient POST to /expo-push, then settle the claim). Mig 208 fixed the mig-202 contract bug where it POSTed {mode:retry} that the deployed expo-push 400s on, so retries were claimed, cap-burned, and never sent. Cron sharmeats-push-retry-dispatch every 2 min.';

revoke all on function public.dispatch_push_retries(integer) from public, anon, authenticated;
grant execute on function public.dispatch_push_retries(integer) to service_role;

-- Single overload (house rule 1).
do $$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='dispatch_push_retries') <> 1 then
    raise exception '[208] dispatch_push_retries has more than one overload';
  end if;
  -- The old broken contract must be gone.
  if position('mode'', ''retry' in
       (select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='dispatch_push_retries')) > 0 then
    raise exception '[208] dispatch_push_retries still POSTs the dead mode:retry contract';
  end if;
end $$;
