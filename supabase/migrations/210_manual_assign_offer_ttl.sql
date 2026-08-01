-- 210_manual_assign_offer_ttl.sql
--
-- A dispatcher's manual assignment created an offer that could never expire.
--
-- FOUND 2026-08-01 from an ops alert the operator noticed had been repeating
-- hourly since the previous day:
--
--   [dispatch] 1 order(s) stuck:
--   stale_offer · 6d0fbc27 · ready · 11175.8m · offer outstanding with no response
--
-- THE LOOP, both halves of it:
--
--   1. assign_driver (the dispatcher path) inserted the assignment WITHOUT
--      offer_expires_at:
--
--        insert into public.order_assignments
--          (order_id, driver_id, status, assigned_by, assigned_by_id)
--        values (p_order_id, p_driver_id, 'offered', 'dispatcher', v_user);
--
--      auto_assign_order sets `now() + dispatch_offer_ttl_seconds` on the same
--      column. Only the manual path omitted it, so only manual offers were
--      born without a deadline.
--
--   2. dispatch_sweep then refused to expire exactly those rows:
--
--        where status = 'offered'
--          and offer_expires_at is not null      <-- the immortality clause
--          and offer_expires_at < now()
--
--      The NULL guard reads as defensive and is the opposite. A missing
--      deadline should mean "this offer has no business being outstanding",
--      not "keep it forever". Absence of evidence failing OPEN is the same
--      shape as house rule 4, and the same shape as the stale-ping bug fixed
--      in migration 201 — which is why this uses that migration's remedy,
--      coalesce to -infinity, rather than inventing a third idiom.
--
-- The consequence is not just noise. The offer never expires, so the sweep
-- never recycles the order to another driver: a manual assignment to someone
-- who never responds strands the order permanently. The hourly alert was the
-- only symptom visible, and it was telling the truth.
--
-- Three rows exist in this state, all created by a dispatcher on 2026-07-24
-- within three seconds of each other. Two belong to orders since cancelled;
-- the third is DEMO04, which is what has been alerting. Part 2 retires all
-- three on the next sweep.
--
-- House rules: both bodies were taken from prod's pg_get_functiondef, not from
-- an older migration (rule 2); neither argument list changes, so no second
-- overload is created (rule 1); grants are re-asserted below (rule 3).

-- ---------------------------------------------------------------------------
-- 1. The manual path gets the same TTL the automatic path has always had.
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
  v_order public.orders%rowtype;   -- [202 F-11]
  v_previous uuid;                 -- [202 F-12]
  v_ttl int;                       -- [210]
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode='check_violation'; end if;
  if coalesce(v_role::text,'') not in ('admin','dispatcher') then raise exception 'NOT_AUTHORIZED' using errcode='check_violation'; end if;

  -- [202 F-11] Lock and validate the ORDER before anything else. Same lock
  -- order as auto_assign_order (order row first), so a manual assign and the
  -- 20s sweep serialise instead of racing into two live offers. Fails closed on
  -- a NULL status.
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode='check_violation'; end if;
  if coalesce(v_order.status::text,'') not in ('placed','accepted','preparing','ready','picked_up','out_for_delivery') then
    raise exception 'ORDER_NOT_ASSIGNABLE: order is % — assign only applies to a live order',
      coalesce(v_order.status::text,'unknown') using errcode='check_violation';
  end if;
  v_previous := v_order.assigned_driver_id;

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

  -- [202 F-12] Release the driver we just displaced, before repointing the
  -- order. Guarded so we never touch the incoming driver and never resurrect
  -- someone who deliberately went offline: exactly the mig-054 pattern, applied
  -- on the path mig 054 did not cover.
  if v_previous is not null and v_previous is distinct from p_driver_id then
    update public.drivers set status='online' where id=v_previous and status='on_job';
  end if;

  -- [210] THE FIX. Same TTL source and same default (45s) as auto_assign_order,
  -- read here rather than hardcoded so tuning dispatch_offer_ttl_seconds moves
  -- both paths together. Without this the row is born with a NULL deadline and
  -- dispatch_sweep can never retire it — the order is stranded on a driver who
  -- may never answer, and the stuck-order watchdog reports it hourly forever.
  select (value #>> '{}')::int into v_ttl
    from public.platform_settings where key = 'dispatch_offer_ttl_seconds';

  insert into public.order_assignments (order_id, driver_id, status, assigned_by, assigned_by_id, offer_expires_at)
  values (p_order_id,p_driver_id,'offered','dispatcher',v_user, now() + make_interval(secs => coalesce(v_ttl,45)));
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
end;
$function$;

revoke all on function public.assign_driver(uuid, uuid) from public, anon;
grant execute on function public.assign_driver(uuid, uuid) to authenticated, service_role;

comment on function public.assign_driver(uuid, uuid) is
  'Manual dispatcher assignment. Sets offer_expires_at from platform_settings.dispatch_offer_ttl_seconds exactly as auto_assign_order does — before migration 210 it did not, so a manual offer had no deadline, dispatch_sweep could never retire it, and an unanswered assignment stranded the order permanently while the watchdog alerted hourly.';

-- ---------------------------------------------------------------------------
-- 2. A missing deadline now means EXPIRED, not IMMORTAL.
--
--    Retires the three NULL-deadline rows that already exist, and makes the
--    sweep robust to any future path that forgets the column.
-- ---------------------------------------------------------------------------
create or replace function public.dispatch_sweep()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_default text;
  v_count   int := 0;
  v_rec     record;
begin
  with expired as (
    update public.order_assignments
       set status = 'expired', responded_at = now()
     where status = 'offered'
       -- [210] was: `and offer_expires_at is not null and offer_expires_at < now()`
       -- A row with no deadline could never satisfy that, so it stayed 'offered'
       -- forever and the order it pinned was never recycled. coalesce to
       -- -infinity treats "no deadline" as "already past", matching migration
       -- 201's handling of a missing last_ping_at. An offer with no expiry is
       -- not an offer with infinite time; it is a bug, and this retires it.
       and coalesce(offer_expires_at, '-infinity'::timestamptz) < now()
    returning order_id
  )
  update public.orders o
     set assigned_driver_id = null
    from expired e
   where o.id = e.order_id
     and o.status not in ('picked_up','out_for_delivery','delivered');

  select coalesce((value #>> '{}'), 'manual') into v_default
    from public.platform_settings where key = 'dispatch_mode';

  for v_rec in
    select o.id
      from public.orders o
      left join public.zones z on z.id = o.zone
     where o.status in ('accepted','preparing','ready')
       and o.dropoff_geo is not null
       and (o.payment_method = 'cash_on_delivery' or o.payment_status = 'paid')
       and coalesce(z.dispatch_mode, v_default) = 'auto'
       and not exists (
             select 1 from public.order_assignments oa
              where oa.order_id = o.id and oa.status in ('offered','accepted')
           )
     order by o.placed_at asc
     limit 50
  loop
    if public.auto_assign_order(v_rec.id) is not null then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$function$;

revoke all on function public.dispatch_sweep() from public, anon, authenticated;
grant execute on function public.dispatch_sweep() to service_role;

comment on function public.dispatch_sweep() is
  'Every-20s dispatch tick: retires expired offers, then auto-assigns eligible orders. Since migration 210 an assignment with a NULL offer_expires_at counts as expired rather than immortal — the previous `is not null` guard meant any offer created without a deadline (every manual dispatcher assignment, until 210 fixed assign_driver) stranded its order permanently.';
