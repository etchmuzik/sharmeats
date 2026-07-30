-- 180_payment_integrity_reapply.sql
--
-- Package 04 — lands the payment-integrity work that migration 121 was supposed to
-- deliver and never did.
--
-- ================= WHY THIS MIGRATION EXISTS =================
-- The ledger runs 110..119 and then jumps to 122. Mig 121 is ABSENT — not applied and
-- later reverted, simply never applied. Everything in it is missing from production:
--
--   * public.payment_attempts                        (table)
--   * public.settle_paymob_payment(...)              (card settlement)
--   * public.finalize_full_card_refund(...)          (refund finalisation)
--   * orders_paymob_txn_id_uniq                      (one settlement per txn)
--   * order_refunds_one_active_or_succeeded          (duplicate-refund guard)
--   * order_refunds.updated_at
--
-- Two edge functions call the missing RPCs by name:
--   supabase/functions/paymob-webhook/index.ts:145 -> settle_paymob_payment
--   supabase/functions/paymob-refund/index.ts:224  -> finalize_full_card_refund
-- Card is feature-gated off (EXPO_PUBLIC_PAYMENTS_CARD_ENABLED=false), so nothing is
-- broken for customers today — but the card rail CANNOT work until this lands, and
-- Package 04 Slice B's evidence gate is unreachable without it.
--
-- ================= WHY A NEW NUMBER RATHER THAN APPLYING 121 =================
-- House rule 2: never re-run a months-old body unreviewed. 121 was written 58
-- migrations ago, before the grant and role-check rules this database now enforces.
-- It was audited line by line against current production first; the audit's findings
-- are recorded below so the reasoning survives.
--
-- 121 stays on disk untouched as the historical artefact. This migration carries its
-- intent with the corrections, and the ledger will record 121 as superseded rather
-- than leaving a permanent unexplained gap.
--
-- ================= AUDIT RESULT: LOGIC UNCHANGED =================
-- Every assumption 121 makes still holds, verified against production:
--   * orders.payment_method is text and holds 'card' for card orders. NOTE: `orders`
--     also has payment_method_kind (an enum, vocabulary 'card'/'cash'), and the two
--     DISAGREE for cash ('cash_on_delivery' vs 'cash'). This looked like a bug in 121
--     and is not: place_order takes `payment_method text` constrained to
--     ('card','cash_on_delivery'), stores it verbatim, and DERIVES the enum from it.
--     The text column is the authoritative input, so `payment_method <> 'card'` is
--     correct and is kept verbatim;
--   * payment_status vocabulary is exactly pending/paid/failed/refunded;
--   * total_egp is integer EGP, so total_egp * 100 = amount_cents holds;
--   * the role checks are already fail-closed (coalesce(..., '') <> 'service_role'),
--     satisfying house rule 4 — deliberately NOT "improved".
--
-- Nothing superseded 121: production has zero paymob/card-payment functions (the
-- settle* functions that exist are merchant and driver PAYOUT sweeps), no
-- paymob_txn_id index, and neither refund guard.
--
-- ================= WHAT IS CORRECTED =================
-- Three grant-hygiene fixes, no logic changes:
--   1. revoke from `public` as well as anon/authenticated. On this database
--      ALTER DEFAULT PRIVILEGES grants arwdDxtm on new tables, and a PUBLIC grant
--      SURVIVES a role-specific revoke — mig 121 revoked only the two roles.
--   2. TRUNCATE explicitly included, because TRUNCATE IGNORES RLS: "RLS on with a
--      SELECT policy" would not stop an anon-key holder emptying the refund history.
--   3. order_refunds' column-level grant (excluding provider_detail and actor_id from
--      client reads) is 121's own good idea and is kept — a provider payload can
--      carry operational detail a customer should not receive through PostgREST.
--
-- Note on the CURRENT exposure, so it is not overstated: order_refunds today has
-- table-level SELECT/INSERT/UPDATE/DELETE granted to anon and authenticated, but only
-- ONE policy (SELECT, admin-or-own-order) and none for writes. RLS therefore denies
-- the writes — verified by attempting a forged INSERT as a random authenticated user
-- and having it rejected, with TRUNCATE not granted. This was a capability gap, not a
-- live vulnerability. The revokes below close the gap properly rather than relying on
-- the absence of a policy to hold forever.

-- ---------------------------------------------------------------------------
-- 1. Payment attempts — private service-role state
-- ---------------------------------------------------------------------------
-- Binds the HMAC-covered Paymob webhook order.id to exactly one Sharm Eats order.
-- That binding is the whole security property: without it a callback would have to be
-- matched on a client-controlled reference, which is forgeable.
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

-- One live checkout per order: a second concurrent attempt would let two provider
-- callbacks each believe they own the order.
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

-- CORRECTION 1 + 2 vs mig 121: `public` included (a PUBLIC grant survives a
-- role-specific revoke), and TRUNCATE is therefore covered too — it ignores RLS.
revoke all on table public.payment_attempts from public, anon, authenticated;
grant select, insert, update, delete on table public.payment_attempts to service_role;

comment on table public.payment_attempts is
  'Private Paymob checkout state. provider_order_id is the HMAC-covered webhook order.id and is the ONLY key permitted to bind a callback to a Sharm Eats order — matching on a client-controlled reference would be forgeable. No client grant of any kind. Mig 180 (delivering mig 121, which was never applied).';

-- A signed transaction id may settle only one order.
create unique index if not exists orders_paymob_txn_id_uniq
  on public.orders (paymob_txn_id)
  where paymob_txn_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Refund idempotency
-- ---------------------------------------------------------------------------
alter table public.order_refunds
  add column if not exists updated_at timestamptz not null default now();

-- CORRECTION 1 + 2 again: mig 121 revoked from anon/authenticated only.
revoke all on table public.order_refunds from public, anon, authenticated;

-- CORRECTION 3 (keeping 121's intent): a provider response can carry operational
-- detail a customer should not receive through PostgREST, so provider_detail and
-- actor_id are deliberately EXCLUDED from the client-readable column list.
grant select (id, order_id, amount_egp, reason, status, created_at, updated_at)
  on table public.order_refunds to authenticated;
grant select, insert, update, delete on table public.order_refunds to service_role;

-- THE DUPLICATE-REFUND GUARD. Only one requested-or-succeeded refund per order. A
-- request left in 'requested' after an unknown provider outcome deliberately BLOCKS
-- automatic retries and forces reconciliation — a stuck refund is safer than a double
-- refund, because one is an operational task and the other is lost money.
create unique index if not exists order_refunds_one_active_or_succeeded
  on public.order_refunds (order_id)
  where status in ('requested', 'succeeded');

create unique index if not exists order_refunds_provider_ref_uniq
  on public.order_refunds (provider_ref)
  where provider_ref is not null and provider_ref <> '';

-- ---------------------------------------------------------------------------
-- 3. Refund finalisation
-- ---------------------------------------------------------------------------
-- Body preserved from mig 121 verbatim: the audit found no assumption that has
-- changed, and rewriting a money-handling function to "tidy" it is how hardening gets
-- lost. Only the grants around it are corrected.
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
  -- Already fail-closed: an absent role coalesces to '' and is refused.
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
  -- IDEMPOTENT on replay: the same provider reference returns quietly, a DIFFERENT
  -- one raises. A provider retry must not be mistaken for a second refund.
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

comment on function public.finalize_full_card_refund(uuid, text, jsonb) is
  'SERVICE ROLE ONLY: atomically records a successful full Paymob refund and moves the paid card order to refunded. Idempotent on a provider retry (same provider_ref returns quietly, a different one raises). Concurrent and partial refunds are refused by row locks plus order_refunds_one_active_or_succeeded. Body preserved verbatim from the never-applied mig 121 — rewriting a money-handling function to tidy it is how hardening gets lost. Mig 180.';

-- ---------------------------------------------------------------------------
-- 4. Card settlement
-- ---------------------------------------------------------------------------
-- Money settlement is ONE database transaction, keyed on the HMAC-covered Paymob
-- order id. No client-controlled reference participates in the lookup.
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
  -- The amount is checked against the ATTEMPT and again against the ORDER below.
  -- Both, deliberately: a provider that reports a different amount than we asked for
  -- must not settle, and neither must an attempt that drifted from its order.
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
    -- A DUPLICATE WEBHOOK for the same transaction is a no-op; a DIFFERENT
    -- transaction claiming an already-paid order is an incident and raises.
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
  'SERVICE ROLE ONLY: atomically binds an HMAC-signed Paymob transaction to its private payment attempt and settles exactly one card order. The lookup key is the HMAC-covered provider order id — no client-controlled reference participates. A duplicate webhook for the same txn is a no-op; a different txn claiming a paid order raises. Amount is verified against BOTH the attempt and the order. Body preserved verbatim from the never-applied mig 121. Mig 180.';
