-- 107 — capture the Paymob TRANSACTION id + a refunds audit, for the card refund path
-- (P0 #4 from the 2026-07-11 gap analysis).
--
-- BACKGROUND: the webhook stores orders.paymob_order_ref = the Paymob ORDER id, but
-- Paymob's refund API (POST /acceptance/void_refund/refund) refunds a TRANSACTION id.
-- Add orders.paymob_txn_id (the signed obj.id from the webhook) so a refund can target
-- the exact captured transaction. Also add a small order_refunds audit table so every
-- refund attempt is recorded (who, how much, provider response) — refunds move money
-- and must be traceable.
-- Non-destructive: new nullable column + new table + RLS. The webhook is redeployed
-- separately to populate paymob_txn_id going forward (see supabase/functions/paymob-webhook).

alter table public.orders
  add column if not exists paymob_txn_id text;   -- Paymob transaction id (obj.id), for refunds

comment on column public.orders.paymob_txn_id is
  'Paymob transaction id (signed obj.id from the webhook). Target for the refund API. Distinct from paymob_order_ref (the Paymob order id).';

-- ============================================================================
-- order_refunds — one row per refund attempt (audit + idempotency signal).
-- ============================================================================
create table if not exists public.order_refunds (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders(id) on delete cascade,
  amount_egp    int  not null check (amount_egp > 0),
  reason        text,
  status        text not null default 'requested'
                  check (status in ('requested','succeeded','failed')),
  provider_ref  text,                 -- Paymob refund transaction id, on success
  provider_detail jsonb,              -- raw provider response for debugging
  actor_id      uuid,                 -- admin who issued it
  created_at    timestamptz not null default now()
);
create index if not exists order_refunds_order_idx on public.order_refunds (order_id, created_at desc);

comment on table public.order_refunds is
  'Audit of card refund attempts. Written by the paymob-refund edge function (service role). Admins read; no client writes.';

alter table public.order_refunds enable row level security;
-- Admins read; the refunding customer reads their own order's refunds. No client writes.
create policy order_refunds_select on public.order_refunds
  for select using (
    (select public.auth_role()) = 'admin'
    or exists (select 1 from public.orders o
                where o.id = order_refunds.order_id and o.user_id = (select auth.uid()))
  );
