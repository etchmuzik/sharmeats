# Restaurant Self-Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A restaurant owner self-registers in merchant-web, submits their restaurant + KYC docs, and goes live after admin approval — admin's only touch is doc review, menu seeding, and one Approve click.

**Architecture:** Draft-restaurant-first. One SECURITY DEFINER RPC (`apply_as_restaurant`) atomically creates an inactive `restaurants` row + `merchant_staff` owner link + role flip at wizard submit; a second admin-only RPC (`approve_restaurant`) verifies 3 approved KYC docs + a seeded menu inside Postgres before flipping `is_active`. All existing infra is reused: mig 075/076 KYC trail, `restaurants_read` draft-hiding policy, merchant write policies on menu tables (already exist — menu editing is UI-only work).

**Tech Stack:** Postgres/Supabase (migration 120), Next.js 15 client-side SPA (merchant-web :3001, admin-web :3002, both static-export), supabase-js v2, vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-07-24-restaurant-self-onboarding-design.md`

## Global Constraints

- **Monorepo rule:** every app manages its own `node_modules`; run npm commands from inside the app dir (`cd apps/merchant-web && npm run test`), never via root workspaces.
- **Migration house rules (CLAUDE.md):** new migration number **120** (max existing is 119); brand-new function names only (`apply_as_restaurant`, `approve_restaurant`, `admin_set_commission` — no existing overloads, verified); every SECURITY DEFINER fn pins `search_path` and does `REVOKE ALL ... FROM PUBLIC, anon` before granting; role checks fail closed via `coalesce(...) <> 'admin'`; validate with a tx-wrapped dry run before prod; never edit applied migrations.
- **Authority columns:** `restaurants.onboarding_status`, `onboarding_rejection_reason`, `terms_version`, `terms_accepted_at` get **no column UPDATE grant** — only the new RPCs write them.
- **Money:** commission stays `numeric`; no floats introduced anywhere.
- **KYC doc-type strings (must match existing data + admin `/kyc` labels):** `commercial_reg`, `tax_card`, `food_license` (see `apps/restaurant/src/kyc.ts:16`).
- **Merchant terms version string:** `2026-07-24-merchant-v1` (constant, used in SQL + wizard).
- **Copy language:** EN only — merchant-web has no i18n framework today; matching the surface's existing approach. (Deviation from spec's "EN + AR" noted at plan review.)
- **Sharm geo sanity box:** lat ∈ [27.70, 28.35], lng ∈ [34.20, 34.70].
- **Prod applies are owner-gated:** Task 2 pauses for explicit human confirmation before `apply_migration`.
- **Branch:** all work on `feat/restaurant-self-onboarding` off `main`; conventional commits; PR at the end.
- After schema change: `npm run db:types` from repo root, commit the regenerated `packages/db-types/database.types.ts`.
- Every surface touched must pass its own `npm run typecheck` (and `npm test` where it exists) before the final PR.

## File Structure

```
supabase/migrations/120_restaurant_self_onboarding.sql   (new — schema + 3 RPCs)
packages/db-types/database.types.ts                      (regenerated)
apps/merchant-web/src/lib/onboarding.ts                  (new — types, phase resolver, RPC wrappers, error copy)
apps/merchant-web/src/lib/onboarding.test.ts             (new — pure-logic tests)
apps/merchant-web/src/lib/wizardDraft.ts                 (new — draft persistence + per-step validation)
apps/merchant-web/src/lib/wizardDraft.test.ts            (new)
apps/merchant-web/src/lib/kyc.ts                         (new — web KYC upload/list, mirrors apps/restaurant/src/kyc.ts)
apps/merchant-web/src/app/signup/page.tsx                (new — partner signup)
apps/merchant-web/src/app/onboarding/Wizard.tsx          (new — 4-step wizard, rendered by root page)
apps/merchant-web/src/app/onboarding/ApplicationStatus.tsx (new — checklist + KYC upload + rejected notice)
apps/merchant-web/src/app/page.tsx                       (modify — phase machine gains onboarding states)
apps/merchant-web/src/app/menu/page.tsx                  (new — guard + own-restaurant menu route)
apps/merchant-web/src/app/menu/MenuManager.tsx           (new — copied from admin-web, unchanged)
apps/merchant-web/src/app/menu/fields.tsx                (new — copied from admin-web, unchanged)
apps/admin-web/src/app/onboarding/page.tsx               (new — approval queue)
apps/admin-web/src/app/page.tsx                          (modify — nav card)
apps/admin-web/src/app/menu/page.tsx                     (modify — ?restaurant= preselect)
landing/                                                 (modify — one "Partner with us" link; locate exact file in Task 10)
```

---

### Task 1: Migration 120 — schema + RPCs, validated by tx-wrapped dry run

**Files:**
- Create: `supabase/migrations/120_restaurant_self_onboarding.sql`
- Create: `/private/tmp/claude-501/-Users-etch-Downloads-sharmeats/*/scratchpad/mig120_dryrun.sql` (scratch test harness — not committed)

**Interfaces:**
- Produces (later tasks call these via `supabase.rpc(...)`):
  - `apply_as_restaurant(p_name text, p_description text, p_cuisines cuisine_type[], p_phone text, p_address text, p_zone zone_type, p_lat double precision, p_lng double precision, p_is_open_24h boolean, p_prep_low int, p_prep_high int, p_payout_method text, p_payout_bank_name text, p_payout_iban text, p_payout_wallet text, p_payout_holder text, p_terms_version text) returns uuid`
  - `approve_restaurant(p_restaurant_id uuid, p_decision text, p_reason text default null) returns void`
  - `admin_set_commission(p_restaurant_id uuid, p_pct numeric) returns void`
  - New `restaurants` columns: `onboarding_status`, `onboarding_rejection_reason`, `terms_version`, `terms_accepted_at`
  - Error codes raised (all `errcode = 'check_violation'`): `AUTH_REQUIRED`, `NOT_ELIGIBLE`, `INVALID_NAME`, `INVALID_PHONE`, `ZONE_NOT_SERVED`, `GEO_OUT_OF_AREA`, `TERMS_REQUIRED`, `NOT_AUTHORIZED`, `RESTAURANT_NOT_FOUND`, `INVALID_DECISION`, `REASON_REQUIRED`, `KYC_INCOMPLETE`, `MENU_EMPTY`

- [ ] **Step 1: Create branch**

```bash
cd /Users/etch/Downloads/sharmeats
git checkout main && git pull && git checkout -b feat/restaurant-self-onboarding
```

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/120_restaurant_self_onboarding.sql` with exactly:

```sql
-- 120_restaurant_self_onboarding.sql
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
  'Self-onboarding workflow state (mig 120). live = pre-feature/admin-created.'
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
  v_base_slug := btrim(both '-' from regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g'));
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
  'Wizard submit: atomically creates the caller''s INACTIVE restaurant (onboarding_status=submitted), merchant_staff owner link, role flip customer->merchant_staff, and terms stamp. Idempotent per account (returns existing restaurant id). Mig 120.';

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
  'ADMIN: approve (requires 3 approved KYC docs + >=1 menu item — verified here, not in the UI) or reject (reason required) a submitted restaurant. Sole writer of onboarding_status. Mig 120.';

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
  'ADMIN: set a restaurant''s commission_pct (0-50). The onboarding-queue negotiation override. Mig 120.';
```

- [ ] **Step 3: Write the dry-run behavior test**

Create `mig120_dryrun.sql` in the session scratchpad directory. It wraps the ENTIRE migration + behavior assertions in one transaction that always rolls back — safe against prod:

```sql
begin;

\i supabase/migrations/120_restaurant_self_onboarding.sql

do $test$
declare
  v_applicant uuid := gen_random_uuid();
  v_admin     uuid := gen_random_uuid();
  v_rid       uuid;
  v_rid2      uuid;
  v_section   uuid;
  v_caught    boolean;
begin
  -- Fixture profiles (public.users only; auth.uid() is faked via jwt claims).
  insert into public.users (id, phone, display_name, locale, preferred_currency, role)
  values (v_applicant, '+201000000001', 'Applicant', 'en', 'EGP', 'customer'),
         (v_admin,     '+201000000002', 'Admin',     'en', 'EGP', 'admin');

  -- ---- act as the applicant -------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_applicant, 'role', 'authenticated')::text, true);

  v_rid := public.apply_as_restaurant(
    'Test Kitchen 120', 'A test kitchen', array['egyptian']::cuisine_type[],
    '+201234567890', '12 Test St', 'naama', 27.91, 34.33,
    false, 15, 30, 'bank', 'CIB', 'EG0000', null, 'Test Owner',
    '2026-07-24-merchant-v1');

  -- Draft invariants.
  perform 1 from public.restaurants
   where id = v_rid and is_active = false and is_open = false
     and onboarding_status = 'submitted' and commission_pct = 15.0
     and terms_version = '2026-07-24-merchant-v1' and terms_accepted_at is not null;
  if not found then raise exception 'FAIL: draft row invariants'; end if;

  perform 1 from public.merchant_staff
   where profile_id = v_applicant and restaurant_id = v_rid and staff_role = 'owner';
  if not found then raise exception 'FAIL: merchant_staff owner link'; end if;

  perform 1 from public.users where id = v_applicant and role = 'merchant_staff';
  if not found then raise exception 'FAIL: role flip'; end if;

  -- Idempotent second call returns the same id (and does not error on role).
  v_rid2 := public.apply_as_restaurant(
    'Test Kitchen 120', null, null, '+201234567890', null, 'naama', 27.91, 34.33,
    false, 15, 30, null, null, null, null, null, '2026-07-24-merchant-v1');
  if v_rid2 <> v_rid then raise exception 'FAIL: idempotency'; end if;

  -- Geo box rejection.
  begin
    v_caught := false;
    perform public.apply_as_restaurant(
      'Cairo Kitchen', null, null, '+201234567890', null, 'naama', 30.0, 31.2,
      false, 15, 30, null, null, null, null, null, 'v1');
  exception when others then
    v_caught := (sqlerrm like '%GEO_OUT_OF_AREA%' or sqlerrm like '%NOT_ELIGIBLE%');
  end;
  if not v_caught then raise exception 'FAIL: geo box not enforced'; end if;

  -- ---- act as the admin -------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- Approve must fail: no docs yet.
  begin
    v_caught := false;
    perform public.approve_restaurant(v_rid, 'approve');
  exception when others then v_caught := sqlerrm like '%KYC_INCOMPLETE%';
  end;
  if not v_caught then raise exception 'FAIL: approve without KYC allowed'; end if;

  -- Seed 3 approved docs.
  insert into public.kyc_documents (subject_type, subject_id, doc_type, storage_path, status)
  values ('restaurant', v_rid, 'commercial_reg', 't/cr.jpg', 'approved'),
         ('restaurant', v_rid, 'tax_card',       't/tc.jpg', 'approved'),
         ('restaurant', v_rid, 'food_license',   't/fl.jpg', 'approved');

  -- Approve must still fail: empty menu.
  begin
    v_caught := false;
    perform public.approve_restaurant(v_rid, 'approve');
  exception when others then v_caught := sqlerrm like '%MENU_EMPTY%';
  end;
  if not v_caught then raise exception 'FAIL: approve with empty menu allowed'; end if;

  -- Seed one menu item, then approve for real.
  insert into public.menu_sections (restaurant_id, name) values (v_rid, 'Mains')
  returning id into v_section;
  insert into public.menu_items (restaurant_id, section_id, name, price_egp)
  values (v_rid, v_section, 'Koshary', 90);

  perform public.approve_restaurant(v_rid, 'approve');
  perform 1 from public.restaurants
   where id = v_rid and onboarding_status = 'approved'
     and is_active = true and is_open = false;
  if not found then raise exception 'FAIL: approve outcome'; end if;

  -- Reject requires a reason.
  update public.restaurants set onboarding_status = 'submitted', is_active = false
   where id = v_rid;  -- rewind (inside the same definer-free tx; we are superuser here)
  begin
    v_caught := false;
    perform public.approve_restaurant(v_rid, 'reject');
  exception when others then v_caught := sqlerrm like '%REASON_REQUIRED%';
  end;
  if not v_caught then raise exception 'FAIL: reject without reason allowed'; end if;

  perform public.approve_restaurant(v_rid, 'reject', 'Docs unreadable');
  perform 1 from public.restaurants
   where id = v_rid and onboarding_status = 'rejected'
     and is_active = false and onboarding_rejection_reason = 'Docs unreadable';
  if not found then raise exception 'FAIL: reject outcome'; end if;

  -- Non-admin cannot approve.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_applicant, 'role', 'authenticated')::text, true);
  begin
    v_caught := false;
    perform public.approve_restaurant(v_rid, 'approve');
  exception when others then v_caught := sqlerrm like '%NOT_AUTHORIZED%';
  end;
  if not v_caught then raise exception 'FAIL: non-admin approve allowed'; end if;

  -- Privilege layer: anon must NOT be able to execute the new fns.
  if has_function_privilege('anon',
      'public.apply_as_restaurant(text,text,cuisine_type[],text,text,zone_type,double precision,double precision,boolean,int,int,text,text,text,text,text,text)',
      'execute') then
    raise exception 'FAIL: anon can execute apply_as_restaurant';
  end if;
  if has_function_privilege('anon', 'public.approve_restaurant(uuid,text,text)', 'execute') then
    raise exception 'FAIL: anon can execute approve_restaurant';
  end if;

  -- Authority columns: authenticated has no UPDATE grant on onboarding_status.
  if exists (
    select 1 from information_schema.column_privileges
    where table_name = 'restaurants' and column_name = 'onboarding_status'
      and grantee in ('authenticated','anon') and privilege_type = 'UPDATE'
  ) then
    raise exception 'FAIL: onboarding_status has a client UPDATE grant';
  end if;

  raise notice 'ALL MIG-120 BEHAVIOR CHECKS PASSED';
end;
$test$;

rollback;
```

- [ ] **Step 4: Run the dry run and verify it passes**

The `\i` meta-command needs psql; when running via the Supabase MCP `execute_sql` instead, paste the migration file content in place of the `\i` line (single batch: `begin; <migration SQL> <do-block> rollback;`).

Expected output: `NOTICE: ALL MIG-120 BEHAVIOR CHECKS PASSED` and no error. If any `FAIL:` raises, fix the migration (not the test) and re-run.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/120_restaurant_self_onboarding.sql
git commit -m "feat(db): restaurant self-onboarding schema + RPCs (mig 120)"
```

---

### Task 2: Apply migration 120 to prod (OWNER-GATED) + regenerate types

**Files:**
- Modify: `packages/db-types/database.types.ts` (regenerated)

**Interfaces:**
- Consumes: Task 1's migration file.
- Produces: prod schema with mig 120; regenerated DB types (merchant-web/admin-web use loose `supabase.rpc()` calls, so types are for consistency, not compilation blockers).

- [ ] **Step 1: STOP — get explicit human confirmation to apply migration 120 to prod.** Do not proceed on silence.

- [ ] **Step 2: Apply and verify**

Apply via Supabase MCP `apply_migration` with name `120_restaurant_self_onboarding` and the file's content. Then verify exactly one overload of each new function and run advisors:

```sql
select proname, pg_get_function_identity_arguments(oid)
from pg_proc where proname in ('apply_as_restaurant','approve_restaurant','admin_set_commission');
```

Expected: exactly 3 rows (one per function). Then run `get_advisors` (security): expect **no new** findings vs the pre-migration baseline.

- [ ] **Step 3: Regenerate types**

```bash
cd /Users/etch/Downloads/sharmeats && npm run db:types
git add packages/db-types/database.types.ts
git commit -m "chore(db-types): regenerate for mig 120"
```

---

### Task 3: merchant-web onboarding data layer (pure logic, TDD)

**Files:**
- Create: `apps/merchant-web/src/lib/onboarding.ts`
- Create: `apps/merchant-web/src/lib/onboarding.test.ts`

**Interfaces:**
- Produces (used by Tasks 5–7):
  - `type OnboardingPhase = 'none' | 'submitted' | 'rejected' | 'active'`
  - `resolveOnboardingPhase(staff: StaffOnboardingRow | null | undefined): OnboardingPhase`
  - `interface StaffOnboardingRow { restaurant_id: string; restaurants: { onboarding_status: string; onboarding_rejection_reason: string | null; name: string } }`
  - `rpcErrorToCopy(message: string): string`
  - `MERCHANT_TERMS_VERSION = '2026-07-24-merchant-v1'`
  - `interface RestaurantApplication` (all wizard fields) and `applyAsRestaurant(supabase, app): Promise<string>`

- [ ] **Step 1: Write the failing tests**

`apps/merchant-web/src/lib/onboarding.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { resolveOnboardingPhase, rpcErrorToCopy } from './onboarding';

const staff = (onboarding_status: string) => ({
  restaurant_id: 'r1',
  restaurants: { onboarding_status, onboarding_rejection_reason: null, name: 'T' },
});

describe('resolveOnboardingPhase', () => {
  it('is none with no staff link', () => {
    expect(resolveOnboardingPhase(null)).toBe('none');
    expect(resolveOnboardingPhase(undefined)).toBe('none');
  });
  it('maps submitted', () => {
    expect(resolveOnboardingPhase(staff('submitted'))).toBe('submitted');
  });
  it('maps rejected', () => {
    expect(resolveOnboardingPhase(staff('rejected'))).toBe('rejected');
  });
  it('approved and live (and legacy/unknown) are active', () => {
    expect(resolveOnboardingPhase(staff('approved'))).toBe('active');
    expect(resolveOnboardingPhase(staff('live'))).toBe('active');
    expect(resolveOnboardingPhase(staff('draft'))).toBe('active'); // never client-visible; fail open to dashboard
  });
});

describe('rpcErrorToCopy', () => {
  it('maps every typed code to human copy', () => {
    expect(rpcErrorToCopy('ZONE_NOT_SERVED')).toMatch(/don.t deliver/i);
    expect(rpcErrorToCopy('GEO_OUT_OF_AREA')).toMatch(/Sharm/i);
    expect(rpcErrorToCopy('NOT_ELIGIBLE')).toMatch(/account/i);
    expect(rpcErrorToCopy('INVALID_NAME')).toMatch(/name/i);
    expect(rpcErrorToCopy('INVALID_PHONE')).toMatch(/phone/i);
    expect(rpcErrorToCopy('TERMS_REQUIRED')).toMatch(/terms/i);
  });
  it('embedded codes still match (Postgres prefixes messages)', () => {
    expect(rpcErrorToCopy('P0001: ZONE_NOT_SERVED')).toMatch(/don.t deliver/i);
  });
  it('unknown errors get the generic fallback', () => {
    expect(rpcErrorToCopy('something odd')).toMatch(/try again/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/merchant-web && npx vitest run src/lib/onboarding.test.ts
```

Expected: FAIL — `Cannot find module './onboarding'`.

- [ ] **Step 3: Implement**

`apps/merchant-web/src/lib/onboarding.ts`:

```typescript
/**
 * Self-onboarding data layer (mig 120).
 * Pure helpers are exported separately from the client wrappers so they can be
 * unit-tested without a Supabase client.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const MERCHANT_TERMS_VERSION = '2026-07-24-merchant-v1';

export type OnboardingPhase = 'none' | 'submitted' | 'rejected' | 'active';

export interface StaffOnboardingRow {
  restaurant_id: string;
  restaurants: {
    onboarding_status: string;
    onboarding_rejection_reason: string | null;
    name: string;
  };
}

export function resolveOnboardingPhase(
  staff: StaffOnboardingRow | null | undefined,
): OnboardingPhase {
  if (!staff) return 'none';
  const s = staff.restaurants.onboarding_status;
  if (s === 'submitted') return 'submitted';
  if (s === 'rejected') return 'rejected';
  // approved / live / anything unexpected → normal dashboard (RLS keeps drafts
  // customer-invisible regardless of what the client renders).
  return 'active';
}

const ERROR_COPY: Record<string, string> = {
  ZONE_NOT_SERVED: "We don't deliver in that area yet — pick the closest served zone, or contact us and we'll keep your details.",
  GEO_OUT_OF_AREA: 'That location looks outside Sharm el-Sheikh. Please set your restaurant’s actual position.',
  NOT_ELIGIBLE: 'This account type can’t apply as a restaurant. Sign up with a fresh email for your business.',
  INVALID_NAME: 'Please enter your restaurant name (2–120 characters).',
  INVALID_PHONE: 'Please enter a valid contact phone number.',
  TERMS_REQUIRED: 'You need to accept the partner terms to submit.',
  AUTH_REQUIRED: 'Your session expired — please log in again.',
};

export function rpcErrorToCopy(message: string): string {
  for (const code of Object.keys(ERROR_COPY)) {
    if (message.includes(code)) return ERROR_COPY[code];
  }
  return 'Something went wrong submitting your application. Please try again.';
}

export interface RestaurantApplication {
  name: string;
  description: string;
  cuisines: string[];
  phone: string;
  address: string;
  zone: string;
  lat: number;
  lng: number;
  isOpen24h: boolean;
  prepLow: number;
  prepHigh: number;
  payoutMethod: 'bank' | 'wallet';
  payoutBankName: string;
  payoutIban: string;
  payoutWallet: string;
  payoutHolder: string;
}

/** Calls apply_as_restaurant; resolves to the new restaurant id. Throws Error with raw RPC message (map with rpcErrorToCopy at the UI). */
export async function applyAsRestaurant(
  supabase: SupabaseClient,
  app: RestaurantApplication,
): Promise<string> {
  const { data, error } = await supabase.rpc('apply_as_restaurant', {
    p_name: app.name,
    p_description: app.description,
    p_cuisines: app.cuisines,
    p_phone: app.phone,
    p_address: app.address,
    p_zone: app.zone,
    p_lat: app.lat,
    p_lng: app.lng,
    p_is_open_24h: app.isOpen24h,
    p_prep_low: app.prepLow,
    p_prep_high: app.prepHigh,
    p_payout_method: app.payoutMethod,
    p_payout_bank_name: app.payoutBankName,
    p_payout_iban: app.payoutIban,
    p_payout_wallet: app.payoutWallet,
    p_payout_holder: app.payoutHolder,
    p_terms_version: MERCHANT_TERMS_VERSION,
  });
  if (error) throw new Error(error.message);
  return data as string;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/merchant-web && npx vitest run src/lib/onboarding.test.ts
```

Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add apps/merchant-web/src/lib/onboarding.ts apps/merchant-web/src/lib/onboarding.test.ts
git commit -m "feat(merchant-web): onboarding data layer with typed error copy"
```

---

### Task 4: merchant-web wizard draft persistence + validation (TDD)

**Files:**
- Create: `apps/merchant-web/src/lib/wizardDraft.ts`
- Create: `apps/merchant-web/src/lib/wizardDraft.test.ts`

**Interfaces:**
- Produces (used by Task 5):
  - `interface WizardDraft` — superset of `RestaurantApplication` with nullable geo
  - `emptyDraft(): WizardDraft`
  - `loadDraft(storage: Pick<Storage,'getItem'>): WizardDraft` / `saveDraft(storage, draft)` / `clearDraft(storage)`
  - `validateStep(step: 1|2|3|4, d: WizardDraft): string | null` — returns human error or null when valid
  - `draftToApplication(d: WizardDraft): RestaurantApplication` — call only after steps validate

- [ ] **Step 1: Write the failing tests**

`apps/merchant-web/src/lib/wizardDraft.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  emptyDraft, loadDraft, saveDraft, clearDraft, validateStep, draftToApplication,
} from './wizardDraft';

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(), key: () => null, length: 0,
  } as Storage;
}

describe('draft persistence', () => {
  it('round-trips through storage', () => {
    const s = memStorage();
    const d = { ...emptyDraft(), name: 'Koshary King', zone: 'naama' };
    saveDraft(s, d);
    expect(loadDraft(s)).toEqual(d);
  });
  it('corrupt storage yields a fresh draft', () => {
    const s = memStorage();
    s.setItem('sharmeats-merchant-onboarding-draft', '{not json');
    expect(loadDraft(s)).toEqual(emptyDraft());
  });
  it('clearDraft removes it', () => {
    const s = memStorage();
    saveDraft(s, emptyDraft());
    clearDraft(s);
    expect(s.getItem('sharmeats-merchant-onboarding-draft')).toBeNull();
  });
});

describe('validateStep', () => {
  it('step 1 requires name and phone', () => {
    expect(validateStep(1, emptyDraft())).toMatch(/name/i);
    const named = { ...emptyDraft(), name: 'Koshary King' };
    expect(validateStep(1, named)).toMatch(/phone/i);
    expect(validateStep(1, { ...named, phone: '+201234567890' })).toBeNull();
  });
  it('step 2 requires zone and in-box coordinates', () => {
    const base = { ...emptyDraft(), name: 'K', phone: '+201234567890' };
    expect(validateStep(2, base)).toMatch(/zone/i);
    const zoned = { ...base, zone: 'naama' };
    expect(validateStep(2, zoned)).toMatch(/location/i);
    expect(validateStep(2, { ...zoned, lat: 27.91, lng: 34.33 })).toBeNull();
    expect(validateStep(2, { ...zoned, lat: 30.0, lng: 31.2 })).toMatch(/Sharm/i);
  });
  it('step 3 requires payout details for the chosen method', () => {
    const d = { ...emptyDraft(), payoutMethod: 'bank' as const };
    expect(validateStep(3, d)).toMatch(/IBAN|bank/i);
    expect(validateStep(3, { ...d, payoutBankName: 'CIB', payoutIban: 'EG00', payoutHolder: 'Me' })).toBeNull();
    const w = { ...emptyDraft(), payoutMethod: 'wallet' as const };
    expect(validateStep(3, w)).toMatch(/wallet/i);
    expect(validateStep(3, { ...w, payoutWallet: '+2010', payoutHolder: 'Me' })).toBeNull();
  });
  it('step 4 requires terms acceptance', () => {
    expect(validateStep(4, emptyDraft())).toMatch(/terms/i);
    expect(validateStep(4, { ...emptyDraft(), termsAccepted: true })).toBeNull();
  });
});

describe('draftToApplication', () => {
  it('produces trimmed application fields', () => {
    const d = {
      ...emptyDraft(), name: '  Koshary King ', phone: ' +2012 ', zone: 'naama',
      lat: 27.91, lng: 34.33, termsAccepted: true,
    };
    const app = draftToApplication(d);
    expect(app.name).toBe('Koshary King');
    expect(app.phone).toBe('+2012');
    expect(app.lat).toBe(27.91);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/merchant-web && npx vitest run src/lib/wizardDraft.test.ts
```

Expected: FAIL — `Cannot find module './wizardDraft'`.

- [ ] **Step 3: Implement**

`apps/merchant-web/src/lib/wizardDraft.ts`:

```typescript
/**
 * Onboarding wizard draft: localStorage persistence + per-step validation.
 * Pure functions (storage injected) so vitest covers them without a DOM.
 */
import type { RestaurantApplication } from './onboarding';

const KEY = 'sharmeats-merchant-onboarding-draft';

export interface WizardDraft {
  name: string;
  description: string;
  cuisines: string[];
  phone: string;
  address: string;
  isOpen24h: boolean;
  prepLow: number;
  prepHigh: number;
  zone: string;
  lat: number | null;
  lng: number | null;
  payoutMethod: 'bank' | 'wallet';
  payoutBankName: string;
  payoutIban: string;
  payoutWallet: string;
  payoutHolder: string;
  termsAccepted: boolean;
}

export function emptyDraft(): WizardDraft {
  return {
    name: '', description: '', cuisines: [], phone: '', address: '',
    isOpen24h: false, prepLow: 15, prepHigh: 30,
    zone: '', lat: null, lng: null,
    payoutMethod: 'bank', payoutBankName: '', payoutIban: '', payoutWallet: '',
    payoutHolder: '', termsAccepted: false,
  };
}

export function loadDraft(storage: Pick<Storage, 'getItem'>): WizardDraft {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return emptyDraft();
    return { ...emptyDraft(), ...(JSON.parse(raw) as Partial<WizardDraft>) };
  } catch {
    return emptyDraft();
  }
}

export function saveDraft(storage: Pick<Storage, 'setItem'>, draft: WizardDraft): void {
  storage.setItem(KEY, JSON.stringify(draft));
}

export function clearDraft(storage: Pick<Storage, 'removeItem'>): void {
  storage.removeItem(KEY);
}

const IN_SHARM = (lat: number, lng: number) =>
  lat >= 27.7 && lat <= 28.35 && lng >= 34.2 && lng <= 34.7;

export function validateStep(step: 1 | 2 | 3 | 4, d: WizardDraft): string | null {
  switch (step) {
    case 1: {
      if (d.name.trim().length < 2) return 'Please enter your restaurant name.';
      if (d.phone.trim().length < 6) return 'Please enter a contact phone number.';
      return null;
    }
    case 2: {
      if (!d.zone) return 'Pick your delivery zone.';
      if (d.lat == null || d.lng == null) return 'Set your restaurant location.';
      if (!IN_SHARM(d.lat, d.lng)) return 'That location looks outside Sharm el-Sheikh.';
      return null;
    }
    case 3: {
      if (d.payoutHolder.trim() === '') {
        return d.payoutMethod === 'bank'
          ? 'Enter the bank account holder, bank name and IBAN.'
          : 'Enter the wallet number and account holder.';
      }
      if (d.payoutMethod === 'bank' && (d.payoutBankName.trim() === '' || d.payoutIban.trim() === ''))
        return 'Enter your bank name and IBAN.';
      if (d.payoutMethod === 'wallet' && d.payoutWallet.trim() === '')
        return 'Enter your wallet number.';
      return null;
    }
    case 4:
      return d.termsAccepted ? null : 'Please accept the partner terms to submit.';
  }
}

export function draftToApplication(d: WizardDraft): RestaurantApplication {
  return {
    name: d.name.trim(),
    description: d.description.trim(),
    cuisines: d.cuisines,
    phone: d.phone.trim(),
    address: d.address.trim(),
    zone: d.zone,
    lat: d.lat as number,
    lng: d.lng as number,
    isOpen24h: d.isOpen24h,
    prepLow: d.prepLow,
    prepHigh: d.prepHigh,
    payoutMethod: d.payoutMethod,
    payoutBankName: d.payoutBankName.trim(),
    payoutIban: d.payoutIban.trim(),
    payoutWallet: d.payoutWallet.trim(),
    payoutHolder: d.payoutHolder.trim(),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/merchant-web && npx vitest run src/lib/wizardDraft.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/merchant-web/src/lib/wizardDraft.ts apps/merchant-web/src/lib/wizardDraft.test.ts
git commit -m "feat(merchant-web): wizard draft persistence + step validation"
```

---

### Task 5: merchant-web `/signup` page + wizard UI

**Files:**
- Create: `apps/merchant-web/src/app/signup/page.tsx`
- Create: `apps/merchant-web/src/app/onboarding/Wizard.tsx`

**Interfaces:**
- Consumes: `applyAsRestaurant`, `rpcErrorToCopy` (Task 3); everything from `wizardDraft.ts` (Task 4); `createSupabaseBrowserClient` (`@/lib/supabase/client`); `useToast` (`../Toast`).
- Produces: `<Wizard onSubmitted={() => void}>` — root page (Task 7) renders it when phase is `'none'` and calls back on success.

- [ ] **Step 1: Signup page**

`apps/merchant-web/src/app/signup/page.tsx` — mirrors `login/page.tsx` structure/styling (read that file first and reuse its exact wrapper classes):

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { LegalLinks } from '../LegalLinks';

export default function SignupPage() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function signUp() {
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
    });
    setBusy(false);
    if (error) return setError(error.message);
    // With email confirmation ON, no session exists yet — tell them to confirm.
    if (!data.session) {
      setNotice('Check your inbox to confirm your email, then log in to continue your application.');
      return;
    }
    router.replace('/');
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-extrabold">Partner with Sharm Eats</h1>
      <p className="text-sm text-ink2">
        Create your account, tell us about your restaurant, and start selling after a quick review.
      </p>
      <input
        className="rounded-xl border px-4 py-3"
        type="email" placeholder="Business email" value={email}
        onChange={(e) => setEmail(e.target.value)} autoComplete="email"
      />
      <input
        className="rounded-xl border px-4 py-3"
        type="password" placeholder="Password (8+ characters)" value={password}
        onChange={(e) => setPassword(e.target.value)} autoComplete="new-password"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      {notice && <p className="text-sm">{notice}</p>}
      <button
        className="rounded-xl bg-ink px-4 py-3 font-bold text-white disabled:opacity-50"
        disabled={busy || !email || password.length < 8}
        onClick={signUp}
      >
        {busy ? 'Creating account…' : 'Create account'}
      </button>
      <p className="text-sm text-ink2">
        Already a partner? <Link className="underline" href="/login">Log in</Link>
      </p>
      <LegalLinks />
    </main>
  );
}
```

Before committing, open `apps/merchant-web/src/app/login/page.tsx`, compare the rendered wrapper/input/button classes, and align this page to match them exactly (the classes above are the expected pattern; the login page is authoritative).

- [ ] **Step 2: Wizard component**

`apps/merchant-web/src/app/onboarding/Wizard.tsx`:

```tsx
'use client';

/**
 * 4-step onboarding wizard. Draft lives in localStorage (survives refresh);
 * the DB is touched exactly once, at final submit (apply_as_restaurant).
 */
import { useEffect, useMemo, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { applyAsRestaurant, rpcErrorToCopy } from '@/lib/onboarding';
import {
  type WizardDraft, emptyDraft, loadDraft, saveDraft, clearDraft, validateStep, draftToApplication,
} from '@/lib/wizardDraft';

const CUISINES = [
  'italian','seafood','egyptian','sushi','healthy','burgers','cafe','asian',
  'pizza','breakfast','late_night','street_food','sweets',
]; // food verticals only — grocery/pharmacy onboard via ops for now

interface Zone { id: string; name_en: string }

export function Wizard({ onSubmitted }: { onSubmitted: () => void }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  // Start empty and hydrate from localStorage on mount — `window` is not
  // available during Next.js static-export prerendering, so it must never be
  // touched in a useState initializer.
  const [draft, setDraft] = useState<WizardDraft>(emptyDraft);
  const [hydrated, setHydrated] = useState(false);
  const [zones, setZones] = useState<Zone[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    setDraft(loadDraft(window.localStorage));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) saveDraft(window.localStorage, draft);
  }, [draft, hydrated]);

  useEffect(() => {
    supabase.from('zones').select('id,name_en').eq('is_active', true)
      .then(({ data }) => setZones((data as Zone[]) ?? []));
  }, [supabase]);

  const set = (patch: Partial<WizardDraft>) => setDraft((d) => ({ ...d, ...patch }));

  function next() {
    const problem = validateStep(step, draft);
    if (problem) return setError(problem);
    setError(null);
    setStep((s) => (s < 4 ? ((s + 1) as 2 | 3 | 4) : s));
  }

  function useMyLocation() {
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        set({ lat: Number(pos.coords.latitude.toFixed(6)), lng: Number(pos.coords.longitude.toFixed(6)) });
      },
      () => {
        setLocating(false);
        setError('Could not read your location — enter coordinates manually.');
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function submit() {
    const problem = validateStep(4, draft);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      await applyAsRestaurant(supabase, draftToApplication(draft));
      clearDraft(window.localStorage);
      onSubmitted();
    } catch (e: unknown) {
      setError(rpcErrorToCopy(e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-4 p-6">
      <h1 className="text-2xl font-extrabold">Tell us about your restaurant</h1>
      <p className="text-sm text-ink2">Step {step} of 4</p>

      {step === 1 && (
        <section className="flex flex-col gap-3">
          <input className="rounded-xl border px-4 py-3" placeholder="Restaurant name"
            value={draft.name} onChange={(e) => set({ name: e.target.value })} />
          <textarea className="rounded-xl border px-4 py-3" placeholder="Short description"
            value={draft.description} onChange={(e) => set({ description: e.target.value })} />
          <div className="flex flex-wrap gap-2">
            {CUISINES.map((c) => (
              <button key={c} type="button"
                className={`rounded-full border px-3 py-1 text-sm ${draft.cuisines.includes(c) ? 'bg-ink text-white' : ''}`}
                onClick={() => set({
                  cuisines: draft.cuisines.includes(c)
                    ? draft.cuisines.filter((x) => x !== c)
                    : [...draft.cuisines, c],
                })}>
                {c.replace('_', ' ')}
              </button>
            ))}
          </div>
          <input className="rounded-xl border px-4 py-3" placeholder="Contact phone (+20…)"
            value={draft.phone} onChange={(e) => set({ phone: e.target.value })} />
          <input className="rounded-xl border px-4 py-3" placeholder="Street address"
            value={draft.address} onChange={(e) => set({ address: e.target.value })} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.isOpen24h}
              onChange={(e) => set({ isOpen24h: e.target.checked })} />
            Open 24 hours
          </label>
        </section>
      )}

      {step === 2 && (
        <section className="flex flex-col gap-3">
          <select className="rounded-xl border px-4 py-3" value={draft.zone}
            onChange={(e) => set({ zone: e.target.value })}>
            <option value="">Delivery zone…</option>
            {zones.map((z) => <option key={z.id} value={z.id}>{z.name_en}</option>)}
          </select>
          <button type="button" className="rounded-xl border px-4 py-3 font-bold"
            onClick={useMyLocation} disabled={locating}>
            {locating ? 'Locating…' : '📍 Use my current location'}
          </button>
          <div className="flex gap-2">
            <input className="w-1/2 rounded-xl border px-4 py-3" type="number" step="0.000001"
              placeholder="Latitude" value={draft.lat ?? ''}
              onChange={(e) => set({ lat: e.target.value === '' ? null : Number(e.target.value) })} />
            <input className="w-1/2 rounded-xl border px-4 py-3" type="number" step="0.000001"
              placeholder="Longitude" value={draft.lng ?? ''}
              onChange={(e) => set({ lng: e.target.value === '' ? null : Number(e.target.value) })} />
          </div>
          <p className="text-xs text-ink2">Stand at the restaurant and tap the button — or paste coordinates from Google Maps.</p>
        </section>
      )}

      {step === 3 && (
        <section className="flex flex-col gap-3">
          <div className="flex gap-2">
            {(['bank', 'wallet'] as const).map((m) => (
              <button key={m} type="button"
                className={`rounded-xl border px-4 py-2 font-bold ${draft.payoutMethod === m ? 'bg-ink text-white' : ''}`}
                onClick={() => set({ payoutMethod: m })}>
                {m === 'bank' ? 'Bank transfer' : 'Mobile wallet'}
              </button>
            ))}
          </div>
          {draft.payoutMethod === 'bank' ? (
            <>
              <input className="rounded-xl border px-4 py-3" placeholder="Bank name"
                value={draft.payoutBankName} onChange={(e) => set({ payoutBankName: e.target.value })} />
              <input className="rounded-xl border px-4 py-3" placeholder="IBAN"
                value={draft.payoutIban} onChange={(e) => set({ payoutIban: e.target.value })} />
            </>
          ) : (
            <input className="rounded-xl border px-4 py-3" placeholder="Wallet number (+20…)"
              value={draft.payoutWallet} onChange={(e) => set({ payoutWallet: e.target.value })} />
          )}
          <input className="rounded-xl border px-4 py-3" placeholder="Account holder name"
            value={draft.payoutHolder} onChange={(e) => set({ payoutHolder: e.target.value })} />
          <p className="text-xs text-ink2">Weekly settlement — see your statement any time in the dashboard.</p>
        </section>
      )}

      {step === 4 && (
        <section className="flex flex-col gap-3">
          <div className="rounded-xl border p-4 text-sm">
            <p className="font-bold">{draft.name}</p>
            <p className="text-ink2">{draft.zone} · {draft.phone}</p>
            <p className="mt-2">
              Standard commission: <span className="font-extrabold">15%</span> of food value.
              Delivery fees go to drivers. No signup or monthly fee.
            </p>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={draft.termsAccepted}
              onChange={(e) => set({ termsAccepted: e.target.checked })} />
            <span>
              I accept the <a className="underline" href="https://sharmeats.online/partner-terms" target="_blank" rel="noreferrer">partner terms</a> on behalf of this business.
            </span>
          </label>
        </section>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex justify-between">
        <button type="button" className="rounded-xl border px-4 py-3 disabled:opacity-40"
          disabled={step === 1 || busy} onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s))}>
          Back
        </button>
        {step < 4 ? (
          <button type="button" className="rounded-xl bg-ink px-6 py-3 font-bold text-white" onClick={next}>
            Continue
          </button>
        ) : (
          <button type="button" className="rounded-xl bg-ink px-6 py-3 font-bold text-white disabled:opacity-50"
            disabled={busy} onClick={submit}>
            {busy ? 'Submitting…' : 'Submit application'}
          </button>
        )}
      </div>
    </main>
  );
}
```

Note: the partner-terms URL must exist — check the landing site for the legal-pages pattern (`LegalLinks.tsx` shows the existing URLs). If there is no partner-terms page yet, link to the existing general terms page URL used by `LegalLinks` and record a follow-up in the PR description.

- [ ] **Step 3: Typecheck**

```bash
cd apps/merchant-web && npm run typecheck
```

Expected: clean. (Existing vitest suite must also stay green: `npm test`.)

- [ ] **Step 4: Commit**

```bash
git add apps/merchant-web/src/app/signup apps/merchant-web/src/app/onboarding/Wizard.tsx
git commit -m "feat(merchant-web): partner signup page + 4-step onboarding wizard"
```

---

### Task 6: merchant-web KYC upload lib + ApplicationStatus checklist

**Files:**
- Create: `apps/merchant-web/src/lib/kyc.ts`
- Create: `apps/merchant-web/src/app/onboarding/ApplicationStatus.tsx`

**Interfaces:**
- Consumes: `my_kyc_documents` RPC (mig 075), `kyc` storage bucket (mig 076), `StaffOnboardingRow` (Task 3).
- Produces: `<ApplicationStatus staff={StaffOnboardingRow} phase={'submitted'|'rejected'}>` — rendered by root page (Task 7). `RESTAURANT_DOC_TYPES`, `listMyKycDocuments(supabase, restaurantId)`, `uploadKycDocument(supabase, restaurantId, docType, file)`.

- [ ] **Step 1: KYC lib (web mirror of `apps/restaurant/src/kyc.ts` — keep doc types + path convention identical)**

`apps/merchant-web/src/lib/kyc.ts`:

```typescript
/**
 * Restaurant KYC for the web dashboard. Mirrors apps/restaurant/src/kyc.ts:
 * same doc_type strings, same storage path convention
 * (kyc/<uid>/restaurant-<type>-<ts> — mig 075/076 policies key off the uid folder).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type KycStatus = 'pending' | 'approved' | 'rejected';

export interface KycDocument {
  id: string;
  doc_type: string;
  status: KycStatus;
  review_note: string | null;
  created_at: string;
}

export const RESTAURANT_DOC_TYPES: { key: string; label: string; hint: string }[] = [
  { key: 'commercial_reg', label: 'Commercial registration', hint: 'السجل التجاري' },
  { key: 'tax_card', label: 'Tax card', hint: 'البطاقة الضريبية' },
  { key: 'food_license', label: 'Food licence', hint: 'رخصة تشغيل / سلامة الغذاء' },
];

export async function listMyKycDocuments(
  supabase: SupabaseClient,
  restaurantId: string,
): Promise<KycDocument[]> {
  const { data, error } = await supabase.rpc('my_kyc_documents', {
    p_subject_type: 'restaurant',
    p_subject_id: restaurantId,
  });
  if (error) throw new Error(error.message);
  return (data as KycDocument[]) ?? [];
}

export async function uploadKycDocument(
  supabase: SupabaseClient,
  restaurantId: string,
  docType: string,
  file: File,
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `${user.id}/restaurant-${docType}-${Date.now()}.${ext}`;

  const { error: upErr } = await supabase.storage.from('kyc').upload(path, file, {
    contentType: file.type || 'image/jpeg',
    upsert: true,
  });
  if (upErr) throw new Error(upErr.message);

  const { error: insErr } = await supabase.from('kyc_documents').insert({
    subject_type: 'restaurant',
    subject_id: restaurantId,
    doc_type: docType,
    storage_path: path,
  });
  if (insErr) throw new Error(insErr.message);
}
```

- [ ] **Step 2: ApplicationStatus component**

`apps/merchant-web/src/app/onboarding/ApplicationStatus.tsx`:

```tsx
'use client';

/**
 * The merchant's home while their application is under review (submitted) or
 * after a rejection. Checklist: submitted ✓ → 3 KYC docs → menu (ops-seeded) →
 * go-live. Doc statuses refetch on upload and every 30s (cheap poll — the page
 * is only ever open pre-launch, realtime channel not worth it here).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import type { StaffOnboardingRow } from '@/lib/onboarding';
import {
  type KycDocument, RESTAURANT_DOC_TYPES, listMyKycDocuments, uploadKycDocument,
} from '@/lib/kyc';
import { SignOutButton } from '../SignOutButton';

export function ApplicationStatus({
  staff, phase,
}: { staff: StaffOnboardingRow; phase: 'submitted' | 'rejected' }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [docs, setDocs] = useState<KycDocument[] | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setDocs(await listMyKycDocuments(supabase, staff.restaurant_id));
      // Auto-advance: when admin approves (or the status otherwise leaves
      // submitted/rejected), reload so the root page re-routes to the dashboard.
      const { data } = await supabase
        .from('restaurants')
        .select('onboarding_status')
        .eq('id', staff.restaurant_id)
        .single();
      const s = (data as { onboarding_status: string } | null)?.onboarding_status;
      if (s && s !== 'submitted' && s !== 'rejected') window.location.reload();
    } catch {
      setError('Could not load your documents — pull to refresh or try again shortly.');
    }
  }, [supabase, staff.restaurant_id]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  // Latest doc per type wins (re-uploads supersede).
  const latestByType = new Map<string, KycDocument>();
  for (const d of docs ?? []) {
    const prev = latestByType.get(d.doc_type);
    if (!prev || d.created_at > prev.created_at) latestByType.set(d.doc_type, d);
  }
  const approvedCount = RESTAURANT_DOC_TYPES
    .filter((t) => latestByType.get(t.key)?.status === 'approved').length;

  async function onPick(docType: string, file: File | undefined) {
    if (!file) return;
    setUploading(docType);
    setError(null);
    try {
      await uploadKycDocument(supabase, staff.restaurant_id, docType, file);
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload failed — try again.');
    } finally {
      setUploading(null);
    }
  }

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold">{staff.restaurants.name}</h1>
        <SignOutButton />
      </div>

      {phase === 'rejected' && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm">
          <p className="font-bold">Your application was not approved.</p>
          <p className="mt-1">{staff.restaurants.onboarding_rejection_reason ?? 'Contact support for details.'}</p>
          <p className="mt-2 text-ink2">Fix the documents below and our team will take another look, or email partners@sharmeats.online.</p>
        </div>
      )}

      <ol className="flex flex-col gap-3">
        <li className="rounded-xl border p-4 text-sm">
          ✅ <span className="font-bold">Application submitted</span> — we&apos;ve got your details.
        </li>

        <li className="rounded-xl border p-4 text-sm">
          <p className="font-bold">
            {approvedCount === 3 ? '✅' : '⬜'} Business documents ({approvedCount}/3 approved)
          </p>
          {docs === null ? (
            <p className="mt-2 text-ink2">Loading…</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {RESTAURANT_DOC_TYPES.map((t) => {
                const doc = latestByType.get(t.key);
                return (
                  <li key={t.key} className="flex items-center justify-between gap-2">
                    <span>
                      {t.label} <span className="text-ink2">({t.hint})</span>
                      {doc?.status === 'approved' && ' ✅'}
                      {doc?.status === 'pending' && ' ⏳ under review'}
                      {doc?.status === 'rejected' && (
                        <span className="text-red-600"> ❌ {doc.review_note ?? 'rejected — re-upload'}</span>
                      )}
                    </span>
                    {doc?.status !== 'approved' && (
                      <label className="shrink-0 cursor-pointer rounded-lg border px-3 py-1 font-bold">
                        {uploading === t.key ? 'Uploading…' : doc ? 'Re-upload' : 'Upload'}
                        <input type="file" accept="image/*,.pdf" className="hidden"
                          disabled={uploading !== null}
                          onChange={(e) => onPick(t.key, e.target.files?.[0])} />
                      </label>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </li>

        <li className="rounded-xl border p-4 text-sm">
          ⬜ <span className="font-bold">Menu setup</span> — our team builds your menu with you
          after document review. Have your menu (with prices) ready.
        </li>

        <li className="rounded-xl border p-4 text-sm">
          ⬜ <span className="font-bold">Go live</span> — once approved, you&apos;ll manage orders
          right here and flip yourself Open when ready.
        </li>
      </ol>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </main>
  );
}
```

- [ ] **Step 3: Typecheck + full test run**

```bash
cd apps/merchant-web && npm run typecheck && npm test
```

Expected: clean / all pass.

- [ ] **Step 4: Commit**

```bash
git add apps/merchant-web/src/lib/kyc.ts apps/merchant-web/src/app/onboarding/ApplicationStatus.tsx
git commit -m "feat(merchant-web): KYC upload + application status checklist"
```

---

### Task 7: Wire onboarding states into the merchant-web root page

**Files:**
- Modify: `apps/merchant-web/src/app/page.tsx` (the `Phase` type, the resolution effect, and the render switch)
- Modify: `apps/merchant-web/src/app/login/page.tsx` (one line: link to `/signup`)

**Interfaces:**
- Consumes: `resolveOnboardingPhase`, `StaffOnboardingRow` (Task 3); `<Wizard>` (Task 5); `<ApplicationStatus>` (Task 6).
- Produces: the routed experience — this is the integration point.

- [ ] **Step 1: Extend the phase machine**

In `apps/merchant-web/src/app/page.tsx`:

1. Add imports:

```tsx
import { Wizard } from './onboarding/Wizard';
import { ApplicationStatus } from './onboarding/ApplicationStatus';
import { resolveOnboardingPhase, type StaffOnboardingRow } from '@/lib/onboarding';
```

2. Extend the `Phase` union — replace the current `{ state: 'no-restaurant' }` member with:

```tsx
  | { state: 'apply' }                                        // no merchant_staff link yet → wizard
  | { state: 'pending'; staff: StaffOnboardingRow; sub: 'submitted' | 'rejected' }
```

3. In the resolution effect, change the `merchant_staff` select to also pull onboarding fields:

```tsx
      const { data: staffRows, error: staffErr } = await supabase
        .from('merchant_staff')
        .select('restaurant_id, staff_role, restaurants(name, is_open, onboarding_status, onboarding_rejection_reason)')
        .limit(1);
```

4. Replace the `if (!staff) { setPhase({ state: 'no-restaurant' }); return; }` block with:

```tsx
      if (!staff) {
        setPhase({ state: 'apply' });
        return;
      }
      const onboarding = resolveOnboardingPhase(staff as unknown as StaffOnboardingRow);
      if (onboarding === 'submitted' || onboarding === 'rejected') {
        setPhase({ state: 'pending', staff: staff as unknown as StaffOnboardingRow, sub: onboarding });
        return;
      }
```

(`'active'` falls through to the existing ready-path unchanged.)

5. In the render switch, replace the old `no-restaurant` branch with:

```tsx
  if (phase.state === 'apply') {
    return <Wizard onSubmitted={() => setReloadKey((k) => k + 1)} />;
  }
  if (phase.state === 'pending') {
    return <ApplicationStatus staff={phase.staff} phase={phase.sub} />;
  }
```

Keep whatever the old `no-restaurant` branch rendered available for reference in the diff, but delete it — `apply` replaces it. (Accounts that were manually staff-linked but have no restaurant can no longer occur; the wizard is now the correct experience for an unlinked login.)

- [ ] **Step 2: Login page cross-link**

In `apps/merchant-web/src/app/login/page.tsx`, under the sign-in button (next to the existing forgot-password affordance), add:

```tsx
      <p className="text-sm text-ink2">
        New restaurant? <Link className="underline" href="/signup">Partner with Sharm Eats</Link>
      </p>
```

(add `import Link from 'next/link';` if not present).

- [ ] **Step 3: Typecheck + tests + manual smoke**

```bash
cd apps/merchant-web && npm run typecheck && npm test
npm run dev  # manual: /signup renders; log in with an unlinked account → wizard appears
```

- [ ] **Step 4: Commit**

```bash
git add apps/merchant-web/src/app/page.tsx apps/merchant-web/src/app/login/page.tsx
git commit -m "feat(merchant-web): route onboarding states from the dashboard root"
```

---

### Task 8: merchant-web Menu tab (port of admin MenuManager)

**Files:**
- Create: `apps/merchant-web/src/app/menu/MenuManager.tsx` (copy, unchanged)
- Create: `apps/merchant-web/src/app/menu/fields.tsx` (copy, unchanged)
- Create: `apps/merchant-web/src/app/menu/page.tsx` (new guard page)
- Modify: `apps/merchant-web/src/app/page.tsx` (header link to `/menu` in the ready state)

**Interfaces:**
- Consumes: `MenuManager({ restaurantId })` — already parameterized; RLS merchant policies scope every write to the caller's own restaurant regardless of the prop.
- Produces: `/menu` route for approved merchants.

- [ ] **Step 1: Copy the components verbatim**

```bash
cp apps/admin-web/src/app/menu/MenuManager.tsx apps/merchant-web/src/app/menu/MenuManager.tsx
cp apps/admin-web/src/app/menu/fields.tsx apps/merchant-web/src/app/menu/fields.tsx
```

Then open both copies and fix ONLY imports that don't resolve in merchant-web (e.g. `../Toast`, `../Skeleton`, `@/lib/supabase/client` — merchant-web has equivalents at the same relative locations; adjust paths if they differ). Do not otherwise edit — drift between the two copies is acceptable v1 (they serve different roles; a shared package is future work).

- [ ] **Step 2: Guard page**

`apps/merchant-web/src/app/menu/page.tsx`:

```tsx
'use client';

/**
 * Own-restaurant menu editor. The RLS merchant policies on menu_sections/
 * menu_items/modifiers/modifier_options are the real guard — this page just
 * resolves WHICH restaurant and renders the same MenuManager admin uses.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { resolveOnboardingPhase, type StaffOnboardingRow } from '@/lib/onboarding';
import { MenuManager } from './MenuManager';
import { Skeleton } from '../Skeleton';

type Phase =
  | { state: 'loading' }
  | { state: 'blocked' }
  | { state: 'ready'; restaurantId: string; name: string };

export default function MerchantMenuPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ state: 'loading' });

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/login'); return; }
      const { data } = await supabase
        .from('merchant_staff')
        .select('restaurant_id, restaurants(name, is_open, onboarding_status, onboarding_rejection_reason)')
        .limit(1);
      const staff = data?.[0] as unknown as StaffOnboardingRow | undefined;
      if (!staff || resolveOnboardingPhase(staff) !== 'active') {
        setPhase({ state: 'blocked' });
        return;
      }
      setPhase({ state: 'ready', restaurantId: staff.restaurant_id, name: staff.restaurants.name });
    })();
  }, [router]);

  if (phase.state === 'loading') return <Skeleton />;
  if (phase.state === 'blocked') {
    return (
      <main className="mx-auto max-w-lg p-6">
        <p className="text-sm">Menu editing unlocks once your restaurant is approved.</p>
        <Link className="underline" href="/">Back to dashboard</Link>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-extrabold">{phase.name} — Menu</h1>
        <Link className="underline" href="/">Dashboard</Link>
      </div>
      <MenuManager restaurantId={phase.restaurantId} />
    </main>
  );
}
```

- [ ] **Step 3: Dashboard header link**

In `apps/merchant-web/src/app/page.tsx`, in the `ready` state header (near the open/close toggle and `SignOutButton`), add:

```tsx
          <Link className="rounded-lg border px-3 py-1 text-sm font-bold" href="/menu">Menu</Link>
```

(add the `next/link` import if missing).

- [ ] **Step 4: Typecheck + manual smoke**

```bash
cd apps/merchant-web && npm run typecheck && npm test
npm run dev  # manual: as an approved merchant, /menu edits sections/items; writes succeed (RLS)
```

- [ ] **Step 5: Commit**

```bash
git add apps/merchant-web/src/app/menu apps/merchant-web/src/app/page.tsx
git commit -m "feat(merchant-web): own-restaurant menu editor (port of admin MenuManager)"
```

---

### Task 9: admin-web onboarding queue

**Files:**
- Create: `apps/admin-web/src/app/onboarding/page.tsx`
- Modify: `apps/admin-web/src/app/page.tsx` (nav card, after the `/kyc` card at line ~146)
- Modify: `apps/admin-web/src/app/menu/page.tsx` (`?restaurant=<id>` preselect)

**Interfaces:**
- Consumes: `approve_restaurant`, `admin_set_commission` RPCs (Task 1); admin sees all restaurants via existing `restaurants_read` policy; `kyc_documents` admin read (mig 075).
- Produces: `/onboarding` admin page.

- [ ] **Step 1: Queue page**

`apps/admin-web/src/app/onboarding/page.tsx` — follow the structure of `apps/admin-web/src/app/kyc/page.tsx` (same Phase/guard/Toast conventions — read it first):

```tsx
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { SignOutButton } from '../SignOutButton';
import { useToast } from '../Toast';
import { Skeleton } from '../Skeleton';

const REQUIRED_DOCS = ['commercial_reg', 'tax_card', 'food_license'] as const;
const DOC_LABEL: Record<string, string> = {
  commercial_reg: 'Commercial reg', tax_card: 'Tax card', food_license: 'Food licence',
};

interface QueueRow {
  id: string;
  name: string;
  zone: string;
  phone: string | null;
  created_at: string;
  onboarding_status: 'submitted' | 'rejected';
  onboarding_rejection_reason: string | null;
  commission_pct: number;
  docs: Record<string, 'pending' | 'approved' | 'rejected' | 'missing'>;
  menuItems: number;
}

type Phase = { state: 'loading' } | { state: 'unauthorized' } | { state: 'ready' };

export default function OnboardingQueuePage() {
  const router = useRouter();
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>({ state: 'loading' });
  const [filter, setFilter] = useState<'submitted' | 'rejected'>('submitted');
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    const { data: restaurants, error } = await supabase
      .from('restaurants')
      .select('id, name, zone, phone, created_at, onboarding_status, onboarding_rejection_reason, commission_pct')
      .eq('onboarding_status', filter)
      .order('created_at', { ascending: true });
    if (error) { toast('Could not load queue', 'error'); return; }
    const list = (restaurants ?? []) as Omit<QueueRow, 'docs' | 'menuItems'>[];
    const ids = list.map((r) => r.id);

    const [docsRes, itemsRes] = ids.length
      ? await Promise.all([
          supabase.from('kyc_documents')
            .select('subject_id, doc_type, status, created_at')
            .eq('subject_type', 'restaurant').in('subject_id', ids),
          supabase.from('menu_items').select('restaurant_id').in('restaurant_id', ids),
        ])
      : [{ data: [] }, { data: [] }];

    setRows(list.map((r) => {
      const docs: QueueRow['docs'] = {};
      for (const t of REQUIRED_DOCS) docs[t] = 'missing';
      // latest doc per type wins
      const mine = ((docsRes.data ?? []) as { subject_id: string; doc_type: string; status: string; created_at: string }[])
        .filter((d) => d.subject_id === r.id)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      for (const d of mine) {
        if ((REQUIRED_DOCS as readonly string[]).includes(d.doc_type)) {
          docs[d.doc_type] = d.status as 'pending' | 'approved' | 'rejected';
        }
      }
      const menuItems = ((itemsRes.data ?? []) as { restaurant_id: string }[])
        .filter((m) => m.restaurant_id === r.id).length;
      return { ...r, docs, menuItems };
    }));
  }, [filter, toast]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/login'); return; }
      const { data: me } = await supabase.from('users').select('role').eq('id', session.user.id).single();
      if (me?.role !== 'admin') { setPhase({ state: 'unauthorized' }); return; }
      setPhase({ state: 'ready' });
    })();
  }, [router]);

  useEffect(() => {
    if (phase.state === 'ready') load();
  }, [phase.state, load]);

  async function decide(row: QueueRow, decision: 'approve' | 'reject') {
    const supabase = createSupabaseBrowserClient();
    let reason: string | null = null;
    if (decision === 'reject') {
      reason = window.prompt(`Reason for rejecting ${row.name} (shown to the merchant):`);
      if (!reason?.trim()) return;
    } else if (!window.confirm(`Approve ${row.name}? It becomes visible to customers (closed until the owner opens).`)) {
      return;
    }
    setBusyId(row.id);
    const { error } = await supabase.rpc('approve_restaurant', {
      p_restaurant_id: row.id, p_decision: decision, p_reason: reason,
    });
    setBusyId(null);
    if (error) {
      const m = error.message;
      toast(
        m.includes('KYC_INCOMPLETE') ? 'Blocked: 3 approved KYC docs required.'
        : m.includes('MENU_EMPTY') ? 'Blocked: seed the menu first.'
        : `Failed: ${m}`,
        'error');
      return;
    }
    toast(decision === 'approve' ? `${row.name} is live 🎉` : `${row.name} rejected`, 'success');
    load();
  }

  async function setCommission(row: QueueRow) {
    const raw = window.prompt(`Commission % for ${row.name}:`, String(row.commission_pct));
    if (raw === null) return;
    const pct = Number(raw);
    if (!Number.isFinite(pct) || pct < 0 || pct > 50) { toast('Enter 0–50', 'error'); return; }
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.rpc('admin_set_commission', { p_restaurant_id: row.id, p_pct: pct });
    if (error) { toast(`Failed: ${error.message}`, 'error'); return; }
    toast('Commission updated', 'success');
    load();
  }

  if (phase.state === 'loading') return <Skeleton />;
  if (phase.state === 'unauthorized') {
    return <main className="p-6"><p>Admin account required.</p></main>;
  }

  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-extrabold">Restaurant onboarding</h1>
        <div className="flex items-center gap-3">
          <Link className="underline" href="/">Home</Link>
          <SignOutButton />
        </div>
      </div>

      <div className="mb-4 flex gap-2">
        {(['submitted', 'rejected'] as const).map((f) => (
          <button key={f}
            className={`rounded-full border px-4 py-1 text-sm font-bold ${filter === f ? 'bg-ink text-white' : ''}`}
            onClick={() => setFilter(f)}>
            {f}
          </button>
        ))}
      </div>

      {rows.length === 0 && <p className="text-sm text-ink2">Queue is empty. 🌴</p>}

      <ul className="flex flex-col gap-3">
        {rows.map((row) => {
          const docsOk = REQUIRED_DOCS.every((t) => row.docs[t] === 'approved');
          const canApprove = docsOk && row.menuItems > 0;
          return (
            <li key={row.id} className="rounded-xl border p-4 text-sm">
              <div className="flex items-center justify-between">
                <p className="font-extrabold">{row.name}</p>
                <p className="text-ink2">{new Date(row.created_at).toLocaleDateString()}</p>
              </div>
              <p className="text-ink2">{row.zone} · {row.phone ?? 'no phone'}</p>
              {row.onboarding_rejection_reason && (
                <p className="mt-1 text-red-600">Rejected: {row.onboarding_rejection_reason}</p>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-2">
                {REQUIRED_DOCS.map((t) => (
                  <span key={t} className={`rounded-full border px-2 py-0.5 text-xs ${
                    row.docs[t] === 'approved' ? 'border-green-500 text-green-700'
                    : row.docs[t] === 'rejected' ? 'border-red-500 text-red-700'
                    : 'text-ink2'}`}>
                    {DOC_LABEL[t]}: {row.docs[t]}
                  </span>
                ))}
                <span className={`rounded-full border px-2 py-0.5 text-xs ${row.menuItems > 0 ? 'border-green-500 text-green-700' : 'text-ink2'}`}>
                  menu: {row.menuItems} items
                </span>
                <button className="rounded-full border px-2 py-0.5 text-xs underline" onClick={() => setCommission(row)}>
                  commission: {row.commission_pct}%
                </button>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Link className="rounded-lg border px-3 py-1 font-bold" href="/kyc">Review docs</Link>
                <Link className="rounded-lg border px-3 py-1 font-bold" href={`/menu?restaurant=${row.id}`}>Seed menu</Link>
                <button
                  className="rounded-lg bg-ink px-3 py-1 font-bold text-white disabled:opacity-40"
                  disabled={!canApprove || busyId === row.id}
                  title={canApprove ? '' : 'Needs 3 approved docs + a seeded menu'}
                  onClick={() => decide(row, 'approve')}>
                  {busyId === row.id ? '…' : 'Approve & go live'}
                </button>
                <button
                  className="rounded-lg border border-red-400 px-3 py-1 font-bold text-red-600 disabled:opacity-40"
                  disabled={busyId === row.id}
                  onClick={() => decide(row, 'reject')}>
                  Reject
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
```

Note on the reject prompt: `window.prompt`/`window.confirm` match this dashboard's existing minimal-chrome style; if `/kyc` uses the Toast-based inline pattern instead of prompts, mirror `/kyc`'s pattern for the reason input.

- [ ] **Step 2: Nav card + menu preselect**

In `apps/admin-web/src/app/page.tsx`, duplicate the existing nav-card markup (see the `/kyc` card near line 146) with:

```tsx
            href="/onboarding"
```

and title "Onboarding", subtitle "Approve new restaurants".

In `apps/admin-web/src/app/menu/page.tsx`, preselect from the URL — add near the existing state:

```tsx
import { useSearchParams } from 'next/navigation';
// inside the component:
const params = useSearchParams();
useEffect(() => {
  const preselect = params.get('restaurant');
  if (preselect) setSelectedId(preselect);
}, [params]);
```

(Match the actual selected-state setter name in the file — it holds `selectedId` per line 80. Next.js static export requires `useSearchParams` be under a `<Suspense>` boundary; if `next build` complains, wrap the page's default export content in `<Suspense>` per the existing pattern elsewhere in this app, or read `window.location.search` in a mount effect instead — the simpler escape hatch for a client-only SPA.)

- [ ] **Step 3: Typecheck + build**

```bash
cd apps/admin-web && npm run typecheck && npm run lint && npm run build
```

Expected: clean (build catches the `useSearchParams`/Suspense issue if present).

- [ ] **Step 4: Commit**

```bash
git add apps/admin-web/src/app/onboarding apps/admin-web/src/app/page.tsx apps/admin-web/src/app/menu/page.tsx
git commit -m "feat(admin-web): restaurant onboarding approval queue"
```

---

### Task 10: Landing-site "Partner with us" link

**Files:**
- Modify: `landing/src/app/page.tsx` — the existing `#partner` section (line ~235) already has a CTA at line ~243: `<a className="btn dbtn" href="mailto:hello@sharmeats.online">{t.partner_cta}</a>`.

**Interfaces:**
- Consumes: merchant-web production URL `https://merchant.sharmeats.online` (docs/GO-LIVE.md line 50 — dashboards live on Hostinger).

- [ ] **Step 1: Point the partner CTA at signup**

In `landing/src/app/page.tsx`, change the partner card CTA href:

```tsx
<a className="btn dbtn" href="https://merchant.sharmeats.online/signup">{t.partner_cta}</a>
```

Keep the mailto as a secondary line under it (styled like the section's existing secondary text; check `globals.css` class names used nearby):

```tsx
<a className="nlink" href="mailto:hello@sharmeats.online">{t.partner_email}</a>
```

Add `partner_email` to the page's translation object for every locale it defines (find the `partner_cta` entries and add a sibling key next to each; EN: "or email hello@sharmeats.online", AR: «أو راسلنا على hello@sharmeats.online», mirror the file's existing locale set). If `partner_cta` copy still says "email us"-style wording in any locale, update it to an apply-now framing (EN: "Add your restaurant").

- [ ] **Step 2: Typecheck + build**

```bash
cd landing && npm run typecheck 2>/dev/null || true; npm run build
```

Expected: build clean. (Landing deploys separately to Vercel — deploy is a release step, not part of this branch's CI.)

- [ ] **Step 3: Commit**

```bash
git add landing
git commit -m "feat(landing): partner-with-us link to merchant signup"
```

---

### Task 11: Full verification + PR

**Files:** none new.

- [ ] **Step 1: Per-surface gates**

```bash
cd apps/merchant-web && npm run typecheck && npm test && npm run lint
cd ../admin-web && npm run typecheck && npm run lint && npm run build
cd ../.. && deno test --permit-no-files supabase/functions/   # unchanged, must stay green
```

Expected: all pass.

- [ ] **Step 2: Manual E2E (against prod DB with a throwaway email — the feature is dark until the landing link ships)**

1. `cd apps/merchant-web && npm run dev` → `/signup` with a fresh email → confirm → log in.
2. Wizard: complete all 4 steps (use real Sharm coordinates, e.g. 27.9158, 34.3300) → submit → status checklist appears.
3. Upload 3 doc images → admin-web `/kyc`: approve all 3.
4. Admin-web `/onboarding`: row shows 3 green chips; "Approve" disabled until menu seeded → `/menu?restaurant=<id>`: add a section + item (+ cover image via RestaurantEditor) → back: Approve → confirm live.
5. Merchant dashboard now shows the normal order queue (closed); `/menu` tab edits work.
6. Customer app (or a SQL check): restaurant visible with `is_active=true` and `is_open=false`:
   `select is_active, is_open, onboarding_status from restaurants where slug like 'test%';`
7. Reject path: second throwaway application → admin rejects with a reason → merchant sees the reason.
8. Clean up the two test restaurants:
   `approve_restaurant` has no delete — use the existing `admin_delete_restaurant` RPC from admin `/menu`.

- [ ] **Step 3: PR**

```bash
git push -u origin feat/restaurant-self-onboarding
gh pr create --title "feat: restaurant self-onboarding (mig 120 + merchant/admin web)" --body "$(cat <<'EOF'
## Summary
- Mig 120: restaurants.onboarding_status + apply_as_restaurant / approve_restaurant / admin_set_commission (draft-restaurant-first self-onboarding)
- merchant-web: /signup, 4-step wizard, application checklist w/ KYC upload, own-restaurant menu editor
- admin-web: /onboarding approval queue (approve blocked in-DB until 3 approved KYC docs + seeded menu)
- landing: partner link

Spec: docs/superpowers/specs/2026-07-24-restaurant-self-onboarding-design.md
Plan: docs/superpowers/plans/2026-07-24-restaurant-self-onboarding.md

## Invariants preserved
- is_active remains the only customer-visibility switch; drafts hidden by the existing restaurants_read policy
- onboarding_status has no client UPDATE grant; approve_restaurant is its sole writer and re-verifies KYC+menu preconditions in Postgres
- Both RPCs: SECURITY DEFINER, pinned search_path, revoked from PUBLIC/anon, coalesce fail-closed role checks
- No money-path changes; commission override via new admin-only admin_set_commission (0–50 bound)

## Test plan
- [x] Mig 120 tx-wrapped dry run (BEGIN…ROLLBACK) with in-tx behavior asserts — ALL PASSED
- [x] merchant-web vitest (onboarding phase resolver, error copy, wizard draft/validation)
- [x] Manual E2E: signup → wizard → KYC ×3 → seed menu → approve → live (closed) → reject path
- [ ] Owner: deploy merchant-web + admin-web exports; then landing link goes live
EOF
)"
```

---

## Deviations from the spec (surfaced for review, decided during planning)

1. **EN-only copy** — merchant-web has no i18n framework; adding one is its own project. AR appears only in the KYC doc-type hints (high-confusion terms).
2. **Location step uses geolocation + coordinate fields, not a map pin** — merchant-web has no map dependency; adding Leaflet/Google for one wizard step violates YAGNI. Upgrade later if applications show bad coordinates.
3. **Merchant terms recorded on the `restaurants` row** (`terms_version`, `terms_accepted_at`) rather than the mig 106 `users` columns — those hold the *customer* ToS acceptance; overwriting them with a merchant version would corrupt that compliance trail.
4. **Geo validation is a Sharm bounding box**, not the spec's "mig 079 radius helper" — that helper validates *dropoffs against an existing restaurant* and no zone geometry exists in the schema; the box is the honest v1 check, with admin review as the real gate.
5. **Approve/reject merchant notification is the live status page** (poll/refetch), not an Expo push — new merchants overwhelmingly haven't installed the restaurant mobile app yet, so a push would silently reach nobody; `ops_alert` covers the ops side. (The existing mig 040 order-push flow is untouched and picks the merchant up once they install the app.)
