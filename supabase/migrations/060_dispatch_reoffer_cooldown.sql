-- 060_dispatch_reoffer_cooldown.sql
-- Time-bound the auto-dispatch rejection filter (pre-ship audit AUDIT-2).
--
-- THE ISSUE (048 / 025): auto_assign_order's nearest-driver subquery excluded
-- any driver with an assignment row in ('offered','rejected','reassigned') for
-- the order, with NO recency bound. dispatch_sweep marks a TTL-LAPSED offer
-- (a driver who was busy and never answered) as 'rejected' (025:198). So a
-- driver who merely *didn't respond in 45s* was permanently burned for that
-- order's lifetime. If every in-range driver lapsed once, the order had no one
-- left to offer to until the pool refreshed (a new driver enters range, or a
-- busy one returns to 'online'). Not order-loss — the ~20s sweep + the 054
-- on_job->online reset + the manual assign_driver escape hatch all recover it
-- — but a real degradation under a thin/busy pool.
--
-- THE FIX: keep an ACTIVE 'offered' row excluding unconditionally (never
-- double-offer a live order), but bound 'rejected'/'reassigned' exclusions to
-- a cooldown window measured from assigned_at (NOT NULL; responded_at is null
-- for some paths). After the cooldown a lapsed/declined driver becomes
-- re-eligible for that order. Window is configurable via a new platform_setting
-- (default 3600s = 1h); seeded here.
--
-- Body is 048's auto_assign_order verbatim except the two exclusion subqueries
-- (last-definition-wins discipline: full function body restated).

insert into public.platform_settings (key, value)
values ('dispatch_reoffer_cooldown_seconds', to_jsonb(3600))
on conflict (key) do nothing;

comment on column public.order_assignments.offer_expires_at is
  'When an auto-dispatch offer lapses. dispatch_sweep() marks lapsed offers ''rejected'' and re-offers to the next-nearest driver. NULL for manual (dispatcher) offers, which never auto-expire. [060] A rejected/lapsed driver becomes re-eligible for the order after dispatch_reoffer_cooldown_seconds (measured from assigned_at).';

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
  v_reoffer_cd  int;
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
  -- function observes the order in an eligible state with the column still null.
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

  -- [060] Re-offer cooldown: how long a rejected/lapsed offer keeps excluding a
  -- driver from THIS order before they become eligible again. Default 1h.
  select coalesce((value #>> '{}')::int, 3600) into v_reoffer_cd
    from public.platform_settings where key = 'dispatch_reoffer_cooldown_seconds';

  -- Nearest eligible driver who hasn't already seen this order.
  -- [060] A live 'offered' row excludes unconditionally (don't double-offer);
  -- a 'rejected'/'reassigned' row excludes only within the cooldown window, so
  -- a driver who lapsed (was busy) becomes re-eligible after the cooldown
  -- instead of being burned for the order's whole lifetime.
  select nd.driver_id into v_driver
    from public.nearest_drivers(v_order.dropoff_geo, coalesce(v_radius,5000), 20) nd
   where not exists (
           select 1 from public.order_assignments oa
            where oa.order_id = p_order_id
              and oa.driver_id = nd.driver_id
              and (
                    oa.status = 'offered'
                    or (oa.status in ('rejected','reassigned')
                        and oa.assigned_at > now() - make_interval(secs => coalesce(v_reoffer_cd,3600)))
                  )
         )
   order by nd.distance_m asc
   limit 1;

  if v_driver is null then
    return null;  -- no one in range; sweep retries next tick
  end if;

  -- [048] First-look hold for Gold-tier drivers (unchanged except the same
  -- cooldown-bounded exclusion below).
  select dl.first_look_seconds into v_first_look
    from public.driver_loyalty dl where dl.driver_id = v_driver;

  if coalesce(v_first_look, 0) = 0 then
    select nd.driver_id into v_gold_driver
      from public.nearest_drivers(v_order.dropoff_geo, coalesce(v_radius,5000), 20) nd
      join public.driver_loyalty dl on dl.driver_id = nd.driver_id and dl.tier = 'gold'
     where not exists (
             select 1 from public.order_assignments oa
              where oa.order_id = p_order_id
                and oa.driver_id = nd.driver_id
                and (
                      oa.status = 'offered'
                      or (oa.status in ('rejected','reassigned')
                          and oa.assigned_at > now() - make_interval(secs => coalesce(v_reoffer_cd,3600)))
                    )
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
  -- Dispatch is best-effort per order: one bad order must not abort the sweep.
  raise warning 'auto_assign_order(%) failed: % (%)', p_order_id, sqlerrm, sqlstate;
  return null;
end;
$$;

comment on function public.auto_assign_order is
  'Offers one order to the nearest eligible driver. [048] Gold first-look hold via dispatch_eligible_at. [060] A rejected/lapsed offer only excludes the driver for dispatch_reoffer_cooldown_seconds (default 1h, from assigned_at) instead of permanently, so a busy driver who let an offer lapse becomes re-eligible; a live ''offered'' row still excludes unconditionally. Creates an auto order_assignments row + pushes the driver. Returns offered driver_id or NULL.';
