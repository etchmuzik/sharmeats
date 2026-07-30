-- 189_dispatch_pickup_centered.sql
--
-- Package 08 recon fix (owner-approved 2026-07-30): auto_assign_order searched
-- nearest_drivers around the DROP-OFF. The driver's first leg is to the
-- RESTAURANT — nearest-to-the-customer can be a zone away from the food,
-- inflating pickup wait and P90 prep-to-door. Verified in the live body
-- (both candidate queries centered on v_order.dropoff_geo). Package 08's spec
-- lists this as an existing risk that must not be copied into parcel dispatch;
-- it was also simply a food bug.
--
-- Body rebuilt from the CURRENT prod definition (house rule 2) with three
-- deltas: a v_pickup declaration, its resolution (restaurant geo, falling back
-- to drop-off for geo-less fixture rows — never a full-area scan), and both
-- nearest_drivers call sites re-centered.

CREATE OR REPLACE FUNCTION public.auto_assign_order(p_order_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_order public.orders; v_radius int; v_ttl int; v_driver uuid; v_prof uuid; v_asg_id uuid;
  v_base text; v_gold_driver uuid; v_first_look int; v_held_since timestamptz; v_reoffer_cd int;
  v_cap record; v_pickup geography;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then return null; end if;
  if exists (select 1 from public.order_assignments where order_id=p_order_id and status in ('offered','accepted')) then return null; end if;
  if v_order.status not in ('accepted','preparing','ready') then return null; end if;
  if v_order.dropoff_geo is null then return null; end if;
  -- [mig 189] Search around the PICKUP, not the drop-off: the driver's first
  -- leg is to the restaurant, so the nearest-to-customer driver could be a
  -- whole zone away from the food. Falls back to the drop-off only when the
  -- restaurant has no geo (fixture/legacy rows) — never fails open to a full
  -- scan. Package 08 flagged this as a risk not to copy into parcels; it was
  -- also simply wrong for food.
  select coalesce(r.geo, v_order.dropoff_geo) into v_pickup
    from public.restaurants r where r.id = v_order.restaurant_id;
  v_pickup := coalesce(v_pickup, v_order.dropoff_geo);
  if v_order.dispatch_eligible_at is null then
    update public.orders set dispatch_eligible_at=now() where id=p_order_id returning dispatch_eligible_at into v_order.dispatch_eligible_at;
  end if;
  select coalesce((value #>> '{}')::int, 5000) into v_radius from public.platform_settings where key='dispatch_radius_m';
  select coalesce((value #>> '{}')::int, 45) into v_ttl from public.platform_settings where key='dispatch_offer_ttl_seconds';
  select coalesce((value #>> '{}')::int, 3600) into v_reoffer_cd from public.platform_settings where key='dispatch_reoffer_cooldown_seconds';

  -- [149] The COD ceiling is applied as a CANDIDATE FILTER, not a post-hoc
  -- rejection: a driver at their hard limit is simply not a candidate, so the
  -- sweep moves to the next-nearest instead of leaving the order unassigned.
  -- Raising here would be worse than useless -- the exception handler below
  -- swallows it into a warning and returns null, stalling this order entirely.
  select nd.driver_id into v_driver
    from public.nearest_drivers(v_pickup, coalesce(v_radius,5000), 20) nd
   where not exists (select 1 from public.order_assignments oa where oa.order_id=p_order_id and oa.driver_id=nd.driver_id
              and (oa.status='offered' or (oa.status in ('rejected','reassigned') and oa.assigned_at > now() - make_interval(secs => coalesce(v_reoffer_cd,3600)))))
     and (select c.outcome from public.driver_cod_capacity(nd.driver_id, p_order_id) c) <> 'blocked'
   order by nd.distance_m asc limit 1;
  if v_driver is null then return null; end if;
  select dl.first_look_seconds into v_first_look from public.driver_loyalty dl where dl.driver_id = v_driver;
  if coalesce(v_first_look, 0) = 0 then
    select nd.driver_id into v_gold_driver
      from public.nearest_drivers(v_pickup, coalesce(v_radius,5000), 20) nd
      join public.driver_loyalty dl on dl.driver_id=nd.driver_id and dl.tier='gold'
     where not exists (select 1 from public.order_assignments oa where oa.order_id=p_order_id and oa.driver_id=nd.driver_id
                and (oa.status='offered' or (oa.status in ('rejected','reassigned') and oa.assigned_at > now() - make_interval(secs => coalesce(v_reoffer_cd,3600)))))
       and (select c.outcome from public.driver_cod_capacity(nd.driver_id, p_order_id) c) <> 'blocked'
     order by nd.distance_m asc limit 1;
    if v_gold_driver is not null and v_gold_driver <> v_driver then
      select coalesce((value #>> '{}')::int, 8) into v_first_look from public.platform_settings where key='loyalty_driver_first_look_gold_seconds';
      v_held_since := coalesce(v_order.dispatch_eligible_at, v_order.placed_at);
      if now() - v_held_since < make_interval(secs => coalesce(v_first_look,8)) then return null; end if;
    end if;
  end if;

  -- Record what the ceiling decided for the driver actually chosen.
  select * into v_cap from public.driver_cod_capacity(v_driver, p_order_id);
  perform public.log_cod_limit_event(
    v_driver, p_order_id, v_cap.outcome, v_cap.held_egp, v_cap.prospective_egp,
    v_cap.soft_limit_egp, v_cap.hard_limit_egp, v_cap.mode);

  insert into public.order_assignments (order_id, driver_id, status, assigned_by, offer_expires_at)
  values (p_order_id, v_driver, 'offered', 'auto', now() + make_interval(secs => coalesce(v_ttl,45))) returning id into v_asg_id;
  update public.orders set assigned_driver_id=v_driver, dispatch_mode='auto' where id=p_order_id;
  select profile_id into v_prof from public.drivers where id=v_driver;
  select value #>> '{}' into v_base from public.platform_settings where key='functions_base_url';
  if v_prof is not null and v_base is not null and v_base <> '' then
    perform net.http_post(
      url := v_base || '/expo-push',
      body := jsonb_build_object('event','new_offer','orderId',p_order_id::text,'recipientUserIds',jsonb_build_array(v_prof::text)),
      headers := public.push_headers());
  end if;
  return v_driver;
exception when others then
  raise warning 'auto_assign_order(%) failed: % (%)', p_order_id, sqlerrm, sqlstate;
  return null;
end; $function$;

revoke all on function public.auto_assign_order(uuid) from public, anon, authenticated;
