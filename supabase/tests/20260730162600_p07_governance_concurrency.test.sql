-- Two-session proof for the Package 07 lifecycle/vertical transition lock.
--
-- This test intentionally commits fixtures so separate dblink sessions can
-- observe them. Run only against a disposable database after the migration:
--
--   psql "$DISPOSABLE_PGURI" -v ON_ERROR_STOP=1 \
--     -v dblink_dsn="$DISPOSABLE_PGURI" \
--     -f supabase/tests/20260730162600_p07_governance_concurrency.test.sql
--
-- Pass criteria for each producer:
--   1. an exclusive vertical transition lock makes the producer wait;
--   2. after the transition commits private, the producer re-checks visibility;
--   3. it records vertical_not_visible and never records would_send=true.

\set ON_ERROR_STOP on

create extension if not exists dblink;

-- dblink starts independent clients, so it must receive the same complete
-- connection URI (including non-default host/port/user/credentials). For a
-- local socket test the fallback below is sufficient; remote/disposable CI
-- should pass -v dblink_dsn="$DISPOSABLE_PGURI" as documented above.
\if :{?dblink_dsn}
\else
select format(
  'dbname=%L user=%L host=%L port=%L',
  current_database(),
  current_user,
  coalesce(
    inet_server_addr()::text,
    split_part(current_setting('unix_socket_directories'), ',', 1)
  ),
  current_setting('port')
) as dblink_dsn \gset
\endif

select set_config(
  'p07.dblink_dsn',
  :'dblink_dsn',
  false
) as p07_dsn_loaded \gset

do $fixtures$
declare
  v_user uuid := '00000000-0000-4000-8000-000000000721';
  v_rest uuid := '00000000-0000-4000-8000-000000000722';
  v_order uuid := '00000000-0000-4000-8000-000000000723';
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at
  ) values (
    v_user, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', '_tp07_concurrency@example.test', '',
    now(), now(), now()
  ) on conflict (id) do nothing;

  insert into public.users (id, role, phone, display_name, is_blocked)
  values (v_user, 'customer', '+201000000721', 'P07 concurrency customer', false)
  on conflict (id) do update set role = 'customer', is_blocked = false;

  insert into public.restaurants (
    id, slug, name, cover_image, zone, vertical_id,
    cuisines, is_active, is_open, min_order_egp
  ) values (
    v_rest, '_tp07-concurrency', 'P07 concurrency', '', 'naama', 'grocery',
    '{}'::public.cuisine_type[], true, true, 0
  ) on conflict (id) do update
    set vertical_id = 'grocery', cuisines = '{}', is_active = true, is_open = true;

  insert into public.customer_carts (
    user_id, restaurant_id, items, updated_at, expires_at
  ) values (
    v_user, v_rest,
    jsonb_build_array(jsonb_build_object(
      'item_id', '00000000-0000-4000-8000-000000000729',
      'quantity', 1, 'modifier_option_ids', jsonb_build_array(), 'notes', ''
    )),
    now() - interval '25 hours', now() + interval '7 days'
  ) on conflict (user_id) do update
    set restaurant_id = excluded.restaurant_id,
        items = excluded.items,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at;

  insert into public.orders (
    id, short_code, user_id, restaurant_id, restaurant_name,
    address_snapshot, items, subtotal_egp, delivery_fee_egp, tax_egp,
    total_egp, eta_at, status, payment_method, payment_method_kind,
    payment_label, delivered_at, vertical_id
  ) values (
    v_order, 'TP07C', v_user, v_rest, 'P07 concurrency',
    '{}'::jsonb, '[]'::jsonb, 10, 0, 0, 10, now(),
    'delivered', 'cash_on_delivery', 'cash', 'Cash',
    now() - interval '8 days', 'grocery'
  ) on conflict (id) do update
    set delivered_at = now() - interval '8 days',
        status = 'delivered',
        vertical_id = 'grocery';

  update public.vertical_private_access
     set status = 'revoked', revoked_at = coalesce(revoked_at, now())
   where vertical_id = 'grocery' and user_id = v_user and status = 'active';
  delete from public.lifecycle_sends where user_id = v_user;
  update public.verticals
     set launch_stage = 'public', is_active = true
   where id = 'grocery';
end;
$fixtures$;

do $concurrency$
declare
  v_dsn text := current_setting('p07.dblink_dsn');
  v_busy integer;
  v_result integer;
  v_count integer;
  v_producer text;
  v_event text;
  v_subject uuid;
begin
  perform dblink_connect('p07_transition', v_dsn);

  foreach v_producer in array array[
    'select public.abandoned_cart_sweep()',
    'select public.reorder_cadence_sweep()'
  ] loop
    if v_producer like '%abandoned_cart%' then
      v_event := 'abandoned_cart';
      v_subject := '00000000-0000-4000-8000-000000000722';
    else
      v_event := 'reorder_cadence';
      v_subject := '00000000-0000-4000-8000-000000000723';
    end if;

    -- A fresh async connection per query avoids libpq's pending-result state
    -- leaking between the two independent producer proofs.
    perform dblink_connect('p07_producer', v_dsn);

    -- Setup must commit before either remote transaction starts. Doing these
    -- writes in this local DO transaction would hold row locks that the remote
    -- transition cannot acquire.
    perform dblink_exec(
      'p07_transition',
      format(
        'delete from public.lifecycle_sends where user_id = %L and lifecycle_event = %L',
        '00000000-0000-4000-8000-000000000721',
        v_event
      )
    );
    perform dblink_exec(
      'p07_transition',
      'update public.verticals set launch_stage = ''public'' where id = ''grocery'''
    );

    perform dblink_exec('p07_transition', 'begin');
    perform dblink_exec(
      'p07_transition',
      $remote$
        do $lock$
        begin
          perform pg_advisory_xact_lock(
            hashtextextended('vertical:grocery', 0)
          );
          update public.verticals
             set launch_stage = 'private'
           where id = 'grocery';
        end;
        $lock$;
      $remote$
    );

    if dblink_send_query('p07_producer', v_producer) <> 1 then
      raise exception 'could not launch % asynchronously', v_event;
    end if;

    perform pg_sleep(0.20);
    select dblink_is_busy('p07_producer') into v_busy;
    if v_busy <> 1 then
      raise exception '% did not wait on the vertical transition lock', v_event;
    end if;

    perform dblink_exec('p07_transition', 'commit');
    select result
      into v_result
      from dblink_get_result('p07_producer') as completed(result integer);

    if v_result <> 0 then
      raise exception '% reported % sends after the vertical closed', v_event, v_result;
    end if;

    select count(*)
      into v_count
      from public.lifecycle_sends
     where user_id = '00000000-0000-4000-8000-000000000721'
       and lifecycle_event = v_event
       and subject_id = v_subject
       and suppression_reason = 'vertical_not_visible'
       and not would_send;
    if v_count <> 1 then
      raise exception '% recorded % post-transition suppressions, expected 1',
        v_event,
        v_count;
    end if;

    select count(*)
      into v_count
      from public.lifecycle_sends
     where user_id = '00000000-0000-4000-8000-000000000721'
       and lifecycle_event = v_event
       and would_send;
    if v_count <> 0 then
      raise exception '% recorded would_send=true after the close', v_event;
    end if;

    perform dblink_disconnect('p07_producer');
  end loop;

  -- Reproduce the REAL private-access lock order, not only a synthetic
  -- vertical transition:
  --
  --   access RPC: target users row FOR UPDATE -> exclusive vertical advisory
  --   producer:   shared vertical advisory -> unlock -> lifecycle ledger FK
  --
  -- The producer must release vertical before it waits on the users row. If it
  -- still held vertical here, the real grant RPC below and the ledger insert
  -- would deadlock.
  perform dblink_exec(
    'p07_transition',
    'update public.vertical_private_access '
      || 'set status = ''revoked'', revoked_at = coalesce(revoked_at, now()) '
      || 'where vertical_id = ''grocery'' '
      || 'and user_id = ''00000000-0000-4000-8000-000000000721'' '
      || 'and status = ''active'''
  );
  perform dblink_exec(
    'p07_transition',
    'delete from public.lifecycle_sends '
      || 'where user_id = ''00000000-0000-4000-8000-000000000721'' '
      || 'and lifecycle_event = ''abandoned_cart'''
  );
  perform dblink_exec(
    'p07_transition',
    'update public.verticals set launch_stage = ''private'' where id = ''grocery'''
  );
  perform dblink_connect('p07_producer', v_dsn);
  perform dblink_exec('p07_transition', 'begin');
  perform dblink_exec(
    'p07_transition',
    $remote$
      do $hold_user$
      begin
        perform set_config(
          'request.jwt.claims',
          json_build_object(
            'sub', '91967dc5-9b0c-4ce4-ad8b-9810b3aee768',
            'role', 'authenticated'
          )::text,
          true
        );
        perform 1
          from public.users
         where id = '00000000-0000-4000-8000-000000000721'
         for update;
      end;
      $hold_user$;
    $remote$
  );

  if dblink_send_query(
    'p07_producer',
    'select public.abandoned_cart_sweep()'
  ) <> 1 then
    raise exception 'could not launch real-grant lock-order producer';
  end if;
  perform pg_sleep(0.20);
  select dblink_is_busy('p07_producer') into v_busy;
  if v_busy <> 1 then
    raise exception 'producer did not wait on the grant-held users row';
  end if;

  -- This is the real capability/user/vertical RPC. It must acquire the
  -- exclusive vertical lock and finish while the producer is waiting on the FK.
  perform dblink_exec(
    'p07_transition',
    $remote$
      do $grant$
      begin
        perform public.grant_vertical_private_access(
          'grocery',
          '00000000-0000-4000-8000-000000000721',
          'p07-concurrency',
          'real RPC lock-order regression',
          now() + interval '1 hour'
        );
      end;
      $grant$;
    $remote$
  );
  perform dblink_exec('p07_transition', 'commit');
  select result
    into v_result
    from dblink_get_result('p07_producer') as completed(result integer);
  perform dblink_disconnect('p07_producer');

  if v_result <> 0 then
    raise exception 'real-grant lock-order producer reported % sends', v_result;
  end if;
  select count(*)
    into v_count
    from public.lifecycle_sends
   where user_id = '00000000-0000-4000-8000-000000000721'
     and lifecycle_event = 'abandoned_cart'
     and suppression_reason = 'vertical_not_visible'
     and not would_send;
  if v_count <> 1 then
    raise exception 'real-grant lock-order proof recorded % suppression rows', v_count;
  end if;

  perform dblink_disconnect('p07_transition');
  raise notice 'Package 07 two-session concurrency assertions PASSED (both producers + real access RPC order)';
exception when others then
  begin
    perform dblink_exec('p07_transition', 'rollback');
  exception when others then
    null;
  end;
  begin
    perform dblink_disconnect('p07_producer');
  exception when others then
    null;
  end;
  begin
    perform dblink_disconnect('p07_transition');
  exception when others then
    null;
  end;
  raise;
end;
$concurrency$;
