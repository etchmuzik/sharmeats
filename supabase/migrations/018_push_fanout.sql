-- 018_push_fanout.sql
-- Push notifications on order status changes.
--
-- The client half (push_tokens, 014) and the delivery half (expo-push edge
-- function) already exist, but until now the ONLY caller was paymob-webhook
-- (order_paid). This migration closes the loop: an AFTER INSERT trigger on
-- order_status_events fans every meaningful status change out to the customer
-- via pg_net -> expo-push.
--
-- Design notes:
--   * pg_net is asynchronous — the HTTP call is queued and executed after the
--     transaction commits, so advance_order_status never blocks on Expo.
--   * The functions base URL lives in platform_settings ('functions_base_url')
--     so staging/local projects can point elsewhere; if the key is absent the
--     trigger silently no-ops (push stays best-effort, mirrors expo-push's own
--     graceful no-op behavior).
--   * expo-push is deployed with --no-verify-jwt and resolves the recipient
--     from the order row itself, so no service key is stored in the database.
--
-- Non-destructive: extension + setting + trigger only.

create extension if not exists pg_net;

insert into public.platform_settings (key, value)
values ('functions_base_url', to_jsonb('https://ilqpsebcfbaoaogimhud.supabase.co/functions/v1'::text))
on conflict (key) do nothing;

create or replace function public.notify_order_status_event()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_event text;
  v_base  text;
begin
  -- Map order status -> expo-push event key. Statuses without customer-facing
  -- copy (placed, preparing, cancelled, rejected) are skipped; 'placed' is the
  -- customer's own action and payment confirmation already pushes order_paid.
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

  -- Queued + async; failures land in net._http_response, never in the order flow.
  perform net.http_post(
    url     := v_base || '/expo-push',
    body    := jsonb_build_object('event', v_event, 'orderId', new.order_id::text),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  return new;
exception when others then
  -- Push is strictly best-effort: swallow anything (pg_net missing, bad URL…).
  return new;
end;
$$;

drop trigger if exists order_status_events_push on public.order_status_events;
create trigger order_status_events_push
  after insert on public.order_status_events
  for each row execute function public.notify_order_status_event();

comment on function public.notify_order_status_event is
  'AFTER INSERT on order_status_events: fans the status change out to the customer via pg_net -> expo-push edge function. Best-effort; never blocks the order flow.';
