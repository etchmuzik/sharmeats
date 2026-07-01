-- 048_loyalty_first_look_dispatch.sql
-- Three-sided loyalty system, part 6: Gold-tier driver first-look dispatch.
--
-- auto_assign_order (025) already offers each order to the single nearest
-- eligible driver — there is no multi-driver broadcast moment to delay. To
-- honor "Gold drivers see offers first" WITHOUT touching nearest_drivers'
-- distance scoring, we hold back the auto-offer to a non-Gold nearest driver
-- for driver_loyalty.first_look_seconds IF a Gold-tier driver is also
-- in-radius and eligible — giving that Gold driver's push notification (sent
-- separately, see below) a head start to open the app and self-accept via
-- the manual accept path before the sweep locks in the non-Gold offer.
--
-- Non-destructive: replaces auto_assign_order (CREATE OR REPLACE, same
-- signature/return type as 025) + one new nullable column (orders.
-- dispatch_eligible_at) added additively below.
--
-- NOTE ON FILE NUMBERING: this was planned as 042-047 range but 047 was
-- consumed by an unplanned security fix (047_promo_code_entropy.sql), so
-- this ships as 048. Internal bracketed tags below read [048] rather than
-- the [046] the design doc draft used, to correctly self-reference this
-- migration's actual number.
--
-- DESIGN NOTE — why dispatch_eligible_at exists (not orders.updated_at):
-- the first draft of this migration used `coalesce(v_order.updated_at,
-- v_order.placed_at)` as the hold-window origin. That's wrong: orders has a
-- BEFORE UPDATE trigger (orders_touch_updated_at -> touch_updated_at(), see
-- 002_app_schema.sql) that stamps `updated_at = now()` on EVERY update to
-- the row -- not just the transition into 'accepted'/'preparing'/'ready'.
-- Any unrelated write to the same order (a merchant editing kitchen_notes,
-- 039_auto_advance_kitchen's own status hop, etc.) would silently reset the
-- hold clock, so the "held less than first_look_seconds ago" check could
-- re-arm indefinitely instead of expiring after a bounded window. A
-- dedicated column, stamped exactly once (on first observation by this
-- function, guarded by `is null`), is not touched by touch_updated_at
-- (which only ever assigns NEW.updated_at) and is therefore a stable,
-- write-once "became dispatch-eligible" marker.

alter table public.orders
  add column if not exists dispatch_eligible_at timestamptz;

comment on column public.orders.dispatch_eligible_at is
  '[048] Stamped once by auto_assign_order() the first time it observes this order eligible for auto-dispatch (status in accepted/preparing/ready, dropoff_geo not null) with dispatch_eligible_at still null. Never touched again afterward -- distinct from updated_at, which touch_updated_at() bumps on every write. Used as the origin timestamp for the Gold-tier first-look hold window.';

create or replace function public.auto_assign_order(p_order_id uuid)
returns uuid
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_order       public.orders;
  v_radius      int;
  v_ttl         int;
  v_driver      uuid;
  v_prof        uuid;
  v_asg_id      uuid;
  v_base        text;
  v_gold_driver uuid;
  v_first_look  int;
  v_held_since  timestamptz;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then return null; end if;

  -- Never double-offer: bail if an active (offered/accepted) assignment exists.
  if exists (
    select 1 from public.order_assignments
     where order_id = p_order_id and status in ('offered','accepted')
  ) then
    return null;
  end if;

  -- Only dispatch orders that are actually ready to move.
  if v_order.status not in ('accepted','preparing','ready') then
    return null;
  end if;
  if v_order.dropoff_geo is null then
    return null;  -- no destination to route from; manual fallback
  end if;

  -- [048] Stamp dispatch_eligible_at exactly once, the first time this
  -- function observes the order in an eligible state with the column still
  -- null. This happens in the same row lock/transaction as the rest of this
  -- call (the `for update` above already holds the lock). Never touched
  -- again afterward, so it survives any later unrelated write to the order
  -- (which only bumps updated_at via touch_updated_at, a different column).
  if v_order.dispatch_eligible_at is null then
    update public.orders
       set dispatch_eligible_at = now()
     where id = p_order_id
    returning dispatch_eligible_at into v_order.dispatch_eligible_at;
  end if;

  select coalesce((value #>> '{}')::int, 5000) into v_radius
    from public.platform_settings where key = 'dispatch_radius_m';
  select coalesce((value #>> '{}')::int, 45) into v_ttl
    from public.platform_settings where key = 'dispatch_offer_ttl_seconds';

  -- Nearest eligible driver who hasn't already seen this order (unchanged
  -- from 025 — distance scoring itself is never modified).
  select nd.driver_id into v_driver
    from public.nearest_drivers(v_order.dropoff_geo, coalesce(v_radius,5000), 20) nd
   where not exists (
           select 1 from public.order_assignments oa
            where oa.order_id = p_order_id
              and oa.driver_id = nd.driver_id
              and oa.status in ('offered','rejected','reassigned')
         )
   order by nd.distance_m asc
   limit 1;

  if v_driver is null then
    return null;  -- no one in range; sweep retries next tick
  end if;

  -- [048] First-look hold: if the nearest driver is NOT Gold-tier, but a
  -- Gold-tier driver is also in-radius/eligible for this order, hold the
  -- offer back for that Gold driver's first_look_seconds — but only once
  -- per order. We check order age using dispatch_eligible_at (stamped once,
  -- above): if the order became eligible for dispatch less than
  -- first_look_seconds ago, skip this tick so the next sweep tick (20s
  -- later, per 025) retries. Since first_look_seconds is small (single-digit
  -- to low tens), a 20s sweep cadence means this typically costs the order
  -- at most one tick.
  select dl.first_look_seconds into v_first_look
    from public.driver_loyalty dl where dl.driver_id = v_driver;

  if coalesce(v_first_look, 0) = 0 then
    -- Nearest driver is not (or has no) elevated first-look — but check
    -- whether a Gold driver is also in-radius and hasn't been offered yet.
    select nd.driver_id into v_gold_driver
      from public.nearest_drivers(v_order.dropoff_geo, coalesce(v_radius,5000), 20) nd
      join public.driver_loyalty dl on dl.driver_id = nd.driver_id and dl.tier = 'gold'
     where not exists (
             select 1 from public.order_assignments oa
              where oa.order_id = p_order_id
                and oa.driver_id = nd.driver_id
                and oa.status in ('offered','rejected','reassigned')
           )
     order by nd.distance_m asc
     limit 1;

    if v_gold_driver is not null and v_gold_driver <> v_driver then
      select coalesce((value #>> '{}')::int, 8) into v_first_look
        from public.platform_settings where key = 'loyalty_driver_first_look_gold_seconds';
      v_held_since := coalesce(v_order.dispatch_eligible_at, v_order.placed_at);
      if now() - v_held_since < make_interval(secs => coalesce(v_first_look,8)) then
        return null;  -- hold this tick; the Gold driver gets first crack via push
      end if;
    end if;
  end if;

  insert into public.order_assignments
    (order_id, driver_id, status, assigned_by, offer_expires_at)
  values
    (p_order_id, v_driver, 'offered', 'auto', now() + make_interval(secs => coalesce(v_ttl,45)))
  returning id into v_asg_id;

  update public.orders
     set assigned_driver_id = v_driver, dispatch_mode = 'auto'
   where id = p_order_id;

  -- Push the offer to that driver (resolve their auth profile for push_tokens).
  select profile_id into v_prof from public.drivers where id = v_driver;
  select value #>> '{}' into v_base
    from public.platform_settings where key = 'functions_base_url';

  if v_prof is not null and v_base is not null and v_base <> '' then
    perform net.http_post(
      url     := v_base || '/expo-push',
      body    := jsonb_build_object(
                   'event', 'new_offer',
                   'orderId', p_order_id::text,
                   'recipientUserIds', jsonb_build_array(v_prof::text)
                 ),
      headers := '{"Content-Type": "application/json"}'::jsonb
    );
  end if;

  return v_driver;
exception when others then
  -- Dispatch is best-effort per order: one bad order must not abort the whole
  -- sweep. But DON'T swallow silently — emit a WARNING so a real error (FK
  -- violation, bad data) is visible in the Postgres logs instead of an order
  -- mysteriously never dispatching. Returning null lets the sweep continue.
  raise warning 'auto_assign_order(%) failed: % (%)', p_order_id, sqlerrm, sqlstate;
  return null;
end;
$$;

comment on function public.auto_assign_order is
  'Offers one order to the nearest eligible driver. [048] Stamps orders.dispatch_eligible_at once on first sight, then holds the offer back up to loyalty_driver_first_look_gold_seconds (measured from dispatch_eligible_at) if a Gold-tier driver is also in-radius and the nearest driver is not Gold, giving Gold drivers first crack without changing nearest_drivers distance scoring. Creates an auto order_assignments row + pushes the driver. Returns offered driver_id or NULL.';

revoke all on function public.auto_assign_order(uuid) from public, anon, authenticated;
grant execute on function public.auto_assign_order(uuid) to postgres;
