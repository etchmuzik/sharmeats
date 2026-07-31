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
    v_fail := v_fail || 'postgis extension absent -- geography tables cannot have restored; install postgis and re-run the drill'::text;
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
  -- Every name here was checked against production on 2026-07-27. The first
  -- drill failed on 'customer_credits', which has NEVER existed -- the customer
  -- wallet is credit_ledger (+ the customer_credit_balance view). A guessed
  -- name in a verifier is worse than no check: it fails every drill forever and
  -- teaches the operator to distrust good backups.
  foreach v_txt in array array[
    'orders','order_items','order_financials','order_status_events',
    'users','merchant_staff','menu_items','menu_sections',
    'restaurant_settlements','driver_earnings','driver_cash_ledger',
    'credit_ledger','kyc_documents','platform_settings'
  ] loop
    if to_regclass('public.' || v_txt) is null then
      v_fail := v_fail || ('missing core table: public.' || v_txt);
    end if;
  end loop;

  -- ---------------------------------------------------------------------
  -- 5. RLS. The schema is deny-by-default; a restore that dropped RLS would
  --    produce a database that reads fine and leaks everything.
  --
  --    THE THRESHOLD WAS WRONG UNTIL 2026-07-27. It expected ~71, derived by
  --    counting `ENABLE ROW LEVEL SECURITY` lines in the dump (72). But
  --    pg_dump emits that statement for relkinds this query does not count,
  --    so a dump-statement count was being compared against a live catalog
  --    count of base tables only -- guaranteed to look like catastrophic data
  --    loss on a perfect restore. The first drill duly "failed" at 48.
  --
  --    Measured against production the same day: 50 base tables, 48 with RLS.
  --    So 48 was the CORRECT answer. The floor is now 45 -- low enough to
  --    absorb normal growth, high enough that a restore which genuinely
  --    dropped RLS still trips it.
  -- ---------------------------------------------------------------------
  select count(*) into v_n
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity;
  if v_n < 45 then
    v_fail := v_fail || ('only ' || v_n || ' public tables have RLS enabled (expected >=45; prod had 48 on 2026-07-27) -- RLS did not restore');
  end if;

  -- Named tables where RLS is non-negotiable.
  --
  -- to_regclass INSIDE the subquery, not a ::regclass cast. SQL does not
  -- short-circuit AND, so `to_regclass(x) is not null and not (select ... where
  -- oid = x::regclass)` still evaluates the cast when the table is absent, and
  -- the cast RAISES. The verifier therefore died with "relation does not exist"
  -- on exactly the restore it was meant to describe. to_regclass returns NULL
  -- instead of raising; coalesce turns the resulting NULL row into a definite
  -- "no RLS".
  foreach v_txt in array array['orders','order_financials','kyc_documents','users'] loop
    if to_regclass('public.' || v_txt) is not null
       and not coalesce(
             (select relrowsecurity from pg_class where oid = to_regclass('public.' || v_txt)),
             false) then
      v_fail := v_fail || ('RLS NOT enabled on public.' || v_txt);
    end if;
  end loop;

  -- ---------------------------------------------------------------------
  -- 5b. GRANTS. The single largest hole this verifier used to have.
  --
  --     RLS is only half the authorization model here; the other half is the
  --     grant set, and RLS cannot restrict columns at all. Migration 037 exists
  --     precisely because `authenticated` held UPDATE on every column of
  --     public.orders (payment_status, status, total_egp, assigned_driver_id)
  --     through the Supabase default table grant, and RLS could not stop it.
  --     The fix was a REVOKE plus a three-column GRANT — a privilege, not a
  --     policy.
  --
  --     backup-prod.sh dumped with --no-privileges until 2026-08-01, so a
  --     restore reconstructed every table, policy and function and NONE of the
  --     grants. That database reads fine and enforces nothing, and the old
  --     verifier passed it. These checks make that impossible.
  -- ---------------------------------------------------------------------
  -- The roles must exist before any grant could have applied. If they are
  -- missing, roles.sql was not loaded (or was the "not captured" note) and every
  -- GRANT in schema.sql failed — say that plainly rather than reporting a dozen
  -- downstream symptoms.
  foreach v_txt in array array['anon','authenticated','service_role'] loop
    if not exists (select 1 from pg_roles where rolname = v_txt) then
      v_fail := v_fail || ('role ' || v_txt || ' does not exist -- roles.sql was not loaded, so NO grant in schema.sql could apply');
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    -- Positive: the client roles actually hold privileges on the public tables.
    -- Prod had 50 public tables on 2026-07-27 and the app roles are granted on
    -- most of them; 25 is a floor low enough to absorb growth either way and
    -- high enough that a privilege-free restore cannot pass.
    select count(distinct c.oid) into v_n
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(c.relacl) a
      join pg_roles r on r.oid = a.grantee
     where n.nspname = 'public'
       and c.relkind = 'r'
       and r.rolname in ('anon','authenticated','service_role');
    if v_n < 25 then
      v_fail := v_fail || ('only ' || v_n || ' public tables carry a grant to anon/authenticated/service_role (expected >=25) -- the dump was taken without privileges, or roles.sql was not loaded first');
    end if;

    -- Positive: SECURITY DEFINER functions carry an explicit ACL. House rule 3
    -- is `revoke all ... from public, anon` followed by targeted grants; a
    -- function whose proacl is NULL still has the default EXECUTE TO PUBLIC,
    -- which on a SECURITY DEFINER RPC means anon can call it.
    select count(*) into v_n
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proacl is not null;
    if v_n < 20 then
      v_fail := v_fail || ('only ' || v_n || ' public functions have an explicit ACL (expected >=20) -- function grants did not restore, so PUBLIC/anon can execute the SECURITY DEFINER RPCs');
    end if;

    -- Negative, and specific: migration 037's column lockdown. Restoring
    -- without privileges reinstates the default GRANT ALL and hands every
    -- customer the ability to mark their own COD order paid.
    if to_regclass('public.orders') is not null then
      foreach v_txt in array array['status','payment_status','total_egp','assigned_driver_id'] loop
        if exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'orders' and column_name = v_txt)
           and has_column_privilege('authenticated', 'public.orders', v_txt, 'UPDATE') then
          v_fail := v_fail || ('authenticated has UPDATE on public.orders.' || v_txt || ' -- migration 037''s column lockdown is NOT present in this restore');
        end if;
      end loop;
      -- ...and the grant that SHOULD be there. Its absence means the restore
      -- over-revoked rather than under-revoked: ratings would fail in the app.
      if exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'orders' and column_name = 'rating_food')
         and not has_column_privilege('authenticated', 'public.orders', 'rating_food', 'UPDATE') then
        v_fail := v_fail || 'authenticated CANNOT update public.orders.rating_food -- migration 037''s rating grant did not restore'::text;
      end if;
      if has_table_privilege('anon', 'public.orders', 'UPDATE') then
        v_fail := v_fail || 'anon holds UPDATE on public.orders -- the default table grant is back; this is the mig-037 hole reopened'::text;
      end if;
    end if;
  end if;

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

  -- Orders must point at a real restaurant and a real customer. BOTH tables are
  -- guarded: the query names restaurants too, so guarding only on orders made
  -- this raise "relation public.restaurants does not exist" and abort the whole
  -- verifier — hiding every check below it on precisely the broken restore it
  -- exists to describe.
  if to_regclass('public.orders') is not null and to_regclass('public.restaurants') is not null then
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
      v_fail := v_fail || 'platform_settings is EMPTY -- dispatch/fees/alerting would be unconfigured'::text;
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
-- spatial_ref_sys is excluded on BOTH sides: PostGIS creates it as part of the
-- extension, so it is never a `CREATE TABLE public.` line in the dump but is
-- always present after the restore. Counting it here made a perfect restore
-- report one extra table forever.
select
  case
    when :'manifest_tables' = 'skip' then 'table-count check skipped'
    when count(*)::text = :'manifest_tables'
      then 'table count matches dump: ' || count(*)
    else
      -- Not fatal on its own: a dump taken before a migration legitimately has
      -- fewer tables. Reported loudly so the operator decides.
      'WARNING: ' || count(*) || ' tables restored, dump defines ' || :'manifest_tables'
  end as table_count_check
from information_schema.tables
where table_schema = 'public'
  and table_type = 'BASE TABLE'
  and table_name <> 'spatial_ref_sys';

-- Row counts for the tables an operator will actually want to eyeball.
select 'orders' as t, count(*) from public.orders
union all select 'users', count(*) from public.users
union all select 'restaurants', count(*) from public.restaurants
union all select 'menu_items', count(*) from public.menu_items
union all select 'order_financials', count(*) from public.order_financials
order by 1;

\echo ''
\echo 'RESTORE VERIFICATION PASSED'
