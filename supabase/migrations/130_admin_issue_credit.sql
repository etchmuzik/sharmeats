-- 130_admin_issue_credit.sql
--
-- Restore the admin's ability to compensate a customer -- lost as collateral
-- damage of a correct security fix.
--
-- Migration 101 closed the sla_late self-credit exploit by revoking
-- issue_credit's EXECUTE from authenticated entirely. That was right: simply
-- re-granting would reopen the hole, because issue_credit's sla_late branch
-- lets ANY caller pick the amount on their own delivered order. But the
-- revoke also removed the only paved path for an admin to make a customer
-- whole -- the first cold-delivery complaint would be negotiated from memory
-- in WhatsApp with no button behind it.
--
-- Fix: a separate admin-only wrapper. It exposes only the human-compensation
-- reasons ('refund','goodwill','adjustment' -- never 'sla_late', which stays
-- machine-issued, and never 'redeem', which belongs to redeem_credit), caps
-- the per-call amount at a sanity ceiling, and forwards to issue_credit --
-- definer-to-definer, so the inner function's revoked client ACL is not in
-- the path. issue_credit's own internal admin gate provides defense in depth.
--
-- Standalone, additive, idempotent. Rollback: drop function.

create or replace function public.admin_issue_credit(
  p_user_id    uuid,
  p_amount_egp integer,
  p_reason     text,
  p_order_id   uuid default null,
  p_note       text default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;
  if coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  -- Only the human-compensation reasons. sla_late is machine-issued
  -- (mig 062/101); redeem belongs to redeem_credit.
  if p_reason not in ('refund', 'goodwill', 'adjustment') then
    raise exception 'INVALID_REASON' using errcode = 'check_violation';
  end if;
  -- Sanity ceiling: ~16x the 300 EGP AOV. Not a business rule -- a fat-finger
  -- and compromised-admin blast-radius cap. Two calls for a larger amount is
  -- a feature: it forces a second decision.
  if p_amount_egp is null or p_amount_egp <= 0 or p_amount_egp > 5000 then
    raise exception 'INVALID_AMOUNT' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'USER_NOT_FOUND' using errcode = 'check_violation';
  end if;

  -- Definer-to-definer: runs as owner, so issue_credit's revoked client ACL
  -- does not apply. Its ledger + balance + push side-effects are reused as-is.
  perform public.issue_credit(p_user_id, p_amount_egp, p_reason, p_order_id, p_note);
end;
$function$;

revoke all on function public.admin_issue_credit(uuid, integer, text, uuid, text) from public, anon;
grant execute on function public.admin_issue_credit(uuid, integer, text, uuid, text) to authenticated;

comment on function public.admin_issue_credit(uuid, integer, text, uuid, text) is
  'ADMIN: issue a customer credit (refund/goodwill/adjustment, <= 5000 EGP/call). The paved compensation path since mig 101 revoked issue_credit from clients to close the sla_late self-credit hole. Forwards to issue_credit definer-to-definer. Mig 130.';
