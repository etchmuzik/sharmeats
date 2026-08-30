-- 221_enforce_server_payment_gate.sql
--
-- The mobile payment picker and public order RPC are not authorities: old
-- binaries and any future direct writer could still submit a card order. This
-- final persistence-boundary guard keeps the public launch cash-only.
--
-- Do not remove or relax this trigger by toggling a client-side environment
-- variable. A future card rollout needs its own reviewed migration after the
-- gateway intentions, webhook validation, settlement flow, and E2E paid-order
-- acceptance test are live.

create or replace function public.orders_reject_non_cod_payment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if new.payment_method is distinct from 'cash_on_delivery' then
    raise exception 'CARD_PAYMENTS_DISABLED' using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

revoke all on function public.orders_reject_non_cod_payment()
  from public, anon, authenticated, service_role;

drop trigger if exists orders_reject_non_cod_payment_trg on public.orders;
create trigger orders_reject_non_cod_payment_trg
  before insert or update of payment_method on public.orders
  for each row
  execute function public.orders_reject_non_cod_payment();

comment on function public.orders_reject_non_cod_payment() is
  'Launch cash-only guard: rejects every new or changed payment_method except cash_on_delivery. This is intentionally enforced at the orders persistence boundary; replace only in a reviewed card-payments rollout. Migration 221.';
