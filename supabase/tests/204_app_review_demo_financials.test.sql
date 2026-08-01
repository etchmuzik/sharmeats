\set ON_ERROR_STOP on

begin;

-- ============================================================================
-- Harness for migration 204 (App Review demo financials backfill).
--
-- Reproduces the production shape the migration asserts against: exactly the
-- 3 demo orders delivered-without-financials, one delivered CONTROL order that
-- already has its row, one cancelled sibling, a founding-rate (12%) demo
-- restaurant, and empty settlements.
--
-- Negative controls replay the REAL migration file against mutated state in a
-- savepoint and require it to REFUSE. Detection: with ON_ERROR_STOP off, a
-- failed \ir leaves the transaction aborted, so the \gset sentinel that
-- follows cannot run and its variable stays unset — \if then decides.
-- ============================================================================

create table public.restaurants (
  id uuid primary key,
  commission_pct numeric(5,2)
);

create table public.orders (
  id uuid primary key,
  restaurant_id uuid references public.restaurants(id),
  status text not null,
  subtotal_egp int,
  discount_egp int default 0,
  delivery_fee_egp int default 0,
  payment_method text,
  commission_pct_snapshot numeric(5,2),
  delivered_at timestamptz
);

create table public.order_financials (
  order_id uuid primary key references public.orders(id),
  restaurant_id uuid not null,
  subtotal_egp int not null check (subtotal_egp >= 0),
  commission_pct numeric(5,2) not null check (commission_pct >= 0),
  commission_egp int not null check (commission_egp >= 0),
  delivery_fee_egp int not null default 0,
  payment_method text not null,
  delivered_at timestamptz not null,
  created_at timestamptz not null default now(),
  commission_vat_egp int not null default 0,
  discount_egp int not null default 0
);

create table public.order_financials_failures (
  order_id uuid, resolved_at timestamptz
);

create table public.restaurant_settlements (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid, status text,
  period_start date, period_end date
);

create table public.platform_settings (key text primary key, value jsonb);
insert into public.platform_settings values ('commission_vat_pct', '0'::jsonb);

insert into public.restaurants values ('52a853e8-df6c-4eab-89dc-0969da8184dc', 12.00);

insert into public.orders (id, restaurant_id, status, subtotal_egp, delivery_fee_egp, payment_method, delivered_at) values
  ('000fee3b-a115-4e86-bfc9-43391d5f9958', '52a853e8-df6c-4eab-89dc-0969da8184dc', 'delivered', 420, 25, 'cash_on_delivery', '2026-07-19 23:53:18+00'),
  ('78ef11d0-ed03-40a3-94f2-3911badbba95', '52a853e8-df6c-4eab-89dc-0969da8184dc', 'delivered', 320, 25, 'cash_on_delivery', '2026-07-20 23:53:18+00'),
  ('1227b4cb-4b8f-4bc1-843d-69f04391905a', '52a853e8-df6c-4eab-89dc-0969da8184dc', 'delivered', 225, 25, 'cash_on_delivery', '2026-07-21 18:53:18+00');

insert into public.orders (id, restaurant_id, status, subtotal_egp, payment_method, commission_pct_snapshot, delivered_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '52a853e8-df6c-4eab-89dc-0969da8184dc', 'delivered', 1000, 'cash_on_delivery', 15.00, '2026-07-25 12:00:00+00'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '52a853e8-df6c-4eab-89dc-0969da8184dc', 'cancelled', 500, 'cash_on_delivery', null, null);
insert into public.order_financials (order_id, restaurant_id, subtotal_egp, commission_pct, commission_egp, payment_method, delivered_at)
  values ('aaaaaaaa-0000-0000-0000-000000000001', '52a853e8-df6c-4eab-89dc-0969da8184dc', 1000, 15.00, 150, 'cash_on_delivery', '2026-07-25 12:00:00+00');

-- ---------------------------------------------------------------------------
-- NEGATIVE CONTROL 1: a 4th delivered-without-financials order → must refuse.
-- ---------------------------------------------------------------------------
savepoint neg1;
insert into public.orders (id, restaurant_id, status, subtotal_egp, payment_method, delivered_at)
  values ('bbbbbbbb-0000-0000-0000-000000000001', '52a853e8-df6c-4eab-89dc-0969da8184dc', 'delivered', 99, 'cash_on_delivery', now());
\set ON_ERROR_STOP off
\ir ../migrations/204_backfill_app_review_demo_financials.sql
select true as neg1_ran_clean \gset
\set ON_ERROR_STOP on
rollback to savepoint neg1;
\if :{?neg1_ran_clean}
  do $$ begin raise exception 'NEGATIVE CONTROL 1 FAILED: migration accepted an unexpected 4th unbilled order'; end $$;
\else
  \echo PASS neg1: migration refused an unexpected unbilled-order population
\endif

-- ---------------------------------------------------------------------------
-- NEGATIVE CONTROL 2: an overlapping PAID settlement → must refuse.
-- ---------------------------------------------------------------------------
savepoint neg2;
insert into public.restaurant_settlements (restaurant_id, status, period_start, period_end)
  values ('99999999-0000-0000-0000-000000000009', 'paid', date '2026-07-13', date '2026-07-19');
\set ON_ERROR_STOP off
\ir ../migrations/204_backfill_app_review_demo_financials.sql
select true as neg2_ran_clean \gset
\set ON_ERROR_STOP on
rollback to savepoint neg2;
\if :{?neg2_ran_clean}
  do $$ begin raise exception 'NEGATIVE CONTROL 2 FAILED: migration ran despite an overlapping paid settlement'; end $$;
\else
  \echo PASS neg2: migration refused with an overlapping paid settlement
\endif

-- ---------------------------------------------------------------------------
-- THE REAL RUN.
-- ---------------------------------------------------------------------------
\ir ../migrations/204_backfill_app_review_demo_financials.sql

do $$
declare v_n int; v_sum int;
begin
  select count(*), sum(commission_egp) into v_n, v_sum
    from public.order_financials
   where order_id in ('000fee3b-a115-4e86-bfc9-43391d5f9958',
                      '78ef11d0-ed03-40a3-94f2-3911badbba95',
                      '1227b4cb-4b8f-4bc1-843d-69f04391905a');
  if v_n <> 3 then raise exception 'expected 3 backfilled rows, got %', v_n; end if;
  if v_sum <> 115 then raise exception 'expected total commission 115 (50+38+27), got %', v_sum; end if;
  raise notice 'PASS: 3 rows backfilled, commission totals 115 EGP at 12%%';

  if (select commission_egp from public.order_financials
       where order_id = 'aaaaaaaa-0000-0000-0000-000000000001') <> 150 then
    raise exception 'control row was modified';
  end if;
  if exists (select 1 from public.order_financials
              where order_id = 'aaaaaaaa-0000-0000-0000-000000000002') then
    raise exception 'cancelled order gained a financials row';
  end if;
  raise notice 'PASS: control rows untouched';
end $$;

-- ---------------------------------------------------------------------------
-- REPLAY: a one-shot data fix must refuse a second run (population is now
-- empty, which no longer matches the expected 3) — proving double-insert is
-- structurally impossible.
-- ---------------------------------------------------------------------------
savepoint replay;
\set ON_ERROR_STOP off
\ir ../migrations/204_backfill_app_review_demo_financials.sql
select true as replay_ran_clean \gset
\set ON_ERROR_STOP on
rollback to savepoint replay;
\if :{?replay_ran_clean}
  do $$ begin raise exception 'REPLAY CHECK FAILED: one-shot migration ran twice'; end $$;
\else
  \echo PASS replay: migration refuses a second run
\endif

rollback;
select 'migration 204 test finished' as done;
