-- 061_redeem_points_one_percent.sql
-- Economics fix: loyalty redemption repriced from 100% cashback to ~1%.
--
-- Background: 049 set v_value_egp := p_points * v_rate, a "1:1 inversion of
-- the earn formula". That makes the program a full-cashback scheme:
--   earn  (bronze): floor(subtotal / 10) points  -> 200 EGP order = 20 pts
--   redeem (049):   20 pts * 10                  -> 200 EGP promo code
-- i.e. 100% of subtotal returned as credit (125% Silver / 150% Gold via the
-- earn multipliers), against 12-15% commission revenue. Every redemption
-- loses the platform ~7x its gross revenue on the originating orders.
--
-- Decision (owner, 2026-07-03, financial-model session): loyalty targets
-- ~1% back (Silver ~1.25%, Gold ~1.5% via earn multipliers), matching the
-- pre-049 arithmetic on purpose this time:
--   v_value_egp := (p_points * v_rate) / 100
--   100 pts (from 1,000 EGP of orders, bronze) -> 10 EGP promo code.
-- The customer app redeems in fixed steps of 100 points (REDEEM_POINTS in
-- apps/customer/app/(tabs)/rewards.tsx) and never displays an EGP rate, so
-- no client change is needed. greatest(1, ...) keeps a floor of 1 EGP for
-- sub-100-point redemptions reachable only via direct RPC.
--
-- Body is byte-identical to 049's redeem_points EXCEPT the v_value_egp line
-- and its comment. No locking, guard, grant, or return-shape changes.
-- Non-destructive, idempotent (create or replace + repeatable grant).

create or replace function public.redeem_points(p_points int)
returns text
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_user    uuid := auth.uid();
  v_balance int;
  v_rate    int;
  v_value_egp int;
  v_code    text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;
  if p_points is null or p_points <= 0 then raise exception 'INVALID_POINTS' using errcode = 'check_violation'; end if;

  perform 1 from public.customer_loyalty where user_id = v_user for update;
  select points_balance into v_balance from public.customer_loyalty where user_id = v_user;
  if v_balance is null or v_balance < p_points then
    raise exception 'INSUFFICIENT_POINTS' using errcode = 'check_violation';
  end if;

  select coalesce((value #>> '{}')::int, 10) into v_rate
    from public.platform_settings where key = 'loyalty_points_per_egp';
  v_value_egp := greatest(1, (p_points * v_rate) / 100);  -- ~1% cashback: points earn at floor(subtotal/rate), so value = points*rate/100 returns 1 EGP per 100 EGP spent (bronze); tier multipliers raise earning, not the redemption rate (see 061 header)

  v_code := 'LOY-' || upper(encode(gen_random_bytes(16), 'hex'));
  insert into public.promo_codes (code, kind, value, per_user_limit, is_active)
  values (upper(v_code), 'fixed', v_value_egp, 1, true);

  update public.customer_loyalty
     set points_balance = points_balance - p_points, updated_at = now()
   where user_id = v_user;

  insert into public.loyalty_points_ledger (subject_type, subject_id, delta_points, reason)
  values ('customer', v_user, -p_points, 'redeem');

  return upper(v_code);
end;
$$;
grant execute on function public.redeem_points(int) to authenticated;

comment on function public.redeem_points is
  'Debits the caller''s point balance and mints a one-time LOY-<32 hex chars> fixed promo_codes row (per_user_limit=1, 128 bits of entropy via pgcrypto gen_random_bytes), same redemption shape as the referral reward path (026). Value is (p_points * loyalty_points_per_egp) / 100 — ~1% cashback at the bronze earn rate (see 061; supersedes 049''s 1:1 valuation). Raises INSUFFICIENT_POINTS if the balance is too low.';
