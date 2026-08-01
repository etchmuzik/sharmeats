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

BACKUP_DIR="${BACKUP_DIR:-${HOME}/sharmeats-backups}"
MAX_AGE_HOURS="${MAX_AGE_HOURS:-26}"   # 24h cadence + 2h slack for a sleeping Mac
LABEL="com.sharmeats.backup"

fail() { echo "✗ BACKUP UNHEALTHY: $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 1. Is there a successful backup at all, and how old is it?
# ---------------------------------------------------------------------------
[[ -d "${BACKUP_DIR}" ]] || fail "backup directory ${BACKUP_DIR} does not exist"

# -FAILED dirs are quarantined failures, not backups. Excluding them is the
# whole point: a run of failures must not read as "recent activity".
newest="$(ls -1d "${BACKUP_DIR}"/*/ 2>/dev/null \
  | grep -v -- '-FAILED/$' \
  | sort -r | head -1 || true)"

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

# ---------------------------------------------------------------------------
# 3. Is the scheduler healthy? Presence is not enough — read the exit status.
#    launchctl list prints: <PID|-> <LAST_EXIT_STATUS> <LABEL>
#    A job that never runs shows "-" for PID and its last exit code here. That
#    78 is precisely what three days of silent failure looked like.
# ---------------------------------------------------------------------------
if command -v launchctl >/dev/null 2>&1; then
  row="$(launchctl list 2>/dev/null | awk -v l="${LABEL}" '$3 == l' || true)"
  if [[ -z "${row}" ]]; then
    echo "⚠ scheduler: ${LABEL} is not loaded — backups are not scheduled at all" >&2
    echo "  fix: launchctl load ~/Library/LaunchAgents/${LABEL}.plist" >&2
  else
    last_exit="$(echo "${row}" | awk '{print $2}')"
    if [[ "${last_exit}" != "0" ]]; then
      fail "scheduler ${LABEL} last exited ${last_exit} (78 = program path wrong). Backups are firing and failing."
    fi
  fi
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

  m_newest="$(ls -1d "${MIRROR_DIR}"/*/ 2>/dev/null \
    | grep -v -- '-FAILED/$' \
    | sort -r | head -1 || true)"
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
  mirror_msg=" · off-site $(basename "${m_newest}") ${m_age}h old"
else
  mirror_msg=" · off-site mirror NOT CONFIGURED (set MIRROR_DIR — a backup on one machine is one incident from gone)"
fi

# ---------------------------------------------------------------------------
# 5. Verdict
# ---------------------------------------------------------------------------
if (( age_hours > MAX_AGE_HOURS )); then
  fail "newest backup $(basename "${newest}") is ${age_hours}h old (limit ${MAX_AGE_HOURS}h)"
fi

echo "✓ backup healthy: $(basename "${newest}") is ${age_hours}h old (limit ${MAX_AGE_HOURS}h)${mirror_msg}"
