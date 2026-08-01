\set ON_ERROR_STOP on

-- 205_sla_credit_integrity.test.sql
--
-- Category 1 (see supabase/tests/README.md): self-contained, loads its own
-- migration with a real `\ir`, runs against the empty PostgreSQL instance
-- scripts/test-security-migrations.sh spins up, and is listed in that script's
-- test_files array.
--
-- BEFORE / apply / AFTER. The PRE-205 function below is the VERBATIM body read
-- from production on 2026-08-01 via pg_get_functiondef — not migration 135's
-- copy — so the BEFORE assertions prove the real defect, not a repo artefact.
-- Every BEFORE case is re-run AFTER on a fresh order id, which is the only way
-- to show that the fix changed exactly what it claims to and nothing else: a
-- test that only checked the AFTER state would still pass if the migration were
-- empty, and one that only checked the payout cases would not notice the
-- published 15-minute promise being switched off.
--
-- The promise under test is the one printed in the customer app
-- (apps/customer/src/i18n/locales/*.json — checkout.promiseSub, order.slaChip,
-- order.slaLine, wallet.subtitle) and enforceable under Egypt's Consumer
-- Protection Law 181/2018. Cases A1, A6, A7, A9, A11 and A13 exist to make
-- weakening it a test failure.
--
-- What this canNOT prove: that the stubs match production. issue_credit and
-- ops_alert are reduced to the parts the trigger depends on (ledger row,
-- one-credit-per-order index, alert text) with the push side-effects dropped.
-- The prod check is the transaction-wrapped dry run plus the verification
-- queries in the migration's footer.

-- Transaction-wrapped so nothing persists (migration house rule 6).
begin;

-- ---------------------------------------------------------------------------
-- Supabase surface stubs.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end;
$$;

create schema auth;
create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;

create type app_role as enum ('customer','driver','merchant_staff','dispatcher','admin');
create type order_status_type as enum (
  'placed','accepted','preparing','ready','picked_up','out_for_delivery',
  'delivered','cancelled','rejected'
);

-- ---------------------------------------------------------------------------
-- Schema slice the trigger touches (columns and nullability copied from
-- production's information_schema on 2026-08-01 — order_financials.delivered_at
-- being NOT NULL is load-bearing for the "leave the billing coalesce alone"
-- decision in 205, so it is reproduced faithfully).
-- ---------------------------------------------------------------------------
create table public.users (
  id   uuid primary key,
  role app_role not null default 'customer'
);

create table public.restaurants (
  id             uuid primary key,
  name           text not null,
  commission_pct numeric(5,2) not null default 12.0
);

create table public.platform_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.orders (
  id                     uuid primary key,
  short_code             text not null unique,
  user_id                uuid references public.users(id),
  restaurant_id          uuid not null references public.restaurants(id),
  status                 order_status_type not null default 'placed',
  subtotal_egp           int not null default 0,
  discount_egp           int not null default 0,
  delivery_fee_egp       int not null default 0,
  payment_method         text not null default 'cash_on_delivery',
  commission_pct_snapshot numeric(5,2),
  placed_at              timestamptz not null default now(),
  eta_at                 timestamptz,
  delivered_at           timestamptz
);

create table public.order_financials (
  order_id           uuid primary key,
  restaurant_id      uuid not null,
  subtotal_egp       int not null,
  discount_egp       int not null default 0,
  commission_pct     numeric(5,2) not null,
  commission_egp     int not null,
  commission_vat_egp int not null default 0,
  delivery_fee_egp   int not null,
  payment_method     text not null,
  delivered_at       timestamptz not null,
  created_at         timestamptz not null default now()
);

create table public.order_financials_failures (
  order_id  uuid primary key,
  sqlstate  text,
  message   text,
  failed_at timestamptz not null default now()
);

create table public.credit_ledger (
  id           bigserial primary key,
  user_id      uuid not null,
  delta_egp    int  not null,
  reason       text not null,
  ref_order_id uuid,
  note         text,
  actor_id     uuid,
  created_at   timestamptz not null default now()
);

-- 062:83-85 — the index the trigger's unique_violation swallow relies on.
create unique index credit_ledger_one_sla_per_order
  on public.credit_ledger (ref_order_id) where (reason = 'sla_late');

create table public.customer_credit_balance (
  user_id     uuid primary key,
  balance_egp int not null default 0,
  updated_at  timestamptz not null default now()
);

create function public.auth_role()
returns app_role
language sql
stable
as $$
  select role from public.users where id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- ops_alert stub. Production fires a Telegram webhook through pg_net and
-- returns silently when no URL is configured; here it records the text, which
-- is the only property 205 depends on — that the skip is LOUD and names the
-- order. (That "returns silently" behaviour is exactly why 205 also raises a
-- warning alongside every alert.)
-- ---------------------------------------------------------------------------
create table public.test_ops_alerts (
  id  bigserial primary key,
  txt text not null
);

create function public.ops_alert(p_text text)
returns void
language plpgsql
as $$
begin
  insert into public.test_ops_alerts (txt) values (p_text);
end;
$$;

-- issue_credit stub — the ledger + balance half of the production function
-- (mig 101 body, push side-effect dropped). The validations are kept because
-- the trigger relies on two of them: sla_late requires an order id, and the
-- partial unique index raises unique_violation on a second credit.
create function public.issue_credit(
  p_user_id uuid, p_amount_egp int, p_reason text,
  p_order_id uuid default null, p_note text default null
)
returns void
language plpgsql
as $$
begin
  if p_amount_egp is null or p_amount_egp <= 0 then
    raise exception 'INVALID_AMOUNT' using errcode='check_violation';
  end if;
  if p_reason not in ('refund','goodwill','sla_late','redeem','adjustment') then
    raise exception 'INVALID_REASON' using errcode='check_violation';
  end if;
  if p_reason = 'sla_late' and p_order_id is null then
    raise exception 'SLA_CREDIT_REQUIRES_ORDER' using errcode='check_violation';
  end if;
  insert into public.credit_ledger (user_id, delta_egp, reason, ref_order_id, note, actor_id)
  values (p_user_id, p_amount_egp, p_reason, p_order_id, p_note, auth.uid());
  insert into public.customer_credit_balance (user_id, balance_egp)
  values (p_user_id, p_amount_egp)
  on conflict (user_id) do update
    set balance_egp = public.customer_credit_balance.balance_egp + p_amount_egp,
        updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- PRE-205 snapshot_order_financials — VERBATIM production body, 2026-08-01.
-- Note the two lines this whole file is about:
--     v_late_min := extract(epoch from (coalesce(new.delivered_at, now()) - new.eta_at)) / 60.0;
--     if v_late_min > v_grace then ...
-- ---------------------------------------------------------------------------
create function public.snapshot_order_financials()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_rate numeric(5,2); v_vat_pct int; v_commission int; v_grace int;
  v_pct int; v_max int; v_late_min numeric; v_credit int;
  v_standard numeric(5,2);
begin
  if new.status <> 'delivered' or old.status = 'delivered' then return new; end if;

  v_rate := new.commission_pct_snapshot;
  if v_rate is null then
    select commission_pct into v_rate from public.restaurants where id = new.restaurant_id;
  end if;

  if v_rate is null then
    select coalesce((value #>> '{}')::numeric, 15) into v_standard
      from public.platform_settings where key = 'standard_commission_pct';
    v_rate := coalesce(v_standard, 15);
    begin
      perform public.ops_alert(
        'commission rate missing for order ' || new.id::text ||
        ' (restaurant ' || new.restaurant_id::text || ') — billed at standard ' || v_rate::text || '%');
    exception when others then null;
    end;
  end if;

  v_commission := floor(coalesce(new.subtotal_egp, 0) * v_rate / 100.0)::int;
  select coalesce((value #>> '{}')::int, 0) into v_vat_pct
    from public.platform_settings where key = 'commission_vat_pct';

  begin
    insert into public.order_financials (
      order_id, restaurant_id, subtotal_egp, discount_egp, commission_pct, commission_egp,
      commission_vat_egp, delivery_fee_egp, payment_method, delivered_at
    ) values (
      new.id, new.restaurant_id, coalesce(new.subtotal_egp, 0), coalesce(new.discount_egp, 0),
      v_rate, v_commission,
      floor(v_commission * coalesce(v_vat_pct,0) / 100.0)::int,
      coalesce(new.delivery_fee_egp, 0), new.payment_method,
      coalesce(new.delivered_at, now())
    ) on conflict (order_id) do nothing;
  exception when others then
    begin
      insert into public.order_financials_failures (order_id, sqlstate, message)
      values (new.id, sqlstate, sqlerrm)
      on conflict (order_id) do update
        set failed_at = now(), sqlstate = excluded.sqlstate, message = excluded.message;
      perform public.ops_alert('UNBILLED ORDER ' || new.id::text ||
        ' — order_financials snapshot failed: ' || sqlerrm);
    exception when others then null;
    end;
    raise warning 'snapshot_order_financials: order % not billed (%): %', new.id, sqlstate, sqlerrm;
  end;

  begin
    select coalesce((value #>> '{}')::int, 15)  into v_grace from public.platform_settings where key = 'sla_credit_grace_minutes';
    select coalesce((value #>> '{}')::int, 10)  into v_pct   from public.platform_settings where key = 'sla_credit_pct';
    select coalesce((value #>> '{}')::int, 100) into v_max   from public.platform_settings where key = 'sla_credit_max_egp';

    if new.eta_at is not null then
      v_late_min := extract(epoch from (coalesce(new.delivered_at, now()) - new.eta_at)) / 60.0;
      if v_late_min > v_grace then
        v_credit := least(v_max, floor(coalesce(new.subtotal_egp, 0) * v_pct / 100.0)::int);
        if v_credit > 0 then
          begin
            perform public.issue_credit(new.user_id, v_credit, 'sla_late', new.id,
              'Auto late credit: ' || round(v_late_min)::text || ' min late');
          exception when unique_violation then null;
          end;
        end if;
      end if;
    end if;
  exception when others then
    begin
      perform public.ops_alert('SLA credit FAILED for late order ' || new.id::text || ': ' || sqlerrm);
    exception when others then null;
    end;
    raise warning 'snapshot_order_financials: SLA credit failed for order %: %', new.id, sqlerrm;
  end;

  return new;
end;
$function$;

-- The trigger as production defines it: AFTER UPDATE OF status, FOR EACH ROW.
-- This shape is why 205 does not consult order_status_events — advance_order_status
-- inserts that row after the UPDATE returns, so it does not exist yet here.
create trigger orders_snapshot_financials
  after update of status on public.orders
  for each row execute function public.snapshot_order_financials();

-- ---------------------------------------------------------------------------
-- Live production settings, 2026-08-01.
-- ---------------------------------------------------------------------------
insert into public.platform_settings (key, value) values
  ('sla_credit_grace_minutes', to_jsonb(15)),
  ('sla_credit_pct',           to_jsonb(10)),
  ('sla_credit_max_egp',       to_jsonb(100)),
  ('commission_vat_pct',       to_jsonb(0)),
  ('standard_commission_pct',  to_jsonb(15));

insert into public.users (id, role) values
  ('80000000-0000-0000-0000-000000000001', 'customer');

insert into public.restaurants (id, name, commission_pct) values
  ('81000000-0000-0000-0000-000000000001', 'Koshary House', 15.00);

-- ---------------------------------------------------------------------------
-- Harness. now() is fixed for the whole transaction, so eta_at = now() - N min
-- and delivered_at = now() make the lateness exactly N minutes, deterministically.
-- ---------------------------------------------------------------------------
create sequence public.t_code_seq;

create function public.t_place(
  p_id uuid, p_late_minutes numeric, p_subtotal int,
  p_set_delivered_at boolean default true
)
returns void
language plpgsql
as $$
begin
  insert into public.orders (
    id, short_code, user_id, restaurant_id, status, subtotal_egp,
    delivery_fee_egp, payment_method, commission_pct_snapshot,
    placed_at, eta_at, delivered_at
  ) values (
    p_id, 'T' || lpad(nextval('public.t_code_seq')::text, 5, '0'),
    '80000000-0000-0000-0000-000000000001',
    '81000000-0000-0000-0000-000000000001',
    'out_for_delivery', p_subtotal, 20, 'cash_on_delivery', 15.00,
    now() - interval '60 min',
    now() - (p_late_minutes * interval '1 minute'),
    case when p_set_delivered_at then now() else null end
  );
end;
$$;

create function public.t_flip(p_id uuid, p_status order_status_type default 'delivered')
returns void
language plpgsql
as $$
begin
  update public.orders set status = p_status where id = p_id;
end;
$$;

-- null = no sla_late credit for this order.
create function public.t_credit(p_id uuid)
returns int
language sql
stable
as $$
  select delta_egp from public.credit_ledger
   where ref_order_id = p_id and reason = 'sla_late';
$$;

create function public.t_alerts(p_id uuid)
returns int
language sql
stable
as $$
  select count(*)::int from public.test_ops_alerts where txt like '%' || p_id::text || '%';
$$;

create function public.t_billed(p_id uuid)
returns boolean
language sql
stable
as $$
  select exists (select 1 from public.order_financials where order_id = p_id);
$$;

-- ###########################################################################
-- BEFORE — prove the defect exists on the production body.
-- ###########################################################################
select public.t_place('b0000000-0000-0000-0000-000000000001', 20,   110);        -- genuine, 20 min late
select public.t_place('b0000000-0000-0000-0000-000000000002', 4320, 110);        -- 3-day batch flip
select public.t_place('b0000000-0000-0000-0000-000000000003', 20,   110, false); -- no delivered_at
select public.t_place('b0000000-0000-0000-0000-000000000004', 6,    110);        -- inside the grace
select public.t_place('b0000000-0000-0000-0000-000000000005', 20,   110);        -- goes to cancelled
select public.t_place('b0000000-0000-0000-0000-000000000006', 20,   110);        -- settings deleted

select public.t_flip('b0000000-0000-0000-0000-000000000001');
select public.t_flip('b0000000-0000-0000-0000-000000000002');
select public.t_flip('b0000000-0000-0000-0000-000000000003');
select public.t_flip('b0000000-0000-0000-0000-000000000004');
select public.t_flip('b0000000-0000-0000-0000-000000000005', 'cancelled');

do $$
begin
  -- B1 the promise works today. This is the behaviour 205 must not disturb.
  if public.t_credit('b0000000-0000-0000-0000-000000000001') is distinct from 11 then
    raise exception 'BEFORE/B1: a 20-min-late order should already credit 11, got %',
      coalesce(public.t_credit('b0000000-0000-0000-0000-000000000001')::text, 'nothing');
  end if;

  -- B2 THE DEFECT. A 3-day-old order flipped by an admin is paid as a late
  -- delivery, and nobody is told.
  if public.t_credit('b0000000-0000-0000-0000-000000000002') is distinct from 11 then
    raise exception 'BEFORE/B2: expected the stale-flip defect to pay out 11, got %',
      coalesce(public.t_credit('b0000000-0000-0000-0000-000000000002')::text, 'nothing');
  end if;
  if public.t_alerts('b0000000-0000-0000-0000-000000000002') <> 0 then
    raise exception 'BEFORE/B2: the old body alerts nobody about a 3-day flip';
  end if;

  -- B3 THE DEFECT. A NULL delivered_at is measured against the wall clock.
  if public.t_credit('b0000000-0000-0000-0000-000000000003') is distinct from 11 then
    raise exception 'BEFORE/B3: expected a null delivered_at to pay out via coalesce(...,now()), got %',
      coalesce(public.t_credit('b0000000-0000-0000-0000-000000000003')::text, 'nothing');
  end if;

  -- B4 grace holds.
  if public.t_credit('b0000000-0000-0000-0000-000000000004') is not null then
    raise exception 'BEFORE/B4: 6 minutes is inside the 15-minute grace and must not credit';
  end if;

  -- B5 a cancellation is not a delivery.
  if public.t_credit('b0000000-0000-0000-0000-000000000005') is not null
     or public.t_billed('b0000000-0000-0000-0000-000000000005') then
    raise exception 'BEFORE/B5: a cancelled order must neither credit nor bill';
  end if;
end;
$$;

-- B6 THE DEFECT (item 5). Remove the settings rows and the promise dies
-- silently, because `select coalesce(...) into` never runs its coalesce when
-- the SELECT returns no rows.
delete from public.platform_settings
 where key in ('sla_credit_grace_minutes','sla_credit_pct','sla_credit_max_egp');

select public.t_flip('b0000000-0000-0000-0000-000000000006');

do $$
begin
  if public.t_credit('b0000000-0000-0000-0000-000000000006') is not null then
    raise exception 'BEFORE/B6: expected a missing settings row to silently kill the credit, but it paid %',
      public.t_credit('b0000000-0000-0000-0000-000000000006');
  end if;
end;
$$;

insert into public.platform_settings (key, value) values
  ('sla_credit_grace_minutes', to_jsonb(15)),
  ('sla_credit_pct',           to_jsonb(10)),
  ('sla_credit_max_egp',       to_jsonb(100));

-- ###########################################################################
-- APPLY
-- ###########################################################################
\ir ../migrations/205_sla_credit_integrity.sql

-- The migration must not have minted a second overload (house rule 1), and the
-- trigger must still be wired to it.
do $$
declare
  v_n int;
  v_args text;
begin
  select count(*), string_agg(coalesce(nullif(pg_get_function_identity_arguments(p.oid), ''), '<none>'), ' | ')
    into v_n, v_args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'snapshot_order_financials';
  if v_n <> 1 then
    raise exception 'PGRST202 hazard: % overloads of snapshot_order_financials (%)', v_n, v_args;
  end if;
  if v_args is distinct from '<none>' then
    raise exception 'argument list changed: expected a no-arg trigger function, got %', v_args;
  end if;

  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where t.tgname = 'orders_snapshot_financials' and c.relname = 'orders'
       and t.tgenabled = 'O') then
    raise exception 'the orders_snapshot_financials trigger is gone or disabled';
  end if;

  if not exists (select 1 from public.platform_settings where key = 'sla_credit_max_late_minutes') then
    raise exception 'the migration did not seed sla_credit_max_late_minutes';
  end if;
end;
$$;

-- The published numbers must be untouched. If a future edit "tunes" one of
-- these, this is where it stops.
do $$
declare v_g int; v_p int; v_m int;
begin
  select (value #>> '{}')::int into v_g from public.platform_settings where key = 'sla_credit_grace_minutes';
  select (value #>> '{}')::int into v_p from public.platform_settings where key = 'sla_credit_pct';
  select (value #>> '{}')::int into v_m from public.platform_settings where key = 'sla_credit_max_egp';
  if (v_g, v_p, v_m) is distinct from (15, 10, 100) then
    raise exception 'the published promise changed: grace=% pct=% cap=% (must be 15/10/100)', v_g, v_p, v_m;
  end if;
end;
$$;

-- ###########################################################################
-- AFTER — the promise is intact, the payout for non-deliveries is gone.
-- ###########################################################################
select public.t_place('a0000000-0000-0000-0000-000000000001', 20,    110);        -- A1  promise
select public.t_place('a0000000-0000-0000-0000-000000000002', 4320,  110);        -- A2  3-day flip
select public.t_place('a0000000-0000-0000-0000-000000000003', 20,    110, false); -- A3  no delivered_at
select public.t_place('a0000000-0000-0000-0000-000000000004', 6,     110);        -- A4  inside grace
select public.t_place('a0000000-0000-0000-0000-000000000005', 15,    110);        -- A5  exactly at grace
select public.t_place('a0000000-0000-0000-0000-000000000006', 16,    110);        -- A6  one minute past
select public.t_place('a0000000-0000-0000-0000-000000000007', 179,   110);        -- A7  inside the bound
select public.t_place('a0000000-0000-0000-0000-000000000008', 181,   110);        -- A8  past the bound
select public.t_place('a0000000-0000-0000-0000-000000000009', 20,   5000);        -- A9  the cap
select public.t_place('a0000000-0000-0000-0000-00000000000a', 20,    110);        -- A10 cancelled
select public.t_place('a0000000-0000-0000-0000-00000000000b', 20,    110);        -- A11 settings deleted
select public.t_place('a0000000-0000-0000-0000-00000000000c', 20,    110);        -- A12 already credited
select public.t_place('a0000000-0000-0000-0000-00000000000d', 20,    110);        -- A13 bound sabotage
select public.t_place('a0000000-0000-0000-0000-00000000000e', 20,      0);        -- A14 zero subtotal
select public.t_place('a0000000-0000-0000-0000-00000000000f', 180,   110);        -- A15 EXACTLY the bound
select public.t_place('a0000000-0000-0000-0000-000000000010', 4320,    0);        -- A16 stale flip, no money
select public.t_place('a0000000-0000-0000-0000-000000000011', 20,    110, false); -- A17 no delivered_at AND no eta_at

-- A17 needs the one row shape the earlier draft could not reach: delivered with
-- neither a delivery timestamp nor a promise. t_place always sets eta_at, so
-- clear it here rather than adding a parameter used exactly once.
update public.orders set eta_at = null
 where id = 'a0000000-0000-0000-0000-000000000011';

select public.t_flip('a0000000-0000-0000-0000-000000000001');
select public.t_flip('a0000000-0000-0000-0000-000000000002');
select public.t_flip('a0000000-0000-0000-0000-000000000003');
select public.t_flip('a0000000-0000-0000-0000-000000000004');
select public.t_flip('a0000000-0000-0000-0000-000000000005');
select public.t_flip('a0000000-0000-0000-0000-000000000006');
select public.t_flip('a0000000-0000-0000-0000-000000000007');
select public.t_flip('a0000000-0000-0000-0000-000000000008');
select public.t_flip('a0000000-0000-0000-0000-000000000009');
select public.t_flip('a0000000-0000-0000-0000-00000000000a', 'cancelled');
select public.t_flip('a0000000-0000-0000-0000-00000000000e');
select public.t_flip('a0000000-0000-0000-0000-00000000000f');
select public.t_flip('a0000000-0000-0000-0000-000000000010');
select public.t_flip('a0000000-0000-0000-0000-000000000011');

do $$
begin
  -- ==== THE PROMISE ====
  -- A1 identical to B1, byte for byte. This is the case the i18n strings
  -- describe and Consumer Protection Law 181/2018 makes enforceable.
  if public.t_credit('a0000000-0000-0000-0000-000000000001') is distinct from 11 then
    raise exception 'AFTER/A1: THE PUBLISHED PROMISE BROKE — a 20-min-late order must still credit 11, got %',
      coalesce(public.t_credit('a0000000-0000-0000-0000-000000000001')::text, 'nothing');
  end if;
  if (select note from public.credit_ledger
       where ref_order_id = 'a0000000-0000-0000-0000-000000000001' and reason = 'sla_late')
     is distinct from 'Auto late credit: 20 min late' then
    raise exception 'AFTER/A1: the ledger note changed; the wallet copy is customer-visible';
  end if;
  if public.t_alerts('a0000000-0000-0000-0000-000000000001') <> 0 then
    raise exception 'AFTER/A1: an ordinary late delivery must not page ops';
  end if;

  -- A5/A6 the grace boundary, exactly as before: strictly greater than 15.
  if public.t_credit('a0000000-0000-0000-0000-000000000005') is not null then
    raise exception 'AFTER/A5: exactly 15 minutes is not "late by 15+" under the strict >; must not credit';
  end if;
  if public.t_credit('a0000000-0000-0000-0000-000000000006') is distinct from 11 then
    raise exception 'AFTER/A6: 16 minutes late must credit 11, got %',
      coalesce(public.t_credit('a0000000-0000-0000-0000-000000000006')::text, 'nothing');
  end if;

  -- A4 grace still absorbs a small overrun.
  if public.t_credit('a0000000-0000-0000-0000-000000000004') is not null then
    raise exception 'AFTER/A4: 6 minutes is inside the grace and must not credit';
  end if;

  -- A7 a genuinely awful delivery — three hours late — still auto-credits. The
  -- bound is not a second grace period.
  if public.t_credit('a0000000-0000-0000-0000-000000000007') is distinct from 11 then
    raise exception 'AFTER/A7: 179 minutes is inside the bound and must still auto-credit, got %',
      coalesce(public.t_credit('a0000000-0000-0000-0000-000000000007')::text, 'nothing');
  end if;

  -- A9 the 100 EGP cap survives: 10% of 5000 is 500, capped to 100.
  if public.t_credit('a0000000-0000-0000-0000-000000000009') is distinct from 100 then
    raise exception 'AFTER/A9: the cap must hold at 100, got %',
      coalesce(public.t_credit('a0000000-0000-0000-0000-000000000009')::text, 'nothing');
  end if;

  -- A14 a zero-value credit is still not issued (the `v_credit > 0` guard).
  if public.t_credit('a0000000-0000-0000-0000-00000000000e') is not null then
    raise exception 'AFTER/A14: a 0 EGP credit must not be issued';
  end if;

  -- A15 EXACTLY the bound. Both comparisons are strict `>`, so the credit window
  -- is (15, 180] — open at the grace, CLOSED at the bound. The inclusive edge
  -- deliberately falls on the promise-preserving side: a customer exactly three
  -- hours late is paid, not reviewed. Asserted because "what happens at exactly
  -- the boundary" is the question a reader of this bound will always ask, and
  -- leaving it to be re-derived from two operators is how it drifts.
  if public.t_credit('a0000000-0000-0000-0000-00000000000f') is distinct from 11 then
    raise exception 'AFTER/A15: exactly 180 minutes is the inclusive edge and must still credit 11, got %',
      coalesce(public.t_credit('a0000000-0000-0000-0000-00000000000f')::text, 'nothing');
  end if;
  if public.t_alerts('a0000000-0000-0000-0000-00000000000f') <> 0 then
    raise exception 'AFTER/A15: a credit paid at the boundary must not also page ops';
  end if;

  -- A16 a stale flip on a zero-value order. Withheld, but SILENTLY: paging a
  -- human to tell them nobody would have been paid anything is alert noise, and
  -- an ops channel that cries wolf is one nobody reads. The bound test sits
  -- above the `v_credit > 0` test, so this needs its own `and v_credit > 0`.
  if public.t_credit('a0000000-0000-0000-0000-000000000010') is not null then
    raise exception 'AFTER/A16: a stale flip must not credit even at 0 EGP';
  end if;
  if public.t_alerts('a0000000-0000-0000-0000-000000000010') <> 0 then
    raise exception 'AFTER/A16: withholding EGP 0 must not page ops, got % alert(s)',
      public.t_alerts('a0000000-0000-0000-0000-000000000010');
  end if;

  -- A17 delivered with NO delivered_at AND no eta_at — the row shape an earlier
  -- draft could not reach, because the integrity check was nested inside
  -- `if new.eta_at is not null`. It produced no credit, no alert and no warning:
  -- a row asserting a delivery that has no evidence it happened, passing in
  -- silence. A missing promise is not an error; a missing delivery timestamp on
  -- a delivered row is.
  if public.t_credit('a0000000-0000-0000-0000-000000000011') is not null then
    raise exception 'AFTER/A17: no eta and no delivered_at cannot produce a credit';
  end if;
  if public.t_alerts('a0000000-0000-0000-0000-000000000011') <> 1 then
    raise exception 'AFTER/A17: a delivered row with no delivered_at must alert even when eta_at is NULL, got % alert(s)',
      public.t_alerts('a0000000-0000-0000-0000-000000000011');
  end if;

  -- ==== THE FIX ====
  -- A2 the stale-order flip. No money, and a named alert so a human decides.
  if public.t_credit('a0000000-0000-0000-0000-000000000002') is not null then
    raise exception 'AFTER/A2: a 3-day-old flip is not a late delivery and must not auto-credit (paid %)',
      public.t_credit('a0000000-0000-0000-0000-000000000002');
  end if;
  if public.t_alerts('a0000000-0000-0000-0000-000000000002') <> 1 then
    raise exception 'AFTER/A2: skipping silently is worse than the bug — expected exactly 1 ops_alert, got %',
      public.t_alerts('a0000000-0000-0000-0000-000000000002');
  end if;
  if not exists (
    select 1 from public.test_ops_alerts
     where txt like '%a0000000-0000-0000-0000-000000000002%'
       and txt like '%WITHHELD%'
       and txt like '%admin_issue_credit%'
       and txt like '%80000000-0000-0000-0000-000000000001%') then
    raise exception 'AFTER/A2: the alert must name the order, the customer and the paved compensation path';
  end if;
  -- Withholding a credit must NOT withhold the commission. Billing is a
  -- separate concern and 205 does not touch it.
  if not public.t_billed('a0000000-0000-0000-0000-000000000002') then
    raise exception 'AFTER/A2: the commission snapshot must still be written';
  end if;

  -- A8 one minute past the bound.
  if public.t_credit('a0000000-0000-0000-0000-000000000008') is not null then
    raise exception 'AFTER/A8: 181 minutes is past the 180-minute bound and must not auto-credit';
  end if;
  if public.t_alerts('a0000000-0000-0000-0000-000000000008') <> 1 then
    raise exception 'AFTER/A8: expected exactly 1 ops_alert for the withheld credit';
  end if;

  -- A3 no delivery timestamp, no claim — and still an alert, because a
  -- 'delivered' row with no delivered_at is a data-integrity event.
  if public.t_credit('a0000000-0000-0000-0000-000000000003') is not null then
    raise exception 'AFTER/A3: a NULL delivered_at must never be measured against the wall clock (paid %)',
      public.t_credit('a0000000-0000-0000-0000-000000000003');
  end if;
  if public.t_alerts('a0000000-0000-0000-0000-000000000003') <> 1 then
    raise exception 'AFTER/A3: a delivered order with no delivered_at must raise exactly 1 alert';
  end if;
  -- ...and billing still happens, because order_financials.delivered_at is NOT
  -- NULL and its coalesce was deliberately left in place.
  if not public.t_billed('a0000000-0000-0000-0000-000000000003') then
    raise exception 'AFTER/A3: removing the SLA coalesce must not create an UNBILLED ORDER';
  end if;

  -- A10 still not a delivery.
  if public.t_credit('a0000000-0000-0000-0000-00000000000a') is not null
     or public.t_billed('a0000000-0000-0000-0000-00000000000a')
     or public.t_alerts('a0000000-0000-0000-0000-00000000000a') <> 0 then
    raise exception 'AFTER/A10: a cancelled order must neither credit, bill, nor alert';
  end if;
end;
$$;

-- A11 (item 5) with the settings rows gone the promise now HOLDS at 15/10/100
-- instead of dying silently.
delete from public.platform_settings
 where key in ('sla_credit_grace_minutes','sla_credit_pct','sla_credit_max_egp','sla_credit_max_late_minutes');

select public.t_flip('a0000000-0000-0000-0000-00000000000b');

do $$
begin
  if public.t_credit('a0000000-0000-0000-0000-00000000000b') is distinct from 11 then
    raise exception 'AFTER/A11: a missing settings row must fall back to 15/10/100 and still credit 11, got %',
      coalesce(public.t_credit('a0000000-0000-0000-0000-00000000000b')::text, 'nothing');
  end if;
end;
$$;

insert into public.platform_settings (key, value) values
  ('sla_credit_grace_minutes', to_jsonb(15)),
  ('sla_credit_pct',           to_jsonb(10)),
  ('sla_credit_max_egp',       to_jsonb(100));

-- A13 the bound cannot be used to retire the promise. Setting it at or below
-- the grace would empty the credit window; the function refuses and uses 180.
insert into public.platform_settings (key, value)
values ('sla_credit_max_late_minutes', to_jsonb(5))
on conflict (key) do update set value = excluded.value;

select public.t_flip('a0000000-0000-0000-0000-00000000000d');

do $$
begin
  if public.t_credit('a0000000-0000-0000-0000-00000000000d') is distinct from 11 then
    raise exception 'AFTER/A13: a bound at or below the grace must be refused, not honoured — got %',
      coalesce(public.t_credit('a0000000-0000-0000-0000-00000000000d')::text, 'nothing');
  end if;
end;
$$;

update public.platform_settings set value = to_jsonb(180) where key = 'sla_credit_max_late_minutes';

-- A12 one credit per order. A human already compensated this delivery as
-- sla_late; the trigger must swallow the unique_violation and, critically, must
-- not abort the status transition or the billing.
insert into public.credit_ledger (user_id, delta_egp, reason, ref_order_id, note)
values ('80000000-0000-0000-0000-000000000001', 25, 'sla_late',
        'a0000000-0000-0000-0000-00000000000c', 'manual, pre-existing');

select public.t_flip('a0000000-0000-0000-0000-00000000000c');

do $$
begin
  if (select count(*) from public.credit_ledger
       where ref_order_id = 'a0000000-0000-0000-0000-00000000000c' and reason = 'sla_late') <> 1 then
    raise exception 'AFTER/A12: exactly one sla_late credit per order';
  end if;
  if public.t_credit('a0000000-0000-0000-0000-00000000000c') is distinct from 25 then
    raise exception 'AFTER/A12: the pre-existing credit must be left alone';
  end if;
  if (select status from public.orders where id = 'a0000000-0000-0000-0000-00000000000c')
     is distinct from 'delivered' then
    raise exception 'AFTER/A12: a swallowed unique_violation must not strand the delivery';
  end if;
  if not public.t_billed('a0000000-0000-0000-0000-00000000000c') then
    raise exception 'AFTER/A12: a swallowed unique_violation must not lose the commission';
  end if;
end;
$$;

-- Re-delivering an already-delivered order is a no-op: no second credit, no
-- second bill. (The fail-closed rewrite of the entry guard must not have
-- changed this.)
select public.t_flip('a0000000-0000-0000-0000-000000000001');

do $$
begin
  if (select count(*) from public.credit_ledger
       where ref_order_id = 'a0000000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'AFTER: re-flipping a delivered order must not credit twice';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The lifetime shape, restated as an assertion. Across the fourteen AFTER
-- orders the only credits paid are the six that describe a real late delivery;
-- the two bookkeeping events pay nothing and page a human instead.
-- ---------------------------------------------------------------------------
do $$
declare v_paid int; v_alerts int;
begin
  select coalesce(sum(delta_egp), 0) into v_paid
    from public.credit_ledger
   where reason = 'sla_late' and ref_order_id::text like 'a0000000%'
     and note is distinct from 'manual, pre-existing';
  -- A1 11 + A6 11 + A7 11 + A9 100 + A11 11 + A13 11 + A15 11 = 166
  if v_paid <> 166 then
    raise exception 'AFTER: expected 166 EGP paid on genuine late deliveries, got %', v_paid;
  end if;

  select count(*) into v_alerts from public.test_ops_alerts;
  -- A2 withheld + A8 withheld + A3 null timestamp + A17 null timestamp, no eta = 4.
  -- A16 (stale flip worth EGP 0) deliberately contributes NOTHING: it is withheld
  -- without paging anyone, because there is no money to review.
  if v_alerts <> 4 then
    raise exception 'AFTER: expected exactly 4 ops alerts (2 withheld + 2 null timestamp), got %', v_alerts;
  end if;
end;
$$;

rollback;
