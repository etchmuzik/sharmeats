-- 049_redeem_points_value_fix.sql
-- Bug fix: redeem_points() minted promo codes worth 100x too little.
--
-- Finding: redeem_points() (047_promo_code_entropy.sql, itself carried over
-- unchanged from 046_loyalty_rpcs.sql) computed the minted promo code's
-- value as:
--   v_value_egp := greatest(1, p_points * v_rate / 100);
-- with the inline comment claiming "points were stored /100-normalized in
-- the earn trigger's floor division; this inverts at the bronze rate."
-- That comment is wrong, and so is the math it justifies.
--
-- The earn trigger (accrue_loyalty_on_delivery, 044_loyalty_earn_clawback.sql)
-- computes points as:
--   v_customer_pts := (floor(subtotal_egp / points_per_egp) * v_mult) / 100;
-- where v_mult is a tier multiplier in percentage-point units (100 for
-- bronze, 125 for silver, 150 for gold) — the "/100" there divides out the
-- *multiplier's* percentage scale, not the points themselves. For a bronze
-- customer (v_mult = 100) this simplifies exactly to
-- floor(subtotal_egp / points_per_egp): points are earned and stored as
-- PLAIN units, not "/100-normalized" units.
--
-- Concretely: at points_per_egp = 10 (the seeded default, 042), a 200 EGP
-- order earns floor(200/10) = 20 points. Redeeming those 20 points should
-- be worth 20 * 10 = 200 EGP back — a straight 1:1 inversion of the earn
-- formula at the bronze rate. The old code instead computed
-- 20 * 10 / 100 = 2 EGP, undervaluing every redemption by 100x.
--
-- Fix (user-confirmed: full 1:1 EGP value): drop the erroneous "/ 100" so
-- v_value_egp := greatest(1, p_points * v_rate). This is the exact inverse
-- of the bronze-rate earn formula, and is intentionally applied at the
-- bronze rate regardless of the customer's actual tier (see corrected
-- inline comment below) — tier multipliers only affect how many points are
-- *earned* per order, not the EGP value of redeeming a point once earned,
-- so the exchange rate stays simple and predictable for customers at any
-- tier.
--
-- create or replace function body below is byte-identical to the
-- currently-shipped version (047_promo_code_entropy.sql's redeem_points)
-- EXCEPT for the single `v_value_egp := ...` line and its inline comment.
-- No locking, exception-handling, guard, grant, or return-shape logic is
-- changed.
--
-- Non-destructive: no drops, no table changes. Idempotent (create or
-- replace + repeatable grant).

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
  v_value_egp := greatest(1, p_points * v_rate);  -- points are earned in plain units at the bronze rate (floor(subtotal/rate)); redemption inverts that exactly by multiplying back by the same rate -- always at the bronze rate regardless of the customer's actual tier, so the exchange rate is simple and predictable

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
  'Debits the caller''s point balance and mints a one-time LOY-<32 hex chars> fixed promo_codes row (per_user_limit=1, 128 bits of entropy via pgcrypto gen_random_bytes), same redemption shape as the referral reward path (026). Value is p_points * loyalty_points_per_egp (1:1 inversion of the bronze-rate earn formula; see 049). Raises INSUFFICIENT_POINTS if the balance is too low.';
