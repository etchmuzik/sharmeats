-- =====================================================================
-- 022_account_deletion.sql
-- Self-service account deletion — Apple App Store Guideline 5.1.1(v).
--
-- Strategy: ANONYMIZE & RETAIN orders, then HARD-delete the auth identity.
-- The auth.users delete cascades auth.users -> public.users ->
-- addresses / payment_methods / push_tokens / favorites / merchant_staff.
-- The only thing blocking that cascade is orders.user_id (was NOT NULL +
-- ON DELETE RESTRICT). We resolve it structurally (nullable + SET NULL) and
-- detach + PII-scrub the user's orders inside a SECURITY DEFINER RPC that the
-- delete-account Edge Function calls before auth.admin.deleteUser().
--
-- Applies on top of 001-021. Respects project RPC conventions
-- (SECURITY DEFINER, set search_path = public, pg_temp; raise check_violation).
-- Idempotent: every DDL step is guarded; the RPC only touches the caller's
-- not-yet-detached rows.
--
-- GROUND-TRUTH NOTE: PII on a retained order lives in MORE than one place, so
-- the scrub is default-deny across the WHOLE order row, not just one column:
--   * address_snapshot = to_jsonb(<addresses row>) -> contains every addresses
--     column (room_number, street_text, building, apartment, landmark,
--     beach_name, hotel_name, geo, label, user_id...). Rebuilt from an
--     ALLOWLIST keeping only the coarse, non-identifying `kind`.
--   * dropoff_geo (geography Point) holds the SAME GPS pin at the top level
--     (set from v_addr.geo in place_order) -> nulled; coarse `zone` retained.
--   * kitchen_notes / cancel_reason -> customer free text -> nulled.
--   * aggregate_allergens -> health data -> nulled.
--   * rider (a driver) -> replaced wholesale.
--   * items[].notes, order_items.notes, order_status_events.note -> free text
--     -> scrubbed; history -> reset to [].
-- Retained: amounts, status, restaurant, timestamps, coarse zone (the
-- financial/audit skeleton).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Resolve the orders.user_id FK blocker.
-- ---------------------------------------------------------------------

-- 1a. Preserve original owner id for tax/audit forensics. No FK -> survives
--     the user delete. Intentionally not referencing users(id).
alter table public.orders
  add column if not exists deleted_user_ref uuid;

comment on column public.orders.deleted_user_ref is
  'Original orders.user_id, retained for legal/tax/audit after the owning account was deleted. Intentionally NOT a foreign key.';

-- 1b. Compliance + idempotency marker.
alter table public.orders
  add column if not exists anonymized_at timestamptz;

comment on column public.orders.anonymized_at is
  'When this order''s PII was scrubbed because its owner deleted their account. NULL = live order.';

-- 1c. Allow user_id to be NULL (so ON DELETE SET NULL is a legal action and
--     the RPC can detach orders).
alter table public.orders
  alter column user_id drop not null;

-- 1d. Drop EVERY foreign key on orders.user_id (name-agnostic loop). A scalar
--     SELECT INTO would abort on >1 match or leave a leftover RESTRICT FK that
--     still blocks the cascade.
do $$
declare
  v_conname text;
begin
  for v_conname in
    select con.conname
    from pg_constraint con
    join pg_class rel     on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'orders'
      and con.contype = 'f'
      and (
        select att.attname
        from pg_attribute att
        where att.attrelid = con.conrelid
          and att.attnum = con.conkey[1]
      ) = 'user_id'
  loop
    execute format('alter table public.orders drop constraint %I', v_conname);
  end loop;
end $$;

-- 1e. Recreate the FK as ON DELETE SET NULL, guarded so re-apply is a no-op.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_user_id_fkey'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_user_id_fkey
      foreign key (user_id) references public.users(id) on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. anonymize_my_account() — detach + PII-scrub the caller's orders.
--    Derives the caller from auth.uid() ONLY (never a passed-in id), so every
--    write is scoped to the caller's own rows and it cannot touch other users'
--    data even though `authenticated` may EXECUTE it.
-- ---------------------------------------------------------------------
create or replace function public.anonymize_my_account()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'No authenticated user in context'
      using errcode = 'check_violation';
  end if;

  -- 2a. ACTIVE-ORDER GUARD. Refuse while an order is in flight: detaching and
  --     scrubbing it would destroy the address/room/GPS/contact the active
  --     delivery (and any refund/support path) needs. The Edge Function maps
  --     this to HTTP 409 so the client tells the user to finish/cancel first.
  --     Terminal statuses per order_status_type (mig 002/009): delivered,
  --     cancelled, rejected.
  if exists (
    select 1 from public.orders
    where user_id = v_uid
      and status not in ('delivered', 'cancelled', 'rejected')
  ) then
    raise exception 'ACTIVE_ORDER'
      using errcode = 'check_violation';
  end if;

  -- 2b. Detach + scrub the caller's orders (idempotent: only rows still owned).
  --     DEFAULT-DENY across the WHOLE order row — every column that can carry
  --     identity, location, free text, or health data is nulled/rebuilt, not
  --     just address_snapshot. Retained columns are the financial/operational
  --     skeleton (amounts, status, restaurant, timestamps, coarse zone), which
  --     is what the tax/audit record needs.
  --       address_snapshot : to_jsonb(<full addresses row>) -> ALLOWLIST rebuild
  --                          keeping only the coarse, non-identifying `kind`.
  --       rider            : a driver (a person) -> replaced wholesale.
  --       dropoff_geo      : the customer's exact GPS pin (geography Point) ->
  --                          nulled. The coarse `zone` is retained for analytics.
  --       kitchen_notes /  : customer free text ("ring room 412, ask for Sarah,
  --       cancel_reason      +20…") -> nulled.
  --       aggregate_allergens: health data -> nulled.
  --       items            : line snapshots can carry per-line `notes` free
  --                          text -> strip the notes from each element.
  --       history          : append-only status log that can carry notes ->
  --                          reset to an empty array.
  update public.orders o
  set
    deleted_user_ref    = coalesce(o.deleted_user_ref, o.user_id),
    user_id             = null,
    anonymized_at       = now(),
    address_snapshot    = case
      when o.address_snapshot is null then null
      else jsonb_strip_nulls(jsonb_build_object(
        'kind',       o.address_snapshot -> 'kind',
        'anonymized', to_jsonb(true)
      ))
    end,
    rider               = case when o.rider is null then null
                               else jsonb_build_object('anonymized', true) end,
    dropoff_geo         = null,
    kitchen_notes       = null,
    cancel_reason       = null,
    aggregate_allergens = null,
    items               = case
      when o.items is null then null
      else (
        select coalesce(jsonb_agg(elem - 'notes'), '[]'::jsonb)
        from jsonb_array_elements(o.items) as elem
      )
    end,
    history             = '[]'::jsonb
  where o.user_id = v_uid;

  -- 2c. Scrub free-text notes on the caller's own order status events
  --     (e.g. "delivered to room 412"). Scoped via the retained owner ref
  --     (deleted_user_ref was just set in 2b above) so we never touch other
  --     customers' audit trails. actor_id is left to its existing ON DELETE
  --     SET NULL (handled, correctly scoped, by the cascade).
  update public.order_status_events e
  set note = null
  from public.orders o
  where e.order_id = o.id
    and o.deleted_user_ref = v_uid
    and e.note is not null;

  -- 2d. order_items (-> orders ON DELETE CASCADE) are retained with the orders;
  --     scrub their per-line free-text `notes` (e.g. "no onions, room 412").
  update public.order_items oi
  set notes = null
  from public.orders o
  where oi.order_id = o.id
    and o.deleted_user_ref = v_uid
    and oi.notes is not null;

  -- 2e. Everything else is handled by the auth.users -> public.users cascade:
  --       addresses / payment_methods / push_tokens / favorites /
  --       merchant_staff           -> ON DELETE CASCADE (removed with the user)
  --       order_status_events.actor_id, promo_redemptions.user_id,
  --       drivers.profile_id, order_assignments.assigned_by_id
  --                                -> ON DELETE SET NULL (nulled by the cascade)
  --       users.default_address_id / default_payment_method_id
  --                                -> the users row itself is removed.
end;
$$;

comment on function public.anonymize_my_account() is
  'Blocks while an active order exists, then detaches + PII-scrubs (allowlist rebuild) the calling user''s orders so a subsequent auth.users hard-delete cascades past orders.user_id (now ON DELETE SET NULL). Acts only on auth.uid(). Idempotent. Called by the delete-account Edge Function before auth.admin.deleteUser.';

-- ---------------------------------------------------------------------
-- 3. Least-privilege EXECUTE. Only signed-in users (acting on themselves)
--    and service_role. service_role cannot abuse it: with no user JWT,
--    auth.uid() is NULL and the RPC raises check_violation.
-- ---------------------------------------------------------------------
revoke all on function public.anonymize_my_account() from public;
grant execute on function public.anonymize_my_account() to authenticated, service_role;

commit;

-- =====================================================================
-- ROLLBACK NOTE (forward-only): once any order has user_id = NULL, re-adding
-- NOT NULL is unsafe. Treat the FK relaxation as forward-only.
-- =====================================================================
