-- 046_loyalty_rpcs.sql
-- Three-sided loyalty system, part 5: client-facing read + redeem RPCs.
--
-- Same shape as my_referral_code (026): SECURITY DEFINER, auth.uid() check,
-- narrow return, granted to authenticated only. No direct table access for
-- driver_loyalty/restaurant_loyalty (no client policy exists on those tables
-- per migration 042) — these RPCs are the only read path.
--
-- Bug fix (found during local validation, not flagged by the task brief):
-- migration 042 added `promo_codes_not_loyalty_prefix_chk`, a CHECK
-- constraint that FORBIDS the `LOY-%` prefix on promo_codes, with a comment
-- claiming to "reserve the LOY- prefix for minted redemption codes." That
-- comment describes the opposite of what the constraint does — it copied
-- the shape of `promo_codes_not_referral_prefix_chk` (026) without noticing
-- the referral system's forbidden prefix (SHARM-) is never actually written
-- to promo_codes (only users.referral_code uses it; the referral system's
-- promo_codes inserts use a DIFFERENT prefix, REF-, specifically to avoid
-- this collision). redeem_points below legitimately needs to insert
-- `LOY-XXXXXX` rows into promo_codes, so the 042 constraint as written
-- would reject every real redemption. Since all promo_codes writes are
-- already SECURITY DEFINER-gated (RLS blocks direct client access — see
-- 019), the constraint serves no additional security purpose; it is
-- dropped here rather than worked around with a different code prefix, to
-- keep the LOY-XXXXXX contract documented below and in the task brief.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'promo_codes_not_loyalty_prefix_chk') then
    alter table public.promo_codes drop constraint promo_codes_not_loyalty_prefix_chk;
  end if;
end $$;
--
-- Non-destructive: new functions only (plus the one corrective constraint
-- drop above, which un-blocks this migration's own redemption codes).

-- ============================================================================
-- Customer: status + history + redeem
-- ============================================================================
create or replace function public.my_loyalty_status()
returns table (tier text, points_balance int, points_rolling_12mo int)
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select cl.tier, cl.points_balance, cl.points_rolling_12mo
    from public.customer_loyalty cl
   where cl.user_id = auth.uid();
$$;
grant execute on function public.my_loyalty_status() to authenticated;

create or replace function public.my_loyalty_history(p_limit int default 20)
returns setof public.loyalty_points_ledger
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select * from public.loyalty_points_ledger
   where subject_type = 'customer' and subject_id = auth.uid()
   order by created_at desc
   limit greatest(1, least(p_limit, 100));
$$;
grant execute on function public.my_loyalty_history(int) to authenticated;

-- redeem_points: debit N points, mint a one-time fixed promo code worth
-- N points converted to EGP at the SAME rate points were earned (1 point =
-- loyalty_points_per_egp EGP / multiplier-neutral — redemption value is
-- always at the bronze rate to keep the exchange rate simple and predictable
-- for customers regardless of the tier they earned it at).
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
  v_value_egp := greatest(1, p_points * v_rate / 100);  -- points were stored /100-normalized in the earn trigger's floor division; this inverts at the bronze rate

  v_code := 'LOY-' || substr(replace(gen_random_uuid()::text,'-',''), 1, 6);
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

-- ============================================================================
-- Driver: my_driver_tier
-- ============================================================================
create or replace function public.my_driver_tier()
returns table (
  tier text, deliveries_rolling_90d int, bonus_per_delivery_egp int,
  first_look_seconds int, acceptance_rate_snapshot numeric, rating_snapshot numeric
)
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select dl.tier, dl.deliveries_rolling_90d, dl.bonus_per_delivery_egp,
         dl.first_look_seconds, dl.acceptance_rate_snapshot, dl.rating_snapshot
    from public.driver_loyalty dl
    join public.drivers d on d.id = dl.driver_id
   where d.profile_id = auth.uid();
$$;
grant execute on function public.my_driver_tier() to authenticated;

-- ============================================================================
-- Restaurant: my_restaurant_tier (merchant_staff-scoped, same resolution join
-- used by getMyRestaurant() in the restaurant/merchant-web apps)
-- ============================================================================
create or replace function public.my_restaurant_tier()
returns table (tier text, orders_rolling_90d int, commission_pct numeric, featured boolean)
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select rl.tier, rl.orders_rolling_90d, r.commission_pct, coalesce(r.featured, false)
    from public.restaurant_loyalty rl
    join public.restaurants r on r.id = rl.restaurant_id
    join public.merchant_staff ms on ms.restaurant_id = r.id
   where ms.profile_id = auth.uid()
   limit 1;
$$;
grant execute on function public.my_restaurant_tier() to authenticated;

comment on function public.redeem_points is
  'Debits the caller''s point balance and mints a one-time LOY-XXXXXX fixed promo_codes row (per_user_limit=1), same redemption shape as the referral reward path (026). Raises INSUFFICIENT_POINTS if the balance is too low.';
