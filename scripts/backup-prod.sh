#!/usr/bin/env bash
#
# Off-site logical backup of the production Supabase database.
#
# WHY THIS EXISTS: the project is on the Supabase FREE plan, which provides no
# managed backups — no daily snapshots and no PITR (verified 2026-07-25:
# pitr_enabled=false, backups=[]). `walg_enabled` is internal infrastructure and
# is NOT an operator-restorable backup. Until the plan is upgraded, THIS SCRIPT
# IS THE ONLY THING STANDING BETWEEN YOU AND TOTAL DATA LOSS from a bad
# migration, a wrong DELETE, or an account incident.
#
# WHAT IT CAPTURES
#   1. roles    — cluster roles/grants (needed for a faithful restore)
#   2. schema   — DDL only: tables, RLS policies, functions, triggers, grants
#   3. data     — the actual rows
#
# GRANTS ARE PART OF THE BACKUP, NOT AN EXTRA. On this platform the entire
# authorization model IS the grant set: RLS cannot restrict columns, so authority
# columns (orders.status, restaurants.commission_pct, drivers.is_verified) are
# protected by the absence of a column-level UPDATE grant, and every SECURITY
# DEFINER RPC is protected by `revoke all ... from public, anon`. The dump used
# to run with pg_dump --no-privileges, so it reconstructed the schema and the RLS
# policies and NONE of that — a restore would have come up either wide open or
# completely broken, and would have reported success either way. The dump now
# carries GRANT/REVOKE and ALTER DEFAULT PRIVILEGES, and refuses to be retained
# without them (see the grant-count guard below).
#   Storage OBJECTS (the KYC bucket's files) are NOT covered by a database dump.
#   See "STORAGE" below.
#
# USAGE
#   export SUPABASE_DB_PASSWORD='...'        # Dashboard → Settings → Database
#   ./scripts/backup-prod.sh                 # writes to ~/sharmeats-backups
#   BACKUP_DIR=/Volumes/ext ./scripts/backup-prod.sh
#
# RESTORE (rehearse this BEFORE you need it — an untested backup is a guess):
#   createdb resttest
#   psql -d resttest -f <stamp>/roles.sql      # MUST come first — schema.sql's
#                                              # GRANTs name these roles
#   psql -d resttest -f <stamp>/schema.sql
#   psql -d resttest -c 'set session_replication_role = replica' -f <stamp>/data.sql
#   then spot-check row counts against the manifest.
# The session_replication_role=replica is REQUIRED for the data step: the dump
# has circular FKs (users<->addresses, users<->payment_methods), so loading with
# triggers/FK checks active fails partway. Also expected: spatial_ref_sys data
# is absent from the dump — it is PostGIS-extension-owned and `CREATE EXTENSION
# postgis` regenerates it (verified 2026-07-27: all 79 other tables matched
# prod row-for-row).
#
# The dumps contain EVERY customer row — treat them as production secrets:
# they are written 0600 into a 0700 directory and must never enter git.

set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-ilqpsebcfbaoaogimhud}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/sharmeats-backups}"
KEEP="${KEEP:-14}"                      # how many SUCCESSFUL backups to retain
KEEP_FAILED="${KEEP_FAILED:-5}"         # how many -FAILED quarantine dirs to retain
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${BACKUP_DIR}/${STAMP}"

# A failed run must never leave a directory that reads as a backup: tonight's
# launchd history was full of dirs holding a single 0-byte roles.sql. On any
# error, rename the output dir to *-FAILED — kept for inspection, impossible
# to mistake for a restore point. Disarmed after the manifest is written.
mark_failed() {
  local code=$?
  if [[ "${code}" -ne 0 ]]; then
    case "${OUT}" in
      "${BACKUP_DIR}"/*)
        [[ -d "${OUT}" ]] && mv -- "${OUT}" "${OUT}-FAILED" \
          && echo "  · incomplete output moved to ${OUT}-FAILED" >&2
        ;;
    esac
  fi
}
# EXIT (not ERR): an explicit `exit 1` in the size checks bypasses ERR traps.
trap mark_failed EXIT

# Password resolution, in order:
#   1. SUPABASE_DB_PASSWORD in the environment (ad-hoc runs)
#   2. macOS Keychain item "sharmeats-db-password" (how the scheduled run gets it)
# The Keychain is used so the password never sits in a plaintext env file or in
# the LaunchAgent plist, and never appears in `ps` output.
if [[ -z "${SUPABASE_DB_PASSWORD:-}" ]]; then
  SUPABASE_DB_PASSWORD="$(security find-generic-password -s 'sharmeats-db-password' -w 2>/dev/null || true)"
fi

if [[ -z "${SUPABASE_DB_PASSWORD:-}" ]]; then
  cat >&2 <<'EOF'
ERROR: no database password available.

Get it from: Supabase Dashboard → Project Settings → Database → Database password
(resetting it there is safe — it does not affect the anon or service-role API
keys the apps use).

Store it once in the Keychain so scheduled backups can run unattended:

  security add-generic-password -a "$USER" -s 'sharmeats-db-password' -w 'YOUR-DB-PASSWORD'

...or set it just for this run:

  export SUPABASE_DB_PASSWORD='YOUR-DB-PASSWORD'
EOF
  exit 1
fi

command -v supabase >/dev/null 2>&1 || SUPABASE_CMD="npx --yes supabase"
SUPABASE_CMD="${SUPABASE_CMD:-supabase}"

umask 077
mkdir -p "${OUT}"
chmod 700 "${BACKUP_DIR}" "${OUT}"

echo "→ backing up ${PROJECT_REF} to ${OUT}"

# --linked uses the repo's supabase/config.toml link; --db-url keeps the password
# out of the process list of other users on shared machines.
# Pooler region MUST match the project's region: eu-west-1, verified against
# the Management API (get_project 2026-07-27) -- NOT eu-central-1 as README.md
# used to claim. The two failure modes are distinct and diagnostic:
#   wrong region  -> FATAL: (ENOTFOUND) tenant/user postgres.<ref> not found
#   wrong password-> FATAL: password authentication failed for user "postgres"
# (the bare "postgres" in the second is normal -- the ref suffix is routing
# info consumed by the pooler, so it is NOT evidence of a region problem).
# Override with POOLER_HOST if the project ever actually moves.
POOLER_HOST="${POOLER_HOST:-aws-0-eu-west-1.pooler.supabase.com}"
# Port 6543 (transaction pooler) is the default; BOTH pooler ports accept a
# valid password for this project (tested 2026-07-27 with a known-good
# credential: 5432 and 6543 each authenticated). Every "password
# authentication failed" that night was a genuinely wrong stored password --
# proven independently by the DIRECT host db.<ref>.supabase.co:5432 rejecting
# the same values with no pooler in the path. If auth fails here, test the
# direct host first:
#   psql "postgresql://postgres@db.<ref>.supabase.co:5432/postgres" -c 'select 1'
# Only if the direct host ACCEPTS while the pooler rejects is the pooler (or
# this host/port choice) the suspect.
POOLER_PORT="${POOLER_PORT:-6543}"
DB_URL="postgresql://postgres.${PROJECT_REF}:${SUPABASE_DB_PASSWORD}@${POOLER_HOST}:${POOLER_PORT}/postgres"

# Dump engine selection.
#
# `supabase db dump` shells out to Docker for its pinned pg_dump. On a machine
# without Docker Desktop that fails with "failed to run docker" AFTER the
# password has already been accepted -- which reads like an auth problem but is
# not (observed 2026-07-27). A native Homebrew pg_dump does the same job, so
# prefer the CLI when Docker is actually usable and fall back to pg_dump when it
# is not. Never silently skip: a backup that reports success without writing
# rows is worse than a loud failure.
USE_NATIVE=0
if ! docker info >/dev/null 2>&1; then
  if command -v pg_dump >/dev/null 2>&1; then
    USE_NATIVE=1
    echo "  · (no Docker daemon — using native pg_dump $(pg_dump --version | awk '{print $3}'))"
  else
    cat >&2 <<'EOF'
ERROR: neither a running Docker daemon nor a native pg_dump is available.

`supabase db dump` needs Docker. Either start Docker Desktop, or install the
Postgres client tools so this script can dump directly:

  brew install libpq && brew link --force libpq
  # or: brew install postgresql@17
EOF
    exit 1
  fi
fi

if [[ "${USE_NATIVE}" -eq 1 ]]; then
  # PGPASSWORD via the environment of this process only -- not on the pg_dump
  # command line, so it stays out of `ps` for other users.
  export PGPASSWORD="${SUPABASE_DB_PASSWORD}"
  PG_CONN="postgresql://postgres.${PROJECT_REF}@${POOLER_HOST}:${POOLER_PORT}/postgres"

  # Role NAMES and memberships, reconstructed from the catalog.
  #
  # A native pg_dump still cannot dump cluster roles — that needs `supabase db
  # dump --role-only` (Docker) or pg_dumpall --roles-only with superuser access,
  # which Supabase's pooler does not grant. But it does not need to: pg_roles is
  # readable by anyone, and what schema.sql's GRANT statements actually require
  # is that the role NAMES exist. Without this file every GRANT and REVOKE in the
  # schema fails with "role does not exist" and the restore comes up with no
  # authorization model at all.
  #
  # NOT captured (and deliberately so — a backup should not carry them):
  # passwords, LOGIN/SUPERUSER attributes, connection limits, per-role settings.
  # A drill database wants the grant graph, not the credentials.
  echo "  · roles (names + memberships, from pg_roles)"
  if command -v psql >/dev/null 2>&1; then
    {
      echo "-- Role names and memberships as of ${STAMP}, reconstructed from pg_roles."
      echo "-- Load this BEFORE schema.sql: every GRANT there names a role from this file."
      echo "-- Passwords and login attributes are NOT captured. See backup-prod.sh."
      psql "${PG_CONN}" -tAc "
        select 'do \$\$ begin if not exists (select 1 from pg_roles where rolname = '
               || quote_literal(rolname) || ') then create role ' || quote_ident(rolname)
               || ' nologin noinherit; end if; end \$\$;'
          from pg_roles
         where rolname not like 'pg\_%'
         order by rolname"
      psql "${PG_CONN}" -tAc "
        select 'grant ' || quote_ident(g.rolname) || ' to ' || quote_ident(m.rolname) || ';'
          from pg_auth_members am
          join pg_roles g on g.oid = am.roleid
          join pg_roles m on m.oid = am.member
         where g.rolname not like 'pg\_%' and m.rolname not like 'pg\_%'
         order by 1"
    } > "${OUT}/roles.sql"
  else
    cat > "${OUT}/roles.sql" <<'EOF'
-- NOT CAPTURED: psql is not installed, so role names could not be read from
-- pg_roles. schema.sql's GRANT statements will fail on restore until the roles
-- exist. Recreate them from supabase/migrations/ (they are all declared there)
-- before loading schema.sql, or install the Postgres client tools and re-run.
EOF
  fi

  # NO --no-privileges. GRANT/REVOKE and ALTER DEFAULT PRIVILEGES are the
  # authorization model on this database (see the header) and belong in the
  # schema dump, in dependency order, right after the objects they apply to.
  # --no-owner stays: ownership needs roles with matching attributes, which this
  # backup deliberately does not carry.
  echo "  · schema (DDL, RLS policies, functions, GRANTs)"
  pg_dump "${PG_CONN}" --schema-only --no-owner \
    --schema=public --schema=storage --schema=auth \
    -f "${OUT}/schema.sql"

  echo "  · data (rows)"
  pg_dump "${PG_CONN}" --data-only --no-owner --no-privileges \
    --schema=public --schema=storage --schema=auth \
    -f "${OUT}/data.sql"

  unset PGPASSWORD
else
  echo "  · roles"
  ${SUPABASE_CMD} db dump --db-url "${DB_URL}" --role-only -f "${OUT}/roles.sql"

  echo "  · schema (DDL, RLS policies, functions)"
  ${SUPABASE_CMD} db dump --db-url "${DB_URL}" -f "${OUT}/schema.sql"

  echo "  · data (rows)"
  ${SUPABASE_CMD} db dump --db-url "${DB_URL}" --data-only -f "${OUT}/data.sql"
fi

# Fail loudly if a dump produced nothing usable. A 0-byte or header-only file
# means the backup did not happen, regardless of exit codes upstream.
for f in schema.sql data.sql; do
  if [[ ! -s "${OUT}/${f}" ]] || [[ "$(wc -l < "${OUT}/${f}")" -lt 10 ]]; then
    echo "ERROR: ${OUT}/${f} is empty or truncated — backup FAILED, not retained." >&2
    exit 1
  fi
done

# A schema dump with no GRANTs is not a backup of this database.
#
# Authority here lives in the grant set, not only in RLS: column-level UPDATE
# grants are what stop a merchant self-setting commission_pct, and
# `revoke all ... from public, anon` is what stops anon calling the SECURITY
# DEFINER RPCs. Restoring DDL + RLS without them yields a database that looks
# right and enforces nothing — the worst possible restore outcome, and one the
# old --no-privileges dump would have produced silently every night.
#
# Counted, not merely presence-checked: prod has ~50 public tables plus the
# functions, so a healthy dump carries hundreds. A handful would mean the dump
# captured one schema's ACLs and dropped the rest.
GRANT_COUNT="$(grep -c '^\(GRANT\|REVOKE\|ALTER DEFAULT PRIVILEGES\) ' "${OUT}/schema.sql" || true)"
MIN_GRANTS="${BACKUP_MIN_GRANTS:-50}"
if [[ "${GRANT_COUNT}" -lt "${MIN_GRANTS}" ]]; then
  cat >&2 <<EOF
ERROR: schema.sql contains only ${GRANT_COUNT} GRANT/REVOKE statements (expected
>= ${MIN_GRANTS}) — the authorization model was NOT captured. Backup FAILED, not
retained.

On this database the grant set IS the authorization model, so a dump without it
restores to something that reads fine and enforces nothing.

If the dump ran through the Supabase CLI path, that path may be passing
--no-privileges of its own accord; run with Docker stopped to take the native
pg_dump path, which captures privileges explicitly. Override the floor only if
you know why it moved:  BACKUP_MIN_GRANTS=<n> ./scripts/backup-prod.sh
EOF
  exit 1
fi

# Manifest: what was captured, so a restore can be sanity-checked later.
{
  echo "project_ref: ${PROJECT_REF}"
  echo "taken_at_utc: ${STAMP}"
  echo "taken_by: $(whoami)@$(hostname)"
  if [[ "${USE_NATIVE}" -eq 1 ]]; then
    echo "dump_engine: native pg_dump $(pg_dump --version 2>/dev/null | awk '{print $3}')"
    echo "roles_captured: names + memberships only (no passwords/attributes)"
  else
    echo "dump_engine: supabase cli $(${SUPABASE_CMD} --version 2>/dev/null | head -1)"
    echo "roles_captured: yes"
  fi
  echo "grant_statements: ${GRANT_COUNT}"
  echo "git_head: $(git -C "$(dirname "$0")/.." rev-parse --short HEAD 2>/dev/null || echo n/a)"
  echo "files:"
  for f in roles.sql schema.sql data.sql; do
    if [[ -f "${OUT}/${f}" ]]; then
      echo "  ${f}: $(wc -c < "${OUT}/${f}" | tr -d ' ') bytes"
    fi
  done
} > "${OUT}/MANIFEST.txt"

chmod 600 "${OUT}"/*.sql "${OUT}/MANIFEST.txt"

# Fail loudly if a dump came back suspiciously small — a truncated backup that
# looks successful is worse than an obvious failure.
for f in schema.sql data.sql; do
  size=$(wc -c < "${OUT}/${f}" | tr -d ' ')
  if [[ "${size}" -lt 1024 ]]; then
    echo "ERROR: ${f} is only ${size} bytes — dump likely failed. Keeping for inspection." >&2
    exit 1
  fi
done

# Retention: keep the newest ${KEEP} SUCCESSFUL timestamped directories.
#
# The earlier version globbed every directory, so `-FAILED` quarantine dirs
# counted against KEEP. Four consecutive failures on 2026-07-27 therefore
# evicted four good backups: with 14 slots and 8 failure dirs present, the
# effective retention was 6 real backups, not 14 — retention silently shrank
# in exactly the circumstance where history matters most. Failures are now
# counted and pruned separately.
ls -1d "${BACKUP_DIR}"/*/ 2>/dev/null \
  | grep -v -- '-FAILED/$' \
  | sort -r | tail -n +$((KEEP + 1)) | while read -r old; do
  echo "  · pruning $(basename "${old}")"
  rm -rf "${old}"
done

# Quarantined failures are kept for diagnosis but must not accumulate forever.
ls -1d "${BACKUP_DIR}"/*-FAILED/ 2>/dev/null \
  | sort -r | tail -n +$((KEEP_FAILED + 1)) | while read -r old; do
  echo "  · pruning failed run $(basename "${old}")"
  rm -rf "${old}"
done

trap - EXIT
echo "✓ backup complete: ${OUT}"
cat "${OUT}/MANIFEST.txt"
cat <<'EOF'

NEXT (do not skip):
  · Copy this directory OFF this machine (external drive / encrypted cloud).
    A backup that lives only on the laptop that could die with it is not a backup.
  · STORAGE IS NOT INCLUDED. The 'kyc' bucket holds merchant/driver identity
    documents and a DB dump does not contain them. Back those up separately from
    the Dashboard (Storage → kyc → download) or with the Storage API.
  · Rehearse a restore into a scratch database at least once. Until you have
    restored successfully, you have an untested assumption, not a backup.
EOF
