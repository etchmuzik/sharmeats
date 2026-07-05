-- 087_f1_revoke_ledger_writes.sql
-- F1 (2026-07-05 audit): revoke leftover client write grants on ledger/authority
-- tables. Every write to these tables happens via owner-privileged SECURITY
-- DEFINER RPCs; none of them has an RLS write policy, so these table grants were
-- unreachable defense-in-depth debt from the broad default GRANT. Behavior-neutral.
--
-- Idempotent: REVOKE of an absent privilege is a no-op.
-- Rollback: GRANT INSERT, UPDATE, DELETE ON <table> TO anon, authenticated;
--           (not recommended — nothing legitimate uses direct writes).

revoke insert, update, delete on
  public.credit_ledger,
  public.customer_credit_balance,
  public.loyalty_points_ledger,
  public.customer_loyalty,
  public.driver_loyalty,
  public.restaurant_loyalty,
  public.order_financials,
  public.restaurant_settlements,
  public.order_status_events,
  public.promo_codes
from anon, authenticated;
