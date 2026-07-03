-- 073_notification_coverage_medium.sql
-- Second wave of notification coverage (MEDIUM/LOW gaps from the 2026-07-03
-- A-to-X audit). All are trigger-based off existing state changes — no RPC edits,
-- no new status model. The two gaps that DO need new mechanisms (driver_arrived
-- geofence, offer_expiring sweep) are intentionally deferred; see the note at end.
--
-- What this adds:
--   1. driver_assigned  -> customer   (a driver accepted; card now has a rider)
--   2. order_ready_pickup -> driver   (order ready AND a driver is assigned)
--   3. low_rating        -> restaurant (customer left food rating <= 2)
--   4. tier_promoted     -> customer / driver (loyalty tier increased)
--
-- Pattern mirrors notify_order_status_event (040/071): read functions_base_url +
-- the Vault push secret, POST to /expo-push. Fail-open; never block the write.
-- expo-push COPY companion keys: driver_assigned, order_ready_pickup,
-- low_rating, tier_promoted (added to the edge function).
-- Non-destructive: two new trigger functions + bindings. Idempotent.

-- ============================================================================
-- Shared helper: resolve base url + push headers once. Returns null base to
-- signal "not configured -> caller returns early".
-- ============================================================================
create or replace function public.push_headers()
returns jsonb
language plpgsql
stable
security definer set search_path = public, pg_temp
as $$
declare v_secret text; v_headers jsonb;
begin
  begin
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_internal_secret';
  exception when others then v_secret := null;
  end;
  v_headers := '{"Content-Type": "application/json"}'::jsonb;
  if v_secret is not null and v_secret <> '' then
    v_headers := v_headers || jsonb_build_object('x-internal-secret', v_secret);
  end if;
  return v_headers;
end;
$$;
revoke all on function public.push_headers() from public, anon, authenticated;

-- ============================================================================
-- notify_order_transition — AFTER UPDATE on orders. Catches:
--   * driver just assigned (assigned_driver_id null -> not null) -> push customer
--   * status -> 'ready' AND a driver is assigned -> push that driver
--   * food rating just set (rating_food null -> value) AND <= 2 -> push restaurant
-- ============================================================================
create or replace function public.notify_order_transition()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_base    text;
  v_headers jsonb;
  v_drv_uid uuid;
  v_staff   jsonb;
begin
  select value #>> '{}' into v_base from public.platform_settings where key = 'functions_base_url';
  if v_base is null or v_base = '' then return new; end if;
  v_headers := public.push_headers();

  -- 1. Driver assigned -> tell the customer "a driver is on the way".
  if new.assigned_driver_id is not null and old.assigned_driver_id is null then
    perform net.http_post(
      url     := v_base || '/expo-push',
      body    := jsonb_build_object('event', 'driver_assigned', 'orderId', new.id::text),
      headers := v_headers
    );
  end if;

  -- 2. Order ready AND a driver is assigned -> ping that driver to come pick up.
  if new.status = 'ready' and old.status is distinct from 'ready'
     and new.assigned_driver_id is not null then
    select d.profile_id into v_drv_uid from public.drivers d where d.id = new.assigned_driver_id;
    if v_drv_uid is not null then
      perform net.http_post(
        url     := v_base || '/expo-push',
        body    := jsonb_build_object('event', 'order_ready_pickup', 'orderId', new.id::text,
                     'recipientUserIds', jsonb_build_array(v_drv_uid::text)),
        headers := v_headers
      );
    end if;
  end if;

  -- 3. Low food rating just submitted -> alert the restaurant's staff.
  if new.rating_food is not null and old.rating_food is null and new.rating_food <= 2 then
    select coalesce(jsonb_agg(distinct ms.profile_id::text), '[]'::jsonb) into v_staff
      from public.merchant_staff ms where ms.restaurant_id = new.restaurant_id;
    if v_staff is not null and v_staff <> '[]'::jsonb then
      perform net.http_post(
        url     := v_base || '/expo-push',
        body    := jsonb_build_object('event', 'low_rating', 'orderId', new.id::text,
                     'recipientUserIds', v_staff),
        headers := v_headers
      );
    end if;
  end if;

  return new;
exception when others then
  return new;  -- best-effort; never block the order update
end;
$$;
revoke all on function public.notify_order_transition() from public, anon, authenticated;

drop trigger if exists orders_notify_transition on public.orders;
create trigger orders_notify_transition
  after update on public.orders
  for each row execute function public.notify_order_transition();

comment on function public.notify_order_transition is
  'AFTER UPDATE on orders: driver-assigned -> customer; ready+assigned -> driver pickup ping; low food rating -> restaurant. Best-effort push; never blocks.';

-- ============================================================================
-- notify_loyalty_tier_change — AFTER UPDATE of tier on customer_loyalty and
-- driver_loyalty. Pushes when the tier INCREASES (bronze<silver<gold).
-- Bound to both tables via one function (uses TG_TABLE_NAME to resolve the
-- recipient user id: customer_loyalty.user_id is the customer; driver_loyalty
-- keys by driver id -> drivers.profile_id).
-- ============================================================================
create or replace function public.notify_loyalty_tier_change()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_base    text;
  v_headers jsonb;
  v_uid     uuid;
  v_rank    jsonb := '{"bronze":1,"silver":2,"gold":3}'::jsonb;
begin
  -- Only fire when tier strictly increased.
  if new.tier is not distinct from old.tier then return new; end if;
  if (v_rank ->> new.tier)::int <= (v_rank ->> old.tier)::int then return new; end if;

  select value #>> '{}' into v_base from public.platform_settings where key = 'functions_base_url';
  if v_base is null or v_base = '' then return new; end if;
  v_headers := public.push_headers();

  if TG_TABLE_NAME = 'customer_loyalty' then
    v_uid := new.user_id;
  elsif TG_TABLE_NAME = 'driver_loyalty' then
    select d.profile_id into v_uid from public.drivers d where d.id = new.driver_id;
  end if;
  if v_uid is null then return new; end if;

  perform net.http_post(
    url     := v_base || '/expo-push',
    body    := jsonb_build_object('event', 'tier_promoted', 'orderId', v_uid::text,
                 'recipientUserIds', jsonb_build_array(v_uid::text)),
    headers := v_headers
  );
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function public.notify_loyalty_tier_change() from public, anon, authenticated;

drop trigger if exists customer_loyalty_notify_tier on public.customer_loyalty;
create trigger customer_loyalty_notify_tier
  after update of tier on public.customer_loyalty
  for each row execute function public.notify_loyalty_tier_change();

drop trigger if exists driver_loyalty_notify_tier on public.driver_loyalty;
create trigger driver_loyalty_notify_tier
  after update of tier on public.driver_loyalty
  for each row execute function public.notify_loyalty_tier_change();

comment on function public.notify_loyalty_tier_change is
  'AFTER UPDATE of tier on customer_loyalty/driver_loyalty: pushes tier_promoted to the subject when tier increases (bronze<silver<gold). Best-effort; never blocks the nightly sweep.';

-- ============================================================================
-- DEFERRED (need new mechanisms, not just a trigger — tracked in PLATFORM-GAPS):
--   * driver_arrived / driver_nearby: needs a driver-app geofence RPC or a new
--     order status. No arrival signal exists in the schema today.
--   * offer_expiring: needs a pg_cron sweep over order_assignments near
--     offer_expires_at (like dispatch_watchdog). Deferred as LOW.
--   * order_reassigned to the dropped driver: needs the reoffer path to capture
--     the prior driver before nulling assigned_driver_id.
-- ============================================================================
