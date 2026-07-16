-- 113_redeem_points_owner_binding.sql
--
-- HIGH (final audit 2026-07-16): redeem_points mints an unbound, uncapped promo
-- code. When a customer redeems loyalty points, the code it mints sets only
-- per_user_limit = 1 (one redemption *per user*) with NO owner_user_id and NO
-- global max_uses. So the minted code is a bearer token: the redeemer shares it,
-- and every DIFFERENT account can redeem it once — each redemption a
-- platform-funded discount, for a single points spend. Platform loss scales with
-- the number of accounts the code is shared to.
--
-- validate_promo already enforces the [058] owner-binding guard
-- ("if v_promo.owner_user_id is not null and owner <> caller then return 0") and
-- the global max_uses cap — redeem_points simply never populated either field.
-- Fix: bind the minted code to the redeemer (owner_user_id = v_user) and cap it
-- globally at a single use (max_uses = 1). No backfill needed: prod has minted 0
-- such codes to date.
--
-- Body reproduced verbatim from the current prod definition (house rule: never
-- start from an older migration copy) with ONLY the promo_codes insert changed.

create or replace function public.redeem_points(p_points integer)
 returns text
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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
  -- [mig 113] owner_user_id binds the code to the redeemer (validate_promo [058]
  -- guard) and max_uses = 1 caps it globally to a single redemption.
  insert into public.promo_codes (code, kind, value, owner_user_id, per_user_limit, max_uses, is_active)
  values (upper(v_code), 'fixed', v_value_egp, v_user, 1, 1, true);

  update public.customer_loyalty
     set points_balance = points_balance - p_points, updated_at = now()
   where user_id = v_user;

  insert into public.loyalty_points_ledger (subject_type, subject_id, delta_points, reason)
  values ('customer', v_user, -p_points, 'redeem');

  return upper(v_code);
end;
$function$;
