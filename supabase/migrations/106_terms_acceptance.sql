-- 106_terms_acceptance.sql
--
-- P0 blocker #6 (in-app legal links + versioned ToS acceptance).
--
-- WHAT THIS ADDS
--   * public.users.terms_accepted_version text  (nullable)
--   * public.users.terms_accepted_at      timestamptz (nullable)
--   * public.record_terms_acceptance(p_version text) — the compliance write.
--
-- WHY A COLUMN GRANT IS THE GATE (see mig 053 / 081, and the memory note
-- supabase-definer-rpc-anon-grant)
-- The users table has ONE self-scoped UPDATE policy `users_update_self`
-- (002_app_schema.sql), `auth.uid() = id`. RLS cannot restrict columns, so
-- mig 053 revoked the broad UPDATE from anon/authenticated and re-granted UPDATE
-- on ONLY the legitimate self-service profile columns. That revoke means a plain
-- `update users set terms_accepted_version = ...` from the app would now get
-- 42501 permission denied on these two brand-new columns. Two ways to allow the
-- write; we do BOTH, defense-in-depth:
--   1. grant UPDATE on exactly these two columns to `authenticated`, so the
--      existing users_update_self policy permits an owner-scoped write; and
--   2. a SECURITY DEFINER RPC that stamps the columns for auth.uid() only, so the
--      app never has to widen anything and the acceptance timestamp is set
--      server-side (now()), not client-supplied.
-- The app calls the RPC (single, auditable path). The column grant is kept so the
-- write is legitimate at the privilege layer and a future direct patch stays
-- owner-and-column scoped rather than falling back to the broad pre-053 grant.
--
-- House invariants honored:
--   * SECURITY DEFINER + SET search_path = public, pg_temp (no mutable path).
--   * EXECUTE revoked from public, anon (revoke-from-anon alone is a no-op while
--     the inherited PUBLIC grant remains) and granted only to authenticated.
--   * The body binds to auth.uid() — a caller can only record acceptance for
--     THEIR OWN row; p_version is the only input and is trimmed/validated.
--
-- Forward-only, idempotent (add-column-if-not-exists + create-or-replace +
-- revoke/grant). Rollback: drop the function and the two columns.

-- 1) Columns. Nullable — a NULL version means "has never accepted" (or accepted
--    a version predating this feature), which the app treats as "needs consent".
alter table public.users
  add column if not exists terms_accepted_version text,
  add column if not exists terms_accepted_at      timestamptz;

comment on column public.users.terms_accepted_version is
  'The Terms of Service version string (e.g. ''2026-07-11'') the user last'
  ' accepted in-app. NULL = never accepted / pre-dates the acceptance feature.'
  ' Written only via record_terms_acceptance() (mig 106).';
comment on column public.users.terms_accepted_at is
  'When the user last accepted the Terms (server clock). Written only via'
  ' record_terms_acceptance() (mig 106).';

-- 2) Column grant — the privilege-layer gate that lets users_update_self (002)
--    permit an owner-scoped write to just these two columns. Mirrors mig 053's
--    approach: the RLS policy scopes the ROW (auth.uid() = id), the grant scopes
--    the COLUMNS. anon gets nothing: an anonymous session upgrades to a
--    phone-linked authenticated one before it records acceptance.
grant update (terms_accepted_version, terms_accepted_at)
  on public.users to authenticated;

-- 3) The compliance write. Stamps the two columns for the CALLER (auth.uid())
--    with the given version and the server clock. SECURITY DEFINER so the write
--    is centralized and the timestamp is server-set, not client-forgeable.
create or replace function public.record_terms_acceptance(p_version text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'check_violation';
  end if;
  if p_version is null or btrim(p_version) = '' then
    raise exception 'VERSION_REQUIRED' using errcode = 'check_violation';
  end if;

  update public.users
     set terms_accepted_version = btrim(p_version),
         terms_accepted_at      = now()
   where id = v_uid;
end;
$$;

comment on function public.record_terms_acceptance(text) is
  'Records that the calling user (auth.uid()) accepted Terms version p_version'
  ' at now(). The single write path for users.terms_accepted_version/_at.'
  ' SECURITY DEFINER, granted to authenticated only (mig 106).';

-- Grant discipline: revoke the inherited PUBLIC/anon EXECUTE, grant only to
-- authenticated. The auth.uid() binding in the body is the real authority; the
-- grant is defense in depth.
revoke execute on function public.record_terms_acceptance(text) from public, anon;
grant  execute on function public.record_terms_acceptance(text) to authenticated;
