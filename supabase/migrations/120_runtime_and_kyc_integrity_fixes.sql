-- 120_runtime_and_kyc_integrity_fixes.sql
--
-- Fixes verified by the 2026-07-24 live audit:
--   1. redeem_credit/redeem_points cannot resolve gen_random_bytes because
--      their SECURITY DEFINER search_path excludes the extensions schema.
--   2. rejecting restaurant KYC calls restaurants.verified, which does not
--      exist (restaurant verification is document-status based today).
--   3. KYC owners can UPDATE Storage objects after an admin reviewed them.
--   4. One Expo device token can remain registered to multiple user accounts.
--
-- Forward-only and idempotent. Rollback, if ever required, is a new migration:
-- restore the prior function bodies and explicitly recreate kyc_update_own.

-- ---------------------------------------------------------------------------
-- KYC evidence is immutable. A re-submission is a new timestamped object and a
-- new pending kyc_documents row; owners may never replace reviewed bytes.
-- ---------------------------------------------------------------------------
drop policy if exists "kyc_update_own" on storage.objects;

-- ---------------------------------------------------------------------------
-- Push-token ownership: a physical app/device token belongs to exactly one
-- current account. Keep the most recently refreshed legacy row, then make the
-- invariant global and expose an authenticated transfer RPC. This closes the
-- shared-device case where the previous user kept receiving order/offer pushes.
-- ---------------------------------------------------------------------------
with ranked as (
  select
    id,
    row_number() over (
      partition by token
      order by updated_at desc, created_at desc, id desc
    ) as position
  from public.push_tokens
)
delete from public.push_tokens as token
using ranked
where token.id = ranked.id
  and ranked.position > 1;

create unique index if not exists push_tokens_token_uidx
  on public.push_tokens(token);

create or replace function public.register_push_token(
  p_token text, p_platform text
)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_token text := nullif(btrim(coalesce(p_token, '')), '');
  v_platform text := lower(nullif(btrim(coalesce(p_platform, '')), ''));
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;
  if v_token is null or length(v_token) < 20 or length(v_token) > 512 then
    raise exception 'INVALID_PUSH_TOKEN' using errcode = 'check_violation';
  end if;
  if v_platform is null or v_platform not in ('ios', 'android', 'web') then
    raise exception 'INVALID_PLATFORM' using errcode = 'check_violation';
  end if;

  insert into public.push_tokens (user_id, token, platform)
  values (v_user, v_token, v_platform)
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        updated_at = now();
end;
$$;
revoke all on function public.register_push_token(text, text)
  from public, anon;
grant execute on function public.register_push_token(text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- review_kyc_document: keep the current signature and behavior, but do not
-- write a nonexistent restaurants.verified column on rejection. Drivers retain
-- their real is_verified revocation; restaurant verification remains expressed
-- by the reviewed document statuses until a canonical restaurant flag exists.
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
-- redeem_credit: body is the migration-062 version with the crypto function
-- schema-qualified and execution narrowed explicitly.
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
-- redeem_points: body is the migration-113 owner-bound/single-use version with
-- only the crypto function schema-qualified and grants made explicit.
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
