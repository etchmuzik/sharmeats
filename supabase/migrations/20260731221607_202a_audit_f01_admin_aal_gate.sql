-- ============================================================================
-- TRANSCRIPT OF AN ALREADY-APPLIED MIGRATION — DO NOT RE-APPLY TO PRODUCTION.
--
--   prod ledger version : 20260731221607
--   prod ledger name    : 202a_audit_f01_admin_aal_gate
--   applied to prod     : 2026-07-31 (directly, with no file in this repo)
--   reconstructed       : 2026-08-01, from
--                         supabase_migrations.schema_migrations.statements
--
-- WHY THIS FILE EXISTS. On 2026-07-31 eleven migrations were applied straight to
-- production and never committed. The repo therefore no longer described the
-- database. This file is a byte-exact copy of what production recorded, written
-- back so that (a) the repo describes production again, and (b) a fresh database
-- rebuilt by replaying supabase/migrations/ ends up in the same state.
--
-- WHAT IT IS NOT. It is not a change. Production ALREADY has everything below.
-- Do not point this at production, do not "re-run it to be sure", and do not
-- edit it to fix a defect — a later, higher-numbered migration does that. Editing
-- a transcript makes the repo lie about production a second time.
--
-- KNOWN GAP, recorded here so it is not mistaken for done: require_admin() below
-- is correct and fails closed, but as of 2026-08-01 the ONLY function in the
-- database that calls it is admin_mfa_posture(), a status reporter.
-- admin_issue_credit, admin_set_commission and mark_settlement_paid do NOT call
-- it. The gate exists; it is wired to almost nothing. Fixing that is the job of
-- a later migration, NOT of an edit to this file.
--
-- The body below this marker is reproduced verbatim, including its own original
-- header comments (which refer to a "202" file that was never committed) and its
-- own numbering claims. Those are left untouched on purpose: this records what
-- ran, not what we wish had run. Verified byte-for-byte against the prod ledger
-- (md5 0e03d34485c701e5cbfe67fa03365ac5).
-- ============================================================================
-- ===== BEGIN TRANSCRIPT =====
-- 202 section F-01 — admin authority requires a second factor, enforced by the
-- database. See docs/AUDIT-REPORT-2026-07-31.md and the full file
-- supabase/migrations/202_audit_20260731_p0_p1_fixes.sql for rationale.
--
-- TOTP was enforced entirely in apps/admin-web/src/app/login/page.tsx; lib/mfa.ts
-- said so outright: "The database is the real authority on what an aal1 session
-- may do; this gate is a prompt, not a permission." The database never checked.
-- An attacker with the password leaked in commit d3427a6 (public repo, eight
-- weeks) skips the dashboard: POST /auth/v1/token with the public anon key
-- returns an aal1 JWT, and every admin RPC gated on role alone.
--
-- Fails open when NO factor is enrolled, so applying this cannot lock the only
-- admin out of production before anyone can enrol. Enrolment is the switch that
-- arms it; admin_mfa_posture() reports who is still unarmed.

create or replace function public.auth_aal()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- request.jwt.claims is set by PostgREST per request. Missing (or a non-JWT
  -- caller such as a cron job running as postgres) reads as NULL, and every
  -- caller below treats NULL as "not aal2" only when a factor exists.
  select nullif(
    current_setting('request.jwt.claims', true)::jsonb ->> 'aal',
    ''
  );
$$;

comment on function public.auth_aal is
  'The caller''s Supabase assurance level (aal1 = password only, aal2 = password + a verified second factor), read from the request JWT. NULL for non-JWT callers (cron/postgres). Mig 202, audit F-01.';

revoke all on function public.auth_aal() from public, anon;
grant execute on function public.auth_aal() to authenticated, service_role;

create or replace function public.has_verified_mfa_factor(p_user_id uuid)
returns boolean
language sql
stable
security definer
-- auth.mfa_factors lives in the auth schema; pinned so the lookup cannot be
-- shadowed (house rule: every SECURITY DEFINER pins search_path).
set search_path = auth, public, pg_temp
as $$
  select exists (
    select 1 from auth.mfa_factors f
     where f.user_id = p_user_id
       and f.status = 'verified'
  );
$$;

comment on function public.has_verified_mfa_factor(uuid) is
  'True when the account has at least one VERIFIED MFA factor. Used by require_admin() so enrolling a factor is what arms the aal2 requirement — an admin who has not enrolled yet is not locked out. Mig 202, audit F-01.';

revoke all on function public.has_verified_mfa_factor(uuid) from public, anon;
grant execute on function public.has_verified_mfa_factor(uuid) to authenticated, service_role;

create or replace function public.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
begin
  -- Fail closed on every uncertain branch (house rule 4): NULL role, NULL user,
  -- and NULL aal with a factor enrolled all raise.
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;

  if coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;

  -- The second factor, when the account has one. Enrolment arms it; see header.
  if public.has_verified_mfa_factor(v_user)
     and coalesce(public.auth_aal(), '') <> 'aal2'
  then
    raise exception 'MFA_REQUIRED: this action needs a second factor; sign in again and enter your authenticator code'
      using errcode = 'check_violation';
  end if;
end;
$$;

comment on function public.require_admin is
  'The admin gate: role = admin AND, when the account has a verified MFA factor, an aal2 session. Replaces bare `coalesce(auth_role(),'''') <> ''admin''` checks so a leaked password alone cannot reach commission, credit issuance, KYC or dispatch through PostgREST. Mig 202, audit F-01.';

revoke all on function public.require_admin() from public, anon;
grant execute on function public.require_admin() to authenticated, service_role;

-- Operator visibility: which admins are still password-only. The rotation
-- checklist in docs/GO-LIVE.md is not finished until this returns no rows with
-- has_factor = false.
create or replace function public.admin_mfa_posture()
returns table (user_id uuid, email text, has_factor boolean, last_sign_in timestamptz)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  perform public.require_admin();
  return query
  select u.id,
         au.email::text,
         public.has_verified_mfa_factor(u.id),
         au.last_sign_in_at
    from public.users u
    join auth.users au on au.id = u.id
   where coalesce(u.role::text, '') = 'admin'
   order by 3, 4 nulls first;
end;
$$;

comment on function public.admin_mfa_posture is
  'Every admin account and whether it has a verified second factor. has_factor = false means a leaked password is still sufficient for that account. Mig 202, audit F-01.';

revoke all on function public.admin_mfa_posture() from public, anon;
grant execute on function public.admin_mfa_posture() to authenticated, service_role;
