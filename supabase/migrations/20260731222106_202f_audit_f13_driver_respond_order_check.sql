-- ============================================================================
-- TRANSCRIPT OF AN ALREADY-APPLIED MIGRATION — DO NOT RE-APPLY TO PRODUCTION.
--
--   prod ledger version : 20260731222106
--   prod ledger name    : 202f_audit_f13_driver_respond_order_check
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
-- of driver_respond(uuid, boolean). Anyone changing that function must start
-- from THIS text, not from mig 030's copy, or the F-13 live-order re-check is
-- silently reverted.
--
-- The body below this marker is reproduced verbatim, including its own original
-- header comments (which refer to a "202" file that was never committed) and its
-- own numbering claims. Those are left untouched on purpose: this records what
-- ran, not what we wish had run. Verified byte-for-byte against the prod ledger
-- (md5 2e56211d0dcdaf007c30e8b6253f34f8).
-- ============================================================================
-- ===== BEGIN TRANSCRIPT =====
-- 202 section F-13 — driver_respond refuses an order that is no longer live.
--
-- Body copied VERBATIM from mig 030 (the current definition) with ONE insertion,
-- marked [202]. Admin/dispatcher may cancel from any non-terminal state, and the
-- terminal driver-release runs at cancel time — i.e. BEFORE a driver who still
-- holds a live offer taps accept. Within the 45s offer TTL that driver could
-- accept a cancelled order: the assignment became `accepted` permanently,
-- drivers.status became `on_job` with no future transition to ever release it,
-- and the driver was sent to a restaurant for food never to be handed over.
--
-- The reject path is deliberately untouched: it clears both assigned_driver_id
-- and the rider snapshot so the customer card reverts to "finding a driver",
-- and the accept path uses rider_snapshot() rather than inline jsonb.

create or replace function public.driver_respond(p_assignment_id uuid, p_accept boolean)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_asg  public.order_assignments;
  v_drv  public.drivers;
  v_order public.orders;   -- [202 F-13]
begin
  select * into v_asg from public.order_assignments where id = p_assignment_id for update;
  if not found then raise exception 'ASSIGNMENT_NOT_FOUND' using errcode = 'check_violation'; end if;

  select * into v_drv from public.drivers where id = v_asg.driver_id;
  if v_drv.profile_id is distinct from v_user then
    raise exception 'NOT_YOUR_ASSIGNMENT' using errcode = 'check_violation';
  end if;
  if v_asg.status <> 'offered' then
    raise exception 'ALREADY_RESPONDED' using errcode = 'check_violation';
  end if;

  if p_accept then
    -- [030] only a verified, active driver may ACCEPT work. (Reject falls
    -- through below and is always permitted.)
    if not (v_drv.is_verified and v_drv.is_active) then
      raise exception 'DRIVER_NOT_ELIGIBLE: driver must be active and verified to accept'
        using errcode = 'check_violation';
    end if;

    -- [202 F-13] The parent order must still be live at the moment of
    -- acceptance. Locked so a concurrent cancel cannot slip in between this
    -- check and the writes below; fails closed on a NULL status. The dead offer
    -- is retired first so the driver cannot retry it.
    select * into v_order from public.orders where id = v_asg.order_id for update;
    if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'check_violation'; end if;
    if coalesce(v_order.status::text,'') not in ('placed','accepted','preparing','ready') then
      update public.order_assignments set status = 'reassigned', responded_at = now() where id = p_assignment_id;
      raise exception 'ORDER_NO_LONGER_AVAILABLE: this order is % — the offer has been withdrawn',
        coalesce(v_order.status::text,'unknown') using errcode = 'check_violation';
    end if;

    update public.order_assignments set status = 'accepted', responded_at = now() where id = p_assignment_id;
    update public.drivers set status = 'on_job' where id = v_asg.driver_id;
    -- Customer-facing: fill the rider card now that a real driver owns the order.
    update public.orders
       set rider = public.rider_snapshot(v_asg.driver_id)
     where id = v_asg.order_id;
  else
    update public.order_assignments set status = 'rejected', responded_at = now() where id = p_assignment_id;
    -- Clear both the id and the snapshot so the card reverts to "finding a driver".
    update public.orders set assigned_driver_id = null, rider = null where id = v_asg.order_id;
  end if;
end;
$$;

comment on function public.driver_respond(uuid, boolean) is
  'A driver accepts or declines an offer. Accepting now re-checks the parent order under lock (mig 202, audit F-13: a driver could accept an order cancelled seconds earlier, becoming permanently on_job with no job and being sent to collect food that would never be handed over).';

revoke all on function public.driver_respond(uuid, boolean) from public, anon;
grant execute on function public.driver_respond(uuid, boolean) to authenticated, service_role;
