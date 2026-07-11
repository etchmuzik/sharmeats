-- 098_admin_restaurant_and_user_rpcs.sql
--
-- The admin web UI lost three capabilities when mig 081 tightened privilege
-- escalation and the base RLS stayed self-scoped. All three are "the security
-- hardening won, the admin UI lost" — the fix is NOT to re-widen table grants
-- (that would hand every authenticated user restaurant-editing / user-reading
-- power), but to route the admin actions through admin-gated SECURITY DEFINER
-- RPCs, exactly like review_kyc_document / generate_settlements already do.
--
-- What was broken:
--   1. admin_update_restaurant — mig 081 revoked table UPDATE on public.restaurants
--      and re-granted ONLY the is_open column (for the merchant/restaurant toggle),
--      so RestaurantEditor's 16-column save got 42501 permission denied. Admins
--      could not onboard (create-inactive → fill details → activate) or edit any
--      restaurant via the web UI.
--   2. admin_delete_restaurant — there is NO delete policy on public.restaurants,
--      so the editor's .delete() was RLS-filtered to 0 rows and PostgREST returned
--      no error → the UI toasted "deleted" while the row survived (false success).
--   3. admin_resolve_user_names — the only SELECT policy on public.users is
--      self-only (002), with no admin arm, so the support inbox's bulk name lookup
--      returned just the admin's own row and every customer thread showed a UUID.
--
-- House invariants honored (see supabase-definer-rpc-anon-grant):
--   * SECURITY DEFINER + SET search_path = public, pg_temp (no mutable path).
--   * Admin gate uses coalesce(auth_role()::text,'') <> 'admin' — the coalesce is
--     load-bearing: a bare NULL <> 'admin' is NULL (fails OPEN); coalesce('')
--     makes it fail CLOSED for any non-admin / anon / NULL-role caller.
--   * EXECUTE revoked from public, anon (revoke-from-anon alone is a no-op while
--     the inherited PUBLIC grant remains) and granted only to authenticated; the
--     in-body admin check is the real authority, the grant is defense in depth.
--
-- Forward-only, idempotent (create-or-replace + revoke/grant). No base-table
-- grants or policies are widened. Rollback: drop the three functions.

-- 1) Admin edits a restaurant's details. Enum-typed params (zone, cuisines)
--    reject invalid values at the boundary. is_open is included so the editor's
--    "Open now" toggle keeps working through the same path.
create or replace function public.admin_update_restaurant(
  p_id             uuid,
  p_name           text,
  p_description    text,
  p_cuisines       public.cuisine_type[],
  p_cuisine_label  text,
  p_cover_image    text,
  p_logo           text,
  p_zone           public.zone_type,
  p_prep_time_low  int,
  p_prep_time_high int,
  p_delivery_fee_egp int,
  p_min_order_egp  int,
  p_tourist_safe   boolean,
  p_is_open        boolean,
  p_is_open_24h    boolean,
  p_featured       boolean,
  p_promo          text,
  p_is_active      boolean
) returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'NAME_REQUIRED' using errcode = 'check_violation';
  end if;

  update public.restaurants set
    name            = btrim(p_name),
    description      = p_description,
    cuisines        = p_cuisines,
    cuisine_label   = p_cuisine_label,
    cover_image     = p_cover_image,
    logo            = p_logo,
    zone            = p_zone,
    prep_time_low   = p_prep_time_low,
    prep_time_high  = p_prep_time_high,
    delivery_fee_egp= p_delivery_fee_egp,
    min_order_egp   = p_min_order_egp,
    tourist_safe    = p_tourist_safe,
    is_open         = p_is_open,
    is_open_24h     = p_is_open_24h,
    featured        = p_featured,
    promo           = p_promo,
    is_active       = p_is_active
  where id = p_id;

  if not found then
    raise exception 'RESTAURANT_NOT_FOUND' using errcode = 'check_violation';
  end if;
end;
$$;

-- 2) Admin hard-deletes a restaurant (menu rows cascade via FK). Row-count
--    checked so the UI can no longer report a false success.
create or replace function public.admin_delete_restaurant(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  delete from public.restaurants where id = p_id;
  if not found then
    raise exception 'RESTAURANT_NOT_FOUND' using errcode = 'check_violation';
  end if;
end;
$$;

-- 3) Admin resolves display names for a set of user ids (support inbox). Returns
--    only id + display_name — never phone or other PII — so it is the minimal
--    projection the inbox needs, not a blanket users read.
create or replace function public.admin_resolve_user_names(p_ids uuid[])
returns table (id uuid, display_name text)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  return query
    select u.id, u.display_name
    from public.users u
    where u.id = any(coalesce(p_ids, '{}'::uuid[]));
end;
$$;

-- Grant discipline: revoke the inherited PUBLIC/anon EXECUTE, grant only to
-- authenticated. The admin gate inside each body is the real authority.
revoke execute on function public.admin_update_restaurant(
  uuid, text, text, public.cuisine_type[], text, text, text, public.zone_type,
  int, int, int, int, boolean, boolean, boolean, boolean, text, boolean
) from public, anon;
grant execute on function public.admin_update_restaurant(
  uuid, text, text, public.cuisine_type[], text, text, text, public.zone_type,
  int, int, int, int, boolean, boolean, boolean, boolean, text, boolean
) to authenticated;

revoke execute on function public.admin_delete_restaurant(uuid) from public, anon;
grant  execute on function public.admin_delete_restaurant(uuid) to authenticated;

revoke execute on function public.admin_resolve_user_names(uuid[]) from public, anon;
grant  execute on function public.admin_resolve_user_names(uuid[]) to authenticated;
