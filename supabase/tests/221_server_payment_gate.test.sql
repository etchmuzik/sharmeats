\set ON_ERROR_STOP on

-- The checkout client and public RPC are not the only writers worth guarding.
-- This fixture deliberately grants a client role direct writes, so the test
-- proves the database rejects non-COD orders at the final persistence boundary.
begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end;
$$;

create table public.orders (
  id uuid primary key,
  payment_method text not null
);

-- Legacy paid/card data stays readable and is not rewritten by a launch gate.
insert into public.orders (id, payment_method)
values ('22100000-0000-0000-0000-000000000001', 'card');

grant usage on schema public to authenticated;
grant insert, update, select (id) on public.orders to authenticated;

\ir ../migrations/221_enforce_server_payment_gate.sql

create function pg_temp.assert_payment_rejected(p_sql text)
returns void
language plpgsql
as $$
begin
  begin
    execute p_sql;
    raise exception 'expected non-COD write to be rejected';
  exception when check_violation then
    if sqlerrm <> 'CARD_PAYMENTS_DISABLED' then
      raise exception 'expected CARD_PAYMENTS_DISABLED, got %', sqlerrm;
    end if;
  end;
end;
$$;

-- Exercise the trigger as the deliberately over-privileged client role, not
-- the fixture owner. This proves the final write boundary remains authoritative
-- if a future table grant or policy regresses.
set local role authenticated;

-- COD writes remain available to the order-placement authority.
insert into public.orders (id, payment_method)
values ('22100000-0000-0000-0000-000000000002', 'cash_on_delivery');

select pg_temp.assert_payment_rejected($sql$
  insert into public.orders (id, payment_method)
  values ('22100000-0000-0000-0000-000000000003', 'card')
$sql$);
select pg_temp.assert_payment_rejected($sql$
  insert into public.orders (id, payment_method)
  values ('22100000-0000-0000-0000-000000000004', 'fawry')
$sql$);
select pg_temp.assert_payment_rejected($sql$
  update public.orders
  set payment_method = 'card'
  where id = '22100000-0000-0000-0000-000000000002'
$sql$);

reset role;

do $$
begin
  if (select payment_method from public.orders where id = '22100000-0000-0000-0000-000000000001') <> 'card' then
    raise exception 'legacy card order was unexpectedly changed';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.orders'::regclass
      and tgname = 'orders_reject_non_cod_payment_trg'
      and not tgisinternal
  ) then
    raise exception 'cash-only order trigger is missing';
  end if;
  if has_function_privilege('public', 'public.orders_reject_non_cod_payment()', 'EXECUTE')
    or has_function_privilege('anon', 'public.orders_reject_non_cod_payment()', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.orders_reject_non_cod_payment()', 'EXECUTE')
    or has_function_privilege('service_role', 'public.orders_reject_non_cod_payment()', 'EXECUTE') then
    raise exception 'cash-only trigger function is callable by a client role';
  end if;
end;
$$;

rollback;
