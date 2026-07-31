-- ============================================================================
-- TRANSCRIPT OF AN ALREADY-APPLIED MIGRATION — DO NOT RE-APPLY TO PRODUCTION.
--
--   prod ledger version : 20260731222016
--   prod ledger name    : 202e_audit_f11_f12_assign_driver_lock_and_release
--   applied to prod     : 2026-07-31 (directly, with no file in this repo)
--   reconstructed       : 2026-08-01, from
--                         supabase_migrations.schema_migrations.statements
--
-- WHY THIS FILE EXISTS. On 2026-07-31 eleven migrations were applied straight to
-- production and never committed. The repo therefore no longer described the
-- database. This file is a byte-exact copy of what production recorded, written
-- back so that (a) the repo describes production again, and (b) a fresh database
-- rebuilt by replaying supabase/migrations/ ends up in the same state.
--
-- WHAT IT IS NOT. It is not a change. Production ALREADY has everything below.
-- Do not point this at production, do not "re-run it to be sure", and do not
-- edit it to fix a defect — a later, higher-numbered migration does that. Editing
-- a transcript makes the repo lie about production a second time.
--
-- HOUSE RULE 2 APPLIES TO THE NEXT PERSON. This body is now the latest version
-- of assign_driver(uuid, uuid). Anyone changing that function must start from
-- THIS text, not from mig 150's copy, or the F-11 order lock and the F-12
-- displaced-driver release are silently reverted. Note also the lock ORDER —
-- the order row is locked before the driver row, matching auto_assign_order —
-- which is what keeps the manual path and the 20s sweep from deadlocking.
--
-- The body below this marker is reproduced verbatim, including its own original
-- header comments (which refer to a "202" file that was never committed) and its
-- own numbering claims. Those are left untouched on purpose: this records what
-- ran, not what we wish had run. Verified byte-for-byte against the prod ledger
-- (md5 33873e5fca712812b72709e93a361e51).
-- ============================================================================
-- ===== BEGIN TRANSCRIPT =====
-- 202 section F-11 / F-12 — assign_driver validates, locks, and releases the
-- displaced driver.
--
-- Body copied VERBATIM from mig 150 (the current definition — it carries the
-- mig 149/150 COD exposure ceiling, the log-before-raise ordering, the ops
-- alerts and the mig 083 assign push) with exactly two insertions, marked [202]:
--
--   F-11: the order is SELECTed FOR UPDATE and its status validated.
--         Previously assign_driver never read public.orders at all, so a
--         dispatcher could offer a delivered/cancelled order, and there was no
--         lock to serialise against auto_assign_order's 20s sweep (two live
--         offers, two drivers at one restaurant). The order row is locked FIRST,
--         matching auto_assign_order's lock order, so they cannot deadlock.
--
--   F-12: the displaced driver is returned to `online`. The mig-054 release only
--         ever runs inside advance_order_status keyed to the NEW driver, so every
--         manual rescue silently retired a real driver from dispatch for the rest
--         of their shift while their app still read "online · receiving offers".

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

comment on function public.assign_driver(uuid, uuid) is
  'Dispatcher/admin manual assignment. Locks and validates the order (mig 202, audit F-11: previously it never read public.orders, so terminal orders could be offered and it raced the 20s sweep into two live offers) and returns the displaced driver to `online` (audit F-12: the mig-054 release only covered advance_order_status, so every manual rescue silently retired a real driver from dispatch). Retains the mig 149/150 COD ceiling and the mig 083 assign push.';

revoke all on function public.assign_driver(uuid, uuid) from public, anon;
grant execute on function public.assign_driver(uuid, uuid) to authenticated, service_role;
