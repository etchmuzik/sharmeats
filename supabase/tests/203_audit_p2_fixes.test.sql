\set ON_ERROR_STOP on

begin;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $roles$;

-- ============================================================================
-- Scaffolding for migration 203.
--
-- Unlike the 202 harness, this one is NOT just a parse check. Migration 203
-- patches EXISTING function bodies by text substitution, so the stubs below
-- reproduce the exact defective text that production carries — verified line by
-- line against prod via pg_proc.prosrc before this file was written. If a stub
-- drifts from prod, 203's own "refusing to patch blind" assertion fires here,
-- which is the point: the harness cannot silently pass against a body prod does
-- not have.
--
-- Column lists likewise mirror production (promo_redemptions.promo_id — NOT
-- promo_code_id, which an earlier draft of 203 assumed and which would have
-- failed at apply time).
-- ============================================================================

create schema if not exists auth;
create schema if not exists private;
create schema if not exists extensions;

create type app_role as enum ('customer','driver','merchant_staff','dispatcher','admin');
create type kyc_subject_type as enum ('driver','restaurant');

create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;

create table public.users (id uuid primary key, role app_role, locale text);
create table public.drivers (id uuid primary key, profile_id uuid);
create table public.restaurants (id uuid primary key);
create table public.merchant_staff (restaurant_id uuid, profile_id uuid);
create table public.platform_settings (key text primary key, value jsonb);

create table public.kyc_documents (
  id uuid primary key default gen_random_uuid(),
  subject_type kyc_subject_type, subject_id uuid, profile_id uuid,
  created_at timestamptz default now()
);
create table public.push_campaigns (
  id uuid primary key default gen_random_uuid(), created_at timestamptz default now()
);
create table public.restaurant_settlements (
  id uuid primary key default gen_random_uuid(), restaurant_id uuid,
  status text, period_start date
);
create table public.driver_settlements (
  id uuid primary key default gen_random_uuid(), driver_id uuid,
  period_start date, period_end date, status text not null default 'draft'
);
create table public.orders (
  id uuid primary key default gen_random_uuid(), tip_egp int, total_egp int,
  payment_method text, payment_status text, paymob_txn_id text
);
create table public.order_items (
  id uuid primary key default gen_random_uuid(), order_id uuid, quantity int
);
create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(), order_id uuid, status text,
  provider_txn_id text, last_error text, updated_at timestamptz
);
create table public.promo_codes (
  id uuid primary key default gen_random_uuid(), code text, max_uses int
);
-- Mirrors prod exactly: the FK column is `promo_id`.
create table public.promo_redemptions (
  id uuid primary key default gen_random_uuid(), promo_id uuid, user_id uuid,
  order_id uuid, code text, discount_egp int, created_at timestamptz default now()
);
create table public.menu_items (id uuid primary key, name text, is_available boolean);
create table public.delivery_service_configs (
  service_area_id uuid primary key, launch_stage text not null, intake_state text not null
);
create table public.delivery_jobs (id uuid primary key default gen_random_uuid(), ref text);
-- Reproduce prod's hazard before creating the private tables: this database has
-- ALTER DEFAULT PRIVILEGES granting arwdDxtm to anon/authenticated, so a new
-- table is client-reachable unless explicitly revoked (house rule 5b). Without
-- this the 203i assertion is VACUOUS — it passes whether or not the revoke
-- runs, because a bare Postgres grants nothing by default. Verified by a
-- per-section negative control: 203i was the one section whose removal the
-- suite failed to detect until this was added.
alter default privileges in schema private grant all on tables to anon, authenticated;

create table private.delivery_quotes (
  id uuid primary key default gen_random_uuid(), service_area_id uuid,
  consumed_at timestamptz, expires_at timestamptz
);
create table private.delivery_access_events (x int);

create function public.auth_role() returns app_role language sql stable as $$ select null::app_role $$;
create function public.is_merchant_staff(p_restaurant_id uuid) returns boolean language sql as $$ select false $$;
create function public.push_headers() returns jsonb language sql as $$ select '{}'::jsonb $$;
create function public.enqueue_push(
  p_event text, p_order_id uuid default null, p_recipient_user_ids uuid[] default null,
  p_idempotency_key text default null, p_route text default null, p_vertical text default null,
  p_category text default 'operational', p_custom_title text default null,
  p_custom_body text default null, p_campaign_id uuid default null,
  p_expires_in interval default null
) returns uuid language sql as $$ select gen_random_uuid() $$;

-- --- Pre-203 (defective) bodies, reproducing prod verbatim -----------------

create or replace function public.my_kyc_documents(p_subject_type kyc_subject_type, p_subject_id uuid)
returns setof public.kyc_documents language sql stable
security definer set search_path = public, pg_temp
as $$
  select k.* from public.kyc_documents k
   where k.subject_type = p_subject_type and k.subject_id = p_subject_id
     and (
       (p_subject_type = 'driver' and exists (select 1 from public.drivers d where d.id = p_subject_id and d.profile_id = auth.uid()))
       or (p_subject_type = 'restaurant' and public.is_merchant_staff(p_subject_id))
       or public.auth_role() = 'admin'
     )
   order by k.created_at desc;
$$;
grant execute on function public.my_kyc_documents(kyc_subject_type, uuid) to authenticated;

create or replace function public.recent_push_campaigns(p_limit int default 20)
returns setof public.push_campaigns language sql stable
security definer set search_path = public, pg_temp
as $$
  select * from public.push_campaigns
   where public.auth_role() = 'admin'
   order by created_at desc
   limit greatest(1, least(coalesce(p_limit,20), 100));
$$;
grant execute on function public.recent_push_campaigns(int) to authenticated;

create or replace function public.my_restaurant_settlements(p_limit int default 12)
returns setof public.restaurant_settlements language sql stable
security definer set search_path = public, pg_temp
as $$
  select s.* from public.restaurant_settlements s
   where public.is_merchant_staff(s.restaurant_id)
   order by s.period_start desc
   limit greatest(1, least(coalesce(p_limit,12), 100));
$$;
grant execute on function public.my_restaurant_settlements(int) to authenticated;

-- settle_paymob_payment: the LIVE (mig 121) shape, carrying the `<>` defect.
create or replace function public.settle_paymob_payment(
  p_order_id uuid, p_provider_order_id text, p_provider_txn_id text, p_amount_cents int
) returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_order        public.orders;
  v_attempt      public.payment_attempts;
  v_transitioned boolean := false;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  select * into v_attempt from public.payment_attempts where order_id = p_order_id limit 1;

  if v_order.payment_method <> 'card' then
    raise exception 'PAYMENT_METHOD_MISMATCH' using errcode = 'check_violation';
  end if;
  if v_order.total_egp * 100 <> p_amount_cents then
    raise exception 'ORDER_AMOUNT_MISMATCH' using errcode = 'check_violation';
  end if;

  if v_order.payment_status = 'paid' then
    if v_order.paymob_txn_id <> btrim(p_provider_txn_id) then
      raise exception 'ORDER_ALREADY_PAID_BY_ANOTHER_TRANSACTION'
        using errcode = 'unique_violation';
    end if;
  elsif v_order.payment_status in ('pending', 'failed') then
    update public.orders
       set payment_status = 'paid',
           paymob_txn_id = btrim(p_provider_txn_id)
     where id = v_order.id;
    v_transitioned := true;
  else
    raise exception 'ORDER_NOT_PAYABLE' using errcode = 'check_violation';
  end if;

  update public.payment_attempts
     set status = 'paid', provider_txn_id = btrim(p_provider_txn_id),
         last_error = null, updated_at = now()
   where id = v_attempt.id;

  return jsonb_build_object('transitioned', v_transitioned);
end;
$$;

-- create_delivery_job: the LIVE shape, carrying the NULL-config fail-open.
create or replace function public.create_delivery_job(p_quote_id uuid)
returns uuid language plpgsql security definer set search_path = public, private, pg_temp
as $$
declare
  v_quote private.delivery_quotes;
  v_cfg   public.delivery_service_configs;
  v_id    uuid;
begin
  select * into v_quote from private.delivery_quotes where id = p_quote_id;
  if not found then raise exception 'QUOTE_NOT_FOUND'; end if;
  if v_quote.consumed_at is not null then
    raise exception 'QUOTE_ALREADY_CONSUMED' using errcode = 'check_violation';
  end if;
  if v_quote.expires_at <= now() then
    raise exception 'QUOTE_EXPIRED' using errcode = 'check_violation';
  end if;

  select * into v_cfg from public.delivery_service_configs
   where service_area_id = v_quote.service_area_id;
  if v_cfg.launch_stage = 'disabled' or v_cfg.intake_state <> 'open' then
    raise exception 'DELIVERY_NOT_AVAILABLE' using errcode = 'check_violation';
  end if;

  update private.delivery_quotes set consumed_at = now() where id = p_quote_id;
  insert into public.delivery_jobs (ref) values ('DJ-TEST') returning id into v_id;
  return v_id;
end;
$$;

-- notify_settlement_change: the LIVE shape, with the settlement id in orderId.
create or replace function public.notify_settlement_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_base  text;
  v_staff jsonb;
  v_event text;
begin
  if new.status = 'finalized' and old.status is distinct from 'finalized' then
    v_event := 'settlement_finalized';
  elsif new.status = 'paid' and old.status is distinct from 'paid' then
    v_event := 'settlement_paid';
  else
    return new;
  end if;

  select value #>> '{}' into v_base from public.platform_settings where key = 'functions_base_url';
  if v_base is null or v_base = '' then return new; end if;

  select coalesce(jsonb_agg(distinct ms.profile_id::text), '[]'::jsonb) into v_staff
    from public.merchant_staff ms where ms.restaurant_id = new.restaurant_id;
  if v_staff is null or v_staff = '[]'::jsonb then return new; end if;

  perform pg_notify('push', jsonb_build_object(
                 'event', v_event,
                 'orderId', new.id::text,
                 'recipientUserIds', v_staff)::text);
  return new;
exception when others then
  return new;
end;
$$;

-- The five SECURITY INVOKER functions 203f pins.
create or replace function public.delivery_job_events_immutable() returns trigger
language plpgsql as $$ begin raise exception 'IMMUTABLE'; end $$;
create or replace function private.delivery_access_events_immutable() returns trigger
language plpgsql as $$ begin raise exception 'IMMUTABLE'; end $$;
create or replace function public.availability_events_immutable() returns trigger
language plpgsql as $$ begin raise exception 'IMMUTABLE'; end $$;
create or replace function public.menu_items_staff_writable_columns() returns text[]
language sql immutable as $$ select array['is_available','sort_order'] $$;
create or replace function public.search_catalog(p_q text)
returns setof public.menu_items language sql stable
as $$ select m.* from public.menu_items m where m.name ilike '%' || p_q || '%' $$;


-- ============================================================================
-- APPLY THE MIGRATION UNDER TEST
-- ============================================================================
\ir ../migrations/203_audit_20260731_p2_fixes.sql


-- ============================================================================
-- ASSERTIONS
-- ============================================================================

-- --- 203a: definer functions revoked from PUBLIC/anon, admin fails closed ---
do $$
declare n int;
begin
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in ('my_kyc_documents','recent_push_campaigns','my_restaurant_settlements')
     and (has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('public', p.oid, 'execute'));
  if n <> 0 then
    raise exception 'FAIL 203a: % definer function(s) still executable by anon/PUBLIC', n;
  end if;
  raise notice 'PASS 203a-1: KYC/campaign/settlement definers revoked from anon+PUBLIC';
end $$;

do $$
declare n int;
begin
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in ('my_kyc_documents','recent_push_campaigns','my_restaurant_settlements')
     and not has_function_privilege('authenticated', p.oid, 'execute');
  if n <> 0 then
    raise exception 'FAIL 203a: % definer function(s) lost the authenticated grant', n;
  end if;
  raise notice 'PASS 203a-2: authenticated still holds EXECUTE on all three';
end $$;

do $$
declare v_src text;
begin
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='my_kyc_documents';
  if position('coalesce(public.auth_role()::text, '''') = ''admin''' in v_src) = 0 then
    raise exception 'FAIL 203a: my_kyc_documents admin check is not fail-closed';
  end if;
  -- The other two disjuncts must survive, or merchants/drivers lose their docs.
  if position('is_merchant_staff' in v_src) = 0 or position('d.profile_id = auth.uid()' in v_src) = 0 then
    raise exception 'FAIL 203a: my_kyc_documents lost a legitimate access branch';
  end if;
  raise notice 'PASS 203a-3: my_kyc_documents admin disjunct fails closed, others intact';
end $$;

-- An anon-context call must return nothing (auth.uid() and auth_role() are NULL).
do $$
declare n int;
begin
  insert into public.kyc_documents (subject_type, subject_id) values ('driver', gen_random_uuid());
  select count(*) into n from public.my_kyc_documents('driver', (select subject_id from public.kyc_documents limit 1));
  if n <> 0 then
    raise exception 'FAIL 203a: my_kyc_documents returned % row(s) to a role-less caller', n;
  end if;
  raise notice 'PASS 203a-4: my_kyc_documents returns nothing to a role-less caller';
end $$;

-- --- 203b: settle_paymob_payment uses is-distinct-from --------------------
do $$
declare v_src text;
begin
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='settle_paymob_payment';
  if position('paymob_txn_id is distinct from btrim(p_provider_txn_id)' in v_src) = 0 then
    raise exception 'FAIL 203b: comparison not made NULL-safe';
  end if;
  if position('paymob_txn_id <> btrim' in v_src) > 0 then
    raise exception 'FAIL 203b: the unsafe comparison is still present';
  end if;
  raise notice 'PASS 203b-1: txn comparison is NULL-safe';
end $$;

-- Behavioural: a paid order with a NULL txn id must now RAISE on a different
-- transaction, where before it silently returned.
do $$
declare v_oid uuid := gen_random_uuid(); v_raised boolean := false;
begin
  insert into public.orders (id, payment_method, payment_status, total_egp, paymob_txn_id)
    values (v_oid, 'card', 'paid', 100, null);
  insert into public.payment_attempts (order_id, status) values (v_oid, 'pending');
  begin
    perform public.settle_paymob_payment(v_oid, 'ord_1', 'txn_different', 10000);
  exception when unique_violation then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL 203b: NULL txn id on a paid order still swallows a different transaction';
  end if;
  raise notice 'PASS 203b-2: a different txn against a NULL-txn paid order now raises';
end $$;

-- Regression: a genuine duplicate (same txn id) must still be a benign no-op.
do $$
declare v_oid uuid := gen_random_uuid(); v_res jsonb;
begin
  insert into public.orders (id, payment_method, payment_status, total_egp, paymob_txn_id)
    values (v_oid, 'card', 'paid', 100, 'txn_same');
  insert into public.payment_attempts (order_id, status) values (v_oid, 'pending');
  v_res := public.settle_paymob_payment(v_oid, 'ord_1', 'txn_same', 10000);
  if (v_res->>'transitioned')::boolean is not false then
    raise exception 'FAIL 203b: duplicate webhook no longer a no-op';
  end if;
  raise notice 'PASS 203b-3: duplicate webhook for the same txn is still a no-op';
end $$;

-- --- 203c: create_delivery_job fails closed on a missing config row -------
do $$
declare v_qid uuid := gen_random_uuid(); v_raised boolean := false;
begin
  -- Quote is valid; the config row deliberately does NOT exist.
  insert into private.delivery_quotes (id, service_area_id, expires_at)
    values (v_qid, gen_random_uuid(), now() + interval '10 minutes');
  begin
    perform public.create_delivery_job(v_qid);
  exception when check_violation then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL 203c: job created with no service-area config (fail-open)';
  end if;
  raise notice 'PASS 203c-1: a missing config row now refuses the job';
end $$;

-- Regression: an OPEN config still creates the job.
do $$
declare v_qid uuid := gen_random_uuid(); v_area uuid := gen_random_uuid(); v_job uuid;
begin
  insert into public.delivery_service_configs (service_area_id, launch_stage, intake_state)
    values (v_area, 'live', 'open');
  insert into private.delivery_quotes (id, service_area_id, expires_at)
    values (v_qid, v_area, now() + interval '10 minutes');
  v_job := public.create_delivery_job(v_qid);
  if v_job is null then
    raise exception 'FAIL 203c: an open service area no longer creates a job';
  end if;
  raise notice 'PASS 203c-2: an open service area still creates a job';
end $$;

-- Regression: a disabled config still refuses.
do $$
declare v_qid uuid := gen_random_uuid(); v_area uuid := gen_random_uuid(); v_raised boolean := false;
begin
  insert into public.delivery_service_configs (service_area_id, launch_stage, intake_state)
    values (v_area, 'disabled', 'open');
  insert into private.delivery_quotes (id, service_area_id, expires_at)
    values (v_qid, v_area, now() + interval '10 minutes');
  begin
    perform public.create_delivery_job(v_qid);
  exception when check_violation then v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL 203c: a disabled service area no longer refuses';
  end if;
  raise notice 'PASS 203c-3: a disabled service area still refuses';
end $$;

-- --- 203d: settlement pushes no longer smuggle a settlement id ------------
do $$
declare v_src text;
begin
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='notify_settlement_change';
  if position('''orderId'', new.id::text' in v_src) > 0 then
    raise exception 'FAIL 203d: settlement id still passed as orderId';
  end if;
  if position('''route''' in v_src) = 0 then
    raise exception 'FAIL 203d: no route field replaced it';
  end if;
  if position('settlement_finalized' in v_src) = 0 or position('merchant_staff' in v_src) = 0 then
    raise exception 'FAIL 203d: settlement notification logic was lost';
  end if;
  raise notice 'PASS 203d: settlement push carries a route, not a fake orderId';
end $$;

-- --- 203e: driver settlements notify the driver ---------------------------
do $$
declare n int;
begin
  select count(*) into n from pg_trigger
   where tgname = 'driver_settlements_notify_change' and not tgisinternal;
  if n <> 1 then
    raise exception 'FAIL 203e: expected 1 driver settlement trigger, found %', n;
  end if;
  raise notice 'PASS 203e-1: driver_settlements notify trigger exists';
end $$;

do $$
declare
  v_did uuid := gen_random_uuid();
  v_pid uuid := gen_random_uuid();
  v_sid uuid := gen_random_uuid();
begin
  insert into public.drivers (id, profile_id) values (v_did, v_pid);
  insert into public.driver_settlements (id, driver_id, period_start, period_end, status)
    values (v_sid, v_did, current_date, current_date, 'draft');
  -- The transition must not raise, and must be swallowed safely if push fails.
  update public.driver_settlements set status = 'finalized' where id = v_sid;
  update public.driver_settlements set status = 'paid' where id = v_sid;
  if (select status from public.driver_settlements where id = v_sid) <> 'paid' then
    raise exception 'FAIL 203e: settlement transition was blocked by the notifier';
  end if;
  raise notice 'PASS 203e-2: settlement transitions fire the notifier without blocking';
end $$;

do $$
begin
  if has_function_privilege('anon', 'public.notify_driver_settlement_change()', 'execute')
     or has_function_privilege('authenticated', 'public.notify_driver_settlement_change()', 'execute') then
    raise exception 'FAIL 203e: trigger function is client-executable';
  end if;
  raise notice 'PASS 203e-3: notifier is not executable by anon/authenticated';
end $$;

-- --- 203f: the five invoker functions have a pinned search_path -----------
do $$
declare n int;
begin
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where (ns.nspname, p.proname) in (
           ('public','delivery_job_events_immutable'),
           ('private','delivery_access_events_immutable'),
           ('public','availability_events_immutable'),
           ('public','menu_items_staff_writable_columns'),
           ('public','search_catalog'))
     and p.proconfig is null;
  if n <> 0 then
    raise exception 'FAIL 203f: % function(s) still have a mutable search_path', n;
  end if;
  raise notice 'PASS 203f-1: all five have a pinned search_path';
end $$;

do $$
declare n int;
begin
  insert into public.menu_items (id, name, is_available) values (gen_random_uuid(), 'koshari', true);
  select count(*) into n from public.search_catalog('kosh');
  if n <> 1 then
    raise exception 'FAIL 203f: search_catalog returned % rows after the pin', n;
  end if;
  raise notice 'PASS 203f-2: search_catalog still works after the pin';
end $$;

-- --- 203g: tip and quantity rails -----------------------------------------
do $$
declare v_raised boolean := false;
begin
  begin
    insert into public.orders (tip_egp, payment_method) values (1000000000, 'cash_on_delivery');
  exception when check_violation then v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL 203g: an absurd tip was accepted';
  end if;
  raise notice 'PASS 203g-1: absurd tip rejected';
end $$;

do $$
declare v_raised boolean := false;
begin
  begin
    insert into public.order_items (order_id, quantity) values (gen_random_uuid(), 100000);
  exception when check_violation then v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL 203g: an absurd quantity was accepted';
  end if;
  raise notice 'PASS 203g-2: absurd quantity rejected';
end $$;

-- Regression: ordinary values still pass, and the rails are generous.
do $$
begin
  insert into public.orders (tip_egp, payment_method) values (50, 'cash_on_delivery');
  insert into public.orders (tip_egp, payment_method) values (5000, 'cash_on_delivery');
  insert into public.order_items (order_id, quantity) values (gen_random_uuid(), 3);
  insert into public.order_items (order_id, quantity) values (gen_random_uuid(), 100);
  raise notice 'PASS 203g-3: realistic tips and quantities still accepted';
end $$;

-- The constraints must be VALIDATED, not left NOT VALID (prod data is clean).
do $$
declare n int;
begin
  select count(*) into n from pg_constraint
   where conname in ('orders_tip_plausible','order_items_quantity_plausible')
     and convalidated;
  if n <> 2 then
    raise exception 'FAIL 203g: expected 2 validated rails, found %', n;
  end if;
  raise notice 'PASS 203g-4: both rails are validated';
end $$;

-- --- 203h: max_uses cap cannot be over-redeemed ---------------------------
do $$
declare
  v_code uuid := gen_random_uuid();
  v_raised boolean := false;
begin
  insert into public.promo_codes (id, code, max_uses) values (v_code, 'LAUNCH2', 2);
  -- Two distinct users take the two available slots.
  insert into public.promo_redemptions (promo_id, user_id, order_id)
    values (v_code, gen_random_uuid(), gen_random_uuid());
  insert into public.promo_redemptions (promo_id, user_id, order_id)
    values (v_code, gen_random_uuid(), gen_random_uuid());
  -- A third must be refused even though it is a different user.
  begin
    insert into public.promo_redemptions (promo_id, user_id, order_id)
      values (v_code, gen_random_uuid(), gen_random_uuid());
  exception when check_violation then v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL 203h: a max_uses=2 code was redeemed 3 times';
  end if;
  if (select count(*) from public.promo_redemptions where promo_id = v_code) <> 2 then
    raise exception 'FAIL 203h: redemption count is not exactly max_uses';
  end if;
  raise notice 'PASS 203h-1: a capped code stops at max_uses across different users';
end $$;

-- Regression: an UNCAPPED code is not serialized and not limited.
do $$
declare v_code uuid := gen_random_uuid(); n int;
begin
  insert into public.promo_codes (id, code, max_uses) values (v_code, 'FOREVER', null);
  insert into public.promo_redemptions (promo_id, user_id, order_id)
    values (v_code, gen_random_uuid(), gen_random_uuid());
  insert into public.promo_redemptions (promo_id, user_id, order_id)
    values (v_code, gen_random_uuid(), gen_random_uuid());
  insert into public.promo_redemptions (promo_id, user_id, order_id)
    values (v_code, gen_random_uuid(), gen_random_uuid());
  select count(*) into n from public.promo_redemptions where promo_id = v_code;
  if n <> 3 then
    raise exception 'FAIL 203h: an uncapped code was limited (got % rows)', n;
  end if;
  -- Uncapped codes get no sequence, so they never contend on the index.
  if exists (select 1 from public.promo_redemptions where promo_id = v_code and redemption_seq is not null) then
    raise exception 'FAIL 203h: an uncapped redemption was assigned a sequence';
  end if;
  raise notice 'PASS 203h-2: uncapped codes are unaffected';
end $$;

-- --- 203i: private tables carry no client grants ---------------------------
do $$
declare n int;
begin
  select count(*) into n
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'private' and c.relkind = 'r'
     and (has_table_privilege('anon', c.oid, 'select')
          or has_table_privilege('authenticated', c.oid, 'select')
          or has_table_privilege('anon', c.oid, 'truncate')
          or has_table_privilege('authenticated', c.oid, 'truncate'));
  if n <> 0 then
    raise exception 'FAIL 203i: % private table(s) still reachable by a client role', n;
  end if;
  raise notice 'PASS 203i: no private table grants SELECT or TRUNCATE to a client role';
end $$;

-- --- house rules: no duplicate overloads, no new anon-executable definers --
do $$
declare r record;
begin
  for r in
    select p.proname, count(*) as n
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.proname in ('my_kyc_documents','recent_push_campaigns','my_restaurant_settlements',
                         'settle_paymob_payment','create_delivery_job','notify_settlement_change',
                         'notify_driver_settlement_change','promo_redemption_assign_seq')
     group by p.proname having count(*) > 1
  loop
    raise exception 'FAIL house-rule-1: % has % overloads', r.proname, r.n;
  end loop;
  raise notice 'PASS house-rule-1: no duplicate overloads created';
end $$;

do $$
declare r record;
begin
  for r in
    select p.proname from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.prosecdef
       and p.proname in ('notify_driver_settlement_change','promo_redemption_assign_seq')
       and (has_function_privilege('anon', p.oid, 'execute')
            or has_function_privilege('public', p.oid, 'execute'))
  loop
    raise exception 'FAIL house-rule-3: new definer % is executable by anon/PUBLIC', r.proname;
  end loop;
  raise notice 'PASS house-rule-3: both new definer functions are revoked from anon+PUBLIC';
end $$;

rollback;
