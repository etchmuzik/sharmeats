-- Assertions for Package 07 governance hardening.
--
-- Run against a disposable database containing migrations through 192:
--
--   psql "$PGURI" -v ON_ERROR_STOP=1 --single-transaction \
--     -c "BEGIN;" \
--     -f supabase/migrations/20260730162600_p07_governance_hardening.sql \
--     -f supabase/tests/20260730162600_p07_governance_hardening.test.sql \
--     -c "ROLLBACK;"
--
-- This file is intentionally red before the migration: the food-only enum,
-- constraint, suppression vocabulary, transition barrier, and producer locks
-- do not exist.

\set ON_ERROR_STOP on

do $$
declare
  v_fail text[] := '{}';
  v_def text;
  v_after_lock text;
  v_constraint text;
  v_values text[];
  v_count int;
begin
  -- The generated/API domain must describe food cuisines only. The legacy
  -- cuisine_type remains for wire compatibility, but cannot be the write type.
  select array_agg(e.enumlabel order by e.enumsortorder)
    into v_values
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    join pg_enum e on e.enumtypid = t.oid
   where n.nspname = 'public' and t.typname = 'food_cuisine_type';

  if v_values is distinct from array[
    'italian','seafood','egyptian','sushi','healthy','burgers','cafe','asian',
    'pizza','breakfast','late_night','street_food','sweets'
  ] then
    v_fail := v_fail || format('food_cuisine_type has the wrong values: %s', v_values);
  end if;

  select pg_get_constraintdef(c.oid)
    into v_constraint
    from pg_constraint c
   where c.conrelid = 'public.restaurants'::regclass
     and c.conname = 'restaurants_cuisines_food_only';

  if v_constraint is null
     or position('grocery' in v_constraint) = 0
     or position('pharmacy' in v_constraint) = 0 then
    v_fail := v_fail || 'restaurants has no authoritative food-only cuisine constraint'::text;
  end if;

  if exists (
    select 1 from public.restaurants
     where cuisines && array['grocery','pharmacy']::public.cuisine_type[]
  ) then
    v_fail := v_fail || 'legacy grocery/pharmacy cuisine tags survived normalization'::text;
  end if;

  -- Direct writes are bound too, not only the admin UI.
  begin
    insert into public.restaurants (
      id, slug, name, cover_image, zone, vertical_id, cuisines
    ) values (
      '00000000-0000-4000-8000-000000000701',
      '_tp07-invalid-cuisine',
      'P07 invalid cuisine',
      '',
      'naama',
      'food',
      array['grocery']::public.cuisine_type[]
    );
    v_fail := v_fail || 'a direct write stored grocery as a cuisine'::text;
    delete from public.restaurants
     where id = '00000000-0000-4000-8000-000000000701';
  exception when check_violation then
    null;
  end;

  select count(*) into v_count
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'admin_update_restaurant'
     and pg_get_function_identity_arguments(p.oid)
         like '%p_cuisines food_cuisine_type[]%';
  if v_count <> 1 then
    v_fail := v_fail || format('admin_update_restaurant food-domain overload count is %s', v_count);
  end if;

  select count(*) into v_count
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'admin_update_restaurant';
  if v_count <> 1 then
    v_fail := v_fail || format('admin_update_restaurant has %s overloads (expected one)', v_count);
  end if;

  select count(*) into v_count
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'apply_as_restaurant'
     and pg_get_function_identity_arguments(p.oid)
         like '%p_cuisines food_cuisine_type[]%';
  if v_count <> 1 then
    v_fail := v_fail || format('apply_as_restaurant food-domain overload count is %s', v_count);
  end if;

  select count(*) into v_count
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'apply_as_restaurant';
  if v_count <> 1 then
    v_fail := v_fail || format('apply_as_restaurant has %s overloads (expected one)', v_count);
  end if;

  if exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('admin_update_restaurant','apply_as_restaurant')
       and (
         has_function_privilege('anon', p.oid, 'execute')
         or not has_function_privilege('authenticated', p.oid, 'execute')
       )
  ) then
    v_fail := v_fail || 'a cuisine write RPC has the wrong anon/authenticated ACL'::text;
  end if;

  if has_function_privilege(
       'authenticated',
       'private.enforce_package07_private_verticals()',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'private.enforce_package07_private_verticals()',
       'execute'
     ) then
    v_fail := v_fail || 'the private-stage repair is executable by a client role'::text;
  end if;

  select pg_get_constraintdef(c.oid)
    into v_constraint
    from pg_constraint c
   where c.conrelid = 'public.lifecycle_sends'::regclass
     and c.conname = 'lifecycle_sends_suppression_reason_check';
  if v_constraint is null or position('vertical_not_visible' in v_constraint) = 0 then
    v_fail := v_fail || 'lifecycle suppression vocabulary rejects vertical_not_visible'::text;
  end if;

  -- Both reminder producers must acquire the shared vertical transition lock
  -- before the authoritative visibility re-check, and must visit lock keys in
  -- the same deterministic order as other multi-vertical paths.
  foreach v_def in array array[
    pg_get_functiondef('public.abandoned_cart_sweep()'::regprocedure),
    pg_get_functiondef('public.reorder_cadence_sweep()'::regprocedure)
  ] loop
    if position('pg_advisory_lock_shared' in v_def) = 0 then
      v_fail := v_fail || 'a lifecycle producer has no shared vertical lock'::text;
    elsif position('pg_advisory_lock_shared' in v_def)
          > position('user_can_view_vertical' in v_def) then
      v_fail := v_fail || 'a lifecycle producer checks visibility before taking the lock'::text;
    end if;
    if position('v_vertical_lock := true' in v_def) = 0
       or position('v_vertical_lock := true' in v_def)
          > position('pg_advisory_lock_shared' in v_def) then
      v_fail := v_fail || 'a lifecycle producer marks its session lock only after acquisition'::text;
    end if;
    v_after_lock := substr(
      v_def,
      position('pg_advisory_lock_shared' in v_def)
    );
    if position('pg_advisory_unlock_shared' in v_after_lock) = 0
       or position('pg_advisory_unlock_shared' in v_after_lock)
          > position('lifecycle_record' in v_after_lock) then
      v_fail := v_fail || 'a lifecycle producer holds vertical while writing the user-FK ledger'::text;
    end if;
    if position('when query_canceled' in lower(v_def)) = 0 then
      v_fail := v_fail || 'a lifecycle producer can leak its session lock on timeout'::text;
    end if;
  end loop;

  v_def := pg_get_functiondef(
    'public.abandoned_cart_sweep()'::regprocedure
  );
  if position('order by r.vertical_id, c.user_id' in lower(v_def)) = 0 then
    v_fail := v_fail || 'abandoned_cart_sweep has no canonical vertical lock order'::text;
  end if;

  v_def := pg_get_functiondef(
    'public.reorder_cadence_sweep()'::regprocedure
  );
  if position('order by o.vertical_id, o.id' in lower(v_def)) = 0 then
    v_fail := v_fail || 'reorder_cadence_sweep has no canonical vertical lock order'::text;
  end if;

  select pg_get_functiondef(
    'private.enforce_package07_private_verticals()'::regprocedure
  ) into v_def;
  if position('pg_advisory_xact_lock' in v_def) = 0
     or position('update public.verticals' in lower(v_def)) = 0
     or position('pg_advisory_xact_lock' in v_def)
        > position('update public.verticals' in lower(v_def)) then
    v_fail := v_fail || 'the grocery/pharmacy private repair is not lock-first'::text;
  end if;
  if (select launch_stage from public.verticals where id = 'grocery') <> 'private'
     or (select launch_stage from public.verticals where id = 'pharmacy') <> 'private' then
    v_fail := v_fail || 'the Package 07 pilot verticals are not private'::text;
  end if;

  if array_length(v_fail, 1) > 0 then
    raise exception 'Package 07 governance assertions FAILED (%):%  - %',
      array_length(v_fail, 1), E'\n', array_to_string(v_fail, E'\n  - ');
  end if;
  raise notice 'Package 07 governance shape assertions PASSED';
end $$;

-- Functional suppression-ledger proof: both producers must persist the
-- vertical_not_visible decision instead of swallowing a constraint failure.
do $$
declare
  v_user uuid := '00000000-0000-4000-8000-000000000711';
  v_rest uuid := '00000000-0000-4000-8000-000000000712';
  v_order uuid := '00000000-0000-4000-8000-000000000713';
  v_count int;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at
  ) values (
    v_user, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', '_tp07@example.test', '',
    now(), now(), now()
  ) on conflict (id) do nothing;

  insert into public.users (id, role, phone, display_name, is_blocked)
  values (v_user, 'customer', '+201000000711', 'P07 customer', false)
  on conflict (id) do update set role = 'customer', is_blocked = false;

  insert into public.restaurants (
    id, slug, name, cover_image, zone, vertical_id,
    cuisines, is_active, is_open, min_order_egp
  ) values (
    v_rest, '_tp07-hidden', 'P07 hidden', '', 'naama', 'grocery',
    '{}'::public.cuisine_type[], true, true, 0
  ) on conflict (id) do update
    set vertical_id = 'grocery', cuisines = '{}', is_active = true, is_open = true;

  update public.verticals set launch_stage = 'private', is_active = true
   where id = 'grocery';
  update public.vertical_private_access
     set status = 'revoked', revoked_at = coalesce(revoked_at, now())
   where vertical_id = 'grocery' and user_id = v_user and status = 'active';
  delete from public.lifecycle_sends where user_id = v_user;

  insert into public.customer_carts (
    user_id, restaurant_id, items, updated_at, expires_at
  ) values (
    v_user, v_rest,
    jsonb_build_array(jsonb_build_object(
      'item_id', '00000000-0000-4000-8000-000000000719',
      'quantity', 1, 'modifier_option_ids', jsonb_build_array(), 'notes', ''
    )),
    now() - interval '25 hours', now() + interval '7 days'
  ) on conflict (user_id) do update
    set restaurant_id = excluded.restaurant_id,
        items = excluded.items,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at;

  perform public.abandoned_cart_sweep();

  select count(*) into v_count from public.lifecycle_sends
   where user_id = v_user
     and lifecycle_event = 'abandoned_cart'
     and suppression_reason = 'vertical_not_visible'
     and not would_send;
  if v_count <> 1 then
    raise exception 'abandoned_cart_sweep wrote % vertical_not_visible rows, expected 1', v_count;
  end if;

  insert into public.orders (
    id, short_code, user_id, restaurant_id, restaurant_name,
    address_snapshot, items, subtotal_egp, delivery_fee_egp, tax_egp,
    total_egp, eta_at, status, payment_method, payment_method_kind,
    payment_label, delivered_at, vertical_id
  ) values (
    v_order, 'TP07R', v_user, v_rest, 'P07 hidden',
    '{}'::jsonb, '[]'::jsonb, 10, 0, 0, 10, now(),
    'delivered', 'cash_on_delivery', 'cash', 'Cash',
    now() - interval '8 days', 'grocery'
  ) on conflict (id) do update
    set delivered_at = now() - interval '8 days',
        status = 'delivered',
        vertical_id = 'grocery';

  perform public.reorder_cadence_sweep();

  select count(*) into v_count from public.lifecycle_sends
   where user_id = v_user
     and lifecycle_event = 'reorder_cadence'
     and subject_id = v_order
     and suppression_reason = 'vertical_not_visible'
     and not would_send;
  if v_count <> 1 then
    raise exception 'reorder_cadence_sweep wrote % vertical_not_visible rows, expected 1', v_count;
  end if;

  raise notice 'Package 07 lifecycle suppression ledger assertions PASSED';
end $$;
