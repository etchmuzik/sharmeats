-- Privilege matrix for migration 136. NEGATIVE (staff rejected) + POSITIVE
-- (owner succeeds; staff keeps line-cook actions).
--
-- USAGE (from an empty database; PostgreSQL 18.x):
--   createdb v136
--   psql -d v136 -v ON_ERROR_STOP=1 -f supabase/tests/136_staff_role_fixture.sql
--   psql -d v136 -v ON_ERROR_STOP=1 -f supabase/migrations/136_merchant_staff_role_enforcement.sql
--   -- the drift case below needs a column the guard has never heard of; add it
--   -- as the table owner, since `authenticated` has no DDL rights:
--   psql -d v136 -c "alter table public.menu_items add column if not exists promo_price_egp int;"
--   psql -d v136 -f supabase/tests/136_staff_role_assertions.sql
--
-- Expect 40 PASS and zero FAIL. Every line prints its expectation and what it
-- actually got, so a failure names the case.
--
-- RUN THIS ON A FRESH DATABASE EVERY TIME. The matrix mutates rows as it goes
-- (an owner sets requires_prescription, changes the price), so a second run
-- against the same database reports false failures on the cases whose
-- precondition the first run consumed. That is a property of the harness, not
-- of the migration -- but it has already fooled one reviewer, so: fresh db.
--
-- NOTE ON 'SILENT-DENY': that is the EXPECTED result for a policy-only refusal
-- on UPDATE/DELETE, not a defect. An RLS USING qual is a row filter, so the
-- statement matches zero rows and raises nothing. See the HOW A REFUSAL
-- SURFACES section of the migration header -- it is the reason restaurants
-- gets a trigger and the reason the clients check row counts.
\set QUIET on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.exec(p_sql text) returns text
language plpgsql as $$
declare n int;
begin
  execute p_sql; get diagnostics n = row_count;
  if n = 0 then return 'SILENT-DENY(0 rows)'; end if;
  return 'OK(' || n || ')';
exception when others then
  return 'RAISE ' || sqlstate ||
    case when position('MANAGER_REQUIRED' in sqlerrm) > 0 then ' MANAGER_REQUIRED' else '' end;
end $$;

create or replace function pg_temp.chk(p_label text, p_expect text, p_sql text) returns text
language plpgsql as $$
declare got text;
begin
  got := pg_temp.exec(p_sql);
  return case when got like p_expect || '%' then 'PASS ' else '*** FAIL *** ' end
         || rpad(p_label, 46) || ' expect=' || rpad(p_expect,14) || ' got=' || got;
end $$;

create or replace function pg_temp.as_user(p_uid text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid, false);
end $$;

\echo '================ NEGATIVE: staff tier must be REJECTED ================'
set role authenticated;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000002');

select pg_temp.chk('staff: price_egp',            'RAISE 23514', $$update public.menu_items set price_egp=200 where id='dddddddd-0000-0000-0000-000000000001'$$);
select pg_temp.chk('staff: name',                 'RAISE 23514', $$update public.menu_items set name='X' where id='dddddddd-0000-0000-0000-000000000001'$$);
select pg_temp.chk('staff: description',          'RAISE 23514', $$update public.menu_items set description='X' where id='dddddddd-0000-0000-0000-000000000001'$$);
select pg_temp.chk('staff: image',                'RAISE 23514', $$update public.menu_items set image='x.png' where id='dddddddd-0000-0000-0000-000000000001'$$);
select pg_temp.chk('staff: flags',                'RAISE 23514', $$update public.menu_items set flags='{vegan}' where id='dddddddd-0000-0000-0000-000000000001'$$);
select pg_temp.chk('staff: section_id',           'RAISE 23514', $$update public.menu_items set section_id='cccccccc-0000-0000-0000-000000000002' where id='dddddddd-0000-0000-0000-000000000001'$$);
select pg_temp.chk('staff: restaurant_id (tenancy)','RAISE 23514',$$update public.menu_items set restaurant_id='bbbbbbbb-0000-0000-0000-000000000002' where id='dddddddd-0000-0000-0000-000000000001'$$);
-- the mig-006 columns the deny-list draft left writable:
select pg_temp.chk('staff: sku (006)',            'RAISE 23514', $$update public.menu_items set sku='PWNED' where id='dddddddd-0000-0000-0000-000000000001'$$);
select pg_temp.chk('staff: barcode (006)',        'RAISE 23514', $$update public.menu_items set barcode='PWNED' where id='dddddddd-0000-0000-0000-000000000001'$$);
select pg_temp.chk('staff: unit (006)',           'RAISE 23514', $$update public.menu_items set unit='kg' where id='dddddddd-0000-0000-0000-000000000001'$$);
select pg_temp.chk('staff: requires_prescription','RAISE 23514', $$update public.menu_items set requires_prescription=true where id='dddddddd-0000-0000-0000-000000000001'$$);
select pg_temp.chk('staff: created_at',           'RAISE 23514', $$update public.menu_items set created_at='2000-01-01' where id='dddddddd-0000-0000-0000-000000000001'$$);
-- future-column drift: a column nobody has taught the guard about

select pg_temp.chk('staff: FUTURE column (drift)','RAISE 23514', $$update public.menu_items set promo_price_egp=1 where id='dddddddd-0000-0000-0000-000000000001'$$);

select pg_temp.chk('staff: menu_items INSERT',    'RAISE 42501', $$insert into public.menu_items (restaurant_id,section_id,name,price_egp) values ('bbbbbbbb-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','New',50)$$);
select pg_temp.chk('staff: menu_items DELETE',    'SILENT-DENY', $$delete from public.menu_items where id='dddddddd-0000-0000-0000-000000000001'$$);
select pg_temp.chk('staff: section INSERT',       'RAISE 42501', $$insert into public.menu_sections (restaurant_id,name) values ('bbbbbbbb-0000-0000-0000-000000000001','New')$$);
select pg_temp.chk('staff: section UPDATE',       'SILENT-DENY', $$update public.menu_sections set name='X' where id='cccccccc-0000-0000-0000-000000000001'$$);
select pg_temp.chk('staff: section DELETE',       'SILENT-DENY', $$delete from public.menu_sections where id='cccccccc-0000-0000-0000-000000000002'$$);
select pg_temp.chk('staff: modifier INSERT',      'RAISE 42501', $$insert into public.modifiers (item_id,name) values ('dddddddd-0000-0000-0000-000000000001','Extra')$$);
select pg_temp.chk('staff: modifier_option UPDATE','SILENT-DENY',$$update public.modifier_options set price_delta_egp=-2000 where id='ffffffff-0000-0000-0000-000000000001'$$);
select pg_temp.chk('staff: is_open (LOUD now)',   'RAISE 23514', $$update public.restaurants set is_open=false where id='bbbbbbbb-0000-0000-0000-000000000001'$$);
select pg_temp.chk('staff: payout_iban',          'RAISE 23514', $$update public.restaurants set payout_iban='EG00' where id='bbbbbbbb-0000-0000-0000-000000000001'$$);
select pg_temp.chk('staff: self-escalate role',   'SILENT-DENY', $$update public.merchant_staff set staff_role='owner' where profile_id='aaaaaaaa-0000-0000-0000-000000000002'$$);
select pg_temp.chk('staff: cross-tenant price',   'SILENT-DENY', $$update public.menu_items set price_egp=1 where id='dddddddd-0000-0000-0000-000000000002'$$);
select pg_temp.chk('staff: UPSERT around trigger','RAISE 42501', $$insert into public.menu_items (id,restaurant_id,section_id,name,price_egp) values ('dddddddd-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','Hacked',9999) on conflict (id) do update set price_egp=9999$$);

\echo ''
\echo '================ POSITIVE: staff keeps line-cook actions ================'
select pg_temp.chk('staff: is_available (86 a dish)','OK',       $$update public.menu_items set is_available=false where id='dddddddd-0000-0000-0000-000000000001'$$);
select pg_temp.chk('staff: sort_order',             'OK',        $$update public.menu_items set sort_order=3 where id='dddddddd-0000-0000-0000-000000000001'$$);
-- The MenuManager.tsx:262-274 shape: full payload, price UNCHANGED. Must pass.
select pg_temp.chk('staff: full payload, price SAME','OK',       $$update public.menu_items set restaurant_id='bbbbbbbb-0000-0000-0000-000000000001', section_id='cccccccc-0000-0000-0000-000000000001', name='Koshari', description='', price_egp=120, image='', flags='{}', is_available=true where id='dddddddd-0000-0000-0000-000000000001'$$);
select pg_temp.chk('staff: reads own hidden item',  'OK',        $$select 1 from public.menu_items where id='dddddddd-0000-0000-0000-000000000001'$$);

\echo ''
\echo '================ POSITIVE: owner / manager succeed ================'
reset role;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
select pg_temp.chk('owner: price_egp',        'OK', $$update public.menu_items set price_egp=150 where id='dddddddd-0000-0000-0000-000000000001'$$);
select pg_temp.chk('owner: requires_prescr.', 'OK', $$update public.menu_items set requires_prescription=true where id='dddddddd-0000-0000-0000-000000000001'$$);
select pg_temp.chk('owner: item INSERT',      'OK', $$insert into public.menu_items (restaurant_id,section_id,name,price_egp) values ('bbbbbbbb-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','New',50)$$);
select pg_temp.chk('owner: section rename',   'OK', $$update public.menu_sections set name='Mains2' where id='cccccccc-0000-0000-0000-000000000001'$$);
select pg_temp.chk('owner: is_open',          'OK', $$update public.restaurants set is_open=false where id='bbbbbbbb-0000-0000-0000-000000000001'$$);
select pg_temp.chk('owner: modifier_option',  'OK', $$update public.modifier_options set price_delta_egp=25 where id='ffffffff-0000-0000-0000-000000000001'$$);

reset role;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000003');
set role authenticated;
select pg_temp.chk('manager: price_egp',      'OK', $$update public.menu_items set price_egp=160 where id='dddddddd-0000-0000-0000-000000000001'$$);
select pg_temp.chk('manager: is_open',        'OK', $$update public.restaurants set is_open=true where id='bbbbbbbb-0000-0000-0000-000000000001'$$);

\echo ''
\echo '================ admin exempt + CHECK constraint ================'
reset role;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000009');
set role authenticated;
select pg_temp.chk('admin: price_egp',        'OK', $$update public.menu_items set price_egp=170 where id='dddddddd-0000-0000-0000-000000000001'$$);
reset role;
select pg_temp.chk('CHECK rejects ''cook''',  'RAISE 23514', $$update public.merchant_staff set staff_role='cook' where profile_id='aaaaaaaa-0000-0000-0000-000000000001'$$);

\echo ''
\echo '================ price bounds (132) still distinguishable ================'
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
select pg_temp.chk('owner: price 99999 -> bounds', 'RAISE 23514', $$update public.menu_items set price_egp=99999 where id='dddddddd-0000-0000-0000-000000000001'$$);
reset role;
