#!/usr/bin/env bash
#
# replay-migrations.sh — apply every migration, in order, to an empty database.
#
# WHY THIS EXISTS
# Nothing has ever replayed supabase/migrations from zero. CI type-checks against
# generated types and runs a hand-picked list of self-contained test files; the
# 206 migrations themselves are only ever applied one at a time, to production,
# by hand. So the question "could we rebuild this database from the repository?"
# — the question a restore, a staging environment, or a second region all depend
# on — has no answer.
#
# This gives it one. It stands up a throwaway PostgreSQL in a temp directory
# (same harness as scripts/test-security-migrations.sh: initdb + pg_ctl, no
# Docker, no service container), shims the parts of a Supabase database that
# migrations assume exist, then applies every migration in filename order with
# ON_ERROR_STOP=1 and reports the FIRST one that fails.
#
# Usage:   scripts/replay-migrations.sh
# Exit:    0 every migration applied, 1 a migration failed, 2 misconfiguration.
#
# ADVISORY IN CI, ON PURPOSE — READ THIS BEFORE PROMOTING IT TO A GATE.
# 64 historical migrations were applied to production by hand and never stamped
# (scripts/db-drift-baseline.txt), two numeric prefixes are duplicated, and some
# migrations were written against a schema that a later migration changed. A
# clean replay is therefore NOT expected today, and wiring this as a blocking
# gate would turn every PR red for reasons no PR author introduced — the same
# mistake ci.yml already documents for expo-doctor. It runs, its output is the
# work item, and it becomes a gate on the day it first passes.
#
# THE SHIM IS A SHIM. Supabase's auth/storage schemas are created by GoTrue and
# storage-api, not by SQL in this repository, and pg_cron/pg_net are not
# installable here. What is created below is the minimum surface the migrations
# reference — enough to prove the DDL is self-consistent, NOT enough to prove
# anything about runtime behaviour. Behavioural assertions belong in
# supabase/tests/ and run through scripts/test-security-migrations.sh.

set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
migrations_dir="${project_root}/supabase/migrations"

if [[ ! -d "${migrations_dir}" ]]; then
  echo "replay-migrations: ${migrations_dir} not found" >&2
  exit 2
fi
command -v pg_config >/dev/null 2>&1 || { echo "replay-migrations: pg_config not found" >&2; exit 2; }

postgres_bin_dir="$(pg_config --bindir)"
test_work_dir="$(mktemp -d "${TMPDIR:-/tmp}/sharmeats-replay.XXXXXX")"
test_data_dir="${test_work_dir}/data"
test_socket_dir="${test_work_dir}/socket"
test_db_port="$((45000 + RANDOM % 5000))"
test_database="replay"

mkdir -p "${test_socket_dir}"

cleanup() {
  if [[ -f "${test_data_dir}/postmaster.pid" ]]; then
    "${postgres_bin_dir}/pg_ctl" -D "${test_data_dir}" -m immediate -w stop >/dev/null
  fi
  case "${test_work_dir}" in
    "${TMPDIR:-/tmp}"/sharmeats-replay.*) rm -rf -- "${test_work_dir}" ;;
    *) echo "Refusing to remove unexpected work directory: ${test_work_dir}" >&2 ;;
  esac
}
trap cleanup EXIT

"${postgres_bin_dir}/initdb" \
  -D "${test_data_dir}" \
  --auth=trust \
  --encoding=UTF8 \
  --no-locale >/dev/null

"${postgres_bin_dir}/pg_ctl" \
  -D "${test_data_dir}" \
  -o "-F -p ${test_db_port} -k ${test_socket_dir}" \
  -w start >/dev/null

"${postgres_bin_dir}/createdb" -h "${test_socket_dir}" -p "${test_db_port}" "${test_database}"

run_sql() {
  "${postgres_bin_dir}/psql" \
    -X -q \
    -v ON_ERROR_STOP=1 \
    -h "${test_socket_dir}" \
    -p "${test_db_port}" \
    -d "${test_database}" \
    "$@"
}

# ---------------------------------------------------------------------------
# Supabase shim
# ---------------------------------------------------------------------------
# Everything here is something a hosted Supabase project already has and this
# repository never creates. If a migration fails because of something MISSING
# from this list, adding it here is usually the right fix; if it fails because of
# its own SQL, that is the finding.
echo "→ shimming the Supabase surface"
if ! run_sql -c "create extension if not exists postgis" >/dev/null 2>&1; then
  cat >&2 <<'EOF'
replay-migrations: PostGIS is not available on this PostgreSQL installation.

addresses, drivers, hotels, kitchens and restaurants all have geography columns,
so without it the replay fails on the first spatial migration for an environment
reason rather than a repository one — which is exactly the misleading result
this script must not produce.

  brew install postgis           # macOS
  apt-get install postgresql-<v>-postgis-3
EOF
  exit 2
fi

run_sql <<'SQL'
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";
create extension if not exists pg_trgm;
create extension if not exists btree_gist;

-- Roles. Supabase creates these at project provisioning; every grant in the
-- migrations names them. NOLOGIN because nothing connects as them here.
do $shim$
declare r text;
begin
  foreach r in array array[
    'anon','authenticated','service_role','authenticator','postgres',
    'supabase_admin','supabase_auth_admin','supabase_storage_admin',
    'supabase_realtime_admin','dashboard_user','pgbouncer'
  ] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin noinherit', r);
    end if;
  end loop;
end
$shim$;

create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;
create schema if not exists graphql_public;
create schema if not exists realtime;
create schema if not exists vault;
create schema if not exists cron;
create schema if not exists net;

-- Realtime's publication. Supabase provisions it empty; migrations add tables to
-- it with `alter publication supabase_realtime add table ...`.
do $shim$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$shim$;

-- auth: GoTrue owns these in a real project.
create table if not exists auth.users (
  id                uuid primary key default gen_random_uuid(),
  email             text,
  phone             text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  raw_app_meta_data  jsonb default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

create or replace function auth.uid() returns uuid
  language sql stable as $fn$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$fn$;

create or replace function auth.role() returns text
  language sql stable as $fn$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
$fn$;

create or replace function auth.email() returns text
  language sql stable as $fn$
  select nullif(current_setting('request.jwt.claim.email', true), '')
$fn$;

create or replace function auth.jwt() returns jsonb
  language sql stable as $fn$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$fn$;

-- storage: storage-api owns these in a real project.
create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now()
);

create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets(id),
  name       text,
  owner      uuid,
  metadata   jsonb,
  created_at timestamptz not null default now()
);

create or replace function storage.foldername(name text) returns text[]
  language sql immutable as $fn$
  select string_to_array(name, '/')
$fn$;

-- pg_cron: not installable here, and the migrations only ever call schedule /
-- unschedule. The stubs record what WOULD have been scheduled so a replay can be
-- diffed against production's cron.job (see scripts/check-cron-liveness.sh).
create table if not exists cron.job (
  jobid    bigserial primary key,
  jobname  text unique,
  schedule text,
  command  text,
  active   boolean not null default true
);

create table if not exists cron.job_run_details (
  jobid      bigint,
  status     text,
  start_time timestamptz
);

create or replace function cron.schedule(job_name text, schedule text, command text)
  returns bigint language sql as $fn$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid
$fn$;

create or replace function cron.unschedule(job_name text)
  returns boolean language sql as $fn$
  delete from cron.job where jobname = job_name returning true
$fn$;

-- Supabase Vault. Provisioned by the platform; 17 migrations read
-- vault.decrypted_secrets and two call vault.create_secret. The shim stores the
-- secret in clear text, which is fine for a throwaway database and must never
-- be mistaken for the real thing.
create table if not exists vault.secrets (
  id           uuid primary key default gen_random_uuid(),
  name         text unique,
  description  text not null default '',
  secret       text not null,
  created_at   timestamptz not null default now()
);

create or replace view vault.decrypted_secrets as
  select id, name, description, secret, secret as decrypted_secret, created_at
    from vault.secrets;

create or replace function vault.create_secret(
  new_secret text,
  new_name text default null,
  new_description text default '',
  new_key_id uuid default null
) returns uuid language sql as $fn$
  insert into vault.secrets (name, description, secret)
  values (new_name, new_description, new_secret)
  on conflict (name) do update set secret = excluded.secret
  returning id
$fn$;

-- pg_net: fire-and-forget HTTP. Records the call instead of making it.
create table if not exists net._http_response (
  id           bigserial primary key,
  status_code  int,
  content      text,
  created      timestamptz not null default now()
);

create or replace function net.http_post(
  url     text,
  body    jsonb default '{}'::jsonb,
  params  jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb,
  timeout_milliseconds int default 5000
) returns bigint language sql as $fn$
  select 0::bigint
$fn$;
SQL

# ---------------------------------------------------------------------------
# Replay
# ---------------------------------------------------------------------------
echo "→ replaying migrations from ${migrations_dir}"

# `create extension pg_net` / `pg_cron` / `hypopg` / `plpgsql_check` and friends
# cannot succeed here: those binaries are Supabase-managed and are not
# installable on a stock PostgreSQL. The statements are neutralised on the way in
# — replaced by an empty DO block, never deleted — and the APIs the migrations
# actually call are stubbed above.
#
# ALLOW-LIST, not a block-list. Enumerating the unavailable ones meant a new
# `create extension` in a future migration would fail the replay for an
# environment reason and read as a repository defect. Anything not installed by
# the shim above is stripped; adding a genuinely-available extension is a
# one-word change here. Every strip is counted and reported, because a shim
# nobody can see is a lie about what was tested.
strip_unavailable_extensions() {
  # ANCHORED AT LINE START (/m). Unanchored, the first pass matched the words
  # "CREATE EXTENSION" inside a prose comment in mig 141 and swallowed the DO
  # block that followed it, producing a syntax error that looked like a defect in
  # that migration. A statement always begins its own line here.
  perl -0777 -pe '
    s{^([ \t]*create\s+extension[^;]*;)}{
      my $stmt = $1;
      $stmt =~ /\b(pgcrypto|postgis|postgis_topology|uuid-ossp|pg_trgm|btree_gist|unaccent|citext)\b/i
        ? $stmt
        : "do \$replayshim\$ begin end \$replayshim\$;"
    }gimse' "$1"
}

# REPLAY_SKIP is a DIAGNOSTIC knob, not a suppression list: it exists so that
# after this reports a failure you can step past it and see what ELSE is broken
# in one pass instead of one run per fix. It defaults to empty, CI never sets it,
# and every skip is printed.
applied=0
skipped=0
stripped=0
while IFS= read -r migration; do
  name="$(basename "${migration}")"
  if [[ " ${REPLAY_SKIP:-} " == *" ${name} "* ]]; then
    echo "  · SKIPPED ${name} (REPLAY_SKIP)"
    skipped=$((skipped + 1))
    continue
  fi
  strip_unavailable_extensions "${migration}" > "${test_work_dir}/current.sql"
  if ! cmp -s "${migration}" "${test_work_dir}/current.sql"; then
    stripped=$((stripped + 1))
  fi
  if ! run_sql -f "${test_work_dir}/current.sql" > "${test_work_dir}/last.log" 2>&1; then
    echo
    echo "REPLAY FAILED at ${name} (after ${applied} applied cleanly)"
    echo "-------------------------------------------------------------"
    sed 's/^/  /' "${test_work_dir}/last.log"
    echo "-------------------------------------------------------------"
    echo "A fresh database cannot be rebuilt from this repository past ${name}."
    exit 1
  fi
  applied=$((applied + 1))
done < <(find "${migrations_dir}" -maxdepth 1 -name '*.sql' | sort)

echo "✓ ${applied} migrations replayed cleanly onto an empty database"
echo "  (${stripped} had a create-extension statement stripped by the shim)"
if [[ "${skipped}" -gt 0 ]]; then
  echo "  WARNING: ${skipped} migration(s) were SKIPPED via REPLAY_SKIP — this run"
  echo "  does NOT show that the repository can rebuild the database."
  exit 1
fi
