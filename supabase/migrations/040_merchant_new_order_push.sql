-- 040_merchant_new_order_push.sql
-- Push the restaurant's staff when a new order is placed, so the restaurant app
-- (kitchen tablet) buzzes even when backgrounded.
--
-- CONTEXT
-- place_order writes a 'placed' order_status_events row (031:233). The push
-- fan-out trigger notify_order_status_event (018, secured in 035) fires on every
-- such row but currently SKIPS 'placed' (its event map returns null for it) —
-- because a 'placed' status is meaningful to the MERCHANT, not the customer.
-- Until now nothing pushed the merchant on a new order; the merchant-web
-- dashboard only chimed via an in-tab Realtime subscription (B2 added a web
-- notification, but that needs the dashboard open). The native restaurant app
-- needs a real push.
--
-- THE FIX
-- Extend notify_order_status_event: on 'placed', resolve the order's restaurant
-- staff (merchant_staff.profile_id == their auth user id, which is how push_tokens
-- are keyed) and POST an `order_placed_merchant` event to expo-push with those
-- recipients. All other statuses keep their existing customer-facing behavior,
-- byte-for-byte from 035 (including the Vault x-internal-secret). Companion:
-- expo-push COPY gets an `order_placed_merchant` entry (edit the edge function).
--
-- Non-destructive: CREATE OR REPLACE of one trigger function. Trigger binding
-- (order_status_events_push, AFTER INSERT) is unchanged.

create or replace function public.notify_order_status_event()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_event      text;
  v_base       text;
  v_secret     text;
  v_headers    jsonb;
  v_recipients jsonb;
  v_rest       uuid;
begin
  select value #>> '{}' into v_base
    from public.platform_settings where key = 'functions_base_url';
  if v_base is null or v_base = '' then return new; end if;

  -- [035] internal secret from Vault; fail open (no header) if absent.
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

  -- ── New-order push to the RESTAURANT's staff. ──────────────────────────────
  if new.status = 'placed' then
    select restaurant_id into v_rest from public.orders where id = new.order_id;
    if v_rest is null then return new; end if;

    -- All staff of that restaurant (profile_id == auth user id == push_tokens.user_id).
    select coalesce(jsonb_agg(distinct ms.profile_id::text), '[]'::jsonb)
      into v_recipients
      from public.merchant_staff ms
     where ms.restaurant_id = v_rest;

    if v_recipients is null or v_recipients = '[]'::jsonb then
      return new;  -- no staff to notify
    end if;

    perform net.http_post(
      url     := v_base || '/expo-push',
      body    := jsonb_build_object(
                   'event', 'order_placed_merchant',
                   'orderId', new.order_id::text,
                   'recipientUserIds', v_recipients
                 ),
      headers := v_headers
    );
    return new;
  end if;

  -- ── Customer-facing status pushes (unchanged from 035). ────────────────────
  v_event := case new.status
    when 'accepted'         then 'order_accepted'
    when 'ready'            then 'order_ready'
    when 'picked_up'        then 'order_picked_up'
    when 'out_for_delivery' then 'order_out_for_delivery'
    when 'delivered'        then 'order_delivered'
    else null
  end;
  if v_event is null then return new; end if;

  perform net.http_post(
    url     := v_base || '/expo-push',
    body    := jsonb_build_object('event', v_event, 'orderId', new.order_id::text),
    headers := v_headers
  );
  return new;
exception when others then
  return new;  -- best-effort; never block the order flow
end;
$$;

comment on function public.notify_order_status_event is
  'AFTER INSERT on order_status_events: fans status changes to the right surface via pg_net -> expo-push (x-internal-secret from Vault). On ''placed'' pushes the restaurant''s merchant_staff (order_placed_merchant, mig 040); other statuses push the customer. Best-effort; never blocks the order flow.';
