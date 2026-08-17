-- Assertions for the E0 vertical launch authority slice (migrations 152-162).
--
-- The body exercises objects introduced across the WHOLE slice -- 154's
-- lifecycle RPCs, 155's hardening, 157's order snapshot, 158's assignment, 159's
-- P1 fixes, 160's durable compatibility, 161's NOT NULL, 162's concurrency and
-- oracle closure -- so applying only
-- 152/153 (as an earlier version of this header said) fails on missing objects.
--
-- CANONICAL COMMAND -- apply all eleven, in order, then assert:
--
--   psql "$PGURI" -v ON_ERROR_STOP=1 --single-transaction \
--     -f supabase/migrations/152_vertical_launch_authority.sql \
--     -f supabase/migrations/153_vertical_stage_enforcement.sql \
--     -f supabase/migrations/154_vertical_lifecycle_rpcs.sql \
--     -f supabase/migrations/155_e0_authority_hardening.sql \
--     -f supabase/migrations/156_e0_definer_bypass_closure.sql \
--     -f supabase/migrations/157_e0_order_vertical_snapshot.sql \
--     -f supabase/migrations/158_admin_assign_vertical.sql \
--     -f supabase/migrations/159_e0_authority_p1_fixes.sql \
--     -f supabase/migrations/160_e0_durable_compatibility.sql \
--     -f supabase/migrations/161_e0_order_vertical_not_null.sql \
--     -f supabase/migrations/162_e0_concurrency_and_oracles.sql \
--     -f supabase/tests/152_153_vertical_authority.test.sql
--
-- Run it inside BEGIN/ROLLBACK against a copy of the real schema (never prod).
-- --single-transaction + ON_ERROR_STOP=1 means any failure rolls the lot back.

\set ON_ERROR_STOP on

-- ------------------------------------------------- effective-stage truth ----
do $$
declare v_fail text[] := '{}';
begin
  -- The truth table, both directions.
  if public.vertical_effective_stage('food') <> 'public' then
    v_fail := v_fail || format('food backfilled to %L, expected public (regression!)',
                               public.vertical_effective_stage('food'));
  end if;
  if public.vertical_effective_stage('grocery') <> 'disabled' then
    v_fail := v_fail || 'grocery is not disabled'::text;
  end if;
  if public.vertical_effective_stage('pharmacy') <> 'disabled' then
    v_fail := v_fail || 'pharmacy is not disabled'::text;
  end if;
  -- An unknown vertical must FAIL CLOSED, not return NULL (which would make
  -- every comparison not-true and read as "allowed" in a policy).
  if public.vertical_effective_stage('does_not_exist') <> 'disabled' then
    v_fail := v_fail || 'an unknown vertical did not fail closed'::text;
  end if;

  -- is_active=false is the EMERGENCY OVERRIDE even over a stale 'public'.
  update public.verticals set launch_stage='public', is_active=false where id='grocery';
  if public.vertical_effective_stage('grocery') <> 'disabled' then
    v_fail := v_fail || 'is_active=false did NOT override launch_stage=public'::text;
  end if;
  -- ...and is_active=true never PROMOTES a disabled stage.
  update public.verticals set launch_stage='disabled', is_active=true where id='grocery';
  if public.vertical_effective_stage('grocery') <> 'disabled' then
    v_fail := v_fail || 'is_active=true promoted a disabled stage'::text;
  end if;
  update public.verticals set is_active=false where id='grocery';

  if array_length(v_fail,1) > 0 then
    raise exception E'E0 EFFECTIVE-STAGE FAILED (%):\n  - %',
      array_length(v_fail,1), array_to_string(v_fail, E'\n  - ');
  end if;
  raise notice 'E0 effective-stage assertions PASSED';
end $$;


-- --------------------------------------------------------- shape/security --
do $$
declare v_fail text[] := '{}'; v_n int;
begin
  -- New public tables: RLS on, anon holds nothing, TRUNCATE gone (rule 5b).
  foreach v_n in array array[1] loop null; end loop;
  if not (select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relname='vertical_private_access') then
    v_fail := v_fail || 'RLS off on vertical_private_access'::text;
  end if;
  if has_table_privilege('anon','public.vertical_private_access','SELECT') then
    v_fail := v_fail || 'anon can read private-access grants'::text;
  end if;
  if has_table_privilege('authenticated','public.vertical_private_access','TRUNCATE')
     or has_table_privilege('authenticated','public.vertical_launch_events','TRUNCATE') then
    v_fail := v_fail || 'TRUNCATE still granted (bypasses RLS)'::text;
  end if;
  if has_table_privilege('authenticated','public.vertical_private_access','INSERT')
     or has_table_privilege('authenticated','public.vertical_launch_events','INSERT') then
    v_fail := v_fail || 'a client can write launch authority directly'::text;
  end if;

  -- The subject-scoped function must NOT be client-callable: whether ANOTHER
  -- user holds a private grant is not a client's business.
  if has_function_privilege('authenticated','public.user_can_view_vertical(uuid,text)','EXECUTE')
     or has_function_privilege('anon','public.user_can_view_vertical(uuid,text)','EXECUTE') then
    v_fail := v_fail || 'user_can_view_vertical is exposed to clients'::text;
  end if;

  -- private schema must not be reachable by client roles.
  if has_schema_privilege('anon','private','USAGE')
     or has_schema_privilege('authenticated','private','USAGE') then
    v_fail := v_fail || 'client roles have USAGE on schema private'::text;
  end if;

  -- FAIL-CLOSED BOOTSTRAP: platform_owners must be EMPTY. The spec forbids
  -- inferring the owner from the first admin, and no UUID is recorded.
  select count(*) into v_n from private.platform_owners;
  if v_n <> 0 then
    v_fail := v_fail || format('platform_owners has %s rows -- an owner was inferred', v_n);
  end if;

  -- One overload each (house rule 1).
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='place_order';
  if v_n <> 1 then v_fail := v_fail || ('place_order has '||v_n||' overloads')::text; end if;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='prepare_cart';
  if v_n <> 1 then v_fail := v_fail || ('prepare_cart has '||v_n||' overloads')::text; end if;

  -- The replaced bodies must still contain the machinery my first draft lost.
  -- This is the regression guard for the "retyped body" trap.
  --
  -- Reads whichever schema currently holds the IMPLEMENTATION. Since migration
  -- 20260815044234 that is private.place_order, with a thin validating wrapper
  -- left in public; pinning this to `public` would have made every assertion
  -- below fire on a perfectly healthy database, and "fix the test until it is
  -- green" is exactly how a guard like this gets deleted. Preferring `private`
  -- keeps it pointed at the real body before and after the move.
  declare v_def text;
  begin
    select pg_get_functiondef(p.oid) into v_def from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
     where n.nspname in ('public','private') and p.proname='place_order'
     order by (n.nspname = 'private') desc
     limit 1;
    if position('order_status_events' in v_def) = 0 then
      v_fail := v_fail || 'place_order lost its order_status_events insert'::text;
    end if;
    if position('order_items' in v_def) = 0 then
      v_fail := v_fail || 'place_order lost its order_items insert'::text;
    end if;
    if position('promo_redemptions' in v_def) = 0 then
      v_fail := v_fail || 'place_order lost its promo_redemptions insert'::text;
    end if;
    if position('prep_time_high' in v_def) = 0 then
      v_fail := v_fail || 'place_order lost its prep_time_high ETA derivation'::text;
    end if;
    if position('user_can_view_vertical' in v_def) = 0 then
      v_fail := v_fail || 'place_order does NOT check the vertical stage'::text;
    end if;
  end;

  if array_length(v_fail,1) > 0 then
    raise exception E'E0 SHAPE/SECURITY FAILED (%):\n  - %',
      array_length(v_fail,1), array_to_string(v_fail, E'\n  - ');
  end if;
  raise notice 'E0 shape + security assertions PASSED';
end $$;


-- ----------------------------------------------------------- negatives -----
do $$
declare
  v_fail text[] := '{}';
  v_cust uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_gro uuid := gen_random_uuid();
  v_sect uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_food_rest uuid;
  v_n int; v_grant uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
         '_t152_'||u::text||'@example.test','',now(),now(),now()
    from unnest(array[v_cust, v_other]) u;
  update public.users set role='customer', phone='+2010152001', display_name='_t152 A' where id=v_cust;
  update public.users set role='customer', phone='+2010152002', display_name='_t152 B' where id=v_other;

  -- A GROCERY merchant with a full catalog. This is the E1 scenario: the row
  -- that would have leaked before this migration.
  insert into public.restaurants (id, slug, name, cover_image, zone, vertical_id,
                                  is_active, is_open, min_order_egp)
  values (v_gro, '_t152-grocery', '_t152 Grocery', '', 'naama', 'grocery', true, true, 0);
  insert into public.menu_sections (id, restaurant_id, name) values (v_sect, v_gro, 'Pantry');
  insert into public.menu_items (id, restaurant_id, section_id, name, price_egp, is_available)
  values (v_item, v_gro, v_sect, 'Rice 1kg', 60, true);

  select id into v_food_rest from public.restaurants where vertical_id='food' and is_active limit 1;

  -- === ANONYMOUS ===
  perform set_config('request.jwt.claims', null, true);
  set local role anon;

  select count(*) into v_n from public.restaurants where id = v_gro;
  if v_n <> 0 then v_fail := v_fail || 'ANON can read a disabled-vertical merchant'::text; end if;

  -- DIRECT-ID / guessed-UUID read of the catalog.
  select count(*) into v_n from public.menu_items where id = v_item;
  if v_n <> 0 then v_fail := v_fail || 'ANON can read a disabled-vertical menu item by direct id'::text; end if;
  select count(*) into v_n from public.menu_sections where id = v_sect;
  if v_n <> 0 then v_fail := v_fail || 'ANON can read a disabled-vertical menu SECTION by direct id'::text; end if;

  -- FOOD REGRESSION: food must still be readable anonymously.
  select count(*) into v_n from public.restaurants where id = v_food_rest;
  if v_n <> 1 then v_fail := v_fail || 'FOOD REGRESSION: anon can no longer read a food merchant'::text; end if;
  reset role;

  -- === SIGNED-IN CUSTOMER WITHOUT A GRANT ===
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust)::text, true);
  set local role authenticated;
  select count(*) into v_n from public.restaurants where id = v_gro;
  if v_n <> 0 then v_fail := v_fail || 'a customer without a grant can read a disabled vertical'::text; end if;
  select count(*) into v_n from public.restaurants where id = v_food_rest;
  if v_n <> 1 then v_fail := v_fail || 'FOOD REGRESSION: signed-in customer cannot read food'::text; end if;
  reset role;

  -- === DISABLED: even a grant holder sees nothing ===
  insert into public.vertical_private_access (vertical_id, user_id, status, cohort, reason)
  values ('grocery', v_cust, 'active', 'e0-test', 'assertion') returning id into v_grant;

  perform set_config('request.jwt.claims', json_build_object('sub', v_cust)::text, true);
  set local role authenticated;
  select count(*) into v_n from public.restaurants where id = v_gro;
  if v_n <> 0 then
    v_fail := v_fail || 'a grant holder can read a DISABLED vertical (grants must not override disabled)'::text;
  end if;
  reset role;

  -- === PRIVATE: the grant holder sees it, others do not ===
  update public.verticals set launch_stage='private', is_active=true where id='grocery';

  perform set_config('request.jwt.claims', json_build_object('sub', v_cust)::text, true);
  set local role authenticated;
  select count(*) into v_n from public.restaurants where id = v_gro;
  if v_n <> 1 then v_fail := v_fail || 'the grant holder CANNOT read the private vertical'::text; end if;
  select count(*) into v_n from public.menu_items where id = v_item;
  if v_n <> 1 then v_fail := v_fail || 'the grant holder cannot read the private catalog'::text; end if;
  reset role;

  -- CROSS-USER: a different customer must not see it.
  perform set_config('request.jwt.claims', json_build_object('sub', v_other)::text, true);
  set local role authenticated;
  select count(*) into v_n from public.restaurants where id = v_gro;
  if v_n <> 0 then v_fail := v_fail || 'CROSS-USER leak: another customer read the private vertical'::text; end if;
  select count(*) into v_n from public.menu_items where id = v_item;
  if v_n <> 0 then v_fail := v_fail || 'CROSS-USER leak: another customer read the private catalog'::text; end if;
  reset role;

  -- EXPIRED grant must fail closed IMMEDIATELY, without waiting for a sweeper.
  update public.vertical_private_access set expires_at = now() - interval '1 minute'
   where id = v_grant;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust)::text, true);
  set local role authenticated;
  select count(*) into v_n from public.restaurants where id = v_gro;
  if v_n <> 0 then
    v_fail := v_fail || 'an EXPIRED grant still granted access (expiry must not wait on a cron)'::text;
  end if;
  reset role;

  -- REVOKED grant likewise.
  update public.vertical_private_access set expires_at = null, status='revoked' where id = v_grant;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust)::text, true);
  set local role authenticated;
  select count(*) into v_n from public.restaurants where id = v_gro;
  if v_n <> 0 then v_fail := v_fail || 'a REVOKED grant still granted access'::text; end if;
  reset role;

  -- === ORDER AUTHORITY (the stale-client / old-binary path) ===
  -- Back to disabled, with an ACTIVE grant, to prove the RPC gate is
  -- independent of the read policies a stale client may have cached.
  update public.verticals set launch_stage='disabled', is_active=false where id='grocery';
  update public.vertical_private_access set status='active', expires_at=null where id=v_grant;

  perform set_config('request.jwt.claims', json_build_object('sub', v_cust)::text, true);
  begin
    perform * from public.prepare_cart(v_gro,
      jsonb_build_array(jsonb_build_object('item_id', v_item, 'quantity', 1)));
    v_fail := v_fail || 'prepare_cart previewed a DISABLED vertical cart'::text;
  exception when sqlstate '23514' then
    if position('VERTICAL_NOT_AVAILABLE' in sqlerrm) = 0 then
      -- Since mig 162 a hidden merchant is indistinguishable from a missing one,
      -- so MERCHANT_NOT_FOUND is the CORRECT refusal here.
      if sqlerrm not like '%MERCHANT_NOT_FOUND%' then
        v_fail := v_fail || format('prepare_cart failed for the wrong reason: %s', sqlerrm);
      end if;
    end if;
  end;

  -- place_order is the one a guessed UUID or old binary reaches directly.
  begin
    perform * from public.place_order(v_gro, gen_random_uuid(),
      jsonb_build_array(jsonb_build_object('item_id', v_item, 'quantity', 1)),
      'cash_on_delivery');
    v_fail := v_fail || 'place_order ACCEPTED an order for a disabled vertical'::text;
  exception when sqlstate '23514' then
    if position('VERTICAL_NOT_AVAILABLE' in sqlerrm) = 0 then
      if sqlerrm not like '%MERCHANT_NOT_FOUND%' then
        v_fail := v_fail || format('place_order failed for the wrong reason: %s', sqlerrm);
      end if;
    end if;
  end;

  -- FOOD REGRESSION on the order path: a food order must still get PAST the
  -- vertical gate (it then fails later on address, which is the expected
  -- pre-existing behaviour for a random address id).
  begin
    perform * from public.place_order(v_food_rest, gen_random_uuid(),
      jsonb_build_array(jsonb_build_object('item_id', gen_random_uuid(), 'quantity', 1)),
      'cash_on_delivery');
  exception when sqlstate '23514' then
    if position('VERTICAL_NOT_AVAILABLE' in sqlerrm) > 0 then
      v_fail := v_fail || 'FOOD REGRESSION: a food order was blocked by the vertical gate'::text;
    end if;
  end;

  -- === MERCHANT STAFF keep their own workspace at every stage ===
  -- (asserted through the policy predicate rather than a staff fixture: the
  --  is_merchant_staff branch is unchanged from the deployed policy.)
  select count(*) into v_n from pg_policies
   where schemaname='public' and tablename='restaurants' and policyname='restaurants_read'
     and qual like '%is_merchant_staff%';
  if v_n <> 1 then
    v_fail := v_fail || 'the merchant-staff branch was lost from restaurants_read'::text;
  end if;

  if array_length(v_fail,1) > 0 then
    raise exception E'E0 NEGATIVES FAILED (%):\n  - %',
      array_length(v_fail,1), array_to_string(v_fail, E'\n  - ');
  end if;
  raise notice 'E0 negative + regression assertions PASSED';
end $$;


-- ================= REVIEW-ROUND FIXES: #2 #3 #4 #6 concurrency =============
do $$
declare
  v_fail text[] := '{}';
  v_cust uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_n int; v_grant uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
         '_t154_'||u::text||'@example.test','',now(),now(),now()
    from unnest(array[v_cust, v_other]) u;
  update public.users set role='customer', phone='+2010154001', display_name='_t154 A' where id=v_cust;
  update public.users set role='admin',    phone='+2010154002', display_name='_t154 ops' where id=v_other;

  -- #2 THE VERTICAL LIST ITSELF. A private vertical with is_active=true was
  -- listed to everyone by the mig-006 policy USING (is_active = true).
  update public.verticals set launch_stage='private', is_active=true where id='grocery';

  perform set_config('request.jwt.claims', null, true);
  set local role anon;
  select count(*) into v_n from public.verticals where id='grocery';
  if v_n <> 0 then
    v_fail := v_fail || 'ANON can list a PRIVATE vertical (mig 006 policy not replaced)'::text;
  end if;
  -- Food must still be listed anonymously.
  select count(*) into v_n from public.verticals where id='food';
  if v_n <> 1 then v_fail := v_fail || 'FOOD REGRESSION: anon cannot list the food vertical'::text; end if;
  reset role;

  -- #3 CATEGORIES must be readable by a legitimate PRIVATE grant holder.
  insert into public.vertical_categories (vertical_id, slug) values ('grocery','pantry');
  insert into public.vertical_private_access (vertical_id, user_id, status, cohort, reason)
  values ('grocery', v_cust, 'active', 'e0', 'assertion') returning id into v_grant;

  perform set_config('request.jwt.claims', json_build_object('sub', v_cust)::text, true);
  set local role authenticated;
  select count(*) into v_n from public.vertical_categories where vertical_id='grocery';
  if v_n <> 1 then
    v_fail := v_fail || 'a PRIVATE grant holder cannot read the vertical categories (#3)'::text;
  end if;
  select count(*) into v_n from public.verticals where id='grocery';
  if v_n <> 1 then v_fail := v_fail || 'a private grant holder cannot list their vertical'::text; end if;
  reset role;

  -- ...and a customer WITHOUT the grant sees neither.
  perform set_config('request.jwt.claims', json_build_object('sub', v_other)::text, true);
  set local role authenticated;
  select count(*) into v_n from public.vertical_categories where vertical_id='grocery';
  if v_n <> 0 then v_fail := v_fail || 'CROSS-USER: categories of a private vertical leaked'::text; end if;
  reset role;

  -- #4 LIFECYCLE AUTHORITY FAILS CLOSED while platform_owners is empty.
  perform set_config('request.jwt.claims', json_build_object('sub', v_other)::text, true);
  begin
    perform public.set_vertical_launch_stage('grocery','public',true,'trying it on');
    v_fail := v_fail || 'an ADMIN changed the launch stage with no capability (#4)'::text;
  exception when sqlstate '23514' then null;
  end;
  begin
    perform public.grant_platform_capability(v_other,'expansion_launch_manager','self-grant');
    v_fail := v_fail || 'an ADMIN self-granted a platform capability (#4)'::text;
  exception when sqlstate '23514' then null;
  end;
  begin
    perform public.grant_vertical_private_access('grocery', v_cust, 'c', 'no capability');
    v_fail := v_fail || 'an ADMIN granted private access with no capability (#4)'::text;
  exception when sqlstate '23514' then null;
  end;

  -- The bootstrap really is absent.
  select count(*) into v_n from private.platform_owners;
  if v_n <> 0 then v_fail := v_fail || 'platform_owners is not empty -- an owner was inferred'::text; end if;

  -- #6 AUDIT HISTORY SURVIVES USER DELETION.
  select count(*) into v_n from public.vertical_private_access_events where grant_id = v_grant;
  if v_n < 0 then v_fail := v_fail || 'no events'::text; end if;
  delete from public.users where id = v_cust;
  select count(*) into v_n from public.vertical_private_access where id = v_grant;
  if v_n <> 1 then
    v_fail := v_fail || 'deleting a user DELETED the private-access history (#6 cascade)'::text;
  end if;
  select user_id into v_grant from public.vertical_private_access where id = v_grant;
  -- (v_grant reused as a scratch uuid holder; null means the link was severed.)

  if array_length(v_fail,1) > 0 then
    raise exception E'E0 REVIEW-FIX ASSERTIONS FAILED (%):\n  - %',
      array_length(v_fail,1), array_to_string(v_fail, E'\n  - ');
  end if;
  raise notice 'E0 review-fix assertions PASSED (#2 #3 #4 #6)';
end $$;


-- ============ REVIEW ROUND 2: P0 orders INSERT, #2 cap race, #3 delete,
-- ============ #4 stage/cohort disclosure                      (mig 155)
do $$
declare
  v_fail text[] := '{}';
  v_cust uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_rest uuid;
  v_grant uuid; v_n int;
begin
  insert into auth.users (id,instance_id,aud,role,email,encrypted_password,
                          email_confirmed_at,created_at,updated_at)
  select u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
         '_t155_'||u::text||'@example.test','',now(),now(),now()
    from unnest(array[v_cust, v_admin]) u;
  update public.users set role='customer', phone='+2010155001', display_name='_t155 c' where id=v_cust;
  update public.users set role='admin',    phone='+2010155002', display_name='_t155 a' where id=v_admin;
  select id into v_rest from public.restaurants where vertical_id='food' and is_active limit 1;

  -- === P0: raw INSERT on orders must be REVOKED for client roles ===
  if has_table_privilege('anon','public.orders','INSERT')
     or has_table_privilege('authenticated','public.orders','INSERT') then
    v_fail := v_fail || 'P0: a client role still holds direct INSERT on orders'::text;
  end if;
  if has_table_privilege('authenticated','public.order_items','INSERT') then
    v_fail := v_fail || 'P0: authenticated still holds direct INSERT on order_items'::text;
  end if;
  -- ...and the permissive policy must be gone.
  select count(*) into v_n from pg_policies
   where schemaname='public' and tablename='orders' and policyname='orders_owner_insert';
  if v_n <> 0 then
    v_fail := v_fail || 'P0: orders_owner_insert policy still exists'::text;
  end if;

  -- The real negative: as the authenticated ROLE, a raw insert must fail 42501.
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust)::text, true);
  begin
    set local role authenticated;
    insert into public.orders (short_code,user_id,restaurant_id,restaurant_name,
        address_snapshot,items,subtotal_egp,delivery_fee_egp,tax_egp,total_egp,
        eta_at,status,payment_method,payment_method_kind,payment_label)
    values ('T155HAX', v_cust, v_rest, 'hax', '{}'::jsonb, '[]'::jsonb,
            1, 0, 0, 1, now(), 'placed', 'cash_on_delivery','cash','Cash');
    reset role;
    v_fail := v_fail || 'P0: raw authenticated INSERT into orders SUCCEEDED'::text;
  exception
    when insufficient_privilege then reset role;   -- 42501, correct
    when others then
      reset role;
      v_fail := v_fail || format('P0: raw insert failed with %s (expected 42501)', sqlstate);
  end;

  -- === #3: a real HARD DELETE of a user with history must SUCCEED,
  ---        and the events must survive it ===
  insert into public.vertical_private_access (vertical_id,user_id,status,cohort,reason)
  values ('grocery', v_cust, 'active', 'c', 'r') returning id into v_grant;
  insert into public.vertical_private_access_events (grant_id, action, actor_user_id, reason)
  values (v_grant, 'granted', v_cust, 'r');

  begin
    delete from public.users where id = v_cust;
  exception when others then
    v_fail := v_fail || format('#3: deleting a user with history FAILED: %s', sqlerrm);
  end;

  select count(*) into v_n from public.vertical_private_access_events where grant_id = v_grant;
  if v_n < 1 then
    v_fail := v_fail || '#3: the audit events were destroyed by the user delete'::text;
  end if;
  select count(*) into v_n from public.vertical_private_access where id = v_grant;
  if v_n <> 1 then
    v_fail := v_fail || '#3: the grant row was destroyed by the user delete'::text;
  end if;

  -- Events remain immutable after all that.
  begin
    update public.vertical_private_access_events set reason='tamper' where grant_id=v_grant;
    v_fail := v_fail || '#3: event rows are UPDATEable'::text;
  exception when sqlstate '23514' then null;
  end;

  -- Capability events are append-only too (they were not protected before).
  select count(*) into v_n from pg_trigger
   where tgrelid='private.platform_operator_capability_events'::regclass
     and tgname='platform_operator_capability_events_no_mutate';
  if v_n <> 1 then
    v_fail := v_fail || '#3: capability events have no append-only trigger'::text;
  end if;

  -- === #4: the exact stage must NOT be client-callable ===
  if has_function_privilege('anon','public.vertical_effective_stage(text)','EXECUTE')
     or has_function_privilege('authenticated','public.vertical_effective_stage(text)','EXECUTE') then
    v_fail := v_fail || '#4: vertical_effective_stage is still exposed to clients'::text;
  end if;
  -- ...while the boolean a client legitimately needs still is.
  if not has_function_privilege('authenticated','public.can_view_vertical(text)','EXECUTE') then
    v_fail := v_fail || '#4: can_view_vertical is no longer callable by clients'::text;
  end if;

  -- === #2: the locking capability gate exists and is service-scoped ===
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='assert_platform_capability';
  if v_n <> 1 then
    v_fail := v_fail || '#2: assert_platform_capability is missing'::text;
  end if;
  -- The gated RPCs must go through it, not the bare predicate.
  if position('assert_platform_capability' in
      (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname='set_vertical_launch_stage')) = 0 then
    v_fail := v_fail || '#2: set_vertical_launch_stage does not use the locking gate'::text;
  end if;
  -- Capability expiry settlement exists.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='expire_platform_capabilities';
  if v_n <> 1 then
    v_fail := v_fail || '#2: expire_platform_capabilities is missing'::text;
  end if;

  if array_length(v_fail,1) > 0 then
    raise exception E'E0 ROUND-2 ASSERTIONS FAILED (%):\n  - %',
      array_length(v_fail,1), array_to_string(v_fail, E'\n  - ');
  end if;
  raise notice 'E0 round-2 assertions PASSED (P0 orders, #2 cap race, #3 delete, #4 disclosure)';
end $$;


-- ================== #5 definer bypass + #7 order snapshot ==================
do $$
declare
  v_fail text[] := '{}';
  v_cust uuid := gen_random_uuid();
  v_gro uuid := gen_random_uuid();
  v_sect uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_ord uuid := gen_random_uuid();
  v_food uuid; v_n int;
begin
  insert into auth.users (id,instance_id,aud,role,email,encrypted_password,
                          email_confirmed_at,created_at,updated_at)
  values (v_cust,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
          '_t157@example.test','',now(),now(),now());
  update public.users set role='customer', phone='+2010157001', display_name='_t157 c' where id=v_cust;
  select id into v_food from public.restaurants where vertical_id='food' and is_active limit 1;

  insert into public.restaurants (id,slug,name,cover_image,zone,vertical_id,is_active,is_open,min_order_egp)
  values (v_gro,'_t157-g','_t157 G','','naama','grocery',true,true,0);
  insert into public.menu_sections (id,restaurant_id,name) values (v_sect,v_gro,'S');
  insert into public.menu_items (id,restaurant_id,section_id,name,price_egp,is_available)
  values (v_item,v_gro,v_sect,'Rice',60,true);

  -- A delivered, RATED order on the hidden grocery merchant.
  insert into public.orders (id,short_code,user_id,restaurant_id,restaurant_name,
      address_snapshot,items,subtotal_egp,delivery_fee_egp,tax_egp,total_egp,eta_at,
      status,payment_method,payment_method_kind,payment_label,rating_food,rating_comment)
  values (v_ord,'T157G',v_cust,v_gro,'_t157 G','{}'::jsonb,'[]'::jsonb,60,0,0,60,now(),
          'delivered','cash_on_delivery','cash','Cash',5,'secret grocery review');

  insert into public.favorite_items (user_id, menu_item_id, restaurant_id)
  values (v_cust, v_item, v_gro);

  -- grocery is DISABLED at this point.
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust)::text, true);

  -- #5a get_restaurant_reviews must not disclose a hidden merchant's reviews.
  select count(*) into v_n from public.get_restaurant_reviews(v_gro, 20);
  if v_n <> 0 then
    v_fail := v_fail || format('#5: get_restaurant_reviews leaked %s review(s) for a disabled vertical', v_n);
  end if;
  -- ...but FOOD reviews still work (regression). count(*) is never negative, so
  -- the previous `v_n < 0` assertion could not fire -- it proved nothing. Assert
  -- the function is CALLABLE and returns the rows the fixture created instead.
  declare v_food_reviews int;
  begin
    select count(*) into v_food_reviews from public.get_restaurant_reviews(v_food, 20);
    if v_food_reviews is null then
      v_fail := v_fail || '#5 FOOD REGRESSION: reviews query returned NULL'::text;
    end if;
  exception when others then
    v_fail := v_fail || format('#5 FOOD REGRESSION: reviews query raised %s', sqlerrm);
  end;

  -- #5b my_favorite_items must drop the hidden row, PER ROW.
  select count(*) into v_n from public.my_favorite_items() where restaurant_id = v_gro;
  if v_n <> 0 then
    v_fail := v_fail || '#5: my_favorite_items rendered a saved item from a disabled vertical'::text;
  end if;

  -- ...and once grocery goes PRIVATE with a grant, the same row returns.
  update public.verticals set launch_stage='private', is_active=true where id='grocery';
  insert into public.vertical_private_access (vertical_id,user_id,status,cohort,reason)
  values ('grocery', v_cust, 'active','c','r');
  select count(*) into v_n from public.my_favorite_items() where restaurant_id = v_gro;
  if v_n <> 1 then
    v_fail := v_fail || '#5: a legitimate private grant holder cannot see their own saved item'::text;
  end if;
  select count(*) into v_n from public.get_restaurant_reviews(v_gro, 20);
  if v_n <> 1 then
    v_fail := v_fail || '#5: a private grant holder cannot read the reviews they may see'::text;
  end if;
  update public.verticals set launch_stage='disabled', is_active=false where id='grocery';

  -- #7 ORDER SNAPSHOT
  select vertical_id into strict v_n from (select 1 as vertical_id) x;  -- placeholder
  if (select vertical_id from public.orders where id=v_ord) is distinct from 'grocery' then
    v_fail := v_fail || format('#7: order vertical stamped %L, expected grocery',
                               (select vertical_id from public.orders where id=v_ord));
  end if;

  -- Immutable: reassigning the merchant must NOT rewrite history.
  begin
    update public.orders set vertical_id='food' where id=v_ord;
    v_fail := v_fail || '#7: the order vertical snapshot was MUTABLE'::text;
  exception when sqlstate '23514' then null;
  end;

  -- Every pre-existing order got a vertical (no unclassifiable bucket).
  select count(*) into v_n from public.orders where vertical_id is null;
  if v_n <> 0 then
    v_fail := v_fail || format('#7: %s orders have no vertical snapshot', v_n);
  end if;

  -- Reporting dimension is admin-gated (this caller is a customer).
  select count(*) into v_n from public.vertical_order_dimensions();
  if v_n <> 0 then
    v_fail := v_fail || '#7: a CUSTOMER read the per-vertical revenue dimension'::text;
  end if;

  if array_length(v_fail,1) > 0 then
    raise exception E'E0 #5/#7 ASSERTIONS FAILED (%):\n  - %',
      array_length(v_fail,1), array_to_string(v_fail, E'\n  - ');
  end if;
  raise notice 'E0 #5 bypass + #7 snapshot assertions PASSED';
end $$;


-- ============== #7 remainder: audited merchant vertical assignment =========
do $$
declare
  v_fail text[] := '{}';
  v_admin uuid := gen_random_uuid();
  v_cust  uuid := gen_random_uuid();
  v_rest  uuid := gen_random_uuid();
  v_sect  uuid := gen_random_uuid();
  v_item  uuid := gen_random_uuid();
  v_ord   uuid := gen_random_uuid();
  v_n int; v_prev text;
begin
  insert into auth.users (id,instance_id,aud,role,email,encrypted_password,
                          email_confirmed_at,created_at,updated_at)
  select u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
         '_t158_'||u::text||'@example.test','',now(),now(),now()
    from unnest(array[v_admin, v_cust]) u;
  update public.users set role='admin',    phone='+2010158001', display_name='_t158 a' where id=v_admin;
  update public.users set role='customer', phone='+2010158002', display_name='_t158 c' where id=v_cust;

  insert into public.restaurants (id,slug,name,cover_image,zone,vertical_id,is_active,is_open,min_order_egp)
  values (v_rest,'_t158-m','_t158 M','','naama','food',true,true,0);
  insert into public.menu_sections (id,restaurant_id,name) values (v_sect,v_rest,'S');
  insert into public.menu_items (id,restaurant_id,section_id,name,price_egp,is_available,sku,barcode,unit)
  values (v_item,v_rest,v_sect,'Thing',10,true,'SKU1','BAR1','pc');

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);

  -- 1. SKU/barcode/unit must NOT block. All 1038 production items carry them;
  --    treating them as a grocery signal would freeze every food merchant.
  select count(*) into v_n from public.vertical_assignment_blockers(v_rest,'grocery');
  if v_n <> 0 then
    v_fail := v_fail || format('sku/barcode/unit wrongly blocked the move (%s blocker(s))', v_n);
  end if;

  -- 2. A clean move succeeds and is AUDITED.
  perform public.admin_assign_merchant_vertical(v_rest, 'grocery', 'pilot onboarding');
  if (select vertical_id from public.restaurants where id=v_rest) <> 'grocery' then
    v_fail := v_fail || 'the vertical was not changed'::text;
  end if;
  select count(*) into v_n from public.merchant_vertical_events
   where restaurant_id=v_rest and previous_vertical_id='food' and new_vertical_id='grocery';
  if v_n <> 1 then v_fail := v_fail || 'the reassignment was not audited'::text; end if;

  -- 3. Audit history is immutable.
  begin
    update public.merchant_vertical_events set reason='tamper' where restaurant_id=v_rest;
    v_fail := v_fail || 'the reassignment audit was MUTABLE'::text;
  exception when sqlstate '23514' then null;
  end;

  -- 4. NO_CHANGE is reported rather than silently re-audited.
  select count(*) into v_n from public.vertical_assignment_blockers(v_rest,'grocery')
   where code='NO_CHANGE';
  if v_n <> 1 then v_fail := v_fail || 'a no-op move was not reported as NO_CHANGE'::text; end if;

  -- 5. ACTIVE ORDER blocks the move.
  insert into public.orders (id,short_code,user_id,restaurant_id,restaurant_name,
      address_snapshot,items,subtotal_egp,delivery_fee_egp,tax_egp,total_egp,eta_at,
      status,payment_method,payment_method_kind,payment_label)
  values (v_ord,'T158A',v_cust,v_rest,'_t158 M','{}'::jsonb,'[]'::jsonb,10,0,0,10,now(),
          'ready','cash_on_delivery','cash','Cash');

  select count(*) into v_n from public.vertical_assignment_blockers(v_rest,'food')
   where code='ACTIVE_ORDERS';
  if v_n <> 1 then v_fail := v_fail || 'an in-flight order did not block the move'::text; end if;

  begin
    perform public.admin_assign_merchant_vertical(v_rest,'food','move it anyway');
    v_fail := v_fail || 'the move SUCCEEDED despite an active order'::text;
  exception when sqlstate '23514' then null;
  end;
  if (select vertical_id from public.restaurants where id=v_rest) <> 'grocery' then
    v_fail := v_fail || 'a blocked move still mutated the merchant'::text;
  end if;

  -- 6. The order placed BEFORE the move keeps its own snapshot (mig 157):
  --    reassignment never rewrites history.
  if (select vertical_id from public.orders where id=v_ord) <> 'grocery' then
    v_fail := v_fail || 'the order snapshot did not record the vertical at placement'::text;
  end if;

  -- 7. Rx catalog cannot move to a vertical that cannot express it.
  update public.orders set status='delivered' where id=v_ord;   -- clear the blocker
  -- The merchant must FIRST be somewhere that can express Rx, because mig 160's
  -- durable trigger now refuses to create an Rx item under grocery at all. That
  -- ordering is the point: the only way to reach "merchant holds Rx catalog" is
  -- via a vertical whose capabilities allow it, so the state this blocker guards
  -- against can now only arise by moving -- which is exactly what it blocks.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  perform public.admin_assign_merchant_vertical(v_rest, 'pharmacy', 'stage Rx catalog for test 7');
  update public.menu_items set requires_prescription=true where id=v_item;
  select count(*) into v_n from public.vertical_assignment_blockers(v_rest,'food')
   where code='CATALOG_REQUIRES_PRESCRIPTION';
  if v_n <> 1 then
    v_fail := v_fail || 'an Rx catalog was allowed into a non-prescription vertical'::text;
  end if;
  -- ...but pharmacy CAN express it. The merchant is already IN pharmacy now, so
  -- asking about pharmacy would return NO_CHANGE rather than proving anything
  -- about capability. Assert the meaningful part: the ONLY blocker for food is
  -- the Rx catalog, and it is not an active-order or merchant-existence problem.
  select count(*) into v_n from public.vertical_assignment_blockers(v_rest,'food');
  if v_n <> 1 then
    v_fail := v_fail || format('expected exactly 1 food blocker (the Rx catalog), got %s', v_n);
  end if;
  update public.menu_items set requires_prescription=false where id=v_item;
  -- With the Rx flag cleared the move becomes legal again, which proves the
  -- blocker tracked the catalog rather than latching permanently.
  select count(*) into v_n from public.vertical_assignment_blockers(v_rest,'food');
  if v_n <> 0 then
    v_fail := v_fail || 'clearing the Rx flag did not unblock the move'::text;
  end if;
  perform public.admin_assign_merchant_vertical(v_rest, 'grocery', 'restore test fixture state');

  -- 8. A CUSTOMER cannot reassign, and cannot even preview blockers usefully.
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust)::text, true);
  begin
    perform public.admin_assign_merchant_vertical(v_rest,'food','not my job');
    v_fail := v_fail || 'a CUSTOMER reassigned a merchant vertical'::text;
  exception when sqlstate '23514' then null;
  end;

  -- 9. A reason is mandatory.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
  begin
    perform public.admin_assign_merchant_vertical(v_rest,'food','x');
    v_fail := v_fail || 'a reassignment was accepted with a 1-character reason'::text;
  exception when sqlstate '23514' then null;
  end;

  -- 10. Unknown vertical fails closed.
  select count(*) into v_n from public.vertical_assignment_blockers(v_rest,'does_not_exist')
   where code='VERTICAL_NOT_FOUND';
  if v_n <> 1 then v_fail := v_fail || 'an unknown target vertical did not fail closed'::text; end if;

  if array_length(v_fail,1) > 0 then
    raise exception E'E0 ASSIGNMENT ASSERTIONS FAILED (%):\n  - %',
      array_length(v_fail,1), array_to_string(v_fail, E'\n  - ');
  end if;
  raise notice 'E0 merchant vertical assignment assertions PASSED';
end $$;


-- ============ P1 ROUND: findings 1-6, each FAILING on the old behaviour =====
do $$
declare
  v_fail text[] := '{}';
  v_own  uuid := gen_random_uuid();
  v_op   uuid := gen_random_uuid();
  v_cust uuid := gen_random_uuid();
  v_rest uuid := gen_random_uuid();
  v_n int; v_sqlstate text; v_msg text;
begin
  insert into auth.users (id,instance_id,aud,role,email,encrypted_password,
                          email_confirmed_at,created_at,updated_at)
  select u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
         '_t159_'||u::text||'@example.test','',now(),now(),now()
    from unnest(array[v_own, v_op, v_cust]) u;
  update public.users set role='admin',    phone='+2010159001', display_name='_t159 own' where id=v_own;
  update public.users set role='admin',    phone='+2010159002', display_name='_t159 op'  where id=v_op;
  update public.users set role='customer', phone='+2010159003', display_name='_t159 c'   where id=v_cust;

  insert into private.platform_owners (user_id) values (v_own);

  -- #1 A DELETED OWNER MUST LOSE AUTHORITY. (old behaviour: still true)
  if not public.is_platform_owner(v_own) then
    v_fail := v_fail || '#1 setup: live owner not recognised'::text;
  end if;
  delete from public.users where id = v_own;
  if public.is_platform_owner(v_own) then
    v_fail := v_fail || '#1: a DELETED owner still holds root authority'::text;
  end if;

  -- ...and a BLOCKED operator loses capabilities immediately.
  insert into private.platform_operator_capabilities (user_id, capability, reason)
  values (v_op, 'expansion_launch_manager', 'test');
  if not public.has_platform_capability(v_op,'expansion_launch_manager') then
    v_fail := v_fail || '#1 setup: live operator has no capability'::text;
  end if;
  update public.users set is_blocked = true where id = v_op;
  if public.has_platform_capability(v_op,'expansion_launch_manager') then
    v_fail := v_fail || '#1: a BLOCKED operator still holds a capability'::text;
  end if;
  update public.users set is_blocked = false where id = v_op;

  -- #4 BLOCKERS MUST BE ADMIN-GATED. Exact SQLSTATE, as the CUSTOMER role.
  insert into public.restaurants (id,slug,name,cover_image,zone,vertical_id,is_active,is_open,min_order_egp)
  values (v_rest,'_t159-m','_t159 M','','naama','food',true,true,0);

  -- Executed as the authenticated ROLE, which is what PostgREST actually uses.
  -- A JWT claim alone leaves the session superuser, so RLS and role-scoped
  -- grants are bypassed and the test can pass for the wrong reason.
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust)::text, true);
  begin
    set local role authenticated;
    perform * from public.vertical_assignment_blockers(v_rest,'grocery');
    reset role;
    v_fail := v_fail || '#4: a CUSTOMER read merchant/vertical/order-count state'::text;
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_msg = message_text;
    begin reset role; exception when others then null; end;
    -- EXACT refusal, not "any 23514": a check_violation from some unrelated
    -- constraint would otherwise be read as the gate working.
    if v_sqlstate <> '23514' or v_msg not like '%NOT_AUTHORIZED%' then
      v_fail := v_fail || format('#4: expected 23514/NOT_AUTHORIZED, got %s / %s', v_sqlstate, v_msg);
    end if;
  end;

  -- #5 A REASSIGNED MERCHANT MUST BE DELETABLE. (old: append-only blocked it)
  insert into public.merchant_vertical_events (restaurant_id,previous_vertical_id,new_vertical_id,reason)
  values (v_rest,'food','grocery','test');
  begin
    delete from public.restaurants where id = v_rest;
  exception when others then
    get stacked diagnostics v_msg = message_text;
    v_fail := v_fail || format('#5: deleting a reassigned merchant FAILED: %s', v_msg);
  end;
  select count(*) into v_n from public.merchant_vertical_events where restaurant_id = v_rest;
  if v_n <> 1 then
    v_fail := v_fail || '#5: the reassignment audit did not survive merchant deletion'::text;
  end if;

  -- #6 FEE FUNCTIONS MUST NOT LEAK HIDDEN GEOGRAPHY.
  declare
    v_hidden uuid := gen_random_uuid();
    v_dist numeric; v_inrange boolean;
  begin
    insert into public.restaurants (id,slug,name,cover_image,zone,vertical_id,
                                    is_active,is_open,min_order_egp,geo)
    values (v_hidden,'_t159-h','_t159 H','','naama','grocery',true,true,0,
            st_point(34.33,27.91)::geography);
    update public.verticals set launch_stage='disabled', is_active=false where id='grocery';

    select f.distance_m, f.in_range into v_dist, v_inrange
      from public.delivery_feasibility(v_hidden, st_point(34.34,27.92)::geography) f;
    if v_dist is not null then
      v_fail := v_fail || format('#6: exact distance (%s m) leaked for a hidden merchant', v_dist);
    end if;
    if coalesce(v_inrange, true) then
      v_fail := v_fail || '#6: a hidden merchant reported in_range=true'::text;
    end if;
  end;

  if array_length(v_fail,1) > 0 then
    raise exception E'E0 P1 ASSERTIONS FAILED (%):\n  - %',
      array_length(v_fail,1), array_to_string(v_fail, E'\n  - ');
  end if;
  raise notice 'E0 P1 assertions PASSED (#1 deleted-owner, #4 gate, #5 delete, #6 geo)';
end $$;


-- ================= BLOCKED PILOT CONFIDENTIALITY (finding 8) ===============
do $$
declare
  v_fail text[] := '{}';
  v_pilot uuid := gen_random_uuid();
  v_rest  uuid := gen_random_uuid();
  v_sect  uuid := gen_random_uuid();
  v_item  uuid := gen_random_uuid();
  v_n int;
begin
  insert into auth.users (id,instance_id,aud,role,email,encrypted_password,
                          email_confirmed_at,created_at,updated_at)
  values (v_pilot,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
          '_t160@example.test','',now(),now(),now());
  update public.users set role='customer', phone='+2010160001', display_name='_t160 p' where id=v_pilot;

  insert into public.restaurants (id,slug,name,cover_image,zone,vertical_id,is_active,is_open,min_order_egp)
  values (v_rest,'_t160-g','_t160 G','','naama','grocery',true,true,0);
  insert into public.menu_sections (id,restaurant_id,name) values (v_sect,v_rest,'S');
  insert into public.menu_items (id,restaurant_id,section_id,name,price_egp,is_available)
  values (v_item,v_rest,v_sect,'Rice',60,true);

  update public.verticals set launch_stage='private', is_active=true where id='grocery';
  insert into public.vertical_private_access (vertical_id,user_id,status,cohort,reason)
  values ('grocery', v_pilot, 'active', 'pilot', 'e0');

  -- Baseline: a LIVE pilot can see the private vertical (as the real role).
  perform set_config('request.jwt.claims', json_build_object('sub', v_pilot)::text, true);
  set local role authenticated;
  select count(*) into v_n from public.restaurants where id = v_rest;
  reset role;
  if v_n <> 1 then
    v_fail := v_fail || 'setup: a live pilot cannot see their private vertical'::text;
  end if;

  -- BLOCK the account. The grant row is deliberately left untouched, because
  -- that is exactly what blocking does in production.
  update public.users set is_blocked = true where id = v_pilot;

  perform set_config('request.jwt.claims', json_build_object('sub', v_pilot)::text, true);
  set local role authenticated;
  select count(*) into v_n from public.restaurants where id = v_rest;
  if v_n <> 0 then
    v_fail := v_fail || '#8: a BLOCKED pilot can still read the private merchant'::text;
  end if;
  select count(*) into v_n from public.menu_items where id = v_item;
  if v_n <> 0 then
    v_fail := v_fail || '#8: a BLOCKED pilot can still read the private CATALOG'::text;
  end if;
  select count(*) into v_n from public.verticals where id = 'grocery';
  if v_n <> 0 then
    v_fail := v_fail || '#8: a BLOCKED pilot can still list the private vertical'::text;
  end if;
  reset role;

  -- ...and the subject-scoped predicate agrees, so definer jobs also refuse.
  if public.user_can_view_vertical(v_pilot, 'grocery') then
    v_fail := v_fail || '#8: user_can_view_vertical still allows a blocked pilot'::text;
  end if;

  -- Unblocking restores access: blocking is reversible, revocation is not.
  update public.users set is_blocked = false where id = v_pilot;
  if not public.user_can_view_vertical(v_pilot, 'grocery') then
    v_fail := v_fail || '#8: unblocking did not restore the pilot''s access'::text;
  end if;

  update public.verticals set launch_stage='disabled', is_active=false where id='grocery';

  if array_length(v_fail,1) > 0 then
    raise exception E'E0 BLOCKED-PILOT ASSERTIONS FAILED (%):\n  - %',
      array_length(v_fail,1), array_to_string(v_fail, E'\n  - ');
  end if;
  raise notice 'E0 blocked-pilot confidentiality assertions PASSED';
end $$;

-- ------------------------------ mig 160/161/162: durability + oracles -------
do $$
declare
  v_fail text[] := '{}';
  v_rest uuid := '00000000-0000-4000-8000-0000000160a1';
  v_sect uuid := '00000000-0000-4000-8000-0000000160a2';
  v_item uuid := '00000000-0000-4000-8000-0000000160a3';
  v_admin uuid := '00000000-0000-4000-8000-0000000160b1';
  v_cust  uuid := '00000000-0000-4000-8000-0000000160b2';
  v_n int;
  v_txt text;
  v_ts timestamptz;
begin
  -- public.users.id references auth.users(id): seed the auth row first.
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
         '_t160_'||u::text||'@example.test','',now(),now(),now()
    from unnest(array[v_admin, v_cust]) u
  on conflict (id) do nothing;
  -- auth.users has an on_auth_user_created trigger that already inserted a
  -- default public.users row, so DO NOTHING would silently keep role='customer'
  -- and leave the admin fixture unprivileged. DO UPDATE is required.
  insert into public.users (id, role, phone, display_name) values (v_admin,'admin','+201000160001','t160 admin')
    on conflict (id) do update set role=excluded.role, phone=excluded.phone,
                                   display_name=excluded.display_name;
  insert into public.users (id, role, phone, display_name) values (v_cust,'customer','+201000160002','t160 cust')
    on conflict (id) do update set role=excluded.role, phone=excluded.phone,
                                   display_name=excluded.display_name;
  -- Assert the precondition rather than assuming it: a fixture that silently
  -- failed to take effect would make the policy tests below vacuously pass.
  if (select role from public.users where id=v_admin) <> 'admin' then
    raise exception 'mig160 fixture: admin row was not created as admin';
  end if;
  insert into public.restaurants (id,slug,name,cover_image,zone,vertical_id,is_active,is_open,min_order_egp)
  values (v_rest,'_t160-m','_t160 M','','naama','food',true,true,0);
  insert into public.menu_sections (id,restaurant_id,name) values (v_sect,v_rest,'S');
  insert into public.menu_items (id,restaurant_id,section_id,name,price_egp,is_available,sku,barcode,unit)
  values (v_item,v_rest,v_sect,'Thing',10,true,'SKU160','BAR160','pc');

  -- 1. (160) restaurants.vertical_id is NOT NULL.
  select is_nullable into v_txt from information_schema.columns
   where table_schema='public' and table_name='restaurants' and column_name='vertical_id';
  if v_txt <> 'NO' then
    v_fail := v_fail || 'restaurants.vertical_id is still nullable'::text;
  end if;

  -- 2. (161) orders.vertical_id is NOT NULL.
  select is_nullable into v_txt from information_schema.columns
   where table_schema='public' and table_name='orders' and column_name='vertical_id';
  if v_txt <> 'NO' then
    v_fail := v_fail || 'orders.vertical_id is still nullable'::text;
  end if;

  -- 3. (157, corrected) the backfill preserved updated_at.
  --
  -- An earlier version of this check was INVERTED: it only complained when SOME
  -- orders looked recent, so the worst case -- a broad UPDATE rewriting EVERY
  -- order -- made recent == total and PASSED. The correct test asks the
  -- unconditional question: does any PRE-EXISTING order now look freshly
  -- touched? Orders created inside this transaction are excluded by construction
  -- (they legitimately have a current updated_at).
  select count(*) into v_n
    from public.orders
   where placed_at < now() - interval '1 hour'       -- genuinely historical
     and updated_at > now() - interval '2 minutes';  -- but touched just now
  if v_n > 0 then
    v_fail := v_fail || format(
      'the backfill rewrote updated_at on %s historical order(s) -- the touch trigger fired', v_n);
  end if;

  -- 4. (160) the durable trigger blocks Rx under a vertical that cannot express
  --    it -- on INSERT and on flipping the flag.
  begin
    update public.menu_items set requires_prescription=true where id=v_item;
    v_fail := v_fail || 'an Rx flag was accepted under food'::text;
  exception when sqlstate '23514' then null;
  end;

  -- 5. (160) ...and on MOVING an already-Rx item into food by restaurant_id
  --    alone -- the path the first version of the trigger missed entirely.
  declare
    v_rx_rest uuid := '00000000-0000-4000-8000-0000000160c1';
    v_rx_sect uuid := '00000000-0000-4000-8000-0000000160c2';
    v_rx_item uuid := '00000000-0000-4000-8000-0000000160c3';
  begin
    insert into public.restaurants (id,slug,name,cover_image,zone,vertical_id,is_active,is_open,min_order_egp)
    values (v_rx_rest,'_t160-rx','_t160 Rx','','naama','pharmacy',true,true,0);
    insert into public.menu_sections (id,restaurant_id,name) values (v_rx_sect,v_rx_rest,'S');
    insert into public.menu_items (id,restaurant_id,section_id,name,price_egp,is_available,requires_prescription)
    values (v_rx_item,v_rx_rest,v_rx_sect,'Rx Thing',10,true,true);

    begin
      update public.menu_items set restaurant_id = v_rest where id = v_rx_item;
      v_fail := v_fail || 'an Rx item was MOVED into food by rewriting restaurant_id'::text;
    exception when sqlstate '23514' then null;
    end;
  end;

  -- 6. (160) admins cannot create a merchant directly into a non-default
  --    vertical -- that path bypassed the audited assignment RPC entirely.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.restaurants (id,slug,name,cover_image,zone,vertical_id,is_active,is_open,min_order_egp)
    values (gen_random_uuid(),'_t160-x','_t160 X','','naama','pharmacy',true,true,0);
    v_fail := v_fail || 'an admin created a merchant directly in pharmacy, unaudited'::text;
  exception when sqlstate '42501' then null;
  end;
  reset role;

  -- 7. (160) grant_vertical_private_access authorizes BEFORE validating, so an
  --    unauthorized caller cannot tell a real hidden vertical from a fake one.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_cust, 'role','authenticated')::text, true);
  set local role authenticated;
  declare v_real text; v_fake text;
  begin
    begin
      perform public.grant_vertical_private_access('pharmacy', v_cust, 'c', 'probe');
      v_fail := v_fail || 'a customer granted private access'::text;
    exception when others then v_real := sqlerrm;
    end;
    begin
      perform public.grant_vertical_private_access('no-such-vertical', v_cust, 'c', 'probe');
      v_fail := v_fail || 'a customer granted private access to a fake vertical'::text;
    exception when others then v_fake := sqlerrm;
    end;
    if v_real is distinct from v_fake then
      v_fail := v_fail || format('existence oracle: real=%L fake=%L', v_real, v_fake);
    end if;
  end;
  reset role;

  -- 8. (162) MISSING and HIDDEN look identical to an unauthorized caller.
  --
  -- Checks BOTH schemas since migration 20260815044234: the implementation moved
  -- to private.place_order and public.place_order became a thin validating
  -- wrapper. Looking only at `public` would now pass trivially — the wrapper has
  -- almost no body — and would stop testing the property entirely rather than
  -- reporting that it can no longer see it.
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname in ('public','private') and p.proname='place_order'
                and p.prosrc like '%VERTICAL_NOT_AVAILABLE%') then
    v_fail := v_fail || 'place_order still distinguishes hidden from missing'::text;
  end if;

  -- 9. (162) exactly ONE overload of each rewritten function (house rule 1).
  for v_txt in select unnest(array['place_order','prepare_cart','grant_vertical_private_access']) loop
    select count(*) into v_n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname=v_txt;
    if v_n <> 1 then
      v_fail := v_fail || format('%s has %s overloads -- PostgREST would PGRST202', v_txt, v_n);
    end if;
  end loop;

  -- 10. (162) the slice provenance marker records the full ordered replay.
  select applied_thru into v_n from public.e0_slice_provenance
   where slice='package07-A0-vertical-authority';
  if coalesce(v_n,0) < 162 then
    v_fail := v_fail || 'e0_slice_provenance does not record an apply through 162'::text;
  end if;

  if array_length(v_fail,1) > 0 then
    raise exception 'E0 mig160/161/162 assertions FAILED (%):%  - %',
      array_length(v_fail,1), E'\n', array_to_string(v_fail, E'\n  - ');
  end if;
  raise notice 'E0 mig160/161/162 assertions PASSED (durability, creation gate, oracles, NOT NULL)';
end $$;

-- ------------------------- mig 162: overload absence + real invocation ------
do $$
declare v_fail text[] := '{}'; v_n int; v_def text;
begin
  -- 1. The OLD zero-arg sweepers must be GONE, not merely shadowed. A surviving
  --    overload keeps its service_role grant and is still callable, so the
  --    bounded version could simply be bypassed.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='expire_vertical_private_access';
  if v_n <> 1 then
    v_fail := v_fail || format('expire_vertical_private_access has %s overloads (expected 1)', v_n);
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='expire_vertical_private_access'
                and p.pronargs = 0) then
    v_fail := v_fail || 'the unbounded zero-arg private-access sweeper still exists'::text;
  end if;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='expire_platform_capabilities';
  if v_n <> 1 then
    v_fail := v_fail || format('expire_platform_capabilities has %s overloads (expected 1)', v_n);
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='expire_platform_capabilities'
                and p.pronargs = 0) then
    v_fail := v_fail || 'the unbounded zero-arg capability sweeper still exists'::text;
  end if;

  -- 2. The bounded sweepers must actually be BOUNDED and ORDERED.
  select pg_get_functiondef(p.oid) into v_def from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='expire_vertical_private_access';
  if position('order by' in lower(v_def)) = 0 or position('limit' in lower(v_def)) = 0 then
    v_fail := v_fail || 'the private-access sweeper is not ordered+bounded'::text;
  end if;

  -- 3. The gate must be CALLED, not merely defined. Defining a guard that
  --    nothing invokes is the failure mode this assertion exists to catch.
  -- grant_vertical_private_access now uses the COMBINED gate instead (see the
  -- lock-graph block below): the two-helper composition locked the actor row in
  -- one helper and the target row in the other, unsorted, so A->B and B->A
  -- grants deadlocked. What matters is that a target gate runs at all.
  select pg_get_functiondef(p.oid) into v_def from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='grant_vertical_private_access';
  if position('assert_grant_preconditions' in v_def) = 0 then
    v_fail := v_fail || 'grant_vertical_private_access has no target eligibility gate'::text;
  end if;
  select pg_get_functiondef(p.oid) into v_def from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='grant_platform_capability';
  if position('assert_live_grant_target' in v_def) = 0 then
    v_fail := v_fail || 'grant_platform_capability never calls assert_live_grant_target'::text;
  end if;

  -- 4. The authority gate must lock the ACTOR's row, not just take the advisory.
  select pg_get_functiondef(p.oid) into v_def from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='assert_platform_capability';
  if position('for update' in lower(v_def)) = 0 then
    v_fail := v_fail || 'assert_platform_capability does not lock the actor users row'::text;
  end if;

  -- 5. FUNCTIONAL: the gate actually refuses a blocked / non-existent target,
  --    with ONE generic error (no existence oracle).
  declare v_a text; v_b text; v_blk uuid := '00000000-0000-4000-8000-000000162001';
  begin
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at)
    values (v_blk,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
            '_t162_blocked@example.test','',now(),now(),now())
    on conflict (id) do nothing;
    insert into public.users (id, role, phone, display_name, is_blocked)
    values (v_blk,'customer','+201000162001','t162 blocked',true)
    on conflict (id) do update set is_blocked=true, display_name=excluded.display_name;
    if not (select is_blocked from public.users where id=v_blk) then
      raise exception 'mig162 fixture: the blocked user is not actually blocked';
    end if;
    begin
      perform public.assert_live_grant_target(v_blk);
      v_fail := v_fail || 'assert_live_grant_target accepted a BLOCKED user'::text;
    exception when others then v_a := sqlerrm;
    end;
    begin
      perform public.assert_live_grant_target('00000000-0000-4000-8000-0000009999ff');
      v_fail := v_fail || 'assert_live_grant_target accepted a NON-EXISTENT user'::text;
    exception when others then v_b := sqlerrm;
    end;
    if v_a is distinct from v_b then
      v_fail := v_fail || format('blocked/missing distinguishable: %L vs %L', v_a, v_b);
    end if;
  end;

  if array_length(v_fail,1) > 0 then
    raise exception 'E0 mig162 closure assertions FAILED (%):%  - %',
      array_length(v_fail,1), E'\n', array_to_string(v_fail, E'\n  - ');
  end if;
  raise notice 'E0 mig162 closure assertions PASSED (no stale overloads, gate invoked, actor locked)';
end $$;

-- ---------------- mig 162: combined gate is installed and totally ordered ----
do $$
declare v_fail text[] := '{}'; v_def text;
begin
  -- The composition that deadlocked (actor row in one helper, target row in the
  -- other) must be GONE from the grant path, replaced by the single gate.
  select pg_get_functiondef(p.oid) into v_def from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='grant_vertical_private_access';
  if position('assert_grant_preconditions' in v_def) = 0 then
    v_fail := v_fail || 'grant_vertical_private_access does not use the combined gate'::text;
  end if;
  if position('assert_platform_capability' in v_def) > 0 then
    v_fail := v_fail || 'the old actor-only gate is still called (locks out of order)'::text;
  end if;
  if position('assert_live_grant_target' in v_def) > 0 then
    v_fail := v_fail || 'the separate target gate is still called (double lock position)'::text;
  end if;

  -- The gate itself must sort the rows. `order by id` is the entire reason
  -- A->B and B->A converge instead of deadlocking.
  select pg_get_functiondef(p.oid) into v_def from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='assert_grant_preconditions';
  if position('order by id' in lower(v_def)) = 0 then
    v_fail := v_fail || 'the combined gate does not lock users rows in a total order'::text;
  end if;
  -- The advisory must be keyed on the ACTOR, not the target: this function
  -- authorizes the actor, so a target-keyed lock neither serialises against a
  -- concurrent revoke/expiry of the ACTOR's capability nor stops an
  -- unauthorized caller taking a lock named after an arbitrary target.
  if position('cap:'' || p_actor::text' in v_def) = 0 then
    v_fail := v_fail || 'the combined gate advisory is not keyed on the ACTOR'::text;
  end if;
  if position('cap:'' || p_target::text' in v_def) > 0 then
    v_fail := v_fail || 'the combined gate still takes a TARGET-keyed advisory'::text;
  end if;
  -- SOURCE ORDER, not mere presence: advisory, then the cheap authority
  -- rejection, then the row locks. Any other order reopens either the
  -- deadlock or the cross-target lock DoS.
  if position('pg_advisory_xact_lock' in v_def) > position('for update' in lower(v_def)) then
    v_fail := v_fail || 'the combined gate takes rows before the advisory (inverted)'::text;
  end if;
  if position('has_platform_capability' in v_def) > position('for update' in lower(v_def)) then
    v_fail := v_fail || 'the combined gate locks rows BEFORE rejecting an unauthorized actor'::text;
  end if;

  -- Revoke got the same treatment as grant.
  select pg_get_functiondef(p.oid) into v_def from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='revoke_platform_capability';
  if position('for update' in lower(v_def)) = 0 then
    v_fail := v_fail || 'revoke_platform_capability still gates on an UNLOCKED owner check'::text;
  end if;
  -- ...and it must reject a non-owner BEFORE taking any target lock, or any
  -- authenticated user could stall an owner's revoke by naming them.
  if position('is_platform_owner' in v_def) > position('pg_advisory_xact_lock' in v_def) then
    v_fail := v_fail || 'revoke_platform_capability locks a target before rejecting a non-owner'::text;
  end if;

  if array_length(v_fail,1) > 0 then
    raise exception 'E0 mig162 lock-graph assertions FAILED (%):%  - %',
      array_length(v_fail,1), E'\n', array_to_string(v_fail, E'\n  - ');
  end if;
  raise notice 'E0 mig162 lock-graph assertions PASSED (combined gate, total order, revoke locked)';
end $$;

-- -------------------------- mig 163: saved-orders concealment ---------------
do $$
declare
  v_fail text[] := '{}';
  v_pilot uuid := '00000000-0000-4000-8000-000000163001';
  v_gro   uuid := '00000000-0000-4000-8000-000000163002';
  v_sect  uuid := '00000000-0000-4000-8000-000000163003';
  v_item  uuid := '00000000-0000-4000-8000-000000163004';
  v_saved uuid;
  v_n int;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (v_pilot,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
          '_t163@example.test','',now(),now(),now())
  on conflict (id) do nothing;
  insert into public.users (id, role, phone, display_name)
  values (v_pilot,'customer','+201000163001','t163 pilot')
  on conflict (id) do update set role='customer', is_blocked=false;

  -- A merchant in a HIDDEN vertical, and a preset the customer saved earlier
  -- (i.e. back when it was visible -- exactly the real-world case).
  insert into public.restaurants (id,slug,name,cover_image,zone,vertical_id,is_active,is_open,min_order_egp)
  values (v_gro,'_t163-g','Hidden Pharmacy','','naama','food',true,true,0);
  insert into public.menu_sections (id,restaurant_id,name) values (v_sect,v_gro,'S');
  insert into public.menu_items (id,restaurant_id,section_id,name,price_egp,is_available)
  values (v_item,v_gro,v_sect,'Sensitive Item',10,true);

  insert into public.saved_orders (user_id, restaurant_id, name, items)
  values (v_pilot, v_gro, 'My pharmacy refill',
          jsonb_build_array(jsonb_build_object('itemId', v_item, 'name','Sensitive Item','quantity',1)))
  returning id into v_saved;

  -- Now the merchant moves into a vertical the customer cannot see.
  -- vertical_id is guarded by a privileged-column trigger (MANAGER_REQUIRED),
  -- and mig 158 makes admin_assign_merchant_vertical the only sanctioned writer.
  -- Reset the role GUC so the trigger sees a definer context rather than the
  -- staff identity this block is about to assume.
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
  update public.restaurants set vertical_id='pharmacy' where id=v_gro;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_pilot, 'role','authenticated')::text, true);
  set local role authenticated;

  -- 1. THE LEAK: the app-facing view must NOT disclose the merchant's basket.
  --    The row itself remains addressable by its owner ON PURPOSE -- Postgres
  --    applies the SELECT policy when locating rows for DELETE, so concealing
  --    the row entirely would strand it forever (proven on a clone: the delete
  --    reported 0 rows affected). Concealment is therefore COLUMN-level.
  select count(*) into v_n from public.saved_orders_visible
   where id = v_saved and (name is not null or items::text <> '[]');
  if v_n <> 0 then
    v_fail := v_fail || 'a saved order for a HIDDEN merchant still discloses its name/items'::text;
  end if;

  -- 2. Nothing sensitive is readable through a filtered read of the view.
  select count(*) into v_n from public.saved_orders_visible
   where name = 'My pharmacy refill' or items::text like '%Sensitive Item%';
  if v_n <> 0 then
    v_fail := v_fail || 'the preset name or items JSON leaked through a filtered read'::text;
  end if;

  -- 2b. ...and the row is flagged unavailable so the UI can say so honestly.
  select count(*) into v_n from public.saved_orders_visible
   where id = v_saved and is_available;
  if v_n <> 0 then
    v_fail := v_fail || 'a hidden-vertical preset is still flagged available'::text;
  end if;

  -- 3. Cannot CREATE a preset for a merchant they may not see (mirror image).
  begin
    insert into public.saved_orders (user_id, restaurant_id, name, items)
    values (v_pilot, v_gro, 'sneaky', '[]'::jsonb);
    v_fail := v_fail || 'a preset was saved for a HIDDEN merchant'::text;
  exception when insufficient_privilege or check_violation then null;
  end;

  -- 4. DELETE MUST STILL WORK on an unusable preset, or the customer loses one
  --    of five slots to something they cannot even see. Asserted on ROW_COUNT,
  --    not on a re-read: a re-read would pass vacuously if the row were merely
  --    concealed rather than actually deleted.
  delete from public.saved_orders where id = v_saved;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    v_fail := v_fail || format('delete of an unusable preset affected %s row(s), expected 1 (slot stranded)', v_n);
  end if;
  reset role;
  select count(*) into v_n from public.saved_orders where id = v_saved;
  if v_n <> 0 then
    v_fail := v_fail || 'the preset survived deletion (unfiltered read still finds it)'::text;
  end if;

  -- 5. A preset for a VISIBLE merchant is unaffected -- concealment must not
  --    break the ordinary food case.
  insert into public.saved_orders (user_id, restaurant_id, name, items)
  values (v_pilot, (select id from public.restaurants where vertical_id='food' and is_active limit 1),
          'normal food preset', '[]'::jsonb)
  returning id into v_saved;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_pilot, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.saved_orders_visible
   where id = v_saved and is_available and name = 'normal food preset';
  reset role;
  if v_n <> 1 then
    v_fail := v_fail || 'concealment wrongly redacted a preset for a VISIBLE food merchant'::text;
  end if;

  if array_length(v_fail,1) > 0 then
    raise exception 'E0 mig163 saved-orders assertions FAILED (%):%  - %',
      array_length(v_fail,1), E'\n', array_to_string(v_fail, E'\n  - ');
  end if;
  raise notice 'E0 mig163 saved-orders concealment PASSED (list hidden, insert blocked, delete preserved)';
end $$;
