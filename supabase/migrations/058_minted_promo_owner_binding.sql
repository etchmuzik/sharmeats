-- 058_minted_promo_owner_binding.sql
-- Close a money leak: minted loyalty/referral reward codes are bearer
-- credentials (pre-ship review H-DB2).
--
-- THE BUG
-- redeem_points mints a 'LOY-...' promo_codes row and reward_referrer_on_delivery
-- mints a 'REF-...' row, both with only per_user_limit = 1. validate_promo
-- enforces per_user_limit by counting promo_redemptions for (promo_id, user_id)
-- — it does NOT bind the code to the earner. So a leaked LOY-/REF- string
-- (shared, screenshotted, forwarded) is redeemable ONCE BY EACH of N different
-- accounts → N× the intended payout, all debited from one earner's balance.
--
-- THE FIX
-- Add owner_user_id to promo_codes (nullable — public campaign codes like
-- WELCOME10 stay owner-less and shareable). Minting stamps the earner/referrer.
-- validate_promo gains one guard: an owner-bound code is only valid for its
-- owner. The referral-CODE path (users.referral_code, intentionally shareable)
-- is untouched — it returns before the promo_codes lookup.

-- 1. Owner column (nullable; existing/public codes remain owner-less).
alter table public.promo_codes
  add column if not exists owner_user_id uuid references public.users(id) on delete set null;

create index if not exists promo_codes_owner_idx
  on public.promo_codes(owner_user_id) where owner_user_id is not null;

-- 2. redeem_points: stamp the redeemer as owner of the minted LOY- code.
create or replace function public.redeem_points(p_points integer)
returns text
language plpgsql
security definer set search_path to 'public', 'pg_temp'
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
  v_value_egp := greatest(1, p_points * v_rate);

  v_code := 'LOY-' || upper(encode(gen_random_bytes(16), 'hex'));
  -- [058] bind the minted code to the redeemer so it can't be redeemed by others.
  insert into public.promo_codes (code, kind, value, per_user_limit, is_active, owner_user_id)
  values (upper(v_code), 'fixed', v_value_egp, 1, true, v_user);

  update public.customer_loyalty
     set points_balance = points_balance - p_points, updated_at = now()
   where user_id = v_user;

  insert into public.loyalty_points_ledger (subject_type, subject_id, delta_points, reason)
  values ('customer', v_user, -p_points, 'redeem');

  return upper(v_code);
end;
$function$;

-- 3. reward_referrer_on_delivery: stamp the referrer as owner of the REF- code.
create or replace function public.reward_referrer_on_delivery()
returns trigger
language plpgsql
security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  v_ref     public.referrals;
  v_reward  int;
  v_code    text;
begin
  if new.status <> 'delivered' or old.status = 'delivered' then return new; end if;

  select * into v_ref from public.referrals
   where order_id = new.id and reward_status = 'pending'
   for update;
  if not found then return new; end if;

  select coalesce((value #>> '{}')::int, 50) into v_reward
    from public.platform_settings where key = 'referral_referrer_reward_egp';

  v_code := 'REF-' || upper(encode(gen_random_bytes(16), 'hex'));
  -- [058] bind the reward code to the referrer.
  insert into public.promo_codes (code, kind, value, per_user_limit, is_active, owner_user_id)
  values (upper(v_code), 'fixed', greatest(1, coalesce(v_reward,50)), 1, true, v_ref.referrer_id);

  update public.referrals
     set reward_status = 'rewarded', reward_code = upper(v_code), rewarded_at = now()
   where id = v_ref.id;

  declare v_base text;
  begin
    select value #>> '{}' into v_base from public.platform_settings where key = 'functions_base_url';
    if v_base is not null and v_base <> '' then
      perform net.http_post(
        url     := v_base || '/expo-push',
        body    := jsonb_build_object(
                     'event', 'referral_rewarded',
                     'orderId', new.id::text,
                     'recipientUserIds', jsonb_build_array(v_ref.referrer_id::text)
                   ),
        headers := '{"Content-Type": "application/json"}'::jsonb
      );
    end if;
  exception when others then null;
  end;

  return new;
exception when others then
  return new;
end;
$function$;

-- 4. validate_promo: an owner-bound code is only valid for its owner.
--    Body = current live def (mig 026 era) plus the owner guard after the
--    promo_codes lookup. Public codes (owner_user_id null) are unaffected.
create or replace function public.validate_promo(p_code text, p_subtotal integer)
returns integer
language plpgsql
stable security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user      uuid := auth.uid();
  v_promo     public.promo_codes;
  v_uses      int;
  v_discount  int;
  v_ref_owner uuid;
  v_friend    int;
  v_min_sub   int;
begin
  if p_code is null or btrim(p_code) = '' then return 0; end if;

  -- Referral-CODE path (users.referral_code — intentionally shareable).
  select id into v_ref_owner from public.users
   where upper(referral_code) = upper(btrim(p_code));
  if found then
    if v_user is null then return 0; end if;
    if v_ref_owner = v_user then return 0; end if;
    if public.has_completed_order(v_user) then return 0; end if;
    if exists (select 1 from public.referrals where referred_id = v_user) then
      return 0;
    end if;
    select coalesce((value #>> '{}')::int, 50)  into v_friend  from public.platform_settings where key = 'referral_friend_discount_egp';
    select coalesce((value #>> '{}')::int, 150) into v_min_sub from public.platform_settings where key = 'referral_min_subtotal_egp';
    if coalesce(p_subtotal,0) < coalesce(v_min_sub,150) then return 0; end if;
    return greatest(0, least(coalesce(v_friend,50), coalesce(p_subtotal,0)));
  end if;

  select * into v_promo from public.promo_codes
   where upper(code) = upper(btrim(p_code)) and is_active;
  if not found then return 0; end if;

  -- [058] owner-bound (minted reward) code: only its owner may redeem it.
  if v_promo.owner_user_id is not null and v_promo.owner_user_id <> coalesce(v_user, '00000000-0000-0000-0000-000000000000'::uuid) then
    return 0;
  end if;

  if v_promo.valid_from is not null and now() < v_promo.valid_from then return 0; end if;
  if v_promo.valid_to   is not null and now() > v_promo.valid_to   then return 0; end if;
  if v_promo.min_subtotal_egp is not null and coalesce(p_subtotal,0) < v_promo.min_subtotal_egp then
    return 0;
  end if;

  if v_promo.max_uses is not null then
    select count(*) into v_uses from public.promo_redemptions where promo_id = v_promo.id;
    if v_uses >= v_promo.max_uses then return 0; end if;
  end if;

  if v_promo.per_user_limit is not null and v_user is not null then
    select count(*) into v_uses from public.promo_redemptions
     where promo_id = v_promo.id and user_id = v_user;
    if v_uses >= v_promo.per_user_limit then return 0; end if;
  end if;

  if v_promo.kind = 'percent' then
    v_discount := (coalesce(p_subtotal,0) * v_promo.value) / 100;
  else
    v_discount := v_promo.value;
  end if;
  if v_promo.max_discount_egp is not null then
    v_discount := least(v_discount, v_promo.max_discount_egp);
  end if;

  return greatest(0, least(v_discount, coalesce(p_subtotal,0)));
end;
$function$;
