#!/usr/bin/env bash
#
# One-shot: wire the off-site backup mirror to an external drive and schedule
# the storage backup. Run ON THE MAC, from the repo root, with the drive
# plugged in:
#
#   ./scripts/setup-mac-backup-mirror.sh "/Volumes/YOUR_DRIVE_NAME"
#
# What it does, in order:
#   1. creates <drive>/sharmeats-backups (the mirror)
#   2. patches the INSTALLED LaunchAgents (~/Library/LaunchAgents) to pass
#      MIRROR_DIR — the repo copies are templates; launchd reads the installed
#      ones, and editing the repo copy alone changes nothing
#   3. installs + loads com.sharmeats.storage-backup if it isn't already
#   4. seeds the mirror with the newest existing database backup so the very
#      first freshness check can pass instead of failing until 03:00
#   5. runs the storage backup once, end to end, before trusting the schedule
#   6. finishes with check-backup-freshness.sh as the verdict
#
# Identity documents only mirror to a drive you have CONFIRMED is encrypted.
# The script tries diskutil first; if it cannot prove encryption it asks you,
# and "no" means the database still mirrors but KYC/proof files stay
# laptop-only. That is the same fail-closed rule backup-storage.sh applies at
# run time — this script just fills in the acknowledgement honestly.

set -euo pipefail

VOLUME="${1:-}"
AGENTS="${HOME}/Library/LaunchAgents"
DB_PLIST="${AGENTS}/com.sharmeats.backup.plist"
ST_PLIST="${AGENTS}/com.sharmeats.storage-backup.plist"
PB=/usr/libexec/PlistBuddy
BACKUP_DIR="${HOME}/sharmeats-backups"

fail() { echo "✗ $*" >&2; exit 1; }
note() { echo "· $*"; }

[[ -x "$PB" ]] || fail "PlistBuddy not found — this script must run on macOS, not in a Linux session"
[[ -n "$VOLUME" ]] || { echo "usage: $0 /Volumes/DRIVE_NAME" >&2; ls /Volumes; exit 1; }
[[ -d "$VOLUME" ]] || fail "$VOLUME is not mounted (ls /Volumes to see what is)"
[[ -f "scripts/backup-storage.sh" ]] || fail "run from the repo root"
[[ -f "$DB_PLIST" ]] || fail "$DB_PLIST is not installed — the database backup agent must exist first (see scripts/com.sharmeats.backup.plist)"

MIRROR="${VOLUME%/}/sharmeats-backups"
mkdir -p "$MIRROR" || fail "$VOLUME is not writable"
chmod 700 "$MIRROR" 2>/dev/null || true
note "mirror directory: $MIRROR"

# --- Is the drive encrypted? Prove it or ask — never assume. -----------------
# diskutil knows for APFS encrypted volumes and FileVault externals. Anything
# it can't confirm goes to a human question, because a wrong "yes" here means
# passport scans on a drive that can be read by whoever finds it in a taxi.
ENCRYPTED=no
if diskutil info "$VOLUME" 2>/dev/null | grep -qiE '^\s*(FileVault|Encrypted):\s*Yes'; then
  ENCRYPTED=yes
  note "drive encryption: confirmed by diskutil"
else
  echo ""
  echo "diskutil could not confirm $VOLUME is encrypted."
  echo "KYC documents and proof-of-delivery photos only mirror to an encrypted volume."
  read -r -p "Is this drive an encrypted volume (FileVault / encrypted APFS)? [y/N] " ans
  [[ "$ans" =~ ^[Yy] ]] && ENCRYPTED=yes || note "storage files will stay laptop-only (database still mirrors)"
fi

# --- Patch the installed plists. Set-then-Add: Set fails if the key is new,
#     Add fails if it already exists, so together they are idempotent. --------
set_env() { # plist key value
  "$PB" -c "Set :EnvironmentVariables:$2 $3" "$1" 2>/dev/null \
    || "$PB" -c "Add :EnvironmentVariables:$2 string $3" "$1"
}

set_env "$DB_PLIST" MIRROR_DIR "$MIRROR"
note "patched $(basename "$DB_PLIST") with MIRROR_DIR"

if [[ ! -f "$ST_PLIST" ]]; then
  cp scripts/com.sharmeats.storage-backup.plist "$ST_PLIST"
  note "installed $(basename "$ST_PLIST")"
fi
if [[ "$ENCRYPTED" == "yes" ]]; then
  set_env "$ST_PLIST" MIRROR_DIR "$MIRROR"
  set_env "$ST_PLIST" STORAGE_MIRROR_ENCRYPTED yes
  note "patched $(basename "$ST_PLIST") with MIRROR_DIR + encryption acknowledgement"
fi

# --- The storage job cannot run without the service-role key. Refuse to
#     schedule a job that is guaranteed to fail — a red exit status every
#     03:30 is noise, and noise is how real failures get ignored. ------------
if ! security find-generic-password -s 'sharmeats-service-role-key' -w >/dev/null 2>&1; then
  echo ""
  echo "✗ Keychain item 'sharmeats-service-role-key' is missing." >&2
  echo "  Store it once (from Supabase dashboard → Settings → API → service_role):" >&2
  echo "    security add-generic-password -a \"\$USER\" -s 'sharmeats-service-role-key' -w 'THE-KEY'" >&2
  echo "  then re-run this script. Database mirror is configured; storage is NOT scheduled." >&2
  launchctl unload "$DB_PLIST" 2>/dev/null || true
  launchctl load "$DB_PLIST"
  exit 1
fi

# --- Reload both agents so launchd rereads the patched plists. --------------
launchctl unload "$DB_PLIST" 2>/dev/null || true
launchctl load "$DB_PLIST"
launchctl unload "$ST_PLIST" 2>/dev/null || true
launchctl load "$ST_PLIST"
note "agents reloaded"

# --- Seed the mirror from the newest existing DB backup so tonight's 03:00
#     run isn't the first moment the mirror check can pass. Same exclusions
#     as check-backup-freshness.sh: -FAILED are quarantined failures and
#     storage-* is the other job's output. -----------------------------------
newest="$(ls -1d "${BACKUP_DIR}"/*/ 2>/dev/null \
  | grep -v -- '-FAILED/$' | grep -v '/storage-[^/]*/$' \
  | sort -r | head -1 || true)"
if [[ -n "$newest" ]]; then
  stamp="$(basename "$newest")"
  if [[ ! -d "${MIRROR}/${stamp}" ]]; then
    cp -pR "$newest" "${MIRROR}/${stamp}"
    note "seeded mirror with ${stamp}"
  else
    note "mirror already has ${stamp}"
  fi
else
  note "no existing database backup to seed with — tonight's 03:00 run will create the first mirror copy"
fi

# --- Run the storage backup once NOW, in the foreground, before trusting the
#     3:30 schedule. "Verify it works before scheduling" — the plist has said
#     so since it was written. ------------------------------------------------
echo ""
echo "Running the storage backup once to verify it end to end..."
if [[ "$ENCRYPTED" == "yes" ]]; then
  MIRROR_DIR="$MIRROR" STORAGE_MIRROR_ENCRYPTED=yes ./scripts/backup-storage.sh
else
  ./scripts/backup-storage.sh
fi

# --- Verdict. The same check the dead-man's switch runs. ---------------------
echo ""
MIRROR_DIR="$MIRROR" ./scripts/check-backup-freshness.sh
echo ""
echo "Done. Both agents are loaded, the mirror is live at ${MIRROR}."
echo "Leave the drive plugged in: an unplugged night now shows up as a"
echo "freshness failure instead of being silently skipped."
