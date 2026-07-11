-- 101 — issue_credit: close the `sla_late` self-credit privilege-escalation hole.
--
-- FOUND (full security audit 2026-07-11): public.issue_credit is granted to
-- `authenticated`, so ANY logged-in user can call it via PostgREST RPC. Its
-- admin gate is intentionally skipped for the internal SLA path:
--
--     if p_reason <> 'sla_late' and coalesce(auth_role()::text,'') <> 'admin'
--        then raise 'NOT_AUTHORIZED'
--
-- With p_reason => 'sla_late' the gate is bypassed and the function then does an
-- UNCONDITIONAL credit_ledger insert + customer_credit_balance increment for the
-- caller-supplied p_user_id / p_amount_egp — no auth.uid() binding, no order
-- validation. The only guard, the partial unique index
--   credit_ledger_one_sla_per_order = UNIQUE (ref_order_id) WHERE reason='sla_late'
-- is defeated because p_order_id DEFAULTs to NULL and Postgres treats NULLs as
-- distinct in a unique index (verified live: 3 NULL-ref sla_late rows inserted
-- with zero conflicts, rolled back). Exploit: any user calls
--   rpc('issue_credit',{p_user_id:<self>,p_amount_egp:1e6,p_reason:'sla_late',p_order_id:null})
-- repeatedly -> unbounded self wallet credit -> redeem_credit -> checkout discount.
--
-- FIX (no feature breakage): the real SLA credit is issued by the SECURITY
-- DEFINER trigger snapshot_order_financials (migs 062/083), which ALWAYS passes a
-- non-NULL order id (new.id) and runs as definer — so it does NOT need the
-- `authenticated` EXECUTE grant. Two layers:
--   1. Revoke EXECUTE from anon/authenticated (and PUBLIC) — kills client access.
--   2. Require p_order_id IS NOT NULL on the sla_late path — makes the one-per-order
--      unique index effective and blocks the NULL bypass even if the grant returns.

-- Layer 2: harden the body (definer + pinned search_path unchanged).
create or replace function public.issue_credit(
  p_user_id uuid,
  p_amount_egp integer,
  p_reason text,
  p_order_id uuid default null::uuid,
  p_note text default null::text
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_actor uuid := auth.uid(); v_base text;
begin
  if p_amount_egp is null or p_amount_egp <= 0 then raise exception 'INVALID_AMOUNT' using errcode='check_violation'; end if;
  if p_reason not in ('refund','goodwill','sla_late','redeem','adjustment') then raise exception 'INVALID_REASON' using errcode='check_violation'; end if;
  -- Admin gate (null-safe). The sla_late internal path bypasses the admin check
  -- but MUST carry a real order id so the one-per-order unique index applies —
  -- this defeats the NULL-ref_order_id duplication exploit.
  if p_reason <> 'sla_late' and coalesce(public.auth_role()::text,'') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode='check_violation';
  end if;
  if p_reason = 'sla_late' and p_order_id is null then
    raise exception 'SLA_CREDIT_REQUIRES_ORDER' using errcode='check_violation';
  end if;
  insert into public.credit_ledger (user_id, delta_egp, reason, ref_order_id, note, actor_id)
  values (p_user_id, p_amount_egp, p_reason, p_order_id, p_note, v_actor);
  insert into public.customer_credit_balance (user_id, balance_egp) values (p_user_id, p_amount_egp)
  on conflict (user_id) do update set balance_egp = public.customer_credit_balance.balance_egp + p_amount_egp, updated_at = now();
  if p_reason <> 'redeem' then
    begin
      select value #>> '{}' into v_base from public.platform_settings where key='functions_base_url';
      if v_base is not null and v_base <> '' then
        perform net.http_post(
          url := v_base || '/expo-push',
          body := jsonb_build_object('event','credit_issued','orderId',coalesce(p_order_id::text,p_user_id::text),'recipientUserIds',jsonb_build_array(p_user_id::text)),
          headers := public.push_headers());
      end if;
    exception when others then null;
    end;
  end if;
end; $function$;

-- Layer 1: no client may call issue_credit directly. The definer trigger that
-- issues SLA credit executes it regardless of these grants.
revoke execute on function public.issue_credit(uuid, integer, text, uuid, text) from public;
revoke execute on function public.issue_credit(uuid, integer, text, uuid, text) from anon;
revoke execute on function public.issue_credit(uuid, integer, text, uuid, text) from authenticated;
grant  execute on function public.issue_credit(uuid, integer, text, uuid, text) to service_role;
