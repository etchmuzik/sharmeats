-- 131_settlement_reference_required.sql
--
-- Fix: mark_settlement_paid accepted a whitespace-only reference, stored NULL
-- (nullif(btrim(...), '')), and still flipped the settlement to 'paid'. An
-- unpaid merchant could look paid with nothing to trace the transfer by --
-- the LOI's weekly Sunday payout is a bank transfer, and the reference IS the
-- audit trail.
--
-- Body taken from PRODUCTION via pg_get_functiondef (house rule 2), one
-- change: an empty/whitespace reference now raises REFERENCE_REQUIRED before
-- any status change. Signature UNCHANGED (uuid, text) -> no second overload
-- (house rule 1); ACL preserved by CREATE OR REPLACE.
--
-- Standalone, additive, idempotent.

create or replace function public.mark_settlement_paid(p_settlement_id uuid, p_reference text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if coalesce(public.auth_role()::text,'') <> 'admin' then raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation'; end if;
  -- [131] The reference is the audit trail of a real bank transfer: a paid
  -- settlement with no reference is indistinguishable from an unpaid one.
  if nullif(btrim(coalesce(p_reference, '')), '') is null then
    raise exception 'REFERENCE_REQUIRED' using errcode = 'check_violation';
  end if;
  update public.restaurant_settlements
     set status = 'paid', paid_at = now(), paid_reference = btrim(p_reference), updated_at = now()
   where id = p_settlement_id and status = 'finalized';
  if not found then raise exception 'NOT_FINALIZED_OR_MISSING' using errcode = 'check_violation'; end if;
end;
$function$;

comment on function public.mark_settlement_paid(uuid, text) is
  'ADMIN: mark a finalized settlement as paid. Requires a non-empty payment reference (the bank-transfer audit trail) since mig 131.';
