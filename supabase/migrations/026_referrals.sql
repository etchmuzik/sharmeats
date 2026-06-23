-- 026_referrals.sql
-- Two-sided referrals — the acquisition growth loop, built ON TOP of the promo
-- system (019) so the customer app needs ZERO new checkout plumbing.
--
-- How it works:
--   * Every user gets a unique referral_code (SHARM-XXXXXX), generated on demand.
--   * A NEW user types a friend's referral code into the SAME promo box at
--     checkout. validate_promo recognizes it, and — only if the caller has no
--     prior delivered order — returns the "friend" discount (default EGP 50).
--   * place_order persists it as a normal redemption (discount_egp/promo_code),
--     and we link it to the referral via the order's promo_code.
--   * When that first order is DELIVERED, a trigger mints a one-time personal
--     promo code for the REFERRER (default EGP 50), redeemable like any promo.
--
-- No wallet/credit store needed: the referrer's reward IS a promo code, reusing
-- the entire 019 redemption path. Amounts live in platform_settings (tunable).
--
-- Security: referral_code is non-secret (it's meant to be shared). The referrals
-- table is RLS-on with read limited to the two parties; all mutation happens via
-- SECURITY DEFINER functions. validate_promo stays the single discount oracle.
--
-- Non-destructive: new column + new tables + function replacement + trigger.

-- ============================================================================
-- Config (tunable without a deploy)
-- ============================================================================
insert into public.platform_settings (key, value) values
  ('referral_friend_discount_egp',   to_jsonb(50)),   -- new user, first order
  ('referral_referrer_reward_egp',   to_jsonb(50)),   -- referrer, after friend's 1st order completes
  ('referral_min_subtotal_egp',      to_jsonb(150))   -- min basket for the friend discount
on conflict (key) do nothing;

-- ============================================================================
-- Keep the referral and promo namespaces DISJOINT. Referral codes are minted as
-- SHARM-XXXXXX. If an admin ever created a promo_code with that prefix it could
-- collide with a user's referral_code and make validate_promo / the link-referral
-- trigger ambiguous (a normal promo redemption would be mis-recorded as a
-- referral). Forbid the reserved prefix on promo_codes so the namespaces can
-- never overlap. (Referrer reward codes are REF-XXXXXX — also outside SHARM-.)
-- ============================================================================
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'promo_codes_not_referral_prefix_chk') then
    alter table public.promo_codes
      add constraint promo_codes_not_referral_prefix_chk
      check (upper(code) not like 'SHARM-%');
  end if;
end $$;

-- ============================================================================
-- users.referral_code — each user's shareable code.
-- ============================================================================
alter table public.users
  add column if not exists referral_code text;

create unique index if not exists users_referral_code_idx
  on public.users (upper(referral_code))
  where referral_code is not null;

-- Generate a SHARM-XXXXXX code (unambiguous alphabet, no 0/O/1/I).
create or replace function public.generate_referral_code()
returns text
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_try  int := 0;
begin
  loop
    v_code := 'SHARM-';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.users where upper(referral_code) = upper(v_code));
    v_try := v_try + 1;
    if v_try > 20 then raise exception 'REFERRAL_CODE_GENERATION_FAILED'; end if;
  end loop;
  return v_code;
end;
$$;

-- my_referral_code — return the caller's code, lazily generating it on first call.
create or replace function public.my_referral_code()
returns text
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_code text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;
  select referral_code into v_code from public.users where id = v_user;
  if v_code is null then
    v_code := public.generate_referral_code();
    update public.users set referral_code = v_code where id = v_user;
  end if;
  return v_code;
end;
$$;
grant execute on function public.my_referral_code() to authenticated;
-- generate_referral_code is an internal helper for my_referral_code — never a
-- direct RPC. Lock it (and the first-order gate below) from client roles so the
-- Supabase advisor's "anon can execute SECURITY DEFINER fn" warning doesn't fire
-- on internals that are not meant to be called over the API.
revoke all on function public.generate_referral_code() from public, anon, authenticated;

-- ============================================================================
-- referrals — one row per (referred user, code). Tracks reward payout.
-- ============================================================================
create table if not exists public.referrals (
  id              uuid primary key default gen_random_uuid(),
  referrer_id     uuid not null references public.users(id) on delete cascade,
  referred_id     uuid not null references public.users(id) on delete cascade,
  code            text not null,
  order_id        uuid references public.orders(id) on delete set null, -- the qualifying first order
  friend_discount_egp int not null default 0,
  reward_status   text not null default 'pending'
                  check (reward_status in ('pending','rewarded','void')),
  reward_code     text,            -- the promo code minted for the referrer
  created_at      timestamptz not null default now(),
  rewarded_at     timestamptz,
  unique (referred_id)             -- a user can be referred at most once
);

create index if not exists referrals_referrer_idx on public.referrals (referrer_id);
create index if not exists referrals_order_idx on public.referrals (order_id);

alter table public.referrals enable row level security;
-- Either party may read their own referral rows; no client writes.
create policy "referrals_read_own" on public.referrals for select
  using (referrer_id = auth.uid() or referred_id = auth.uid());

comment on table public.referrals is
  'Two-sided referral ledger. friend_discount applied at the referred user''s first order; referrer reward minted as a one-time promo code when that order is delivered.';

-- ============================================================================
-- Helper: has the caller ever had a delivered order? (first-order gate)
-- ============================================================================
create or replace function public.has_completed_order(p_user uuid)
returns boolean
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.orders
     where user_id = p_user and status = 'delivered'
  );
$$;
-- Internal gate used inside validate_promo — not a direct RPC. Lock from clients.
revoke all on function public.has_completed_order(uuid) from public, anon, authenticated;

-- ============================================================================
-- validate_promo — now referral-aware. A referral code:
--   * must belong to a DIFFERENT user (no self-referral),
--   * only pays out if the caller has NO delivered order yet (first order),
--   * is worth referral_friend_discount_egp, gated by referral_min_subtotal.
-- Falls through to the normal promo_codes path for non-referral codes.
-- (Full replacement of the 019 version; referral branch marked [026].)
-- ============================================================================
create or replace function public.validate_promo(p_code text, p_subtotal int)
returns int
language plpgsql
stable
security definer set search_path = public, pg_temp
as $$
declare
  v_user      uuid := auth.uid();
  v_promo     public.promo_codes;
  v_uses      int;
  v_discount  int;
  -- [026] referral locals
  v_ref_owner uuid;
  v_friend    int;
  v_min_sub   int;
begin
  if p_code is null or btrim(p_code) = '' then return 0; end if;

  -- [026] Referral path: does this code belong to a user?
  select id into v_ref_owner from public.users
   where upper(referral_code) = upper(btrim(p_code));
  if found then
    if v_user is null then return 0; end if;            -- must be signed in
    if v_ref_owner = v_user then return 0; end if;       -- no self-referral
    if public.has_completed_order(v_user) then return 0; end if;  -- first order only
    if exists (select 1 from public.referrals where referred_id = v_user) then
      return 0;                                          -- already referred once
    end if;
    select coalesce((value #>> '{}')::int, 50)  into v_friend  from public.platform_settings where key = 'referral_friend_discount_egp';
    select coalesce((value #>> '{}')::int, 150) into v_min_sub from public.platform_settings where key = 'referral_min_subtotal_egp';
    if coalesce(p_subtotal,0) < coalesce(v_min_sub,150) then return 0; end if;
    return greatest(0, least(coalesce(v_friend,50), coalesce(p_subtotal,0)));
  end if;

  -- Normal promo path (unchanged from 019).
  select * into v_promo from public.promo_codes
   where upper(code) = upper(btrim(p_code)) and is_active;
  if not found then return 0; end if;

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
$$;

-- ============================================================================
-- Record the referral link when a referral-coded order is placed.
-- place_order already stamps orders.promo_code with the redeemed code. An
-- AFTER INSERT trigger on orders detects a referral code and creates the
-- pending referrals row (idempotent via unique (referred_id)).
-- ============================================================================
create or replace function public.link_referral_on_order()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
begin
  if new.promo_code is null or new.discount_egp <= 0 then return new; end if;

  select id into v_owner from public.users
   where upper(referral_code) = upper(new.promo_code);
  if v_owner is null or v_owner = new.user_id then return new; end if;  -- not a referral code

  insert into public.referrals (referrer_id, referred_id, code, order_id, friend_discount_egp)
  values (v_owner, new.user_id, upper(new.promo_code), new.id, new.discount_egp)
  on conflict (referred_id) do nothing;

  return new;
exception when others then
  return new;  -- never block order placement on referral bookkeeping
end;
$$;

-- Trigger-only function — never a direct RPC. Lock from client roles.
revoke all on function public.link_referral_on_order() from public, anon, authenticated;

drop trigger if exists orders_link_referral on public.orders;
create trigger orders_link_referral
  after insert on public.orders
  for each row execute function public.link_referral_on_order();

-- ============================================================================
-- Mint the referrer's reward when the referred order is DELIVERED.
-- AFTER UPDATE on orders (status -> delivered): if this order qualified a
-- referral that's still pending, create a one-time promo code for the referrer
-- and flip the referral to 'rewarded'.
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
  v_code := 'REF-' || substr(replace(gen_random_uuid()::text,'-',''), 1, 6);
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

drop trigger if exists orders_reward_referrer on public.orders;
create trigger orders_reward_referrer
  after update of status on public.orders
  for each row execute function public.reward_referrer_on_delivery();

comment on function public.reward_referrer_on_delivery is
  'On a referred order''s delivery, mints a one-time fixed promo code (REF-XXXXXX) for the referrer and flips the referral to rewarded. Reward amount from platform_settings.referral_referrer_reward_egp.';
