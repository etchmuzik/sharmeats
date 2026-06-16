-- 025_auto_dispatch.sql
-- Auto-dispatch: turn the manual fleet model into a self-driving one.
--
-- Today an admin assigns each order by hand (assign_driver, mig 011). The pieces
-- for automation already exist — nearest_drivers (PostGIS), order_assignments
-- with assigned_by='auto' + a one-active-per-order unique index, and the
-- platform_settings.dispatch_mode switch (read by place_order). What's missing
-- is the ACTOR. This migration adds it:
--
--   * offer_expires_at on order_assignments  — an offer a driver ignores must
--     expire so the next-nearest driver gets a shot.
--   * auto_assign_order(order_id)            — pick the nearest eligible driver,
--     create an 'offered' (assigned_by='auto') row, push them via expo-push.
--     Skips drivers who already rejected/were-offered THIS order.
--   * dispatch_sweep()                       — the engine. (a) expires stale
--     offers, (b) dispatches ready/accepted orders that have no active
--     assignment, honoring per-zone dispatch_mode override then the platform
--     default. SECURITY DEFINER, callable only by the cron job (+ admin).
--   * pg_cron job every 20s                  — runs dispatch_sweep().
--
-- Safety: dispatch_mode defaults to 'manual' (seeded below), so NOTHING
-- auto-dispatches until you flip the switch:
--   update platform_settings set value = to_jsonb('auto'::text) where key='dispatch_mode';
-- or pilot one zone:  update zones set dispatch_mode='auto' where id='naama';
--
-- Non-destructive: new column + new functions + one cron job + one seeded row.

-- ============================================================================
-- Guard the per-zone override column (added as plain text in 005). The sweep
-- compares it to 'auto'/'manual'; an invalid value would silently make a zone
-- un-dispatchable. Constrain it so only valid modes (or NULL = inherit) exist.
-- ============================================================================
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'zones_dispatch_mode_chk'
  ) then
    alter table public.zones
      add constraint zones_dispatch_mode_chk
      check (dispatch_mode is null or dispatch_mode in ('manual','auto'));
  end if;
end $$;

-- ============================================================================
-- Offer expiry: a driver has OFFER_TTL seconds to accept before re-offer.
-- ============================================================================
alter table public.order_assignments
  add column if not exists offer_expires_at timestamptz;

-- Fast lookup of live offers that have run out the clock.
create index if not exists order_assignments_offer_expiry_idx
  on public.order_assignments (offer_expires_at)
  where status = 'offered';

comment on column public.order_assignments.offer_expires_at is
  'When an auto-dispatch offer lapses. dispatch_sweep() marks lapsed offers ''rejected'' and re-offers to the next-nearest driver. NULL for manual (dispatcher) offers, which never auto-expire.';

-- ============================================================================
-- Seed the dispatch_mode switch so place_order stamps a concrete mode and the
-- sweep has something to read. 'manual' = unchanged behavior until flipped.
-- ============================================================================
insert into public.platform_settings (key, value)
values ('dispatch_mode', to_jsonb('manual'::text))
on conflict (key) do nothing;

-- Tunables live in platform_settings too, so ops can adjust without a deploy.
insert into public.platform_settings (key, value) values
  ('dispatch_offer_ttl_seconds', to_jsonb(45)),     -- per-driver accept window
  ('dispatch_radius_m',          to_jsonb(5000))    -- search radius for nearest driver
on conflict (key) do nothing;

-- ============================================================================
-- auto_assign_order — offer ONE order to the nearest eligible driver.
--
-- "Eligible" = online + verified + active (nearest_drivers already enforces),
-- AND has not already been offered or rejected THIS order (so re-offers walk
-- down the distance list instead of pestering someone who just declined).
--
-- Returns the driver_id offered, or NULL if nobody was available.
-- ============================================================================
create or replace function public.auto_assign_order(p_order_id uuid)
returns uuid
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_order     public.orders;
  v_radius    int;
  v_ttl       int;
  v_driver    uuid;
  v_prof      uuid;
  v_asg_id    uuid;
  v_base      text;
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

  select coalesce((value #>> '{}')::int, 5000) into v_radius
    from public.platform_settings where key = 'dispatch_radius_m';
  select coalesce((value #>> '{}')::int, 45) into v_ttl
    from public.platform_settings where key = 'dispatch_offer_ttl_seconds';

  -- Nearest eligible driver who hasn't already seen (offered/rejected) this order.
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
  'Offers one order to the nearest eligible driver (online/verified/active, not already offered/rejected this order). Creates an auto order_assignments row + pushes the driver. Returns offered driver_id or NULL.';

-- ============================================================================
-- dispatch_sweep — the engine. Idempotent; safe to run every ~20s.
--   1) Expire offers past offer_expires_at  -> 'rejected' (frees the order).
--   2) For each ready/accepted/preparing order with NO active assignment whose
--      effective dispatch_mode is 'auto', call auto_assign_order.
--
-- Effective mode = zones.dispatch_mode (per-zone override) ?? platform default.
-- ============================================================================
create or replace function public.dispatch_sweep()
returns int  -- number of orders newly offered this tick
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_default text;
  v_count   int := 0;
  v_rec     record;
begin
  -- (1) Expire lapsed offers. The order returns to "no active assignment" and
  --     is re-picked below. Clear assigned_driver_id so the card isn't stale.
  with expired as (
    update public.order_assignments
       set status = 'rejected', responded_at = now()
     where status = 'offered'
       and offer_expires_at is not null
       and offer_expires_at < now()
    returning order_id
  )
  update public.orders o
     set assigned_driver_id = null
    from expired e
   where o.id = e.order_id
     and o.status not in ('picked_up','out_for_delivery','delivered');

  -- Platform default mode (defaults to 'manual' if unset).
  select coalesce((value #>> '{}'), 'manual') into v_default
    from public.platform_settings where key = 'dispatch_mode';

  -- (2) Dispatch eligible orders. Effective mode resolves per-zone override
  --     first, then the platform default.
  for v_rec in
    select o.id
      from public.orders o
      left join public.zones z on z.id = o.zone
     where o.status in ('accepted','preparing','ready')
       and o.dropoff_geo is not null
       and coalesce(z.dispatch_mode, v_default) = 'auto'
       and not exists (
             select 1 from public.order_assignments oa
              where oa.order_id = o.id and oa.status in ('offered','accepted')
           )
     order by o.placed_at asc
     limit 50  -- bound per-tick work; backlog drains over subsequent ticks
  loop
    if public.auto_assign_order(v_rec.id) is not null then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

comment on function public.dispatch_sweep is
  'Auto-dispatch engine (run by pg_cron ~20s). Expires lapsed offers and offers unassigned ready/accepted orders to the nearest driver when effective dispatch_mode (per-zone override ?? platform default) is auto. Returns count newly offered.';

-- dispatch_sweep is for the cron job only; never granted to clients. The
-- pg_cron job runs as the role that scheduled it (postgres, in a migration),
-- which also owns these functions — but grant EXECUTE explicitly so the cron
-- call never depends on ownership coincidence (and so it survives an ownership
-- change). postgres is the executor; revoke from every client-facing role.
revoke all on function public.dispatch_sweep() from public, anon, authenticated;
revoke all on function public.auto_assign_order(uuid) from public, anon, authenticated;
grant execute on function public.dispatch_sweep() to postgres;
grant execute on function public.auto_assign_order(uuid) to postgres;

-- ============================================================================
-- Schedule it. pg_cron's finest granularity is 1 minute via cron syntax, so we
-- use the seconds-interval form ('20 seconds') supported by pg_cron >= 1.5.
-- ============================================================================
create extension if not exists pg_cron;

-- Unschedule any prior incarnation (id reuse on re-run), then (re)schedule.
do $$
begin
  perform cron.unschedule('sharmeats-dispatch-sweep');
exception when others then
  null;  -- not scheduled yet
end $$;

select cron.schedule('sharmeats-dispatch-sweep', '20 seconds', $$select public.dispatch_sweep();$$);
