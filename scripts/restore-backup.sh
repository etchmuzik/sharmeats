#!/usr/bin/env bash
#
# Rehearse a restore of a Sharm Eats logical backup into a SCRATCH database.
#
# WHY THIS EXISTS (package 01 §1)
# The project is on the Supabase free plan: no managed backups, no PITR. The
# dumps written by scripts/backup-prod.sh are the only restorable copy, and
# until one has actually been restored they are an assumption, not a backup.
# This script makes that drill repeatable so it gets run more than once.
#
# SAFETY POSTURE
# This script only ever CREATES a scratch database and writes into it. It
# refuses, before touching anything:
#   * a target that looks like production (supabase.co host, the project ref,
#     pooler hostnames, or a name containing prod/production/live);
#   * an empty target name, "/", $HOME, or the repository root;
#   * a database that already exists, unless --force-drop is passed explicitly;
#   * a backup directory whose MANIFEST/schema/data are missing or truncated.
# The refusals run BEFORE createdb, so an unsafe invocation cannot get as far
# as mutating anything.
#
# USAGE
#   scripts/restore-backup.sh <backup-dir> [scratch-db-name]
#   scripts/restore-backup.sh ~/sharmeats-backups/20260727T022014Z
#   scripts/restore-backup.sh <dir> drill_2026_07_27 --force-drop
#
# Defaults the scratch name to sharmeats_drill_<stamp> so a bare invocation is
# safe. Set PGHOST/PGPORT/PGUSER as usual for a non-default local cluster;
# a remote host is rejected unless RESTORE_ALLOW_REMOTE=1 (never use that
# against production).
#
# OUTPUT
# Writes a timestamped drill report to $DRILL_REPORT_DIR (default
# ~/sharmeats-drills), deliberately OUTSIDE the backup directory so a drill can
# never modify or be mistaken for the artifact it is testing.

set -euo pipefail

BACKUP_DIR_ARG="${1:-}"
SCRATCH_DB="${2:-}"
FORCE_DROP=0
for arg in "$@"; do
  [[ "${arg}" == "--force-drop" ]] && FORCE_DROP=1
done

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRILL_REPORT_DIR="${DRILL_REPORT_DIR:-$HOME/sharmeats-drills}"
PROJECT_REF="${SUPABASE_PROJECT_REF:-ilqpsebcfbaoaogimhud}"

die() { echo "ERROR: $*" >&2; exit 1; }

usage() {
  cat >&2 <<'EOF'
usage: scripts/restore-backup.sh <backup-dir> [scratch-db-name] [--force-drop]

  <backup-dir>       a directory written by scripts/backup-prod.sh, containing
                     MANIFEST.txt, schema.sql and data.sql
  [scratch-db-name]  defaults to sharmeats_drill_<utc-stamp>
  --force-drop       drop the scratch database first if it already exists

This restores INTO A SCRATCH DATABASE ONLY. It refuses production-looking
targets and never writes to the backup directory.
EOF
  exit 2
}

[[ -z "${BACKUP_DIR_ARG}" ]] && usage
[[ "${BACKUP_DIR_ARG}" == "-h" || "${BACKUP_DIR_ARG}" == "--help" ]] && usage

# ---------------------------------------------------------------------------
# 1. Validate the backup BEFORE creating anything.
# ---------------------------------------------------------------------------
BACKUP_DIR="$(cd "${BACKUP_DIR_ARG}" 2>/dev/null && pwd || true)"
[[ -z "${BACKUP_DIR}" || ! -d "${BACKUP_DIR}" ]] && die "backup directory not found: ${BACKUP_DIR_ARG}"

case "$(basename "${BACKUP_DIR}")" in
  *-FAILED)
    die "refusing to restore '$(basename "${BACKUP_DIR}")': backup-prod.sh marks incomplete runs -FAILED. Pick a complete one."
    ;;
esac

for f in MANIFEST.txt schema.sql data.sql; do
  [[ -f "${BACKUP_DIR}/${f}" ]] || die "backup is missing ${f} -- not a complete backup directory"
done

# A truncated dump must fail here, before any mutation. backup-prod.sh already
# refuses to retain files under 1 KiB, so anything smaller reached us another
# way (a partial copy off a drive, a half-finished rsync).
for f in schema.sql data.sql; do
  size=$(wc -c < "${BACKUP_DIR}/${f}" | tr -d ' ')
  [[ "${size}" -lt 1024 ]] && die "${f} is only ${size} bytes -- truncated or corrupt backup, refusing to restore"
done

# The schema dump must actually contain schema. A file full of NULs or HTML
# (an error page saved by mistake) passes the size check but not this one.
grep -q "^CREATE TABLE" "${BACKUP_DIR}/schema.sql" \
  || die "schema.sql contains no CREATE TABLE statements -- corrupt or wrong file"
grep -q "^COPY \|^INSERT INTO " "${BACKUP_DIR}/data.sql" \
  || die "data.sql contains no COPY/INSERT statements -- corrupt or wrong file"

MANIFEST_TABLES="skip"
if grep -q "^taken_at_utc:" "${BACKUP_DIR}/MANIFEST.txt"; then
  TAKEN_AT="$(awk -F': ' '/^taken_at_utc:/{print $2}' "${BACKUP_DIR}/MANIFEST.txt")"
else
  die "MANIFEST.txt has no taken_at_utc -- not a manifest written by backup-prod.sh"
fi
# Table count is derived from the dump itself rather than trusted from the
# manifest, which records byte sizes only.
#
# PUBLIC ONLY. This counted every schema until 2026-07-27, giving 80
# (49 public + 23 auth + 8 storage) and comparing it against a verifier query
# that counts public base tables only -- so a perfect restore reported
# "50 tables restored, drill expected 80" and looked like 30 tables had
# vanished. Compare like with like, or the check manufactures alarm.
MANIFEST_TABLES="$(grep -cE "^CREATE TABLE public\." "${BACKUP_DIR}/schema.sql" | tr -d ' ')"

# ---------------------------------------------------------------------------
# 2. Refuse unsafe targets BEFORE createdb.
# ---------------------------------------------------------------------------
if [[ -z "${SCRATCH_DB}" ]]; then
  SCRATCH_DB="sharmeats_drill_$(date -u +%Y%m%d%H%M%S)"
fi

# Empty / filesystem-shaped names. A path here means someone confused the
# database argument with a directory argument.
case "${SCRATCH_DB}" in
  ""|"/"|"${HOME}"|"${HOME}/"|"${REPO_ROOT}"|"${REPO_ROOT}/")
    die "refusing target '${SCRATCH_DB}': that is a filesystem path, not a scratch database name"
    ;;
  */*)
    die "refusing target '${SCRATCH_DB}': database names cannot contain '/'"
    ;;
esac

# Production-shaped names and connection targets.
shopt -s nocasematch
if [[ "${SCRATCH_DB}" =~ (prod|production|live|main) || "${SCRATCH_DB}" == "postgres" ]]; then
  die "refusing target '${SCRATCH_DB}': name looks like production. Use an explicit scratch name."
fi
if [[ "${SCRATCH_DB}" == *"${PROJECT_REF}"* ]]; then
  die "refusing target '${SCRATCH_DB}': contains the production project ref"
fi

TARGET_HOST="${PGHOST:-localhost}"
if [[ "${TARGET_HOST}" =~ supabase\.co|supabase\.com|pooler\. || "${TARGET_HOST}" == *"${PROJECT_REF}"* ]]; then
  die "refusing to restore into '${TARGET_HOST}': that is a Supabase host. This drill is local-only."
fi
if [[ ! "${TARGET_HOST}" =~ ^(localhost|127\.0\.0\.1|::1|/)$ && "${RESTORE_ALLOW_REMOTE:-0}" != "1" ]]; then
  die "PGHOST='${TARGET_HOST}' is not local. Set RESTORE_ALLOW_REMOTE=1 only if you are certain, and never for production."
fi
shopt -u nocasematch

command -v psql     >/dev/null 2>&1 || die "psql not found"
command -v createdb >/dev/null 2>&1 || die "createdb not found"

# PostGIS is checked HERE, before createdb, not after. It is the most likely
# environment failure on a fresh machine, and discovering it post-createdb left
# a stray scratch database behind on every attempt (observed while testing this
# script on 2026-07-27). pg_available_extensions is a catalog read against the
# maintenance database, so it needs no scratch database to answer.
if ! psql -d postgres -tAc \
     "select 1 from pg_available_extensions where name = 'postgis'" 2>/dev/null | grep -q 1; then
  cat >&2 <<'EOF'
ERROR: PostGIS is not available on this PostgreSQL installation.

public.addresses, drivers, hotels, kitchens and restaurants all have geography
columns (23 references in the 2026-07-27 dump). Without PostGIS those five
CREATE TABLEs fail and roughly 180 dependent statements cascade -- which reads
as a corrupt backup but is an environment problem.

  brew install postgis

Nothing has been created or modified.
EOF
  exit 1
fi

# ---------------------------------------------------------------------------
# 3. Create the scratch database.
# ---------------------------------------------------------------------------
if psql -lqtA 2>/dev/null | cut -d'|' -f1 | grep -qx "${SCRATCH_DB}"; then
  if [[ "${FORCE_DROP}" -eq 1 ]]; then
    echo "  · dropping existing ${SCRATCH_DB} (--force-drop)"
    dropdb "${SCRATCH_DB}"
  else
    die "database '${SCRATCH_DB}' already exists. Pass --force-drop to replace it, or choose another name."
  fi
fi

mkdir -p "${DRILL_REPORT_DIR}"
REPORT="${DRILL_REPORT_DIR}/drill-${STAMP}.txt"

echo "→ restore drill"
echo "  backup:  ${BACKUP_DIR}  (taken ${TAKEN_AT})"
echo "  scratch: ${SCRATCH_DB} on ${TARGET_HOST}"
echo "  report:  ${REPORT}"

# -T template0 so a polluted template1 cannot make `create table if not exists`
# statements silently no-op and leave us verifying the wrong schema. That
# happened during development of the mig-136 fixture on 2026-07-27.
createdb -T template0 "${SCRATCH_DB}" || die "createdb failed"

# From here on, a failure should leave the scratch DB for inspection but say so.
cleanup_note() {
  local code=$?
  if [[ "${code}" -ne 0 ]]; then
    echo "  · drill FAILED; scratch database '${SCRATCH_DB}' kept for inspection" >&2
    echo "    drop it with: dropdb ${SCRATCH_DB}" >&2
  fi
}
trap cleanup_note EXIT

{
  echo "Sharm Eats restore drill"
  echo "========================"
  echo "drill_at_utc:  ${STAMP}"
  echo "backup_dir:    ${BACKUP_DIR}"
  echo "backup_taken:  ${TAKEN_AT}"
  echo "scratch_db:    ${SCRATCH_DB}"
  echo "host:          ${TARGET_HOST}"
  echo "operator:      $(whoami)@$(hostname)"
  echo "git_head:      $(git -C "${REPO_ROOT}" rev-parse --short HEAD 2>/dev/null || echo n/a)"
  echo "tables_in_dump: ${MANIFEST_TABLES}"
  echo ""
} > "${REPORT}"

# ---------------------------------------------------------------------------
# 4. PostGIS first. Without it the five geography-bearing tables fail and ~180
#    downstream errors cascade, which reads as a corrupt dump but is not.
# ---------------------------------------------------------------------------
echo "  · postgis"
if ! psql -q -d "${SCRATCH_DB}" -c "create extension if not exists postgis" >/dev/null 2>&1; then
  {
    echo "RESULT: FAILED (postgis unavailable)"
    echo ""
    echo "public.addresses, drivers, hotels, kitchens and restaurants all have"
    echo "geography columns. Without PostGIS those CREATE TABLEs fail and every"
    echo "dependent object cascades -- roughly 180 errors that look like a corrupt"
    echo "dump but are an environment problem."
    echo ""
    echo "Fix:  brew install postgis"
  } >> "${REPORT}"
  cat "${REPORT}"
  die "postgis is not available on this Postgres. See ${REPORT}."
fi
psql -q -d "${SCRATCH_DB}" -c "create extension if not exists pgcrypto" >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# 5. Roles, schema, then data.
# ---------------------------------------------------------------------------
if [[ -s "${BACKUP_DIR}/roles.sql" ]] && grep -qv "^--" "${BACKUP_DIR}/roles.sql" 2>/dev/null \
   && grep -q "CREATE ROLE\|ALTER ROLE" "${BACKUP_DIR}/roles.sql"; then
  echo "  · roles"
  psql -q -d "${SCRATCH_DB}" -f "${BACKUP_DIR}/roles.sql" >>"${REPORT}" 2>&1 || true
  echo "roles: loaded" >> "${REPORT}"
else
  # The native pg_dump path cannot dump cluster roles (see backup-prod.sh), so
  # roles.sql is a note rather than SQL. Say so instead of implying success.
  echo "  · roles (not in this dump -- native pg_dump path; see backup-prod.sh)"
  echo "roles: NOT PRESENT (native dump limitation; recreate from supabase/migrations/)" >> "${REPORT}"
fi

# Keep the error TEXT, not just a count. The first real drill reported
# "schema_errors: 1" and nothing else, so diagnosing it meant re-running the
# load by hand -- a count tells you something broke but never what, which is the
# opposite of what an operator needs at restore time. Full logs go next to the
# report; the first few lines are inlined so the report is self-contained.
SCHEMA_LOG="${REPORT%.txt}-schema.log"
DATA_LOG="${REPORT%.txt}-data.log"

# `psql ... | grep` would report grep's status, so capture to a log first and
# count from the file. Errors here are counted, not fatal: the load is expected
# to be imperfect (see the benign "schema public already exists" below) and the
# verifier is what decides pass/fail.
echo "  · schema"
psql -d "${SCRATCH_DB}" -f "${BACKUP_DIR}/schema.sql" > "${SCHEMA_LOG}" 2>&1 || true
SCHEMA_ERRS=$(grep -c "^psql.*ERROR" "${SCHEMA_LOG}" || true)
echo "schema_errors: ${SCHEMA_ERRS}  (full log: ${SCHEMA_LOG})" >> "${REPORT}"
if [ "${SCHEMA_ERRS}" -gt 0 ]; then
  # Expected and harmless: pg_dump emits CREATE SCHEMA public, which createdb
  # has already made. Called out by name so a real error is not lost beside it.
  grep "^psql.*ERROR" "${SCHEMA_LOG}" | head -5 | sed 's/^/  /' >> "${REPORT}"
fi

echo "  · data (session_replication_role=replica for the circular FKs)"
# users<->addresses and users<->payment_methods are circular, so loading with
# triggers and FK checks active fails partway through.
psql -d "${SCRATCH_DB}" \
  -c "set session_replication_role = replica" \
  -f "${BACKUP_DIR}/data.sql" > "${DATA_LOG}" 2>&1 || true
DATA_ERRS=$(grep -c "^psql.*ERROR" "${DATA_LOG}" || true)
echo "data_errors: ${DATA_ERRS}  (full log: ${DATA_LOG})" >> "${REPORT}"
if [ "${DATA_ERRS}" -gt 0 ]; then
  grep "^psql.*ERROR" "${DATA_LOG}" | head -5 | sed 's/^/  /' >> "${REPORT}"
fi

# ---------------------------------------------------------------------------
# 6. Verify.
# ---------------------------------------------------------------------------
echo "  · verifying"
VERIFY_OUT="$(psql -d "${SCRATCH_DB}" -v ON_ERROR_STOP=1 \
  -v manifest_tables="${MANIFEST_TABLES}" \
  -f "${REPO_ROOT}/scripts/verify-restored-backup.sql" 2>&1)" && VERIFY_RC=0 || VERIFY_RC=$?

{
  echo ""
  echo "--- verifier output ---"
  echo "${VERIFY_OUT}"
  echo ""
  if [[ "${VERIFY_RC}" -eq 0 ]]; then
    echo "RESULT: PASSED"
  else
    echo "RESULT: FAILED (verifier exit ${VERIFY_RC})"
  fi
} >> "${REPORT}"

echo ""
cat "${REPORT}"

if [[ "${VERIFY_RC}" -ne 0 ]]; then
  die "verification failed -- see ${REPORT}"
fi

trap - EXIT
echo ""
echo "✓ drill PASSED. Report: ${REPORT}"
echo "  Scratch database '${SCRATCH_DB}' kept so you can inspect it."
echo "  Drop it when done:  dropdb ${SCRATCH_DB}"
