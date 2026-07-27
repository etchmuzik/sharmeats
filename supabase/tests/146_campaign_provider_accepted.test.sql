-- Assertions for migration 146 (delivered -> provider_accepted).
--
-- Run inside a rolled-back transaction:
--   BEGIN; \i supabase/migrations/146_campaign_provider_accepted.sql
--          \i supabase/tests/146_campaign_provider_accepted.test.sql
--   ROLLBACK;

\set ON_ERROR_STOP on

do $$
declare
  v_fail text[] := '{}';
  v_n    int;
  v_def  text;
  v_id   uuid;
  v_status text;
begin
  -- 1. The writer must no longer produce the misleading literal.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'reconcile_push_campaigns';

  if v_def is null then
    v_fail := v_fail || 'reconcile_push_campaigns is missing'::text;
  else
    if position('''provider_accepted''' in v_def) = 0 then
      v_fail := v_fail || 'reconcile_push_campaigns does not write provider_accepted'::text;
    end if;
    -- The word may still appear in comments; what must be gone is the
    -- ASSIGNMENT of the literal on the 2xx branch.
    if position('then ''delivered''' in v_def) > 0 then
      v_fail := v_fail || 'reconcile_push_campaigns still ASSIGNS ''delivered'''::text;
    end if;
  end if;

  -- 2. Exactly one overload (house rule 1).
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'reconcile_push_campaigns';
  if v_n <> 1 then
    v_fail := v_fail || ('expected 1 reconcile_push_campaigns overload, found ' || v_n)::text;
  end if;

  -- 3. The new value must be accepted by the constraint.
  begin
    insert into public.push_campaigns (title, body, segment, recipients, delivery_status)
    values ('_t146', '_t146', 'all', 0, 'provider_accepted') returning id into v_id;
    delete from public.push_campaigns where id = v_id;
  exception when others then
    v_fail := v_fail || ('provider_accepted rejected by the constraint: ' || sqlerrm)::text;
  end;

  -- 4. The OLD value must still be accepted, or an admin-web build that
  --    predates this migration breaks the moment it writes one.
  begin
    insert into public.push_campaigns (title, body, segment, recipients, delivery_status)
    values ('_t146b', '_t146b', 'all', 0, 'delivered') returning id into v_id;
    delete from public.push_campaigns where id = v_id;
  exception when others then
    v_fail := v_fail || ('back-compat broken: ''delivered'' rejected: ' || sqlerrm)::text;
  end;

  -- 5. Garbage must still be refused -- the constraint must not have been
  --    loosened into uselessness.
  begin
    insert into public.push_campaigns (title, body, segment, recipients, delivery_status)
    values ('_t146c', '_t146c', 'all', 0, 'totally_made_up') returning id into v_id;
    delete from public.push_campaigns where id = v_id;
    v_fail := v_fail || 'the constraint accepted an invalid delivery_status'::text;
  exception when others then null;  -- correct
  end;

  -- 6. No row may be left on the deprecated value after the backfill.
  select count(*) into v_n from public.push_campaigns where delivery_status = 'delivered';
  if v_n > 0 then
    v_fail := v_fail || (v_n || ' campaign row(s) still on the deprecated ''delivered''')::text;
  end if;

  -- 7. The column comment must state plainly that this is NOT device delivery,
  --    because the comment is what the next reader trusts.
  select col_description('public.push_campaigns'::regclass,
           (select attnum from pg_attribute
             where attrelid = 'public.push_campaigns'::regclass
               and attname = 'delivery_status'))
    into v_def;
  if v_def is null or position('NOT device delivery' in v_def) = 0 then
    v_fail := v_fail || 'delivery_status comment does not disclaim device delivery'::text;
  end if;

  if array_length(v_fail, 1) > 0 then
    raise exception E'MIG 146 ASSERTIONS FAILED (%):\n  - %',
      array_length(v_fail, 1), array_to_string(v_fail, E'\n  - ');
  end if;
  raise notice 'MIG 146 ASSERTIONS PASSED';
end $$;
