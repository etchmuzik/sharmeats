-- 123_restaurant_self_onboarding.sql
--
-- Restaurant self-onboarding (design: docs/superpowers/specs/2026-07-24-restaurant-self-onboarding-design.md).
-- Draft-restaurant-first: a merchant self-registers (Supabase auth), the wizard's
-- final step calls apply_as_restaurant() which creates their INACTIVE restaurants
-- row + merchant_staff owner link + role flip in one atomic definer call. Admin
-- approves via approve_restaurant(), which re-verifies the KYC + menu preconditions
-- INSIDE Postgres (UI checks are advisory — migs 081-084 lesson).
--
-- The existing restaurants_read policy (is_active OR is_merchant_staff(id) OR admin)
-- already hides drafts from customers and shows them to their owner — untouched.
-- Merchant menu-write policies (menu_sections/menu_items/modifiers/modifier_options)
-- already exist — untouched.
--
-- House invariants: SECURITY DEFINER + pinned search_path; REVOKE FROM PUBLIC, anon
-- then grant authenticated only; role checks fail closed via coalesce; authority
-- columns (onboarding_status, onboarding_rejection_reason, terms_version,
-- terms_accepted_at) get NO column UPDATE grant — these RPCs are their only writers.
-- Forward-only, idempotent. Rollback: drop the 3 functions and 4 columns.

-- ============================================================================
-- 1) Schema
-- ============================================================================
alter table public.restaurants
  add column if not exists onboarding_status text not null default 'live'
    check (onboarding_status in ('draft','submitted','approved','live','rejected')),
  add column if not exists onboarding_rejection_reason text,
  add column if not exists terms_version text,
  add column if not exists terms_accepted_at timestamptz;

comment on column public.restaurants.onboarding_status is
  'Self-onboarding workflow state (mig 123). live = pre-feature/admin-created.'
  ' is_active stays the sole customer-visibility switch; this is workflow state.'
  ' Written ONLY by apply_as_restaurant/approve_restaurant.';
comment on column public.restaurants.terms_version is
  'Merchant terms version accepted at application (server-stamped by apply_as_restaurant).';

create index if not exists restaurants_onboarding_queue_idx
  on public.restaurants (created_at)
  where onboarding_status in ('submitted','rejected');

-- Stale default: FINANCIALS.md standard commission is 15%.
alter table public.restaurants alter column commission_pct set default 15.0;

-- ============================================================================
-- 2) apply_as_restaurant — the wizard submit. Caller = the prospective owner.
-- ============================================================================
create or replace function public.apply_as_restaurant(
  p_name            text,
  p_description     text,
  p_cuisines        public.cuisine_type[],
  p_phone           text,
  p_address         text,
  p_zone            public.zone_type,
  p_lat             double precision,
  p_lng             double precision,
  p_is_open_24h     boolean,
  p_prep_low        int,
  p_prep_high       int,
  p_payout_method   text,
  p_payout_bank_name text,
  p_payout_iban     text,
  p_payout_wallet   text,
  p_payout_holder   text,
  p_terms_version   text
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_existing uuid;
  v_slug text;
  v_base_slug text;
  v_restaurant_id uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;

  -- Idempotent: an account already linked to a restaurant returns that id.
  select restaurant_id into v_existing
    from public.merchant_staff where profile_id = v_uid limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  -- Fail closed on role: only plain customers may apply (admin/driver/dispatcher
  -- accounts are operational identities, not merchant prospects).
  select coalesce(role::text, '') into v_role from public.users where id = v_uid;
  if v_role is distinct from 'customer' then
    raise exception 'NOT_ELIGIBLE' using errcode = 'check_violation';
  end if;

  -- Input validation (fail fast, typed codes the web maps to copy).
  if p_name is null or length(btrim(p_name)) not between 2 and 120 then
    raise exception 'INVALID_NAME' using errcode = 'check_violation';
  end if;
  if p_phone is null or length(btrim(p_phone)) not between 6 and 20 then
    raise exception 'INVALID_PHONE' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.zones where id = p_zone and is_active) then
    raise exception 'ZONE_NOT_SERVED' using errcode = 'check_violation';
  end if;
  -- Sharm el-Sheikh sanity box — no zone geometry exists in the schema, so this
  -- is a plausibility gate, not a service-radius proof (admin verifies on review).
  if p_lat is null or p_lng is null
     or p_lat not between 27.70 and 28.35
     or p_lng not between 34.20 and 34.70 then
    raise exception 'GEO_OUT_OF_AREA' using errcode = 'check_violation';
  end if;
  if p_terms_version is null or btrim(p_terms_version) = '' then
    raise exception 'TERMS_REQUIRED' using errcode = 'check_violation';
  end if;

  -- Unique slug from the name; collision gets a short random suffix.
  v_base_slug := btrim(regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g'), '-');
  if v_base_slug = '' then v_base_slug := 'restaurant'; end if;
  v_slug := v_base_slug;
  while exists (select 1 from public.restaurants where slug = v_slug) loop
    v_slug := v_base_slug || '-' || substr(md5(clock_timestamp()::text || random()::text), 1, 4);
  end loop;

  insert into public.restaurants (
    slug, name, description, cuisines, cuisine_label, cover_image, zone, geo,
    phone, address, is_open_24h, prep_time_low, prep_time_high,
    payout_method, payout_bank_name, payout_iban, payout_wallet, payout_holder,
    is_active, is_open, onboarding_status, commission_pct, tourist_safe,
    terms_version, terms_accepted_at
  ) values (
    v_slug, btrim(p_name), coalesce(btrim(p_description), ''), coalesce(p_cuisines, '{}'), '',
    '',  -- cover_image seeded by admin during menu review (RestaurantEditor)
    p_zone,
    st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
    btrim(p_phone), nullif(btrim(coalesce(p_address, '')), ''),
    coalesce(p_is_open_24h, false),
    coalesce(nullif(p_prep_low, 0), 10), coalesce(nullif(p_prep_high, 0), 30),
    nullif(btrim(coalesce(p_payout_method, '')), ''),
    nullif(btrim(coalesce(p_payout_bank_name, '')), ''),
    nullif(btrim(coalesce(p_payout_iban, '')), ''),
    nullif(btrim(coalesce(p_payout_wallet, '')), ''),
    nullif(btrim(coalesce(p_payout_holder, '')), ''),
    false,  -- is_active: invisible to customers until approve_restaurant
    false,  -- is_open: merchant flips Open from the dashboard once actually ready
    'submitted',
    15.0,
    false,
    btrim(p_terms_version),
    now()
  )
  returning id into v_restaurant_id;

  insert into public.merchant_staff (profile_id, restaurant_id, staff_role)
  values (v_uid, v_restaurant_id, 'owner');

  update public.users set role = 'merchant_staff', updated_at = now()
   where id = v_uid;

  -- Ops heads-up (Telegram via ops_alert). Best-effort: never block the apply.
  begin
    perform public.ops_alert(
      '🍽️ New restaurant application: ' || btrim(p_name) || ' (' || p_zone::text || ')'
    );
  exception when others then null;
  end;

  return v_restaurant_id;
end;
$function$;

revoke all on function public.apply_as_restaurant(
  text, text, public.cuisine_type[], text, text, public.zone_type,
  double precision, double precision, boolean, int, int,
  text, text, text, text, text, text
) from public, anon;
grant execute on function public.apply_as_restaurant(
  text, text, public.cuisine_type[], text, text, public.zone_type,
  double precision, double precision, boolean, int, int,
  text, text, text, text, text, text
) to authenticated;

comment on function public.apply_as_restaurant is
  'Wizard submit: atomically creates the caller''s INACTIVE restaurant (onboarding_status=submitted), merchant_staff owner link, role flip customer->merchant_staff, and terms stamp. Idempotent per account (returns existing restaurant id). Mig 123.';

-- ============================================================================
-- 3) approve_restaurant — admin go-live / reject. Preconditions verified HERE.
-- ============================================================================
create or replace function public.approve_restaurant(
  p_restaurant_id uuid,
  p_decision      text,
  p_reason        text default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_docs int;
  v_items int;
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;
  if coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;

  select name into v_name from public.restaurants
   where id = p_restaurant_id and onboarding_status in ('submitted','rejected');
  if v_name is null then
    raise exception 'RESTAURANT_NOT_FOUND' using errcode = 'check_violation';
  end if;

  if p_decision = 'approve' then
    -- 3 required doc types, each with an approved document (mig 075 trail).
    select count(distinct doc_type) into v_docs
      from public.kyc_documents
     where subject_type = 'restaurant' and subject_id = p_restaurant_id
       and status = 'approved'
       and doc_type in ('commercial_reg','tax_card','food_license');
    if v_docs < 3 then
      raise exception 'KYC_INCOMPLETE' using errcode = 'check_violation';
    end if;

    select count(*) into v_items
      from public.menu_items where restaurant_id = p_restaurant_id;
    if v_items < 1 then
      raise exception 'MENU_EMPTY' using errcode = 'check_violation';
    end if;

    update public.restaurants
       set onboarding_status = 'approved',
           is_active = true,
           -- is_open stays as-is (false from apply): the merchant opens when ready.
           onboarding_rejection_reason = null,
           updated_at = now()
     where id = p_restaurant_id;

    begin
      perform public.ops_alert('✅ Restaurant approved & live (closed until owner opens): ' || v_name);
    exception when others then null;
    end;

  elsif p_decision = 'reject' then
    if p_reason is null or btrim(p_reason) = '' then
      raise exception 'REASON_REQUIRED' using errcode = 'check_violation';
    end if;
    update public.restaurants
       set onboarding_status = 'rejected',
           is_active = false,
           onboarding_rejection_reason = btrim(p_reason),
           updated_at = now()
     where id = p_restaurant_id;

    begin
      perform public.ops_alert('❌ Restaurant application rejected: ' || v_name);
    exception when others then null;
    end;

  else
    raise exception 'INVALID_DECISION' using errcode = 'check_violation';
  end if;
end;
$function$;

revoke all on function public.approve_restaurant(uuid, text, text) from public, anon;
grant execute on function public.approve_restaurant(uuid, text, text) to authenticated;

comment on function public.approve_restaurant is
  'ADMIN: approve (requires 3 approved KYC docs + >=1 menu item — verified here, not in the UI) or reject (reason required) a submitted restaurant. Sole writer of onboarding_status. Mig 123.';

-- ============================================================================
-- 4) admin_set_commission — the negotiation override for the onboarding queue.
-- admin_update_restaurant (mig 098) deliberately excludes commission; this is
-- the single, audited path to change it.
-- ============================================================================
create or replace function public.admin_set_commission(
  p_restaurant_id uuid,
  p_pct           numeric
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;
  if coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  if p_pct is null or p_pct < 0 or p_pct > 50 then
    raise exception 'INVALID_COMMISSION' using errcode = 'check_violation';
  end if;
  update public.restaurants
     set commission_pct = p_pct, updated_at = now()
   where id = p_restaurant_id;
  if not found then
    raise exception 'RESTAURANT_NOT_FOUND' using errcode = 'check_violation';
  end if;
end;
$function$;

revoke all on function public.admin_set_commission(uuid, numeric) from public, anon;
grant execute on function public.admin_set_commission(uuid, numeric) to authenticated;

comment on function public.admin_set_commission is
  'ADMIN: set a restaurant''s commission_pct (0-50). The onboarding-queue negotiation override. Mig 123.';
