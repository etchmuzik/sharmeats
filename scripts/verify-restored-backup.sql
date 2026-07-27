-- verify-restored-backup.sql
--
-- Post-restore verification for a Sharm Eats logical backup (package 01 §1).
-- Run against the SCRATCH database after restore-backup.sh has loaded
-- roles/schema/data. Read-only: it inspects catalogs and counts rows, and
-- never writes.
--
-- WHY THIS EXISTS
-- "The restore command exited 0" is not proof of a restore. pg_dump/psql will
-- happily report success having skipped objects whose dependencies failed
-- earlier in the file -- which is exactly what a missing PostGIS produces: five
-- CREATE TABLEs fail, ~180 downstream statements cascade, and the tail of the
-- run still looks normal. This file turns "it loaded" into "these specific
-- things are present and consistent", so a bad restore fails loudly here rather
-- than silently on the day it is needed.
--
-- USAGE
--   psql -d <scratch> -v ON_ERROR_STOP=1 \
--        -v manifest_tables=79 \
--        -f scripts/verify-restored-backup.sql
--
-- `manifest_tables` is optional; pass the table count recorded in the drill so
-- a restore that silently lost tables is caught. Omit it to skip that one check.
--
-- EXIT BEHAVIOUR
-- Raises on the first failure with a message naming the check. A clean run ends
-- with "RESTORE VERIFICATION PASSED".

\set ON_ERROR_STOP on

do $$
declare
  v_fail text[] := '{}';
  v_n    bigint;
  v_txt  text;
begin
  -- ---------------------------------------------------------------------
  -- 1. Required schemas. The dump carries public + auth + storage; a restore
  --    missing auth means users/orders FKs are dangling and the copy is
  --    useless for anything but reading.
  -- ---------------------------------------------------------------------
  foreach v_txt in array array['public','auth','storage'] loop
    if not exists (select 1 from information_schema.schemata where schema_name = v_txt) then
      v_fail := v_fail || ('missing schema: ' || v_txt);
    end if;
  end loop;

  -- ---------------------------------------------------------------------
  -- 2. PostGIS. Checked EXPLICITLY and FIRST among extensions, because its
  --    absence is the single failure mode most likely to be misread as a
  --    corrupt backup: addresses/drivers/hotels/kitchens/restaurants all have
  --    geography columns (23 references in the 2026-07-27 dump).
  -- ---------------------------------------------------------------------
  if not exists (select 1 from pg_extension where extname = 'postgis') then
    v_fail := v_fail || 'postgis extension absent -- geography tables cannot have restored; install postgis and re-run the drill';
  end if;

  -- ---------------------------------------------------------------------
  -- 3. The five geography-bearing tables, named individually. If PostGIS was
  --    missing during the load these are exactly what went missing, and this
  --    check reports that in business terms rather than as a type error.
  -- ---------------------------------------------------------------------
  foreach v_txt in array array['addresses','drivers','hotels','kitchens','restaurants'] loop
    if to_regclass('public.' || v_txt) is null then
      v_fail := v_fail || ('missing geography-bearing table: public.' || v_txt);
    end if;
  end loop;

  -- ---------------------------------------------------------------------
  -- 4. Core money/lifecycle tables. Losing any of these silently would be the
  --    worst possible restore outcome: the copy looks usable and is not.
  -- ---------------------------------------------------------------------
  foreach v_txt in array array[
    'orders','order_items','order_financials','order_status_events',
    'users','merchant_staff','menu_items','menu_sections',
    'restaurant_settlements','driver_earnings','driver_cash_ledger',
    'customer_credits','kyc_documents','platform_settings'
  ] loop
    if to_regclass('public.' || v_txt) is null then
      v_fail := v_fail || ('missing core table: public.' || v_txt);
    end if;
  end loop;

  -- ---------------------------------------------------------------------
  -- 5. RLS. The schema is deny-by-default; a restore that dropped RLS would
  --    produce a database that reads fine and leaks everything. Threshold
  --    rather than exact count so adding a table does not fail the drill --
  --    the 2026-07-27 dump had 71 RLS-enabled tables.
  -- ---------------------------------------------------------------------
  select count(*) into v_n
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity;
  if v_n < 60 then
    v_fail := v_fail || ('only ' || v_n || ' public tables have RLS enabled (expected ~71) -- policies did not restore');
  end if;

  -- Named tables where RLS is non-negotiable.
  foreach v_txt in array array['orders','order_financials','kyc_documents','users'] loop
    if to_regclass('public.' || v_txt) is not null
       and not (select relrowsecurity from pg_class where oid = ('public.' || v_txt)::regclass) then
      v_fail := v_fail || ('RLS NOT enabled on public.' || v_txt);
    end if;
  end loop;

  -- ---------------------------------------------------------------------
  -- 6. Authority functions must exist AND have exactly one overload each.
  --    Two overloads is not a restore artefact to shrug at: PostgREST answers
  --    PGRST202 on every call, which is house rule 1 and has already caused a
  --    production outage in this project.
  -- ---------------------------------------------------------------------
  foreach v_txt in array array[
    'place_order','advance_order_status','snapshot_order_financials',
    'is_merchant_staff','is_merchant_manager','auth_role'
  ] loop
    select count(*) into v_n
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_txt;
    if v_n = 0 then
      v_fail := v_fail || ('missing function: public.' || v_txt);
    elsif v_n > 1 then
      v_fail := v_fail || ('public.' || v_txt || ' has ' || v_n || ' overloads (expected 1) -- PGRST202 risk');
    end if;
  end loop;

  -- ---------------------------------------------------------------------
  -- 7. Triggers that enforce authority (migration 136). Present in prod as of
  --    2026-07-27; a restore that lost them silently reopens the staff-tier
  --    price/payout hole.
  -- ---------------------------------------------------------------------
  foreach v_txt in array array[
    'trg_menu_items_privileged_columns','trg_restaurants_privileged_columns'
  ] loop
    if not exists (select 1 from pg_trigger where tgname = v_txt and not tgisinternal) then
      v_fail := v_fail || ('missing authority trigger: ' || v_txt);
    end if;
  end loop;

  -- ---------------------------------------------------------------------
  -- 8. Referential integrity across the auth boundary. public.users is 1:1
  --    with auth.users; an orphan means the two schemas restored out of step,
  --    which breaks every RLS policy that resolves auth.uid().
  -- ---------------------------------------------------------------------
  if to_regclass('public.users') is not null and to_regclass('auth.users') is not null then
    execute 'select count(*) from public.users u where not exists
               (select 1 from auth.users a where a.id = u.id)' into v_n;
    if v_n > 0 then
      v_fail := v_fail || (v_n || ' public.users rows have no matching auth.users row');
    end if;
  end if;

  -- Orders must point at a real restaurant and a real customer.
  if to_regclass('public.orders') is not null then
    execute 'select count(*) from public.orders o where not exists
               (select 1 from public.restaurants r where r.id = o.restaurant_id)' into v_n;
    if v_n > 0 then
      v_fail := v_fail || (v_n || ' orders reference a missing restaurant');
    end if;
  end if;

  -- ---------------------------------------------------------------------
  -- 9. Operational config actually carries VALUES, not just the empty table.
  --    platform_settings drives dispatch mode, fees and the ops alert webhook;
  --    restoring the table shape without its rows produces a database that
  --    starts and then quietly stops dispatching.
  -- ---------------------------------------------------------------------
  if to_regclass('public.platform_settings') is not null then
    execute 'select count(*) from public.platform_settings' into v_n;
    if v_n = 0 then
      v_fail := v_fail || 'platform_settings is EMPTY -- dispatch/fees/alerting would be unconfigured';
    end if;
  end if;

  -- ---------------------------------------------------------------------
  -- Report
  -- ---------------------------------------------------------------------
  if array_length(v_fail, 1) is not null then
    raise exception E'RESTORE VERIFICATION FAILED (% problem(s)):\n  - %',
      array_length(v_fail, 1), array_to_string(v_fail, E'\n  - ');
  end if;
end $$;

-- Table count against the drill's expectation, when supplied. Separate from the
-- block above so psql substitutes the variable rather than plpgsql.
select
  case
    when :'manifest_tables' = 'skip' then 'table-count check skipped'
    when count(*)::text = :'manifest_tables'
      then 'table count matches manifest: ' || count(*)
    else
      -- Not fatal on its own: a dump taken before a migration legitimately has
      -- fewer tables. Reported loudly so the operator decides.
      'WARNING: ' || count(*) || ' tables restored, drill expected ' || :'manifest_tables'
  end as table_count_check
from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE';

-- Row counts for the tables an operator will actually want to eyeball.
select 'orders' as t, count(*) from public.orders
union all select 'users', count(*) from public.users
union all select 'restaurants', count(*) from public.restaurants
union all select 'menu_items', count(*) from public.menu_items
union all select 'order_financials', count(*) from public.order_financials
order by 1;

\echo ''
\echo 'RESTORE VERIFICATION PASSED'
