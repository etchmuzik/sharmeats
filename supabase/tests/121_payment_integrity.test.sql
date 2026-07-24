\set ON_ERROR_STOP on

begin;

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
create function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), ''),
    '{}'
  )::jsonb
$$;

create table public.users (
  id uuid primary key
);

create table public.orders (
  id uuid primary key,
  user_id uuid not null references public.users(id),
  total_egp int not null,
  payment_method text not null,
  payment_status text not null,
  paymob_order_ref text,
  paymob_txn_id text
);

create table public.order_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  amount_egp int not null check (amount_egp > 0),
  reason text,
  status text not null default 'requested'
    check (status in ('requested', 'succeeded', 'failed')),
  provider_ref text,
  provider_detail jsonb,
  actor_id uuid,
  created_at timestamptz not null default now()
);

\ir ../migrations/121_payment_integrity.sql

insert into public.users (id)
values
  ('10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002');

insert into public.orders (
  id, user_id, total_egp, payment_method, payment_status
)
values
  (
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    250,
    'card',
    'pending'
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000002',
    250,
    'card',
    'pending'
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000001',
    300,
    'card',
    'paid'
  );

insert into public.payment_attempts (
  id,
  order_id,
  user_id,
  status,
  amount_egp,
  integration_id,
  provider_order_id
)
values
  (
    '30000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'ready',
    250,
    'integration-live',
    'provider-order-1'
  ),
  (
    '30000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000002',
    'ready',
    250,
    'integration-live',
    'provider-order-2'
  );

select set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);

do $$
declare
  result jsonb;
begin
  result := public.settle_paymob_payment(
    'provider-order-1',
    'provider-txn-1',
    25000,
    'integration-live'
  );
  if result->>'transitioned' <> 'true' then
    raise exception 'first payment settlement did not transition';
  end if;

  result := public.settle_paymob_payment(
    'provider-order-1',
    'provider-txn-1',
    25000,
    'integration-live'
  );
  if result->>'transitioned' <> 'false' then
    raise exception 'payment replay was not idempotent';
  end if;

  if not exists (
    select 1
      from public.orders
     where id = '20000000-0000-0000-0000-000000000001'
       and payment_status = 'paid'
       and paymob_order_ref = 'provider-order-1'
       and paymob_txn_id = 'provider-txn-1'
  ) then
    raise exception 'settled order state is incorrect';
  end if;
end;
$$;

do $$
begin
  perform public.settle_paymob_payment(
    'provider-order-2',
    'provider-txn-2',
    24999,
    'integration-live'
  );
  raise exception 'amount mismatch was accepted';
exception
  when check_violation then
    if sqlerrm <> 'PAYMENT_AMOUNT_MISMATCH' then
      raise;
    end if;
end;
$$;

do $$
begin
  perform public.settle_paymob_payment(
    'provider-order-2',
    'provider-txn-1',
    25000,
    'integration-live'
  );
  raise exception 'one provider transaction settled two orders';
exception
  when unique_violation then
    null;
end;
$$;

insert into public.order_refunds (
  id, order_id, amount_egp, reason, status
)
values (
  '40000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003',
  300,
  'test refund',
  'requested'
);

do $$
declare
  refunded_order_id uuid;
begin
  refunded_order_id := public.finalize_full_card_refund(
    '40000000-0000-0000-0000-000000000001',
    'provider-refund-1',
    '{"ok":true}'::jsonb
  );
  if refunded_order_id <> '20000000-0000-0000-0000-000000000003' then
    raise exception 'refund returned the wrong order';
  end if;
  if not exists (
    select 1
      from public.orders
     where id = refunded_order_id
       and payment_status = 'refunded'
  ) then
    raise exception 'refund did not update the order atomically';
  end if;
end;
$$;

do $$
begin
  perform public.finalize_full_card_refund(
    '40000000-0000-0000-0000-000000000001',
    'different-provider-refund',
    '{"ok":true}'::jsonb
  );
  raise exception 'refund replay with a different provider reference was accepted';
exception
  when unique_violation then
    if sqlerrm <> 'REFUND_PROVIDER_REFERENCE_MISMATCH' then
      raise;
    end if;
end;
$$;

select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"10000000-0000-0000-0000-000000000001"}',
  true
);

do $$
begin
  perform public.settle_paymob_payment(
    'provider-order-1',
    'provider-txn-1',
    25000,
    'integration-live'
  );
  raise exception 'authenticated client called service-only settlement';
exception
  when check_violation then
    if sqlerrm <> 'NOT_AUTHORIZED' then
      raise;
    end if;
end;
$$;

rollback;

\echo '121_payment_integrity.test.sql: PASS'
