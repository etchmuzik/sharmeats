-- 047_promo_code_entropy.sql
-- Security fix: raise the entropy of minted one-time promo codes.
--
-- Finding: both `redeem_points` (046) and `reward_referrer_on_delivery` (026)
-- minted their promo codes as
--   'PREFIX-' || substr(replace(gen_random_uuid()::text,'-',''), 1, 6)
-- i.e. only the first 6 hex characters of a UUID's text form — 24 bits of
-- entropy. The minted code is a bearer credential: `validate_promo`/checkout
-- redemption has no binding to a specific user beyond `per_user_limit`, so
-- possession of the code string alone is sufficient to redeem it. 24 bits
-- (~16.7M possibilities) is guessable/brute-forceable for a code that's
-- worth real money and has no rate limiting of its own at the promo-apply
-- callsite. This migration raises both mint sites to 128 bits of entropy
-- (32 hex chars) via `encode(gen_random_bytes(16), 'hex')`, per pgcrypto.
--
-- Both `create or replace function` bodies below are byte-identical to the
-- currently-shipped versions (046_loyalty_rpcs.sql's redeem_points and
-- 026_referrals.sql's reward_referrer_on_delivery) EXCEPT for the single
-- `v_code := ...` line in each. No locking, exception-handling, guard, or
-- return-shape logic is changed.
--
-- Non-destructive: no drops, no table changes. Idempotent (create or
-- replace + repeatable grant/revoke).

create extension if not exists "pgcrypto";

-- ============================================================================
-- redeem_points (046_loyalty_rpcs.sql) — customer loyalty point redemption
-- ============================================================================
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
  'Debits the caller''s point balance and mints a one-time LOY-<32 hex chars> fixed promo_codes row (per_user_limit=1, 128 bits of entropy via pgcrypto gen_random_bytes), same redemption shape as the referral reward path (026). Raises INSUFFICIENT_POINTS if the balance is too low.';

-- ============================================================================
-- reward_referrer_on_delivery (026_referrals.sql) — referral reward on delivery
-- ============================================================================
create or replace function public.reward_referrer_on_delivery()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_ref     public.referrals;
  v_reward  int;
  v_code    text;
begin
  if new.status <> 'delivered' or old.status = 'delivered' then return new; end if;

  -- FOR UPDATE: serialize concurrent delivery transitions so the reward is
  -- minted exactly once. Without the lock, two simultaneous 'delivered' updates
  -- could both read reward_status='pending' and each mint a REF code, leaving an
  -- orphaned duplicate. The lock makes the second waiter see 'rewarded' and bail.
  select * into v_ref from public.referrals
   where order_id = new.id and reward_status = 'pending'
   for update;
  if not found then return new; end if;

  select coalesce((value #>> '{}')::int, 50) into v_reward
    from public.platform_settings where key = 'referral_referrer_reward_egp';

  -- Mint a one-time fixed promo code for the referrer (per_user_limit 1).
  v_code := 'REF-' || upper(encode(gen_random_bytes(16), 'hex'));
  insert into public.promo_codes (code, kind, value, per_user_limit, is_active)
  values (upper(v_code), 'fixed', greatest(1, coalesce(v_reward,50)), 1, true);

  update public.referrals
     set reward_status = 'rewarded', reward_code = upper(v_code), rewarded_at = now()
   where id = v_ref.id;

  -- Best-effort push to the referrer ("Your friend ordered — here's EGP off").
  declare v_base text; v_prof uuid;
  begin
    select value #>> '{}' into v_base from public.platform_settings where key = 'functions_base_url';
    -- referrer_id IS the users.id == auth user id; expo-push resolves push_tokens by user_id.
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
  return new;  -- never block the delivery transition on reward bookkeeping
end;
$$;

-- Trigger-only function — never a direct RPC. Lock from client roles.
revoke all on function public.reward_referrer_on_delivery() from public, anon, authenticated;

-- Trigger already exists from 026 (after update of status on public.orders);
-- create or replace function above updates its body in place. Re-declaring
-- the trigger here anyway keeps this migration self-contained/idempotent if
-- ever replayed against a DB where 026's trigger definition needs refreshing.
drop trigger if exists orders_reward_referrer on public.orders;
create trigger orders_reward_referrer
  after update of status on public.orders
  for each row execute function public.reward_referrer_on_delivery();

comment on function public.reward_referrer_on_delivery is
  'On a referred order''s delivery, mints a one-time fixed promo code (REF-<32 hex chars>) for the referrer and flips the referral to rewarded. Reward amount from platform_settings.referral_referrer_reward_egp. 128 bits of entropy via pgcrypto gen_random_bytes.';
