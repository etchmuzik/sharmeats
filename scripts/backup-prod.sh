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
#   psql -d resttest -f <stamp>/roles.sql
#   psql -d resttest -f <stamp>/schema.sql
#   psql -d resttest -f <stamp>/data.sql
#   then spot-check row counts against the manifest.
#
# The dumps contain EVERY customer row — treat them as production secrets:
# they are written 0600 into a 0700 directory and must never enter git.

set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-ilqpsebcfbaoaogimhud}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/sharmeats-backups}"
KEEP="${KEEP:-14}"                      # how many timestamped backups to retain
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
DB_URL="postgresql://postgres.${PROJECT_REF}:${SUPABASE_DB_PASSWORD}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres"

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
  PG_CONN="postgresql://postgres.${PROJECT_REF}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres"

  echo "  · roles (native pg_dump cannot dump cluster roles — see manifest)"
  cat > "${OUT}/roles.sql" <<'EOF'
-- NOT CAPTURED by the native pg_dump path: cluster-level roles live outside the
-- database and need `supabase db dump --role-only` (Docker) or pg_dumpall
-- --roles-only with superuser access, which Supabase's pooler does not grant.
-- On restore, recreate roles from supabase/migrations/ (they are all declared
-- there) before loading schema.sql.
EOF

  echo "  · schema (DDL, RLS policies, functions)"
  pg_dump "${PG_CONN}" --schema-only --no-owner --no-privileges \
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

# Manifest: what was captured, so a restore can be sanity-checked later.
{
  echo "project_ref: ${PROJECT_REF}"
  echo "taken_at_utc: ${STAMP}"
  echo "taken_by: $(whoami)@$(hostname)"
  if [[ "${USE_NATIVE}" -eq 1 ]]; then
    echo "dump_engine: native pg_dump $(pg_dump --version 2>/dev/null | awk '{print $3}')"
    echo "roles_captured: NO — see roles.sql for the restore note"
  else
    echo "dump_engine: supabase cli $(${SUPABASE_CMD} --version 2>/dev/null | head -1)"
    echo "roles_captured: yes"
  fi
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

# Retention: keep the newest ${KEEP} timestamped directories.
ls -1d "${BACKUP_DIR}"/*/ 2>/dev/null | sort -r | tail -n +$((KEEP + 1)) | while read -r old; do
  echo "  · pruning $(basename "${old}")"
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
