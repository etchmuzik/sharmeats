-- 121_payment_integrity.sql
--
-- Card payments are still disabled in production. This migration makes the
-- future Paymob flow safe before the flag is enabled:
--   * one active hosted-checkout attempt per order;
--   * signed Paymob order ids are persisted and unique;
--   * transaction ids are unique;
--   * full refunds are claimed once and finalized atomically.

-- ---------------------------------------------------------------------------
-- Payment attempts: private service-role state used to bind the signed Paymob
-- webhook order.id to exactly one Sharm Eats order.
-- ---------------------------------------------------------------------------
create table if not exists public.payment_attempts (
  id                    uuid primary key default gen_random_uuid(),
  order_id              uuid not null references public.orders(id) on delete cascade,
  user_id               uuid not null references public.users(id) on delete cascade,
  status                text not null default 'creating'
                          check (status in ('creating', 'ready', 'paid', 'failed', 'expired')),
  amount_egp            int not null check (amount_egp > 0),
  integration_id        text not null,
  provider_intention_id text,
  provider_order_id     text,
  provider_txn_id       text,
  client_secret         text,
  checkout_url          text,
  last_error            text,
  expires_at            timestamptz not null default (now() + interval '30 minutes'),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index if not exists payment_attempts_one_active_per_order
  on public.payment_attempts (order_id)
  where status in ('creating', 'ready');

create unique index if not exists payment_attempts_provider_order_uniq
  on public.payment_attempts (provider_order_id)
  where provider_order_id is not null;

create unique index if not exists payment_attempts_provider_txn_uniq
  on public.payment_attempts (provider_txn_id)
  where provider_txn_id is not null;

create index if not exists payment_attempts_order_created_idx
  on public.payment_attempts (order_id, created_at desc);

alter table public.payment_attempts enable row level security;
revoke all on table public.payment_attempts from public, anon, authenticated;
grant select, insert, update, delete on table public.payment_attempts to service_role;

comment on table public.payment_attempts is
  'Private Paymob checkout state. provider_order_id is the HMAC-covered webhook order.id and is the only key permitted to bind a callback to a Sharm Eats order.';

-- The signed transaction id may settle only one order.
create unique index if not exists orders_paymob_txn_id_uniq
  on public.orders (paymob_txn_id)
  where paymob_txn_id is not null;

-- ---------------------------------------------------------------------------
-- Refund idempotency: only one requested/succeeded full refund can exist for an
-- order. A request left in "requested" after an unknown provider outcome blocks
-- automatic retries and requires reconciliation, which is safer than a double
-- refund.
-- ---------------------------------------------------------------------------
alter table public.order_refunds
  add column if not exists updated_at timestamptz not null default now();

-- Provider responses may contain operational details that customers should not
-- receive through PostgREST. Keep only the non-sensitive audit summary readable.
revoke all on table public.order_refunds from anon, authenticated;
grant select (id, order_id, amount_egp, reason, status, created_at, updated_at)
  on table public.order_refunds to authenticated;
grant select, insert, update, delete on table public.order_refunds to service_role;

create unique index if not exists order_refunds_one_active_or_succeeded
  on public.order_refunds (order_id)
  where status in ('requested', 'succeeded');

create unique index if not exists order_refunds_provider_ref_uniq
  on public.order_refunds (provider_ref)
  where provider_ref is not null and provider_ref <> '';

create or replace function public.finalize_full_card_refund(
  p_refund_id uuid,
  p_provider_ref text,
  p_provider_detail jsonb default null
)
returns uuid
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_refund public.order_refunds;
  v_order public.orders;
begin
  if coalesce((select auth.jwt()->>'role'), '') <> 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  if nullif(btrim(coalesce(p_provider_ref, '')), '') is null then
    raise exception 'PROVIDER_REF_REQUIRED' using errcode = 'check_violation';
  end if;

  select *
    into v_refund
    from public.order_refunds
   where id = p_refund_id
   for update;
  if not found then
    raise exception 'REFUND_NOT_FOUND' using errcode = 'check_violation';
  end if;
  if v_refund.status = 'succeeded' then
    if v_refund.provider_ref is distinct from btrim(p_provider_ref) then
      raise exception 'REFUND_PROVIDER_REFERENCE_MISMATCH'
        using errcode = 'unique_violation';
    end if;
    return v_refund.order_id;
  end if;
  if v_refund.status <> 'requested' then
    raise exception 'REFUND_NOT_REQUESTED' using errcode = 'check_violation';
  end if;

  select *
    into v_order
    from public.orders
   where id = v_refund.order_id
   for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'check_violation';
  end if;
  if v_order.payment_method <> 'card' or v_order.payment_status <> 'paid' then
    raise exception 'ORDER_NOT_REFUNDABLE' using errcode = 'check_violation';
  end if;
  if v_refund.amount_egp <> v_order.total_egp then
    raise exception 'FULL_REFUNDS_ONLY' using errcode = 'check_violation';
  end if;

  update public.order_refunds
     set status = 'succeeded',
         provider_ref = btrim(p_provider_ref),
         provider_detail = p_provider_detail,
         updated_at = now()
   where id = v_refund.id;

  update public.orders
     set payment_status = 'refunded'
   where id = v_order.id;

  return v_order.id;
end;
$$;

revoke all on function public.finalize_full_card_refund(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.finalize_full_card_refund(uuid, text, jsonb)
  to service_role;

comment on function public.finalize_full_card_refund is
  'SERVICE ROLE: atomically records a successful full Paymob refund and transitions the paid card order to refunded. Concurrent/partial refunds are rejected by row locks and constraints.';

-- ---------------------------------------------------------------------------
-- Money settlement is a single database transaction. The HMAC-covered Paymob
-- order id is the lookup key; no client-controlled order reference participates.
-- ---------------------------------------------------------------------------
create or replace function public.settle_paymob_payment(
  p_provider_order_id text,
  p_provider_txn_id text,
  p_amount_cents int,
  p_integration_id text
)
returns jsonb
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_attempt public.payment_attempts;
  v_order public.orders;
  v_transitioned boolean := false;
begin
  if coalesce((select auth.jwt()->>'role'), '') <> 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  if nullif(btrim(coalesce(p_provider_order_id, '')), '') is null
     or nullif(btrim(coalesce(p_provider_txn_id, '')), '') is null then
    raise exception 'PROVIDER_REFERENCE_REQUIRED' using errcode = 'check_violation';
  end if;

  select *
    into v_attempt
    from public.payment_attempts
   where provider_order_id = btrim(p_provider_order_id)
   for update;
  if not found then
    raise exception 'PAYMENT_ATTEMPT_NOT_FOUND' using errcode = 'check_violation';
  end if;
  if v_attempt.integration_id <> btrim(coalesce(p_integration_id, '')) then
    raise exception 'PAYMENT_INTEGRATION_MISMATCH' using errcode = 'check_violation';
  end if;
  if p_amount_cents is null
     or p_amount_cents <= 0
     or p_amount_cents <> v_attempt.amount_egp * 100 then
    raise exception 'PAYMENT_AMOUNT_MISMATCH' using errcode = 'check_violation';
  end if;

  select *
    into v_order
    from public.orders
   where id = v_attempt.order_id
   for update;
  if not found then
    raise exception 'PAYMENT_ORDER_NOT_FOUND' using errcode = 'check_violation';
  end if;
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
           paymob_order_ref = btrim(p_provider_order_id),
           paymob_txn_id = btrim(p_provider_txn_id)
     where id = v_order.id;
    v_transitioned := true;
  else
    raise exception 'ORDER_NOT_PAYABLE' using errcode = 'check_violation';
  end if;

  update public.payment_attempts
     set status = 'paid',
         provider_txn_id = btrim(p_provider_txn_id),
         last_error = null,
         updated_at = now()
   where id = v_attempt.id;

  return jsonb_build_object(
    'orderId', v_order.id,
    'userId', v_order.user_id,
    'transitioned', v_transitioned
  );
end;
$$;

revoke all on function public.settle_paymob_payment(text, text, int, text)
  from public, anon, authenticated;
grant execute on function public.settle_paymob_payment(text, text, int, text)
  to service_role;

comment on function public.settle_paymob_payment(text, text, int, text) is
  'SERVICE ROLE: atomically binds an HMAC-signed Paymob transaction to its private payment attempt and settles exactly one card order.';
