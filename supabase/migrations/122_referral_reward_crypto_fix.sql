-- 122_referral_reward_crypto_fix.sql
--
-- RUNTIME RPC HOTFIX — safe to apply to production AHEAD of migrations
-- 120/121/20260724120946 (it has zero coupling to unshipped app binaries).
--
-- Closes the last instance of the "pinned search_path + unqualified pgcrypto
-- call" defect class (final-state review, 2026-07-24). reward_referrer_on_delivery
-- pins search_path = public, pg_temp but calls unqualified gen_random_bytes,
-- which lives in the extensions schema — the call fails at runtime, the outer
-- `exception when others` swallows it, and referral rewards have silently never
-- minted since migration 081 went live (2026-07-03). A full-chain sweep confirmed
-- redeem_credit / redeem_points / review_kyc_document (repaired in 120) and this
-- trigger are the only call sites of the defect class.
--
-- Sections 2-4 carry forward migration 120's three function repairs VERBATIM
-- (identical bodies) so production gets every broken RPC fixed in one early
-- hotfix, while 120's app-coupled parts (kyc_update_own policy drop, push-token
-- dedupe + unique index, register_push_token) wait for the binary release train.
-- Applying 120 after this migration re-replaces the same bodies — a no-op.
-- Never edit these bodies here or in 120: any future change is a NEW migration.
--
-- Body below is the LATEST version (081_privilege_escalation_lockdown.sql)
-- verbatim, with only the crypto call schema-qualified. The orders trigger
-- (orders_reward_referrer, mig 026) stays attached across create-or-replace.
-- Forward-only and idempotent. Rollback = restore the 081 body via a new
-- migration (which would re-break reward minting — do not).
--
-- Backfill note: referrals stuck in reward_status='pending' whose order is
-- already delivered are NOT retro-rewarded here (money decision — needs an
-- owner-approved backfill with its own audit trail). Count them with:
--   select count(*) from referrals r join orders o on o.id = r.order_id
--   where r.reward_status = 'pending' and o.status = 'delivered';

create or replace function public.reward_referrer_on_delivery()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_ref public.referrals; v_reward int; v_code text;
begin
  if new.status <> 'delivered' or old.status = 'delivered' then return new; end if;
  select * into v_ref from public.referrals where order_id = new.id and reward_status = 'pending' for update;
  if not found then return new; end if;
  select coalesce((value #>> '{}')::int, 50) into v_reward from public.platform_settings where key = 'referral_referrer_reward_egp';
  v_code := 'REF-' || upper(encode(extensions.gen_random_bytes(16), 'hex'));
  -- [058] bind the reward code to the referrer.
  insert into public.promo_codes (code, kind, value, per_user_limit, is_active, owner_user_id)
  values (upper(v_code), 'fixed', greatest(1, coalesce(v_reward,50)), 1, true, v_ref.referrer_id);
  update public.referrals set reward_status = 'rewarded', reward_code = upper(v_code), rewarded_at = now() where id = v_ref.id;
  declare v_base text;
  begin
    select value #>> '{}' into v_base from public.platform_settings where key = 'functions_base_url';
    if v_base is not null and v_base <> '' then
      perform net.http_post(
        url := v_base || '/expo-push',
        body := jsonb_build_object('event','referral_rewarded','orderId',new.id::text,'recipientUserIds',jsonb_build_array(v_ref.referrer_id::text)),
        headers := public.push_headers());  -- [081] was hardcoded; restore secret
    end if;
  exception when others then null;
  end;
  return new;
exception when others then return new;
end;
$function$;

-- Trigger-only function (026): keep client roles locked out.
revoke all on function public.reward_referrer_on_delivery() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. redeem_credit — VERBATIM carry-forward of migration 120's repair
--    (latest body = 062 with the crypto call schema-qualified).
-- ---------------------------------------------------------------------------
create or replace function public.redeem_credit(p_amount_egp int)
returns text
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_balance int;
  v_code text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;
  if p_amount_egp is null or p_amount_egp <= 0 then
    raise exception 'INVALID_AMOUNT' using errcode = 'check_violation';
  end if;

  perform 1
    from public.customer_credit_balance
   where user_id = v_user
   for update;
  select balance_egp
    into v_balance
    from public.customer_credit_balance
   where user_id = v_user;
  if v_balance is null or v_balance < p_amount_egp then
    raise exception 'INSUFFICIENT_CREDIT' using errcode = 'check_violation';
  end if;

  v_code := 'CR-' || upper(encode(extensions.gen_random_bytes(16), 'hex'));
  insert into public.promo_codes
    (code, kind, value, per_user_limit, is_active, owner_user_id)
  values
    (upper(v_code), 'fixed', p_amount_egp, 1, true, v_user);

  update public.customer_credit_balance
     set balance_egp = balance_egp - p_amount_egp,
         updated_at = now()
   where user_id = v_user;
  insert into public.credit_ledger
    (user_id, delta_egp, reason, note)
  values
    (v_user, -p_amount_egp, 'redeem', 'Minted promo ' || upper(v_code));

  return upper(v_code);
end;
$$;
revoke all on function public.redeem_credit(int) from public, anon;
grant execute on function public.redeem_credit(int) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. redeem_points — VERBATIM carry-forward of migration 120's repair
--    (latest body = 113 with the crypto call schema-qualified).
-- ---------------------------------------------------------------------------
create or replace function public.redeem_points(p_points integer)
returns text
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_balance int;
  v_rate int;
  v_value_egp int;
  v_code text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;
  if p_points is null or p_points <= 0 then
    raise exception 'INVALID_POINTS' using errcode = 'check_violation';
  end if;

  perform 1
    from public.customer_loyalty
   where user_id = v_user
   for update;
  select points_balance
    into v_balance
    from public.customer_loyalty
   where user_id = v_user;
  if v_balance is null or v_balance < p_points then
    raise exception 'INSUFFICIENT_POINTS' using errcode = 'check_violation';
  end if;

  select coalesce((value #>> '{}')::int, 10)
    into v_rate
    from public.platform_settings
   where key = 'loyalty_points_per_egp';
  v_value_egp := greatest(1, (p_points * v_rate) / 100);

  v_code := 'LOY-' || upper(encode(extensions.gen_random_bytes(16), 'hex'));
  insert into public.promo_codes
    (code, kind, value, owner_user_id, per_user_limit, max_uses, is_active)
  values
    (upper(v_code), 'fixed', v_value_egp, v_user, 1, 1, true);

  update public.customer_loyalty
     set points_balance = points_balance - p_points,
         updated_at = now()
   where user_id = v_user;

  insert into public.loyalty_points_ledger
    (subject_type, subject_id, delta_points, reason)
  values
    ('customer', v_user, -p_points, 'redeem');

  return upper(v_code);
end;
$$;
revoke all on function public.redeem_points(integer) from public, anon;
grant execute on function public.redeem_points(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. review_kyc_document — VERBATIM carry-forward of migration 120's repair
--    (no nonexistent restaurants.verified write on rejection).
-- ---------------------------------------------------------------------------
create or replace function public.review_kyc_document(
  p_document_id uuid, p_approve boolean, p_note text default null
)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_doc public.kyc_documents;
  v_agent uuid := auth.uid();
begin
  if v_agent is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;
  if coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;

  update public.kyc_documents
     set status = case when p_approve then 'approved' else 'rejected' end::kyc_doc_status,
         review_note = nullif(btrim(coalesce(p_note, '')), ''),
         reviewed_by = v_agent,
         reviewed_at = now()
   where id = p_document_id
   returning * into v_doc;
  if not found then
    raise exception 'DOCUMENT_NOT_FOUND' using errcode = 'check_violation';
  end if;

  if not p_approve and v_doc.subject_type = 'driver' then
    update public.drivers
       set is_verified = false
     where id = v_doc.subject_id;
  end if;
end;
$$;
revoke all on function public.review_kyc_document(uuid, boolean, text)
  from public, anon;
grant execute on function public.review_kyc_document(uuid, boolean, text)
  to authenticated;

comment on function public.review_kyc_document is
  'ADMIN: approve/reject KYC evidence. Driver rejection also clears drivers.is_verified. Restaurant verification is represented by document status; restaurants has no verification flag.';

-- ---------------------------------------------------------------------------
-- 5. Hygiene from the same sweep: handle_new_auth_user was the only pinned
--    function omitting pg_temp from its search_path.
-- ---------------------------------------------------------------------------
alter function public.handle_new_auth_user() set search_path = public, pg_temp;
