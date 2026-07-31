-- ============================================================================
-- TRANSCRIPT OF AN ALREADY-APPLIED MIGRATION — DO NOT RE-APPLY TO PRODUCTION.
--
--   prod ledger version : 20260731222648
--   prod ledger name    : 202i_audit_f17_and_p2_sweep
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
-- WHAT THIS SUPERSEDES, so nobody re-fixes it. Confirmed live on 2026-08-01:
-- private.delivery_encrypt/decrypt now carry `extensions` on their search_path,
-- and the five private tables listed below have zero anon/authenticated grants.
-- Those two findings are DONE. A migration that "fixes" them again is a no-op at
-- best. Note also that the settle_paymob_payment block below only RAISES NOTICE
-- — it deliberately does not change that function, which stays deferred with the
-- rest of the card work.
--
-- The body below this marker is reproduced verbatim, including its own original
-- header comments (which refer to a "202" file that was never committed) and its
-- own numbering claims. Those are left untouched on purpose: this records what
-- ran, not what we wish had run. Verified byte-for-byte against the prod ledger
-- (md5 174e937f59351509b736daf4710b3232).
-- ============================================================================
-- ===== BEGIN TRANSCRIPT =====
-- 202 section F-17 + the cheap, unambiguous P2s from the same audit.

-- F-17: private.delivery_encrypt/decrypt pin a search_path that EXCLUDES
-- `extensions`, where pgcrypto lives, while calling bare pgp_sym_encrypt /
-- pgp_sym_decrypt. Mig 197's plpgsql_check sweep only covered nspname='public',
-- which is why the `private` pair was missed. One-line fix each, mirroring 197.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private' and p.proname = 'delivery_encrypt'
  ) then
    execute 'alter function private.delivery_encrypt(text) set search_path = private, public, extensions, pg_temp';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private' and p.proname = 'delivery_decrypt'
  ) then
    execute 'alter function private.delivery_decrypt(bytea) set search_path = private, public, extensions, pg_temp';
  end if;
end $$;

-- P2: the private tables from migs 191-193 relied solely on absent schema
-- USAGE. ALTER DEFAULT PRIVILEGES on this database grants arwdDxtm to
-- anon/authenticated on every new table, and TRUNCATE ignores RLS, so the
-- table-level revoke is the actual protection (house rule 5b).
do $$
declare t text;
begin
  foreach t in array array[
    'delivery_access_events',
    'delivery_endpoint_keys',
    'platform_operator_capabilities',
    'platform_operator_capability_events',
    'delivery_job_custody_events'
  ] loop
    if exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'private' and c.relname = t
    ) then
      execute format('revoke all on table private.%I from public, anon, authenticated', t);
    end if;
  end loop;
end $$;

-- P2: settle_paymob_payment compares a nullable paymob_txn_id with `<>`, so a
-- second transaction against an order whose txn id is NULL passes the guard
-- (NULL <> 'x' is NULL, not true). Dormant while card is dark. NOT auto-fixed:
-- the body must be edited from its then-current version at card enablement
-- (house rule 2), so this only records the finding loudly.
do $$
declare v_src text;
begin
  select prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'settle_paymob_payment'
   limit 1;

  if v_src is not null and v_src like '%paymob_txn_id <> %' then
    raise notice 'settle_paymob_payment still uses <> on paymob_txn_id — audit P2; fix as part of card enablement.';
  end if;
end $$;

-- P2: the leftover manual-migration backup — no primary key, no client grants,
-- nothing reads it. Moved out of `public` (so it leaves the PostgREST surface
-- and the advisor's no-PK lint) rather than dropped, so the bytes survive.
do $$
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = '__pre_mig126_129_snapshot'
  ) then
    execute 'revoke all on table public.__pre_mig126_129_snapshot from public, anon, authenticated';
    execute 'alter table public.__pre_mig126_129_snapshot set schema private';
  end if;
end $$;

-- P2: unindexed FKs on the dispatch-hot P08 table. The audit's other 26 are on
-- low-traffic audit tables and are deliberately left until volume makes them real.
create index if not exists delivery_jobs_assigned_driver_idx
  on public.delivery_jobs (assigned_driver_id) where assigned_driver_id is not null;
create index if not exists delivery_jobs_requester_idx
  on public.delivery_jobs (requester_user_id);
create index if not exists delivery_jobs_service_area_idx
  on public.delivery_jobs (service_area_id);
