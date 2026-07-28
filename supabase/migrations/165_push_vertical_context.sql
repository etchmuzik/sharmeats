-- 165_push_vertical_context.sql
--
-- Tell the push sender WHICH VERTICAL each order push is about.
--
-- WHY. Server-side push copy is food copy: "sent to the kitchen", "the
-- restaurant is preparing your order", "Enjoy your meal!". Correct for a
-- restaurant order; wrong for a grocery basket, and for a pharmacy order it is
-- worse than wrong -- "Enjoy your meal!" about a prescription reads as a system
-- that does not know what it just delivered.
--
-- The edge function (expo-push) now takes an optional `vertical` and picks copy
-- accordingly, falling back to GENERIC wording -- never food wording -- for a
-- vertical it has no copy for. This migration supplies that value from the
-- place that already knows it.
--
-- NO EXTRA LOOKUPS. Both senders below are triggers on public.orders (verified:
-- notify_order_transition and notify_order_status_event fire on orders and
-- order_status_events respectively), and orders.vertical_id has existed since
-- mig 157 and been NOT NULL since mig 161. The value is already in hand.
--
-- WHY THE SNAPSHOT, NOT A JOIN. orders.vertical_id is immutable (mig 157) --
-- reassigning a merchant later never rewrites an order's history. Joining
-- restaurants would describe the order using the merchant's CURRENT vertical,
-- so a push about an old food order could arrive in pharmacy language after the
-- merchant moved. The snapshot is the only correct source.
--
-- BACKWARD COMPATIBLE BOTH WAYS. `vertical` is additive: the deployed edge
-- function ignores unknown body keys, so this migration is safe to apply before
-- the function ships. And the function resolves the order's vertical itself
-- when a sender omits it, so an un-migrated sender keeps working after the
-- function ships. Neither half is a release-order trap.

do $mig165$
declare
  v_src text;
  v_new text;
  v_fn  text;
  v_n   int;
  v_hits int;
begin
  foreach v_fn in array array['notify_order_transition', 'notify_order_status_event'] loop
    select count(*) into v_n
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    if v_n <> 1 then
      raise exception 'mig165: expected exactly 1 %() overload, found %', v_fn, v_n;
    end if;

    select pg_get_functiondef(p.oid) into v_src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;

    -- Both senders build their payload as
    --     jsonb_build_object('event', '<name>', 'orderId', new.id::text, ...)
    -- so appending the vertical right after orderId covers every event in the
    -- function, including ones added later that copy the idiom.
    --
    -- notify_order_status_event fires on order_status_events, whose NEW row has
    -- order_id (not id) -- handled by the second pattern below. Exactly one of
    -- the two must match per function; a body that matches neither has drifted
    -- and this raises rather than silently shipping a partial change.
    v_new := replace(v_src,
      '''orderId'', new.id::text',
      '''orderId'', new.id::text, ''vertical'', new.vertical_id');
    v_hits := case when v_new = v_src then 0 else 1 end;

    if v_hits = 0 then
      -- order_status_events carries order_id and no vertical of its own, so the
      -- snapshot is read from the parent order. One extra lookup per push here
      -- is acceptable: this trigger already reads the order for recipients.
      v_new := replace(v_src,
        '''orderId'', new.order_id::text',
        '''orderId'', new.order_id::text, ''vertical'',
           (select o.vertical_id from public.orders o where o.id = new.order_id)');
      v_hits := case when v_new = v_src then 0 else 1 end;
    end if;

    if v_hits = 0 then
      raise exception
        'mig165: no orderId payload key found in %() -- its body differs from expectation', v_fn;
    end if;

    execute v_new;
  end loop;
end;
$mig165$;

-- These are trigger functions (no client grants to re-assert), but verify the
-- triggers still point at them and that exactly one overload of each survives.
do $mig165_verify$
declare v_n int; v_fn text;
begin
  foreach v_fn in array array['notify_order_transition', 'notify_order_status_event'] loop
    select count(*) into v_n
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    if v_n <> 1 then
      raise exception 'mig165: %() ended with % overloads', v_fn, v_n;
    end if;

    select count(*) into v_n
      from pg_trigger t join pg_proc p on p.oid = t.tgfoid
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn and not t.tgisinternal;
    if v_n = 0 then
      raise exception 'mig165: %() is no longer attached to any trigger', v_fn;
    end if;

    -- The whole point of the migration: the payload must now carry it.
    select count(*) into v_n
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn
       and p.prosrc like '%''vertical''%';
    if v_n <> 1 then
      raise exception 'mig165: %() payload does not carry the vertical', v_fn;
    end if;
  end loop;
  raise notice 'mig165: both order push senders now carry the order''s snapshotted vertical';
end;
$mig165_verify$;
