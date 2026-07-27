-- Assertions for migrations 149 + 150 (driver COD exposure ceiling).
--
-- Run inside a rolled-back transaction:
--   BEGIN; \i supabase/migrations/149_driver_cod_ceiling.sql
--          \i supabase/migrations/150_cod_ceiling_enforcement.sql
--          \i supabase/tests/149_150_cod_ceiling.test.sql
--   ROLLBACK;

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------- shape ----
do $$
declare v_fail text[] := '{}'; v_n int;
begin
  -- New tables: RLS on, and anon holds nothing (house rule 5b).
  foreach v_n in array array[1] loop null; end loop;
  if not (select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relname='driver_cod_overrides') then
    v_fail := v_fail || 'RLS not enabled on driver_cod_overrides'::text;
  end if;
  if not (select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relname='driver_cod_limit_events') then
    v_fail := v_fail || 'RLS not enabled on driver_cod_limit_events'::text;
  end if;
  foreach v_n in array array[1] loop null; end loop;

  if has_table_privilege('anon','public.driver_cod_overrides','SELECT')
     or has_table_privilege('anon','public.driver_cod_limit_events','SELECT') then
    v_fail := v_fail || 'anon can read COD limit tables'::text;
  end if;
  if has_table_privilege('authenticated','public.driver_cod_overrides','TRUNCATE')
     or has_table_privilege('authenticated','public.driver_cod_limit_events','TRUNCATE') then
    v_fail := v_fail || 'TRUNCATE still granted (it bypasses RLS)'::text;
  end if;
  if has_table_privilege('authenticated','public.driver_cod_overrides','INSERT')
     or has_table_privilege('authenticated','public.driver_cod_overrides','UPDATE') then
    v_fail := v_fail || 'authenticated can write overrides directly'::text;
  end if;
  -- Telemetry has no client policy at all.
  if (select count(*) from pg_policies where schemaname='public' and tablename='driver_cod_limit_events') <> 0 then
    v_fail := v_fail || 'driver_cod_limit_events has a client policy'::text;
  end if;

  -- The shared decision function must NOT be reachable by a client: another
  -- driver's cash position is not a client's business.
  if has_function_privilege('authenticated','public.driver_cod_capacity(uuid,uuid)','EXECUTE')
     or has_function_privilege('anon','public.driver_cod_capacity(uuid,uuid)','EXECUTE') then
    v_fail := v_fail || 'driver_cod_capacity is exposed to clients'::text;
  end if;

  -- Exactly one overload of each replaced RPC (house rule 1).
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='assign_driver';
  if v_n <> 1 then v_fail := v_fail || ('assign_driver has '||v_n||' overloads')::text; end if;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='auto_assign_order';
  if v_n <> 1 then v_fail := v_fail || ('auto_assign_order has '||v_n||' overloads')::text; end if;

  -- Settings exist and default to OBSERVE, so applying 149 changes nothing.
  if (select value #>> '{}' from public.platform_settings where key='driver_cod_limit_mode') <> 'observe' then
    v_fail := v_fail || 'driver_cod_limit_mode did not default to observe'::text;
  end if;

  if array_length(v_fail,1) > 0 then
    raise exception E'MIG 149/150 SHAPE FAILED (%):\n  - %',
      array_length(v_fail,1), array_to_string(v_fail, E'\n  - ');
  end if;
  raise notice 'MIG 149/150 shape assertions PASSED';
end $$;


-- ------------------------------------------------------------ behaviour ----
do $$
declare
  v_fail text[] := '{}';
  v_admin uuid := gen_random_uuid();
  v_dprof uuid := gen_random_uuid();
  v_driver uuid;
  v_cust uuid := gen_random_uuid();
  v_rest uuid := gen_random_uuid();
  v_sect uuid := gen_random_uuid();
  v_addr uuid := gen_random_uuid();
  v_cod uuid := gen_random_uuid();
  v_card uuid := gen_random_uuid();
  v_cap record;
  v_n int;
begin
  -- Actors.
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u, '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
         '_t149_'||u::text||'@example.test','',now(),now(),now()
    from unnest(array[v_admin, v_dprof, v_cust]) u;

  update public.users set role='admin', phone='+2010149001', display_name='_t149 admin' where id=v_admin;
  update public.users set role='driver', phone='+2010149002', display_name='_t149 driver' where id=v_dprof;
  update public.users set role='customer', phone='+2010149003', display_name='_t149 cust' where id=v_cust;

  -- drivers.name is NOT NULL with no default (checked against the live schema).
  insert into public.drivers (profile_id, name, is_active, is_verified, status)
  values (v_dprof, '_t149 driver', true, true, 'online') returning id into v_driver;

  insert into public.restaurants (id, slug, name, cover_image, zone, is_active, is_open, min_order_egp)
  values (v_rest, '_t149-r', '_t149 R', '', 'naama', true, true, 0);
  insert into public.menu_sections (id, restaurant_id, name) values (v_sect, v_rest, 's');

  -- Two orders: one COD, one card. Inserted directly because place_order needs
  -- a full customer/address/geo path that is not what this test is about --
  -- the ceiling reads orders.total_egp and payment_method, nothing else.
  -- short_code, address_snapshot, tax_egp and eta_at are also NOT NULL.
  insert into public.orders (id, short_code, user_id, restaurant_id, restaurant_name,
                             address_snapshot, items, subtotal_egp, delivery_fee_egp,
                             tax_egp, total_egp, eta_at, status,
                             payment_method, payment_method_kind, payment_label)
  values (v_cod,  'T149COD', v_cust, v_rest, '_t149 R', '{}'::jsonb, '[]'::jsonb,
          900, 100, 0, 1000, now() + interval '30 min', 'ready',
          'cash_on_delivery', 'cash', 'Cash'),
         (v_card, 'T149CRD', v_cust, v_rest, '_t149 R', '{}'::jsonb, '[]'::jsonb,
          900, 100, 0, 1000, now() + interval '30 min', 'ready',
          'card', 'card', 'Card');

  -- 1. Empty ledger, small order: allowed.
  select * into v_cap from public.driver_cod_capacity(v_driver, v_cod);
  if v_cap.outcome <> 'allowed' then
    v_fail := v_fail || format('clean driver reported %L', v_cap.outcome);
  end if;
  if v_cap.prospective_egp <> 1000 then
    v_fail := v_fail || format('COD order weighed %s, expected 1000', v_cap.prospective_egp);
  end if;

  -- 2. Custody comes from the LEDGER. Push the driver just over the soft limit.
  insert into public.driver_cash_ledger (driver_id, delta_egp, reason, ref_order_id)
  values (v_driver, 2500, 'cod_collected', null);
  select * into v_cap from public.driver_cod_capacity(v_driver, v_cod);
  if v_cap.held_egp <> 2500 then
    v_fail := v_fail || format('held_egp read %s, expected 2500 from the ledger', v_cap.held_egp);
  end if;
  -- 2500 + 1000 = 3500 > soft 3000, < hard 5000.
  if v_cap.outcome <> 'warned' then
    v_fail := v_fail || format('crossing the soft limit reported %L, expected warned', v_cap.outcome);
  end if;

  -- 3. Past the HARD limit, in observe mode: would_block, not blocked.
  insert into public.driver_cash_ledger (driver_id, delta_egp, reason, ref_order_id)
  values (v_driver, 2000, 'cod_collected', null);   -- held = 4500
  select * into v_cap from public.driver_cod_capacity(v_driver, v_cod);  -- +1000 = 5500 > 5000
  if v_cap.outcome <> 'would_block' then
    v_fail := v_fail || format('observe mode reported %L, expected would_block', v_cap.outcome);
  end if;

  -- 4. NON-COD work is never blocked, however much cash is held.
  select * into v_cap from public.driver_cod_capacity(v_driver, v_card);
  if v_cap.outcome <> 'allowed' then
    v_fail := v_fail || format('a CARD order was gated by the cash ceiling (%L)', v_cap.outcome);
  end if;

  -- 5. Switch to ENFORCE: the same state now blocks.
  update public.platform_settings set value = to_jsonb('enforce'::text)
   where key = 'driver_cod_limit_mode';
  select * into v_cap from public.driver_cod_capacity(v_driver, v_cod);
  if v_cap.outcome <> 'blocked' then
    v_fail := v_fail || format('enforce mode reported %L, expected blocked', v_cap.outcome);
  end if;

  -- 6. A HAND-IN immediately restores capacity (the ledger is the truth).
  insert into public.driver_cash_ledger (driver_id, delta_egp, reason, ref_order_id)
  values (v_driver, -4000, 'hand_in', null);   -- held = 500
  select * into v_cap from public.driver_cod_capacity(v_driver, v_cod);
  if v_cap.outcome <> 'allowed' then
    v_fail := v_fail || format('a hand-in did not restore capacity (%L, held %s)',
                               v_cap.outcome, v_cap.held_egp);
  end if;

  -- 6b. A SUCCESSFUL assignment records durable telemetry. (The read-only
  --     driver_cod_capacity() calls above deliberately log nothing -- only the
  --     assignment paths do.)
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
  perform public.assign_driver(v_cod, v_driver);
  select count(*) into v_n from public.driver_cod_limit_events
   where driver_id = v_driver and outcome = 'allowed';
  if v_n < 1 then
    v_fail := v_fail || 'a successful assignment recorded no limit event'::text;
  end if;

  -- 7. Dispatcher path RAISES when enforcing.
  insert into public.driver_cash_ledger (driver_id, delta_egp, reason, ref_order_id)
  values (v_driver, 4600, 'cod_collected', null);   -- held = 5100
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
  begin
    perform public.assign_driver(v_cod, v_driver);
    v_fail := v_fail || 'assign_driver did NOT refuse an over-limit driver in enforce mode'::text;
  exception when sqlstate '23514' then
    if position('COD_LIMIT_EXCEEDED' in sqlerrm) = 0 then
      v_fail := v_fail || format('wrong error from assign_driver: %s', sqlerrm);
    end if;
  end;

  -- Telemetry: the NON-blocking outcomes are durably recorded. A blocked
  -- dispatcher assignment necessarily rolls its row back with the raise (no
  -- dblink on this database, so there is no autonomous transaction) -- that is
  -- why the block also fires an ops_alert over pg_net, which is NOT part of
  -- this transaction and therefore survives. Asserting a 'blocked' row here
  -- would be asserting something Postgres cannot deliver.
  select count(*) into v_n from public.driver_cod_limit_events
   where driver_id = v_driver;
  if v_n < 1 then
    v_fail := v_fail || 'no COD limit telemetry was recorded at all'::text;
  end if;

  -- 8. An admin OVERRIDE lets the same assignment through.
  perform public.admin_grant_cod_override(v_driver, 'end of shift, bank closed', 4);
  select * into v_cap from public.driver_cod_capacity(v_driver, v_cod);
  if v_cap.outcome <> 'overridden' then
    v_fail := v_fail || format('an active override reported %L', v_cap.outcome);
  end if;

  -- 9. Override rules: reason required, duration bounded, admin only.
  begin
    perform public.admin_grant_cod_override(v_driver, 'x', 4);
    v_fail := v_fail || 'an override was granted with a 1-character reason'::text;
  exception when sqlstate '23514' then null;
  end;
  begin
    perform public.admin_grant_cod_override(v_driver, 'valid reason', 999);
    v_fail := v_fail || 'an override was granted for an unbounded duration'::text;
  exception when sqlstate '23514' then null;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_dprof)::text, true);
  begin
    perform public.admin_grant_cod_override(v_driver, 'granting myself capacity', 4);
    v_fail := v_fail || 'a DRIVER granted themselves a COD override'::text;
  exception when sqlstate '23514' then null;
  end;

  -- 10. A driver sees their OWN limits and nobody else's.
  select count(*) into v_n from public.my_cod_capacity();
  if v_n <> 1 then
    v_fail := v_fail || 'my_cod_capacity did not return the calling driver''s row'::text;
  end if;

  if array_length(v_fail,1) > 0 then
    raise exception E'MIG 149/150 BEHAVIOUR FAILED (%):\n  - %',
      array_length(v_fail,1), array_to_string(v_fail, E'\n  - ');
  end if;
  raise notice 'MIG 149/150 behaviour assertions PASSED';
end $$;
