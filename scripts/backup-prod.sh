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

if [[ -z "${SUPABASE_DB_PASSWORD:-}" ]]; then
  cat >&2 <<'EOF'
ERROR: SUPABASE_DB_PASSWORD is not set.

Get it from: Supabase Dashboard → Project Settings → Database → Database password
(reset it there if unknown — resetting is safe, it does not affect the anon or
service-role API keys the apps use).

Then:
  export SUPABASE_DB_PASSWORD='your-db-password'
  ./scripts/backup-prod.sh
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

echo "  · roles"
${SUPABASE_CMD} db dump --db-url "${DB_URL}" --role-only -f "${OUT}/roles.sql"

echo "  · schema (DDL, RLS policies, functions)"
${SUPABASE_CMD} db dump --db-url "${DB_URL}" -f "${OUT}/schema.sql"

echo "  · data (rows)"
${SUPABASE_CMD} db dump --db-url "${DB_URL}" --data-only -f "${OUT}/data.sql"

# Manifest: what was captured, so a restore can be sanity-checked later.
{
  echo "project_ref: ${PROJECT_REF}"
  echo "taken_at_utc: ${STAMP}"
  echo "taken_by: $(whoami)@$(hostname)"
  echo "supabase_cli: $(${SUPABASE_CMD} --version 2>/dev/null | head -1)"
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
