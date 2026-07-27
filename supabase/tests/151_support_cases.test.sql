-- Assertions for migration 151 (support cases and SLA).
--
--   BEGIN; \i supabase/migrations/151_support_cases.sql
--          \i supabase/tests/151_support_cases.test.sql
--   ROLLBACK;

\set ON_ERROR_STOP on

do $$
declare v_fail text[] := '{}'; v_n int;
begin
  -- RLS on both new tables; anon holds nothing; TRUNCATE gone (house rule 5b).
  if not (select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relname='support_cases') then
    v_fail := v_fail || 'RLS not enabled on support_cases'::text;
  end if;
  if not (select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relname='support_case_events') then
    v_fail := v_fail || 'RLS not enabled on support_case_events'::text;
  end if;
  if has_table_privilege('anon','public.support_cases','SELECT') then
    v_fail := v_fail || 'anon can read support cases'::text;
  end if;
  if has_table_privilege('authenticated','public.support_cases','TRUNCATE')
     or has_table_privilege('authenticated','public.support_case_events','TRUNCATE') then
    v_fail := v_fail || 'TRUNCATE still granted (bypasses RLS)'::text;
  end if;
  -- No client write grants: every mutation goes through the RPCs.
  if has_table_privilege('authenticated','public.support_cases','INSERT')
     or has_table_privilege('authenticated','public.support_cases','UPDATE') then
    v_fail := v_fail || 'authenticated can write support_cases directly'::text;
  end if;

  -- support_messages must be UNCHANGED in shape apart from the added column:
  -- an old client posting a message must not start failing.
  if (select is_nullable from information_schema.columns
       where table_schema='public' and table_name='support_messages' and column_name='case_id') <> 'YES' then
    v_fail := v_fail || 'support_messages.case_id is NOT NULL -- old clients would break'::text;
  end if;
  select count(*) into v_n from pg_policies
   where schemaname='public' and tablename='support_messages';
  if v_n < 2 then
    v_fail := v_fail || 'support_messages policies were disturbed'::text;
  end if;

  -- Unauthenticated callers refused.
  begin
    perform public.open_support_case('other');
    v_fail := v_fail || 'open_support_case did NOT refuse an unauthenticated caller'::text;
  exception when sqlstate '23514' then null;
  end;

  if array_length(v_fail,1) > 0 then
    raise exception E'MIG 151 SHAPE FAILED (%):\n  - %',
      array_length(v_fail,1), array_to_string(v_fail, E'\n  - ');
  end if;
  raise notice 'MIG 151 shape assertions PASSED';
end $$;


do $$
declare
  v_fail text[] := '{}';
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_case uuid; v_case2 uuid; v_n int; v_evt uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
         '_t151_'||u::text||'@example.test','',now(),now(),now()
    from unnest(array[v_a, v_b, v_admin]) u;
  update public.users set role='customer', phone='+2010151001', display_name='_t151 A' where id=v_a;
  update public.users set role='customer', phone='+2010151002', display_name='_t151 B' where id=v_b;
  update public.users set role='admin',    phone='+2010151003', display_name='_t151 ops' where id=v_admin;

  -- Customer A opens a case.
  perform set_config('request.jwt.claims', json_build_object('sub', v_a)::text, true);
  v_case := public.open_support_case('order_late', null, 'Where is my food?');

  select count(*) into v_n from public.support_cases where id = v_case and customer_id = v_a;
  if v_n <> 1 then v_fail := v_fail || 'case was not created for the caller'::text; end if;

  -- The opening message is attached to the case.
  select count(*) into v_n from public.support_messages where case_id = v_case;
  if v_n <> 1 then v_fail := v_fail || 'the opening message was not linked to the case'::text; end if;

  -- SLA targets were set.
  if (select first_response_due_at from public.support_cases where id=v_case) is null then
    v_fail := v_fail || 'no first-response SLA was set'::text;
  end if;

  -- 1. A SECOND open attempt returns the SAME case -- one problem, one queue
  --    entry, rather than a split conversation.
  v_case2 := public.open_support_case('order_late');
  if v_case2 is distinct from v_case then
    v_fail := v_fail || 'a second open created a duplicate live case'::text;
  end if;

  -- 2. Money reasons default to HIGH priority.
  perform set_config('request.jwt.claims', json_build_object('sub', v_b)::text, true);
  v_case2 := public.open_support_case('refund');
  if (select priority from public.support_cases where id=v_case2) <> 'high' then
    v_fail := v_fail || 'a refund case did not default to high priority'::text;
  end if;

  -- 3. A customer cannot attach a case to someone ELSE's order.
  perform set_config('request.jwt.claims', json_build_object('sub', v_a)::text, true);
  begin
    perform public.open_support_case('payment',
      (select id from public.orders where user_id <> v_a limit 1));
    -- Only a failure if such an order actually exists to steal.
    if exists (select 1 from public.orders where user_id <> v_a) then
      v_fail := v_fail || 'a customer attached a case to another customer''s order'::text;
    end if;
  exception when sqlstate '23514' then null;
  end;

  -- 4. A customer cannot resolve their own case.
  begin
    perform public.resolve_support_case(v_case, 'no_action');
    v_fail := v_fail || 'a CUSTOMER resolved their own support case'::text;
  exception when sqlstate '23514' then null;
  end;

  -- 5. Staff can claim and resolve; resolution demands a structured code.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
  perform public.claim_support_case(v_case);
  if (select assigned_to from public.support_cases where id=v_case) is distinct from v_admin then
    v_fail := v_fail || 'claim did not record the owner'::text;
  end if;
  begin
    perform public.resolve_support_case(v_case, 'made_up_code');
    v_fail := v_fail || 'an invalid resolution code was accepted'::text;
  exception when sqlstate '23514' then null;
  end;
  perform public.resolve_support_case(v_case, 'credited', 'EGP 50 credit issued');
  if (select status from public.support_cases where id=v_case) <> 'resolved' then
    v_fail := v_fail || 'resolve did not set status'::text;
  end if;

  -- 6. History is append-only, even here.
  select id into v_evt from public.support_case_events where case_id = v_case limit 1;
  begin
    update public.support_case_events set event='note' where id=v_evt;
    v_fail := v_fail || 'a case event was UPDATEable'::text;
  exception when sqlstate '23514' then null;
  end;
  begin
    delete from public.support_case_events where id=v_evt;
    v_fail := v_fail || 'a case event was DELETEable'::text;
  exception when sqlstate '23514' then null;
  end;

  -- 7. CROSS-USER: B must not see A's case. Set the role so RLS applies (it is
  --    bypassed for the table owner).
  perform set_config('request.jwt.claims', json_build_object('sub', v_b)::text, true);
  set local role authenticated;
  select count(*) into v_n from public.support_cases where customer_id = v_a;
  if v_n <> 0 then
    v_fail := v_fail || format('customer B can read %s of A''s cases', v_n);
  end if;
  -- ...and case HISTORY is staff-only, so B sees none at all.
  select count(*) into v_n from public.support_case_events;
  if v_n <> 0 then
    v_fail := v_fail || format('customer B can read %s case events', v_n);
  end if;
  reset role;

  -- 8. Legacy backfill: no message left orphaned, and the backfilled case is
  --    RESOLVED so it never appears in a live queue as work nobody is doing.
  select count(*) into v_n from public.support_messages where case_id is null;
  if v_n <> 0 then
    v_fail := v_fail || format('%s support messages were left without a case', v_n);
  end if;
  select count(*) into v_n from public.support_cases
   where resolution_note like 'Backfilled%' and status <> 'resolved';
  if v_n <> 0 then
    v_fail := v_fail || 'a backfilled legacy case is sitting in the live queue'::text;
  end if;

  if array_length(v_fail,1) > 0 then
    raise exception E'MIG 151 BEHAVIOUR FAILED (%):\n  - %',
      array_length(v_fail,1), array_to_string(v_fail, E'\n  - ');
  end if;
  raise notice 'MIG 151 behaviour assertions PASSED';
end $$;
