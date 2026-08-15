#!/usr/bin/env bash
#
# Dead-man's switch for the production backup.
#
# WHY THIS EXISTS: on 2026-08-01 the backup was found dead since 2026-07-29.
# The repository directory was renamed (`sharmeats` → `sharmeats-new`) and the
# launchd agent still pointed at the old absolute path, so every 03:00 firing
# exited 78 (EX_CONFIG, "program not found"). Nothing noticed for three days.
#
# The failure was invisible in the two places anyone would have looked:
#
#   · `launchctl list | grep sharmeats` printed a row, so the job LOOKED
#     installed. Presence is not health — the exit status in that same row was
#     78 the whole time.
#   · `~/sharmeats-backups/backup.log` ended with "✓ backup complete", because
#     the last line written was from the last run that ACTUALLY RAN. A log that
#     is never appended to again looks identical to a log that is healthy and
#     idle. Staleness is invisible unless something compares it to the clock.
#
# The project is on the Supabase FREE plan: no managed backups, no PITR. This
# script is therefore a check on the only thing standing between the business
# and total data loss.
#
# USAGE
#   ./scripts/check-backup-freshness.sh          # exit 0 healthy, 1 stale/broken
#   MAX_AGE_HOURS=48 ./scripts/check-backup-freshness.sh
#
# Wire it into whatever you actually read. It is deliberately exit-code driven
# so it composes with launchd, cron, CI, or the ops Telegram bot:
#   ./scripts/check-backup-freshness.sh || curl -s -X POST "$TELEGRAM_ALERT_URL" ...

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=scripts/lib/backup-paths.sh
source "${SCRIPT_DIR}/lib/backup-paths.sh"

BACKUP_DIR="${BACKUP_DIR:-${HOME}/sharmeats-backups}"
MAX_AGE_HOURS="${MAX_AGE_HOURS:-26}"   # 24h cadence + 2h slack for a sleeping Mac
LABEL="com.sharmeats.backup"
STORAGE_LABEL="${STORAGE_LABEL:-com.sharmeats.storage-backup}"

fail() { echo "✗ BACKUP UNHEALTHY: $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 1. Is there a successful backup at all, and how old is it?
# ---------------------------------------------------------------------------
[[ -d "${BACKUP_DIR}" ]] || fail "backup directory ${BACKUP_DIR} does not exist"
validate_backup_root "${BACKUP_DIR}" "${REPO_ROOT}" "${HOME}" \
  || fail "backup directory ${BACKUP_DIR} is an unsafe retention root"

# -FAILED dirs are quarantined failures, not backups. Excluding them is the
# whole point: a run of failures must not read as "recent activity".
#
# `storage-*` is excluded too, and that exclusion is load-bearing: the storage
# backup writes storage-<stamp>/ into this SAME directory, and "storage-" sorts
# AFTER any digit, so `sort -r | head -1` would pick a storage backup as the
# newest database backup and then fail it for having no schema.sql. The check
# would have started reporting UNHEALTHY the first time a storage backup ran,
# describing the wrong problem.
newest="$(list_backup_dirs "${BACKUP_DIR}" database-success | sort -r | head -1 || true)"

[[ -n "${newest}" ]] || fail "no successful backup found in ${BACKUP_DIR}"

# stat(1) is BSD on macOS, GNU on Linux — support both so this also runs in CI.
if stat -f %m "${newest}" >/dev/null 2>&1; then
  mtime=$(stat -f %m "${newest}")
else
  mtime=$(stat -c %Y "${newest}")
fi

age_hours=$(( ( $(date +%s) - mtime ) / 3600 ))

# ---------------------------------------------------------------------------
# 2. Does the backup actually contain data? A 0-byte dump is not a backup.
# ---------------------------------------------------------------------------
for f in schema.sql data.sql; do
  [[ -s "${newest}/${f}" ]] || fail "newest backup $(basename "${newest}") has no ${f}"
done

# Storage bytes are a separate backup with an independent scheduler and failure
# mode. A fresh database dump cannot compensate for stale/missing object bytes.
storage_newest="$(list_backup_dirs "${BACKUP_DIR}" storage-success | sort -r | head -1 || true)"
[[ -n "${storage_newest}" ]] || fail "no successful storage backup found in ${BACKUP_DIR}"
[[ -s "${storage_newest}/MANIFEST.txt" ]] \
  || fail "newest storage backup $(basename "${storage_newest}") has no manifest"
if stat -f %m "${storage_newest}" >/dev/null 2>&1; then
  storage_mtime=$(stat -f %m "${storage_newest}")
else
  storage_mtime=$(stat -c %Y "${storage_newest}")
fi
storage_age=$(( ( $(date +%s) - storage_mtime ) / 3600 ))

# ---------------------------------------------------------------------------
# 3. Is the scheduler healthy? Presence is not enough — read the exit status.
#    launchctl list prints: <PID|-> <LAST_EXIT_STATUS> <LABEL>
#    A job that never runs shows "-" for PID and its last exit code here. That
#    78 is precisely what three days of silent failure looked like.
# ---------------------------------------------------------------------------
check_scheduler() {
  local label="$1" what="$2"
  local row last_exit
  row="$(launchctl list 2>/dev/null | awk -v l="${label}" '$3 == l' || true)"
  if [[ -z "${row}" ]]; then
    fail "scheduler ${label} is not loaded — ${what} is not scheduled at all. Load ~/Library/LaunchAgents/${label}.plist"
  fi
  last_exit="$(echo "${row}" | awk '{print $2}')"
  if [[ "${last_exit}" != "0" ]]; then
    fail "scheduler ${label} last exited ${last_exit} (78 = program path wrong). ${what} is firing and failing."
  fi
}

if command -v launchctl >/dev/null 2>&1; then
  check_scheduler "${LABEL}" "database backups"
  # The STORAGE job is checked the same way and for the same reason: a dump
  # without the bucket files restores rows that point at objects which no
  # longer exist. It is a separate label because it is a separate failure —
  # the database backup can be perfectly healthy while identity documents and
  # proof-of-delivery photos are being backed up by nothing at all.
  check_scheduler "${STORAGE_LABEL}" "storage backups"
fi

# ---------------------------------------------------------------------------
# 4. Is the off-site copy real?
#
# Only checked when MIRROR_DIR is configured — setting it IS the opt-in. But
# once it is set, a stale or missing mirror is a failure, not a note: the whole
# point of the mirror is the case where this laptop is gone, and "I thought it
# was copying" is precisely the belief that made the dead launchd job survive
# three days. An unplugged drive for one night is caught here rather than
# discovered during a restore.
# ---------------------------------------------------------------------------
if [[ -n "${MIRROR_DIR:-}" ]]; then
  [[ -d "${MIRROR_DIR}" ]] || fail "off-site mirror ${MIRROR_DIR} is not mounted — backups exist only on this machine"
  validate_backup_root "${MIRROR_DIR}" "${REPO_ROOT}" "${HOME}" \
    || fail "off-site mirror ${MIRROR_DIR} is an unsafe retention root"

  m_newest="$(list_backup_dirs "${MIRROR_DIR}" database-success | sort -r | head -1 || true)"
  [[ -n "${m_newest}" ]] || fail "off-site mirror ${MIRROR_DIR} contains no backup"

  if stat -f %m "${m_newest}" >/dev/null 2>&1; then
    m_mtime=$(stat -f %m "${m_newest}")
  else
    m_mtime=$(stat -c %Y "${m_newest}")
  fi
  m_age=$(( ( $(date +%s) - m_mtime ) / 3600 ))

  for f in schema.sql data.sql; do
    [[ -s "${m_newest}/${f}" ]] || fail "mirrored backup $(basename "${m_newest}") has no ${f}"
  done

  (( m_age > MAX_AGE_HOURS )) && fail "off-site mirror $(basename "${m_newest}") is ${m_age}h old (limit ${MAX_AGE_HOURS}h)"
  # Storage mirroring is OPT-IN, gated on the same acknowledgement
  # backup-storage.sh requires (STORAGE_MIRROR_ENCRYPTED=yes: customer ID
  # photos and proof-of-delivery images may only leave the machine onto an
  # encrypted volume). setup-mac-backup-mirror.sh explicitly supports
  # "database mirrors, storage stays laptop-only" — demanding a mirrored
  # storage backup there makes a supported, healthy layout permanently RED,
  # which is how a dead-man's switch stops being believed.
  if [[ "${STORAGE_MIRROR_ENCRYPTED:-}" == "yes" ]]; then
    ms_newest="$(list_backup_dirs "${MIRROR_DIR}" storage-success | sort -r | head -1 || true)"
    [[ -n "${ms_newest}" ]] || fail "off-site mirror ${MIRROR_DIR} contains no storage backup"
    [[ -s "${ms_newest}/MANIFEST.txt" ]] \
      || fail "mirrored storage backup $(basename "${ms_newest}") has no manifest"
    if stat -f %m "${ms_newest}" >/dev/null 2>&1; then
      ms_mtime=$(stat -f %m "${ms_newest}")
    else
      ms_mtime=$(stat -c %Y "${ms_newest}")
    fi
    ms_age=$(( ( $(date +%s) - ms_mtime ) / 3600 ))
    (( ms_age > MAX_AGE_HOURS )) \
      && fail "off-site storage backup $(basename "${ms_newest}") is ${ms_age}h old (limit ${MAX_AGE_HOURS}h)"
    mirror_msg=" · off-site DB $(basename "${m_newest}") ${m_age}h old · storage $(basename "${ms_newest}") ${ms_age}h old"
  else
    mirror_msg=" · off-site DB $(basename "${m_newest}") ${m_age}h old · storage NOT mirrored (STORAGE_MIRROR_ENCRYPTED is not 'yes' — local storage backup is still checked above)"
  fi
else
  mirror_msg=" · off-site mirror NOT CONFIGURED (set MIRROR_DIR — a backup on one machine is one incident from gone)"
fi

# ---------------------------------------------------------------------------
# 5. Verdict
# ---------------------------------------------------------------------------
if (( age_hours > MAX_AGE_HOURS )); then
  fail "newest backup $(basename "${newest}") is ${age_hours}h old (limit ${MAX_AGE_HOURS}h)"
fi
if (( storage_age > MAX_AGE_HOURS )); then
  fail "newest storage backup $(basename "${storage_newest}") is ${storage_age}h old (limit ${MAX_AGE_HOURS}h)"
fi

echo "✓ backup healthy: DB $(basename "${newest}") ${age_hours}h old · storage $(basename "${storage_newest}") ${storage_age}h old (limit ${MAX_AGE_HOURS}h)${mirror_msg}"
