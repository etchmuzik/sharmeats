-- ============================================================================
-- 205 — F-08 / F-09: release promo redemptions on cancel, conserve the remainder
--
-- F-08 (audit §3.2): a rejected/cancelled order permanently consumes the promo
-- redemption it created at placement. validate_promo counts redemptions with no
-- outcome filter, so a customer whose order the merchant rejects loses their
-- one-time (per_user_limit=1) code forever — and for a MINTED code (wallet
-- credit converted to a code, or loyalty points redeemed), the underlying EGP
-- is destroyed with it.
--
-- F-09: converting wallet credit to a fixed-value code and then spending it on a
-- smaller basket burns the difference. validate_promo caps the discount at the
-- subtotal, but redeem_credit already debited the FULL code value at mint time,
-- so value = discount(applied) + remainder(vanished).
--
-- FIX (two triggers, never edits to place_order — house rule 2; a later
-- CREATE OR REPLACE of the 400-line RPC cannot revert a trigger, and both
-- writers of orders.status plus reconcile_stale_card_orders are covered):
--
--   * released_at column + AFTER UPDATE OF status trigger: on the single
--     transition into cancelled/rejected, latch the redemption released. For a
--     minted code, re-credit discount_egp to the owner's wallet and deactivate
--     the code. For a campaign code, only stop it counting against
--     per_user_limit (validate_promo gains `released_at is null`).
--   * AFTER INSERT trigger on promo_redemptions: when a minted fixed-value code
--     is spent for less than its value, refund value − discount_egp to the
--     owner's wallet immediately (the code is the owner's own money, so
--     refunding at placement has no gaming vector).
--
-- Product decisions recorded (owner-approved 2026-08-01):
--   - minted codes re-credit the wallet; campaign codes do not (marketing
--     budget, not wallet money).
--   - max_uses semantics are unchanged: a cancelled order still consumes one
--     global slot (203h's seq authority is max(seq)+1; freeing a slot would
--     mean rewriting that trigger for near-zero benefit). max_uses therefore
--     means "checkouts that reached placement", ops-raisable if needed.
--     Only per_user_limit is released — that is what re-opens the code to its
--     rightful owner after a cancel.
--
-- Prod today: 0 promo_redemptions, 0 minted codes — this is entirely
-- forward-looking (verified during recon). Ship before launch marketing.
--
-- Reason vocabulary: credit_ledger.reason is CHECK-constrained at table level,
-- so two new reasons must be added to the constraint, not just used.
-- ============================================================================

-- --- New ledger reasons ------------------------------------------------------
alter table public.credit_ledger drop constraint if exists credit_ledger_reason_check;
alter table public.credit_ledger add constraint credit_ledger_reason_check
  check (reason in ('refund','goodwill','sla_late','redeem','adjustment',
                    'promo_release','promo_remainder'));

-- Idempotency guards: at most one release and one remainder refund per order.
create unique index if not exists credit_ledger_one_promo_release_per_order
  on public.credit_ledger (ref_order_id) where reason = 'promo_release';
create unique index if not exists credit_ledger_one_promo_remainder_per_order
  on public.credit_ledger (ref_order_id) where reason = 'promo_remainder';

-- --- released_at -------------------------------------------------------------
alter table public.promo_redemptions
  add column if not exists released_at timestamptz;

comment on column public.promo_redemptions.released_at is
  'Set when the redemption''s order reached cancelled/rejected without delivery (mig 205). validate_promo ignores released rows for per_user_limit, re-opening a one-time code to its owner after a cancel. max_uses still counts released rows (see mig 205 header). For a minted code, release also re-credits discount_egp to the owner wallet (reason promo_release).';

-- --- Shared wallet re-credit helper ------------------------------------------
-- issue_credit refuses non-sla_late reasons unless the caller is admin; a
-- trigger firing in a customer/cron context is not admin, so the release path
-- writes the ledger + balance directly. SECURITY DEFINER, owner-only execute.
create or replace function public.credit_wallet_internal(
  p_user_id uuid, p_amount_egp int, p_reason text, p_order_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if p_amount_egp is null or p_amount_egp <= 0 then return; end if;
  if p_reason not in ('promo_release','promo_remainder') then
    raise exception 'credit_wallet_internal is only for promo release/remainder';
  end if;
  insert into public.credit_ledger (user_id, delta_egp, reason, ref_order_id, note, actor_id)
  values (p_user_id, p_amount_egp, p_reason, p_order_id, p_note, null);
  insert into public.customer_credit_balance (user_id, balance_egp)
  values (p_user_id, p_amount_egp)
  on conflict (user_id) do update
    set balance_egp = public.customer_credit_balance.balance_egp + p_amount_egp,
        updated_at = now();
end;
$$;

revoke all on function public.credit_wallet_internal(uuid, int, text, uuid, text)
  from public, anon, authenticated;

-- --- F-08: release on terminal-without-delivery ------------------------------
create or replace function public.release_promo_on_order_terminal()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_red   public.promo_redemptions;
  v_promo public.promo_codes;
begin
  -- Latch idempotently: the state machine enters a terminal state at most once,
  -- but the `released_at is null` filter makes a re-fire (or a second writer) a
  -- no-op regardless.
  update public.promo_redemptions
     set released_at = now()
   where order_id = new.id and released_at is null
  returning * into v_red;
  if not found then return new; end if;

  select * into v_promo from public.promo_codes where id = v_red.promo_id;

  -- Minted code (owner-bound): the discount was the owner's own money. Give it
  -- back and retire the code. Campaign codes have no wallet to refund; the
  -- release above already re-opens per_user_limit, which is all they need.
  if v_promo.owner_user_id is not null and coalesce(v_red.discount_egp, 0) > 0 then
    perform public.credit_wallet_internal(
      v_promo.owner_user_id, v_red.discount_egp, 'promo_release', new.id,
      'Released from ' || coalesce(new.status, 'terminal') || ' order ' || new.id::text);
    update public.promo_codes set is_active = false where id = v_promo.id;
  end if;

  return new;
exception when unique_violation then
  -- promo_release already recorded for this order — nothing to do.
  return new;
when others then
  -- A cancel must never fail because the release could not be written. Surface
  -- it to ops rather than swallow silently (F-08's own failure mode).
  begin perform public.ops_alert('PROMO RELEASE FAILED for order ' || new.id::text || ': ' || sqlerrm); exception when others then null; end;
  return new;
end;
$$;

comment on function public.release_promo_on_order_terminal() is
  'On the transition into cancelled/rejected, releases the order''s promo redemption: re-opens per_user_limit for all codes and, for minted (owner-bound) codes, re-credits discount_egp to the owner wallet and deactivates the code. Mig 205, audit F-08. Covers both orders.status writers plus reconcile_stale_card_orders.';

revoke all on function public.release_promo_on_order_terminal() from public, anon, authenticated;

drop trigger if exists orders_release_promo_on_terminal on public.orders;
create trigger orders_release_promo_on_terminal
  after update of status on public.orders
  for each row
  when (new.status in ('cancelled','rejected') and old.status is distinct from new.status)
  execute function public.release_promo_on_order_terminal();

-- --- F-09: conserve the remainder of a minted fixed-value code ---------------
create or replace function public.refund_minted_code_remainder()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_promo     public.promo_codes;
  v_remainder int;
begin
  select * into v_promo from public.promo_codes where id = new.promo_id;
  -- Only minted, fixed-value codes can strand value: percent codes have no
  -- fixed face value, and campaign codes are not wallet money.
  if v_promo.owner_user_id is null or v_promo.kind <> 'fixed' then
    return new;
  end if;
  v_remainder := v_promo.value - coalesce(new.discount_egp, 0);
  if v_remainder <= 0 then return new; end if;

  perform public.credit_wallet_internal(
    v_promo.owner_user_id, v_remainder, 'promo_remainder', new.order_id,
    'Unused value of minted code ' || v_promo.code || ' on order ' || new.order_id::text);
  return new;
exception when unique_violation then
  return new;
when others then
  begin perform public.ops_alert('PROMO REMAINDER REFUND FAILED for order ' || new.order_id::text || ': ' || sqlerrm); exception when others then null; end;
  return new;
end;
$$;

comment on function public.refund_minted_code_remainder() is
  'When a minted fixed-value code is redeemed for less than its face value, refunds value − discount_egp to the owner wallet at placement (the code is the owner''s own money). Mig 205, audit F-09.';

revoke all on function public.refund_minted_code_remainder() from public, anon, authenticated;

drop trigger if exists promo_redemptions_refund_remainder on public.promo_redemptions;
create trigger promo_redemptions_refund_remainder
  after insert on public.promo_redemptions
  for each row
  execute function public.refund_minted_code_remainder();

-- --- validate_promo: released redemptions no longer count per-user ------------
-- Restated from the live body (verified in recon) with the single change of
-- adding `and released_at is null` to the per_user_limit count. The max_uses
-- count is deliberately left counting released rows (see header).
create or replace function public.validate_promo(p_code text, p_subtotal integer)
returns integer
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_user uuid := auth.uid(); v_promo public.promo_codes; v_uses int; v_discount int;
  v_ref_owner uuid; v_friend int; v_min_sub int;
begin
  if p_code is null or btrim(p_code) = '' then return 0; end if;
  select id into v_ref_owner from public.users where upper(referral_code) = upper(btrim(p_code));
  if found then
    if v_user is null then return 0; end if;
    if v_ref_owner = v_user then return 0; end if;
    if public.has_completed_order(v_user) then return 0; end if;
    if exists (select 1 from public.referrals where referred_id = v_user) then return 0; end if;
    select coalesce((value #>> '{}')::int, 50) into v_friend from public.platform_settings where key = 'referral_friend_discount_egp';
    select coalesce((value #>> '{}')::int, 150) into v_min_sub from public.platform_settings where key = 'referral_min_subtotal_egp';
    if coalesce(p_subtotal,0) < coalesce(v_min_sub,150) then return 0; end if;
    return greatest(0, least(coalesce(v_friend,50), coalesce(p_subtotal,0)));
  end if;
  select * into v_promo from public.promo_codes where upper(code) = upper(btrim(p_code)) and is_active;
  if not found then return 0; end if;
  -- [058] owner-bound minted reward code: only its owner may redeem it.
  if v_promo.owner_user_id is not null and v_promo.owner_user_id <> coalesce(v_user, '00000000-0000-0000-0000-000000000000'::uuid) then
    return 0;
  end if;
  if v_promo.valid_from is not null and now() < v_promo.valid_from then return 0; end if;
  if v_promo.valid_to is not null and now() > v_promo.valid_to then return 0; end if;
  if v_promo.min_subtotal_egp is not null and coalesce(p_subtotal,0) < v_promo.min_subtotal_egp then return 0; end if;
  if v_promo.max_uses is not null then
    -- [205] max_uses counts ALL redemptions incl. released — a cancelled order
    -- still consumes one global slot (see mig 205 header).
    select count(*) into v_uses from public.promo_redemptions where promo_id = v_promo.id;
    if v_uses >= v_promo.max_uses then return 0; end if;
  end if;
  if v_promo.per_user_limit is not null and v_user is not null then
    -- [205] released redemptions do NOT count against per_user_limit, so a
    -- cancelled order re-opens the owner's one-time code.
    select count(*) into v_uses from public.promo_redemptions
     where promo_id = v_promo.id and user_id = v_user and released_at is null;
    if v_uses >= v_promo.per_user_limit then return 0; end if;
  end if;
  if v_promo.kind = 'percent' then v_discount := (coalesce(p_subtotal,0) * v_promo.value) / 100;
  else v_discount := v_promo.value; end if;
  if v_promo.max_discount_egp is not null then v_discount := least(v_discount, v_promo.max_discount_egp); end if;
  return greatest(0, least(v_discount, coalesce(p_subtotal,0)));
end;
$$;

revoke all on function public.validate_promo(text, integer) from public, anon;
grant execute on function public.validate_promo(text, integer) to anon, authenticated;

-- Prove exactly one overload survives (house rule 1 — PGRST202 guard).
do $$
declare v_n int;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'validate_promo';
  if v_n <> 1 then raise exception '[205] validate_promo has % overloads, expected 1', v_n; end if;
end $$;
