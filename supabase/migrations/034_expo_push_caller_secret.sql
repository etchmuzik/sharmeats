-- 034_expo_push_caller_secret.sql
-- Pass the internal shared secret from the SQL push trigger to expo-push (M4).
--
-- THE PROBLEM (audit M4)
-- expo-push is deployed --no-verify-jwt, so any caller who knows the URL could
-- trigger push fan-out. The edge function now (this PR) checks an
-- `x-internal-secret` header against PUSH_INTERNAL_SECRET. The DB trigger that
-- calls it must send that header too, without committing the secret to git.
--
-- THE FIX
-- Read the secret from a database setting `app.push_secret` (set out-of-band by
-- an operator: `ALTER DATABASE postgres SET app.push_secret = '<random>'`; it is
-- NOT stored in any migration). When set, the trigger sends the
-- `x-internal-secret` header; when unset, it omits it and expo-push fails open
-- (warned) — so an un-provisioned environment keeps delivering notifications.
-- Set the SAME value as the function's PUSH_INTERNAL_SECRET secret.
--
-- Non-destructive: CREATE OR REPLACE of one trigger function.

create or replace function public.notify_order_status_event()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_event   text;
  v_base    text;
  v_secret  text;
  v_headers jsonb;
begin
  v_event := case new.status
    when 'accepted'         then 'order_accepted'
    when 'ready'            then 'order_ready'
    when 'picked_up'        then 'order_picked_up'
    when 'out_for_delivery' then 'order_out_for_delivery'
    when 'delivered'        then 'order_delivered'
    else null
  end;
  if v_event is null then return new; end if;

  select value #>> '{}' into v_base
    from public.platform_settings where key = 'functions_base_url';
  if v_base is null or v_base = '' then return new; end if;

  -- [034 M4] Attach the internal shared secret when configured (out-of-band DB
  -- setting; never committed). Omitted when unset → expo-push fails open.
  v_secret := current_setting('app.push_secret', true);
  v_headers := '{"Content-Type": "application/json"}'::jsonb;
  if v_secret is not null and v_secret <> '' then
    v_headers := v_headers || jsonb_build_object('x-internal-secret', v_secret);
  end if;

  perform net.http_post(
    url     := v_base || '/expo-push',
    body    := jsonb_build_object('event', v_event, 'orderId', new.order_id::text),
    headers := v_headers
  );
  return new;
exception when others then
  return new;
end;
$$;

comment on function public.notify_order_status_event is
  'AFTER INSERT on order_status_events: fans the status change out to the customer via pg_net -> expo-push. Sends x-internal-secret from the app.push_secret DB setting when configured (M4). Best-effort; never blocks the order flow.';
