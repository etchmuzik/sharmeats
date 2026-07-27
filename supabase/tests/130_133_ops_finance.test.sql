\set ON_ERROR_STOP on

-- Tests for migrations 130 (admin_issue_credit), 131 (settlement reference
-- required), 132 (menu price bounds), 133 (watchdog placed coverage).
-- Shim methodology per the 126 suite; real bodies re-verified against prod
-- via the md5-guarded dry-run protocol at apply time.

begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end;
$$;

create type app_role as enum ('customer','driver','merchant_staff','dispatcher','admin');

create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select current_setting('test.uid', true)::uuid $$;

create table public.users (id uuid primary key, role app_role not null default 'customer');
create function public.auth_role() returns app_role
language sql stable security definer set search_path = public, pg_temp as $$
  select role from public.users where id = auth.uid()
$$;

create table public.platform_settings (key text primary key, value jsonb not null);

-- ===========================================================================
-- 130 -- admin_issue_credit
-- ===========================================================================
create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null, delta_egp int not null, reason text not null,
  ref_order_id uuid, note text, actor_id uuid
);
create table public.customer_credit_balance (
  user_id uuid primary key, balance_egp int not null default 0,
  updated_at timestamptz not null default now()
);

-- issue_credit shim: the ledger/balance core of the prod body (push omitted).
create function public.issue_credit(p_user_id uuid, p_amount_egp integer, p_reason text, p_order_id uuid default null, p_note text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $function$
declare v_actor uuid := auth.uid();
begin
  if p_amount_egp is null or p_amount_egp <= 0 then raise exception 'INVALID_AMOUNT' using errcode='check_violation'; end if;
  if p_reason not in ('refund','goodwill','sla_late','redeem','adjustment') then raise exception 'INVALID_REASON' using errcode='check_violation'; end if;
  if p_reason <> 'sla_late' and coalesce(public.auth_role()::text,'') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode='check_violation';
  end if;
  insert into public.credit_ledger (user_id, delta_egp, reason, ref_order_id, note, actor_id)
  values (p_user_id, p_amount_egp, p_reason, p_order_id, p_note, v_actor);
  insert into public.customer_credit_balance (user_id, balance_egp) values (p_user_id, p_amount_egp)
  on conflict (user_id) do update set balance_egp = public.customer_credit_balance.balance_egp + p_amount_egp, updated_at = now();
end; $function$;

-- The 130 wrapper, real body.
create function public.admin_issue_credit(p_user_id uuid, p_amount_egp integer, p_reason text, p_order_id uuid default null, p_note text default null)
returns void language plpgsql security definer set search_path to 'public','pg_temp' as $function$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;
  if coalesce(public.auth_role()::text, '') <> 'admin' then raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation'; end if;
  if p_reason not in ('refund', 'goodwill', 'adjustment') then raise exception 'INVALID_REASON' using errcode = 'check_violation'; end if;
  if p_amount_egp is null or p_amount_egp <= 0 or p_amount_egp > 5000 then raise exception 'INVALID_AMOUNT' using errcode = 'check_violation'; end if;
  if not exists (select 1 from public.users where id = p_user_id) then raise exception 'USER_NOT_FOUND' using errcode = 'check_violation'; end if;
  perform public.issue_credit(p_user_id, p_amount_egp, p_reason, p_order_id, p_note);
end; $function$;

insert into public.users (id, role) values
  ('11111111-1111-1111-1111-111111111111', 'admin'),
  ('22222222-2222-2222-2222-222222222222', 'customer');

do $$
begin
  -- Non-admin refused.
  perform set_config('test.uid', '22222222-2222-2222-2222-222222222222', true);
  begin
    perform public.admin_issue_credit('22222222-2222-2222-2222-222222222222', 100, 'goodwill');
    raise exception 'TEST 1 FAILED: non-admin issued a credit';
  exception when check_violation then null;
  end;

  -- Admin succeeds; balance lands.
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', true);
  perform public.admin_issue_credit('22222222-2222-2222-2222-222222222222', 150, 'refund', null, 'cold delivery');
  if (select balance_egp from public.customer_credit_balance where user_id = '22222222-2222-2222-2222-222222222222') <> 150 then
    raise exception 'TEST 1 FAILED: balance not credited';
  end if;

  -- The machine-only and redeem reasons are refused even for admins.
  begin
    perform public.admin_issue_credit('22222222-2222-2222-2222-222222222222', 100, 'sla_late');
    raise exception 'TEST 1 FAILED: sla_late allowed through the wrapper';
  exception when check_violation then null;
  end;

  -- Cap bites.
  begin
    perform public.admin_issue_credit('22222222-2222-2222-2222-222222222222', 5001, 'goodwill');
    raise exception 'TEST 1 FAILED: over-cap amount allowed';
  exception when check_violation then null;
  end;
  raise notice 'test 1 OK: admin_issue_credit -- admin-gated, reason-restricted, capped, balance lands';
end;
$$;

-- ===========================================================================
-- 131 -- mark_settlement_paid requires a real reference
-- ===========================================================================
create table public.restaurant_settlements (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'finalized' check (status in ('draft','finalized','paid')),
  paid_at timestamptz, paid_reference text, updated_at timestamptz not null default now()
);

create function public.mark_settlement_paid(p_settlement_id uuid, p_reference text)
returns void language plpgsql security definer set search_path to 'public','pg_temp' as $function$
begin
  if coalesce(public.auth_role()::text,'') <> 'admin' then raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation'; end if;
  if nullif(btrim(coalesce(p_reference, '')), '') is null then
    raise exception 'REFERENCE_REQUIRED' using errcode = 'check_violation';
  end if;
  update public.restaurant_settlements
     set status = 'paid', paid_at = now(), paid_reference = btrim(p_reference), updated_at = now()
   where id = p_settlement_id and status = 'finalized';
  if not found then raise exception 'NOT_FINALIZED_OR_MISSING' using errcode = 'check_violation'; end if;
end; $function$;

do $$
declare v_id uuid;
begin
  insert into public.restaurant_settlements default values returning id into v_id;
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', true);

  -- NEGATIVE CONTROL: the OLD behaviour (nullif + still flip) is what we fixed.
  -- Whitespace-only must now be refused, status untouched.
  begin
    perform public.mark_settlement_paid(v_id, '   ');
    raise exception 'TEST 2 FAILED: whitespace-only reference accepted';
  exception when check_violation then null;
  end;
  if (select status from public.restaurant_settlements where id = v_id) <> 'finalized' then
    raise exception 'TEST 2 FAILED: status changed despite refused reference';
  end if;

  perform public.mark_settlement_paid(v_id, '  TRF-2026-0727-001  ');
  if (select paid_reference from public.restaurant_settlements where id = v_id) <> 'TRF-2026-0727-001' then
    raise exception 'TEST 2 FAILED: reference not stored trimmed';
  end if;
  if (select status from public.restaurant_settlements where id = v_id) <> 'paid' then
    raise exception 'TEST 2 FAILED: real reference did not mark paid';
  end if;
  raise notice 'test 2 OK: whitespace reference refused (status intact); real reference stored trimmed';
end;
$$;

-- ===========================================================================
-- 132 -- price bounds bind EVERY writer
-- ===========================================================================
create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  price_egp int not null
);
alter table public.menu_items
  add constraint menu_items_price_bounds_chk check (price_egp between 1 and 10000) not valid;
alter table public.menu_items validate constraint menu_items_price_bounds_chk;

do $$
begin
  insert into public.menu_items (price_egp) values (25), (780), (10000), (1);
  begin
    insert into public.menu_items (price_egp) values (0);
    raise exception 'TEST 3 FAILED: zero price accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.menu_items (price_egp) values (100000);
    raise exception 'TEST 3 FAILED: 100000 price accepted';
  exception when check_violation then null;
  end;
  begin
    update public.menu_items set price_egp = -5 where price_egp = 25;
    raise exception 'TEST 3 FAILED: negative price via UPDATE accepted';
  exception when check_violation then null;
  end;
  raise notice 'test 3 OK: price bounds bind inserts and updates; real range (25..780) unaffected';
end;
$$;

-- ===========================================================================
-- 133 -- watchdog counts PLACED orders
-- ===========================================================================
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  status text not null,
  assigned_driver_id uuid,
  placed_at timestamptz not null default now()
);
create table public.__alerts (msg text);
create function public.ops_alert(p_msg text) returns void
language sql as $$ insert into public.__alerts values (p_msg) $$;

-- Watchdog shim: the counting + message core of the 133 body (cron-health
-- check omitted -- no cron schema in the ephemeral cluster).
create function public.dispatch_watchdog() returns void
language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_mins int; v_stuck int := 0; v_placed int := 0; v_cd int; v_last timestamptz; v_msg text;
begin
  select coalesce((value #>> '{}')::int, 10) into v_mins
    from public.platform_settings where key = 'dispatch_stuck_order_minutes';
  select count(*) into v_stuck from public.orders o
   where o.status in ('accepted','ready') and o.assigned_driver_id is null
     and o.placed_at < now() - make_interval(mins => coalesce(v_mins,10));
  select count(*) into v_placed from public.orders o
   where o.status = 'placed'
     and o.placed_at < now() - make_interval(mins => coalesce(v_mins,10));
  if coalesce(v_stuck,0) = 0 and coalesce(v_placed,0) = 0 then return; end if;
  select coalesce((value #>> '{}')::int, 60) into v_cd
    from public.platform_settings where key = 'dispatch_watchdog_cooldown_minutes';
  select nullif(value #>> '{}', '')::timestamptz into v_last
    from public.platform_settings where key = 'dispatch_watchdog_last_alert_at';
  if v_last is not null and v_last > now() - make_interval(mins => coalesce(v_cd, 60)) then return; end if;
  v_msg := 'Sharm Eats dispatch watchdog:';
  if coalesce(v_placed,0) > 0 then
    v_msg := v_msg || ' ' || v_placed || ' order(s) still PLACED (unaccepted) >' || coalesce(v_mins,10) || ' min — auto-accept broken or off.';
  end if;
  if coalesce(v_stuck,0) > 0 then
    v_msg := v_msg || ' ' || v_stuck || ' order(s) stuck unassigned >' || coalesce(v_mins,10) || ' min.';
  end if;
  perform public.ops_alert(v_msg);
end; $function$;

do $$
begin
  -- NEGATIVE CONTROL: the OLD filter ('accepted','ready') sees nothing here.
  insert into public.orders (status, placed_at) values ('placed', now() - interval '25 minutes');
  if (select count(*) from public.orders o
       where o.status in ('accepted','ready') and o.assigned_driver_id is null
         and o.placed_at < now() - interval '10 minutes') <> 0 then
    raise exception 'NEGATIVE CONTROL FAILED';
  end if;
  raise notice 'negative control OK: the pre-133 filter is blind to a 25-min-old PLACED order';

  perform public.dispatch_watchdog();
  if (select count(*) from public.__alerts where msg like '%PLACED (unaccepted)%') <> 1 then
    raise exception 'TEST 4 FAILED: watchdog did not alert on the placed order';
  end if;

  -- A fresh placed order (inside the threshold) must NOT alert.
  delete from public.orders; delete from public.__alerts;
  insert into public.orders (status, placed_at) values ('placed', now() - interval '2 minutes');
  perform public.dispatch_watchdog();
  if (select count(*) from public.__alerts) <> 0 then
    raise exception 'TEST 4 FAILED: watchdog alerted on a fresh placed order';
  end if;
  raise notice 'test 4 OK: watchdog pages on stale PLACED orders, stays quiet on fresh ones';
end;
$$;

do $$ begin raise notice 'ALL 130-133 OPS/FINANCE TESTS PASSED'; end; $$;

rollback;
