-- 045_loyalty_tier_sweep.sql
-- Three-sided loyalty system, part 4: the nightly tier-recompute sweep.
--
-- Mirrors dispatch_sweep() (025): one SECURITY DEFINER function, run by
-- pg_cron, granted only to postgres, wrapped so one subject's failure
-- (raise warning) never aborts the whole sweep.
--
-- Customer tier: from loyalty_points_ledger, trailing 12 months.
-- Driver tier:   from order_assignments (acceptance) + orders (delivered
--                volume + ratings), trailing 90 days, gated by a quality
--                floor.
-- Restaurant tier: from orders (delivered count), trailing 90 days.
-- All three then write derived perks (multiplier is read live by the earn
-- trigger; driver bonus/first-look and restaurant commission/featured are
-- written directly here).
--
-- Non-destructive: new function + one cron job.

create or replace function public.loyalty_tier_sweep()
returns int  -- number of subject rows updated this run
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_count int := 0;
  v_rec   record;
  v_silver_pts int; v_gold_pts int;
  v_drv_silver int; v_drv_gold int; v_min_accept numeric; v_min_rating numeric;
  v_drv_bonus_s int; v_drv_bonus_g int; v_drv_first_look_g int;
  v_rest_silver int; v_rest_gold int; v_rest_disc_s numeric; v_rest_disc_g numeric;
  v_new_tier text;
begin
  select coalesce((value #>> '{}')::int, 500)  into v_silver_pts from public.platform_settings where key = 'loyalty_customer_silver_threshold';
  select coalesce((value #>> '{}')::int, 2000) into v_gold_pts   from public.platform_settings where key = 'loyalty_customer_gold_threshold';
  select coalesce((value #>> '{}')::int, 60)   into v_drv_silver from public.platform_settings where key = 'loyalty_driver_silver_threshold';
  select coalesce((value #>> '{}')::int, 200)  into v_drv_gold   from public.platform_settings where key = 'loyalty_driver_gold_threshold';
  select coalesce((value #>> '{}')::numeric, 80)  into v_min_accept from public.platform_settings where key = 'loyalty_driver_min_acceptance_pct';
  select coalesce((value #>> '{}')::numeric, 450) into v_min_rating from public.platform_settings where key = 'loyalty_driver_min_rating';
  select coalesce((value #>> '{}')::int, 5)  into v_drv_bonus_s from public.platform_settings where key = 'loyalty_driver_bonus_silver_egp';
  select coalesce((value #>> '{}')::int, 10) into v_drv_bonus_g from public.platform_settings where key = 'loyalty_driver_bonus_gold_egp';
  select coalesce((value #>> '{}')::int, 8)  into v_drv_first_look_g from public.platform_settings where key = 'loyalty_driver_first_look_gold_seconds';
  select coalesce((value #>> '{}')::int, 50)  into v_rest_silver from public.platform_settings where key = 'loyalty_restaurant_silver_threshold';
  select coalesce((value #>> '{}')::int, 200) into v_rest_gold   from public.platform_settings where key = 'loyalty_restaurant_gold_threshold';
  -- loyalty_restaurant_*_discount_pct are stored as hundredths of a
  -- percentage point (100 = 1.00pp, 200 = 2.00pp — see 042's seed comments),
  -- but restaurants.commission_pct is a plain percentage (e.g. 12.0), so the
  -- stored value must be divided by 100 before it's subtracted below.
  select coalesce((value #>> '{}')::numeric, 100) / 100.0 into v_rest_disc_s from public.platform_settings where key = 'loyalty_restaurant_silver_discount_pct';
  select coalesce((value #>> '{}')::numeric, 200) / 100.0 into v_rest_disc_g from public.platform_settings where key = 'loyalty_restaurant_gold_discount_pct';

  -- ---- Customers: rolling-12mo points from the ledger ----
  for v_rec in
    select cl.user_id,
           coalesce(sum(l.delta_points) filter (where l.created_at > now() - interval '12 months'), 0) as pts
      from public.customer_loyalty cl
      left join public.loyalty_points_ledger l
        on l.subject_type = 'customer' and l.subject_id = cl.user_id
     group by cl.user_id
  loop
    begin
      v_new_tier := case when v_rec.pts >= v_gold_pts then 'gold'
                          when v_rec.pts >= v_silver_pts then 'silver'
                          else 'bronze' end;
      update public.customer_loyalty
         set tier = v_new_tier, points_rolling_12mo = v_rec.pts, updated_at = now()
       where user_id = v_rec.user_id and (tier <> v_new_tier or points_rolling_12mo <> v_rec.pts);
      if found then v_count := v_count + 1; end if;
    exception when others then
      raise warning 'loyalty_tier_sweep customer(%) failed: %', v_rec.user_id, sqlerrm;
    end;
  end loop;

  -- ---- Drivers: rolling-90d deliveries + quality gate ----
  -- NOTE: order_assignments.status never reaches 'completed' anywhere in this
  -- codebase (driver_respond only ever sets 'accepted'/'rejected' — see
  -- 011_rpcs.sql). Delivery volume MUST be counted from orders.status =
  -- 'delivered' joined on assigned_driver_id, not from order_assignments.
  for v_rec in
    select d.id as driver_id,
           coalesce((
             select count(*) from public.orders o
              where o.assigned_driver_id = d.id and o.status = 'delivered'
                and o.placed_at > now() - interval '90 days'
           ), 0) as deliveries,
           coalesce(
             100.0 * count(*) filter (where oa.status = 'accepted' and oa.assigned_at > now() - interval '90 days')
             / nullif(count(*) filter (where oa.status in ('accepted','rejected') and oa.assigned_at > now() - interval '90 days'), 0),
             100.0
           ) as acceptance_pct,
           coalesce((
             select avg(o.rating_delivery)::numeric from public.orders o
              where o.assigned_driver_id = d.id and o.rating_delivery is not null
                and o.placed_at > now() - interval '90 days'
           ), 5.0) as avg_rating
      from public.drivers d
      left join public.order_assignments oa on oa.driver_id = d.id
     group by d.id
  loop
    begin
      insert into public.driver_loyalty (driver_id) values (v_rec.driver_id)
        on conflict (driver_id) do nothing;

      v_new_tier := 'bronze';
      if v_rec.deliveries >= v_drv_gold
         and v_rec.acceptance_pct >= v_min_accept
         and v_rec.avg_rating * 100 >= v_min_rating then
        v_new_tier := 'gold';
      elsif v_rec.deliveries >= v_drv_silver
         and v_rec.acceptance_pct >= v_min_accept
         and v_rec.avg_rating * 100 >= v_min_rating then
        v_new_tier := 'silver';
      end if;

      update public.driver_loyalty
         set tier = v_new_tier,
             deliveries_rolling_90d = v_rec.deliveries,
             acceptance_rate_snapshot = v_rec.acceptance_pct,
             rating_snapshot = v_rec.avg_rating,
             bonus_per_delivery_egp = case v_new_tier when 'gold' then v_drv_bonus_g when 'silver' then v_drv_bonus_s else 0 end,
             first_look_seconds = case v_new_tier when 'gold' then v_drv_first_look_g else 0 end,
             updated_at = now()
       where driver_id = v_rec.driver_id;
      v_count := v_count + 1;
    exception when others then
      raise warning 'loyalty_tier_sweep driver(%) failed: %', v_rec.driver_id, sqlerrm;
    end;
  end loop;

  -- ---- Restaurants: rolling-90d delivered order count ----
  for v_rec in
    select r.id as restaurant_id,
           coalesce(count(o.id) filter (
             where o.status = 'delivered' and o.placed_at > now() - interval '90 days'
           ), 0) as delivered_count,
           r.commission_pct as base_commission
      from public.restaurants r
      left join public.orders o on o.restaurant_id = r.id
     group by r.id, r.commission_pct
  loop
    begin
      insert into public.restaurant_loyalty (restaurant_id) values (v_rec.restaurant_id)
        on conflict (restaurant_id) do nothing;

      v_new_tier := 'bronze';
      if v_rec.delivered_count >= v_rest_gold then
        v_new_tier := 'gold';
      elsif v_rec.delivered_count >= v_rest_silver then
        v_new_tier := 'silver';
      end if;

      -- Idempotency fix: snapshot the PREVIOUS discount into a variable
      -- BEFORE updating restaurant_loyalty. Reading commission_discount_pct
      -- back off the row AFTER updating it in the same statement (the naive
      -- first draft of this block) is unreliable — it observes the
      -- just-written new discount, not the prior one, which would double
      -- (or under-) apply the delta on every re-run of the sweep.
      declare
        v_prev_discount numeric;
        v_next_discount numeric;
      begin
        select commission_discount_pct into v_prev_discount
          from public.restaurant_loyalty where restaurant_id = v_rec.restaurant_id;
        v_prev_discount := coalesce(v_prev_discount, 0);
        v_next_discount := case v_new_tier when 'gold' then v_rest_disc_g when 'silver' then v_rest_disc_s else 0 end;

        update public.restaurant_loyalty
           set tier = v_new_tier,
               orders_rolling_90d = v_rec.delivered_count,
               commission_discount_pct = v_next_discount,
               updated_at = now()
         where restaurant_id = v_rec.restaurant_id;

        update public.restaurants
           set commission_pct = greatest(0, v_rec.base_commission + v_prev_discount - v_next_discount),
               featured = (v_new_tier = 'gold')
         where id = v_rec.restaurant_id;
      end;

      v_count := v_count + 1;
    exception when others then
      raise warning 'loyalty_tier_sweep restaurant(%) failed: %', v_rec.restaurant_id, sqlerrm;
    end;
  end loop;

  return v_count;
end;
$$;

comment on function public.loyalty_tier_sweep is
  'Nightly recompute of all three loyalty tiers from loyalty_points_ledger/order history. Writes customer/driver/restaurant_loyalty and auto-applies restaurant commission_pct/featured. Run by pg_cron; never granted to clients.';

revoke all on function public.loyalty_tier_sweep() from public, anon, authenticated;
grant execute on function public.loyalty_tier_sweep() to postgres;

create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('sharmeats-loyalty-tier-sweep');
exception when others then
  null;  -- not scheduled yet
end $$;

select cron.schedule('sharmeats-loyalty-tier-sweep', '0 2 * * *', $$select public.loyalty_tier_sweep();$$);
