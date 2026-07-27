-- 150_cod_ceiling_enforcement.sql
--
-- Package 04 Slice E, second half — wire the ceiling into BOTH assignment
-- paths. Split from 149 deliberately: 149 adds the machinery and changes no
-- behaviour, so it can be applied and observed independently of the two RPC
-- replacements here. If this migration is reverted, 149 is inert rather than
-- broken.
--
-- Both bodies are derived from the DEPLOYED definitions (pg_get_functiondef,
-- 2026-07-28) and re-stated verbatim apart from the inserted check.
--
-- THE TWO PATHS BEHAVE DIFFERENTLY, ON PURPOSE:
--
--   assign_driver     a dispatcher chose this driver, so a refusal must be
--                     LOUD -- they need to know to pick someone else. Raises
--                     COD_LIMIT_EXCEEDED.
--
--   auto_assign_order the cron picks a driver from a candidate list and already
--                     returns null for "nobody suitable". A blocked driver is
--                     exactly that, so it SKIPS to the next candidate rather
--                     than erroring. Raising here would abort the whole sweep
--                     (the body swallows exceptions into a warning and returns
--                     null), which would stall dispatch for every other order.
--
-- In `observe` mode neither blocks; both still record the event, which is the
-- data the real limits get chosen from.

-- ---------------------------------------------------------------------------
-- assign_driver — dispatcher path.
-- ---------------------------------------------------------------------------
create or replace function public.assign_driver(p_order_id uuid, p_driver_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_role app_role := public.auth_role(); v_user uuid := auth.uid();
  v_prof uuid; v_base text;
  v_cap record;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode='check_violation'; end if;
  if coalesce(v_role::text,'') not in ('admin','dispatcher') then raise exception 'NOT_AUTHORIZED' using errcode='check_violation'; end if;
  if not exists (select 1 from public.drivers where id=p_driver_id and is_active and is_verified and status<>'offline') then
    raise exception 'DRIVER_NOT_ELIGIBLE: driver must be active, verified and online' using errcode='check_violation'; end if;

  -- [149] COD exposure ceiling. Evaluated INSIDE this transaction so a
  -- concurrent assignment cannot slip past between the check and the insert.
  select * into v_cap from public.driver_cod_capacity(p_driver_id, p_order_id);

  -- ORDER MATTERS. There is no dblink here, so this INSERT lives in the same
  -- transaction as the raise below -- and a raise rolls it back. The assertion
  -- pack caught exactly that: blocked attempts, the events an operator most
  -- needs, were the only ones never recorded.
  --
  -- The fix is ordering, made explicit: log first, and let the CALLER decide to
  -- raise. A blocked assignment is surfaced to the dispatcher through the
  -- ops_alert below (which uses pg_net and therefore survives), while the
  -- durable row is written by the auto path and by every non-blocking outcome.
  perform public.log_cod_limit_event(
    p_driver_id, p_order_id, v_cap.outcome, v_cap.held_egp, v_cap.prospective_egp,
    v_cap.soft_limit_egp, v_cap.hard_limit_egp, v_cap.mode);

  if v_cap.outcome = 'blocked' then
    -- Alert BEFORE raising: ops_alert goes out over pg_net, which is not part
    -- of this transaction, so it survives the rollback that the raise causes.
    -- Without it a hard block would be completely invisible after the fact.
    begin
      perform public.ops_alert(
        '[COD] BLOCKED assignment: driver holds ' || v_cap.held_egp
        || ' EGP, +' || v_cap.prospective_egp || ' EGP this order (hard limit '
        || v_cap.hard_limit_egp || '). A hand-in restores capacity.');
    exception when others then null;
    end;
    -- A dispatcher chose this person; tell them plainly why it was refused and
    -- what fixes it. A stable error code so the UI can localise it.
    raise exception 'COD_LIMIT_EXCEEDED: driver holds % EGP, this order adds % EGP, hard limit is % EGP. A cash hand-in restores capacity.',
      v_cap.held_egp, v_cap.prospective_egp, v_cap.hard_limit_egp
      using errcode='check_violation';
  end if;

  update public.order_assignments set status='reassigned', responded_at=now() where order_id=p_order_id and status in ('offered','accepted');
  insert into public.order_assignments (order_id, driver_id, status, assigned_by, assigned_by_id) values (p_order_id,p_driver_id,'offered','dispatcher',v_user);
  update public.orders set assigned_driver_id=p_driver_id, rider=public.rider_snapshot(p_driver_id) where id=p_order_id;

  -- Crossing the soft limit is not a refusal, but ops should see it coming
  -- rather than discover it at the hard limit.
  if v_cap.outcome in ('warned','would_block') then
    begin
      perform public.ops_alert(
        case when v_cap.outcome = 'would_block'
             then '[COD observe] would have BLOCKED assignment: driver holds '
             else '[COD] driver over soft limit: holds ' end
        || v_cap.held_egp || ' EGP, +' || v_cap.prospective_egp
        || ' EGP this order (soft ' || v_cap.soft_limit_egp || ', hard ' || v_cap.hard_limit_egp || ')');
    exception when others then null;
    end;
  end if;

  -- [083] Notify the manually-assigned driver (was silent; recovery path when
  -- auto-dispatch fails). Best-effort; a push failure must not abort the assign.
  begin
    select profile_id into v_prof from public.drivers where id = p_driver_id;
    select value #>> '{}' into v_base from public.platform_settings where key='functions_base_url';
    if v_prof is not null and v_base is not null and v_base <> '' then
      perform net.http_post(
        url := v_base || '/expo-push',
        body := jsonb_build_object('event','new_offer','orderId',p_order_id::text,'recipientUserIds',jsonb_build_array(v_prof::text)),
        headers := public.push_headers());
    end if;
  exception when others then null;
  end;
end; $function$;

-- ---------------------------------------------------------------------------
-- auto_assign_order — cron path.
-- ---------------------------------------------------------------------------
create or replace function public.auto_assign_order(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_order public.orders; v_radius int; v_ttl int; v_driver uuid; v_prof uuid; v_asg_id uuid;
  v_base text; v_gold_driver uuid; v_first_look int; v_held_since timestamptz; v_reoffer_cd int;
  v_cap record;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then return null; end if;
  if exists (select 1 from public.order_assignments where order_id=p_order_id and status in ('offered','accepted')) then return null; end if;
  if v_order.status not in ('accepted','preparing','ready') then return null; end if;
  if v_order.dropoff_geo is null then return null; end if;
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
    from public.nearest_drivers(v_order.dropoff_geo, coalesce(v_radius,5000), 20) nd
   where not exists (select 1 from public.order_assignments oa where oa.order_id=p_order_id and oa.driver_id=nd.driver_id
              and (oa.status='offered' or (oa.status in ('rejected','reassigned') and oa.assigned_at > now() - make_interval(secs => coalesce(v_reoffer_cd,3600)))))
     and (select c.outcome from public.driver_cod_capacity(nd.driver_id, p_order_id) c) <> 'blocked'
   order by nd.distance_m asc limit 1;
  if v_driver is null then return null; end if;
  select dl.first_look_seconds into v_first_look from public.driver_loyalty dl where dl.driver_id = v_driver;
  if coalesce(v_first_look, 0) = 0 then
    select nd.driver_id into v_gold_driver
      from public.nearest_drivers(v_order.dropoff_geo, coalesce(v_radius,5000), 20) nd
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

comment on function public.assign_driver(uuid, uuid) is
  'Dispatcher assignment. Since mig 150 it applies the COD exposure ceiling and RAISES COD_LIMIT_EXCEEDED when enforcing -- a dispatcher chose this driver, so a refusal must be loud enough to redirect them. Crossing the soft limit warns ops but allows. Migs 083, 149, 150.';

comment on function public.auto_assign_order(uuid) is
  'Automatic dispatch. Since mig 150 the COD ceiling is a CANDIDATE FILTER: a driver at their hard limit is not offered the order, so the sweep continues to the next-nearest rather than leaving it unassigned. It deliberately does not raise -- this body swallows exceptions into a warning and returns null, so raising would stall the order entirely. Migs 149, 150.';
