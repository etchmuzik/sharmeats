-- ============================================================================
-- TRANSCRIPT OF AN ALREADY-APPLIED MIGRATION — DO NOT RE-APPLY TO PRODUCTION.
--
--   prod ledger version : 20260731221911
--   prod ledger name    : 202d_audit_f10_proof_path_fails_closed
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
-- of record_delivery_proof(uuid, text). Anyone changing that function must start
-- from THIS text, not from mig 194's copy, or the fail-closed path guard is
-- silently reverted.
--
-- The body below this marker is reproduced verbatim, including its own original
-- header comments (which refer to a "202" file that was never committed) and its
-- own numbering claims. Those are left untouched on purpose: this records what
-- ran, not what we wish had run. Verified byte-for-byte against the prod ledger
-- (md5 0b87957b7da47877fb72b6bc769fae7d).
-- ============================================================================
-- ===== BEGIN TRANSCRIPT =====
-- 202 section F-10 — record_delivery_proof path guard fails CLOSED.
--
-- Mig 194 wrote:
--     if p_storage_path is null
--        or p_storage_path <> v_user::text || '/' || p_order_id::text ||
--           substring(p_storage_path from '-[0-9]+\.(?:jpg|jpeg|png|webp)$')
-- When the path does NOT end in -<digits>.<ext>, substring() returns NULL, the
-- concatenation becomes NULL, `<> NULL` is NULL, `false OR NULL` is NULL, and
-- plpgsql treats that as false — so the raise never fired and ANY path was
-- accepted. A driver could mint a delivery_proofs row with no bytes behind it,
-- whitewashing ops_deliveries_missing_proof, the one control policing
-- photo-less leave_at_door/no_bell COD deliveries.
--
-- Body copied VERBATIM from mig 194 (it carries the driver role check and the
-- out_for_delivery/delivered handoff gate) with ONE change: the path guard.

create or replace function public.record_delivery_proof(p_order_id uuid, p_storage_path text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user      uuid := auth.uid();
  v_role      app_role := public.auth_role();
  v_driver_id uuid;
  v_order     public.orders;
  v_suffix    text;   -- [202 F-10]
  v_id        uuid;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;

  -- House rule 4: fail CLOSED. `v_role <> 'driver'` is NULL when the role is
  -- NULL, and a NULL guard passes, which would let a role-less caller through.
  if coalesce(v_role::text, '') <> 'driver' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'check_violation';
  end if;

  select d.id into v_driver_id
    from public.drivers d
   where d.profile_id = v_user
     and d.id = v_order.assigned_driver_id;
  if v_driver_id is null then
    raise exception 'NOT_ASSIGNED_DRIVER' using errcode = 'check_violation';
  end if;

  -- Proof belongs to the handoff. `delivered` is allowed because the app records
  -- the row immediately AFTER advancing status (so a slow upload can never block
  -- the transition); anything earlier than out_for_delivery is not a handoff.
  if v_order.status not in ('out_for_delivery', 'delivered') then
    raise exception 'ORDER_NOT_AT_HANDOFF: status is %', v_order.status
      using errcode = 'check_violation';
  end if;

  -- Re-assert the path shape the storage policy enforces. The bytes and the
  -- index are written by two different statements; without this a driver could
  -- index a path pointing at somebody else's prefix.
  --
  -- [202 F-10] Compute the suffix first, reject a non-match explicitly, and
  -- compare with IS DISTINCT FROM so no branch can NULL its way through.
  v_suffix := substring(p_storage_path from '-[0-9]+\.(?:jpg|jpeg|png|webp)$');

  if p_storage_path is null
     or v_suffix is null
     or p_storage_path is distinct from v_user::text || '/' || p_order_id::text || v_suffix
  then
    raise exception 'INVALID_PROOF_PATH' using errcode = 'check_violation';
  end if;

  -- ::text explicitly — orders.dropoff_preference is the public.dropoff_preference
  -- ENUM, and storing it as text keeps this evidence row readable even if the
  -- enum gains or loses a label later.
  insert into public.delivery_proofs (order_id, driver_id, storage_path, dropoff_preference)
  values (p_order_id, v_driver_id, p_storage_path, v_order.dropoff_preference::text)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.record_delivery_proof(uuid, text) is
  'Indexes a delivery-proof photo for an order the caller is the assigned driver of. The storage path must be exactly <uid>/<order_id>-<epoch>.<ext>; a path not matching that shape is REJECTED (mig 202, audit F-10 — mig 194''s guard NULL-propagated and accepted any suffix-less path, letting a driver mint a proof row with no bytes behind it and whitewash ops_deliveries_missing_proof).';

revoke all on function public.record_delivery_proof(uuid, text) from public, anon;
grant execute on function public.record_delivery_proof(uuid, text) to authenticated, service_role;
