#!/usr/bin/env bash
#
# Off-site backup of the production Storage buckets (currently: kyc).
#
# WHY THIS EXISTS, SEPARATE FROM backup-prod.sh
# A database dump does NOT contain storage objects. pg_dump captures the
# storage.objects METADATA rows -- name, bucket, owner, mime type -- but the
# file BYTES live in S3 behind the Storage API, not in Postgres. Restoring
# data.sql therefore recreates a row that points at an object which no longer
# exists: a dangling pointer that looks like a successful restore.
#
# Verified against the 2026-07-27 dump: storage.buckets contained the `kyc`
# bucket row, and storage.objects contained ZERO rows -- no merchant has
# uploaded yet. That is why this is cheap to set up today and expensive to set
# up later: the moment onboarding starts, KYC documents become the ONLY asset
# in the system that cannot be reconstructed from anything else. Orders, menus
# and settlements can be recomputed or re-entered; a merchant's passport scan
# has to be collected again from a human.
#
# WHAT IT CAPTURES
#   Every object in every bucket listed in BUCKETS, preserving the bucket's
#   internal path layout, plus a manifest of what was downloaded.
#
# WHAT IT NEEDS
#   SUPABASE_SERVICE_ROLE_KEY -- the kyc bucket is PRIVATE (public=false, see
#   the storage.buckets row), so the anon key cannot list or read it. Get it
#   from Dashboard -> Project Settings -> API -> service_role. This key bypasses
#   RLS entirely; treat it exactly like the database password.
#
# USAGE
#   export SUPABASE_SERVICE_ROLE_KEY='...'     # or store it in the Keychain:
#   security add-generic-password -a "$USER" -s 'sharmeats-service-role-key' -w '...'
#   ./scripts/backup-storage.sh
#   BACKUP_DIR=/Volumes/ext ./scripts/backup-storage.sh
#
# The downloaded files are identity documents. They are written 0600 into a
# 0700 directory and must never enter git. Under Egypt's PDPL they are personal
# data: keep the off-site copy encrypted, and delete it when the retention
# period in docs/OPS-RUNBOOK.md expires.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=scripts/lib/backup-paths.sh
source "${SCRIPT_DIR}/lib/backup-paths.sh"

PROJECT_REF="${SUPABASE_PROJECT_REF:-ilqpsebcfbaoaogimhud}"
SUPABASE_URL="${SUPABASE_URL:-https://${PROJECT_REF}.supabase.co}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/sharmeats-backups}"
KEEP="${KEEP:-14}"
KEEP_FAILED="${KEEP_FAILED:-5}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${BACKUP_DIR}/storage-${STAMP}"

[[ "${KEEP}" =~ ^[0-9]+$ && "${KEEP}" -ge 1 ]] || { echo "ERROR: KEEP must be a positive integer." >&2; exit 1; }
[[ "${KEEP_FAILED}" =~ ^[0-9]+$ ]] || { echo "ERROR: KEEP_FAILED must be a non-negative integer." >&2; exit 1; }
validate_backup_root "${BACKUP_DIR}" "${REPO_ROOT}" "${HOME}"

# Buckets to capture.
#
# `delivery-proof` added 2026-08-01. It was created later (migration 194) and
# this list was never updated, so proof-of-delivery photos — the evidence in
# any "it never arrived" dispute — were outside every backup this project had.
# Both buckets were empty when it was added, which is the only reason the gap
# cost nothing. Re-check this list against storage.buckets whenever a migration
# adds one:
#   select id, public from storage.buckets order by id;
BUCKETS="${BUCKETS:-kyc delivery-proof avatars}"

# Same failure discipline as backup-prod.sh: a partial run must never leave a
# directory that reads as a usable backup.
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
trap mark_failed EXIT

# Key resolution mirrors backup-prod.sh: environment first, then Keychain, so a
# scheduled run needs no plaintext env file and the key never appears in `ps`.
if [[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  SUPABASE_SERVICE_ROLE_KEY="$(security find-generic-password -s 'sharmeats-service-role-key' -w 2>/dev/null || true)"
fi

if [[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  cat >&2 <<'EOF'
ERROR: no service-role key available.

The kyc bucket is private, so listing and downloading it needs the service_role
key (the anon key returns an empty list, which would look like "no documents"
rather than an error -- the exact silent failure this script must not have).

Get it from: Supabase Dashboard -> Project Settings -> API -> service_role.

Store it once so scheduled runs work unattended:
  security add-generic-password -a "$USER" -s 'sharmeats-service-role-key' -w 'YOUR-KEY'

...or set it for this run only:
  export SUPABASE_SERVICE_ROLE_KEY='YOUR-KEY'
EOF
  exit 1
fi

command -v curl >/dev/null 2>&1 || { echo "ERROR: curl not found." >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 not found (used to parse the object list)." >&2; exit 1; }

umask 077
mkdir -p "${OUT}"
chmod 700 "${BACKUP_DIR}" "${OUT}"

echo "→ backing up storage for ${PROJECT_REF} to ${OUT}"

total_objects=0
total_bytes=0

for bucket in ${BUCKETS}; do
  echo "  · bucket: ${bucket}"
  mkdir -p "${OUT}/${bucket}"

  # The list endpoint is NOT recursive: it returns entries for one prefix, where
  # a "folder" comes back as an entry whose `id` is null. Walk the tree with an
  # explicit queue so nested paths (kyc stores per-subject folders) are covered.
  # A recursive shell function would work too, but the queue keeps the failure
  # mode obvious: if a prefix errors, we stop rather than silently skipping it.
  prefixes=("")
  while [[ ${#prefixes[@]} -gt 0 ]]; do
    prefix="${prefixes[0]}"
    prefixes=("${prefixes[@]:1}")
    offset=0
    while true; do
      body=$(python3 -c '
import json,sys
print(json.dumps({"prefix": sys.argv[1], "limit": 1000, "offset": int(sys.argv[2]),
                  "sortBy": {"column": "name", "order": "asc"}}))' "${prefix}" "${offset}")

      listing=$(curl -fsS -X POST \
        "${SUPABASE_URL}/storage/v1/object/list/${bucket}" \
        -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
        -H "Content-Type: application/json" \
        -d "${body}")
      page_count=$(python3 -c 'import json,sys; print(len(json.load(sys.stdin)))' <<<"${listing}")

      # Split the listing into files and sub-folders. An entry with a null id is a
      # folder placeholder, not an object.
      while IFS=$'\t' read -r kind name size; do
        [[ -z "${name}" ]] && continue
        path="${prefix:+${prefix}/}${name}"
        if [[ "${kind}" == "dir" ]]; then
          prefixes+=("${path}")
          continue
        fi
        mkdir -p "${OUT}/${bucket}/$(dirname "${path}")"
        curl -fsS \
          "${SUPABASE_URL}/storage/v1/object/${bucket}/${path}" \
          -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
          -o "${OUT}/${bucket}/${path}"
        total_objects=$((total_objects + 1))
        total_bytes=$((total_bytes + ${size:-0}))
        echo "      ${path} (${size:-?} bytes)"
      done < <(python3 -c '
import json,sys
for e in json.load(sys.stdin):
    meta = e.get("metadata") or {}
    kind = "file" if e.get("id") else "dir"
    print("\t".join([kind, e.get("name",""), str(meta.get("size",0))]))' <<<"${listing}")

      [[ "${page_count}" -lt 1000 ]] && break
      offset=$((offset + 1000))
    done
  done
done

{
  echo "project_ref: ${PROJECT_REF}"
  echo "taken_at_utc: ${STAMP}"
  echo "taken_by: $(whoami)@$(hostname)"
  echo "buckets: ${BUCKETS}"
  echo "objects: ${total_objects}"
  echo "bytes: ${total_bytes}"
  echo "git_head: $(git -C "$(dirname "$0")/.." rev-parse --short HEAD 2>/dev/null || echo n/a)"
  if [[ "${total_objects}" -eq 0 ]]; then
    echo "note: zero objects. Expected while no merchant has completed KYC upload."
    echo "      This is NOT treated as a failure -- an empty private bucket and a"
    echo "      permission problem are distinguished by the API call succeeding,"
    echo "      which it did (a bad key would have failed the curl above)."
  fi
} > "${OUT}/MANIFEST.txt"

chmod -R go-rwx "${OUT}"

trap - EXIT
echo "✓ storage backup complete: ${OUT}"
cat "${OUT}/MANIFEST.txt"

# ---------------------------------------------------------------------------
# OFF-SITE MIRROR — same mechanism as backup-prod.sh, with one extra gate.
#
# WHY THIS ONE ASKS AND THE DATABASE ONE DOES NOT. These files are identity
# documents: passport and licence scans, and proof-of-delivery photographs of
# people's doorways. Under Egypt's PDPL they are personal data. Copying them to
# an external drive is exactly the right thing to do for durability and exactly
# the wrong thing to do if that drive is unencrypted and later lost — a lost
# database dump is a breach, a lost box of passport scans is a worse one.
#
# A script cannot reliably verify that a volume is encrypted (diskutil output
# varies by filesystem, and a FileVault-protected APFS volume mounted read-write
# looks like any other directory). So instead of guessing, this requires an
# explicit acknowledgement: set STORAGE_MIRROR_ENCRYPTED=yes to confirm the
# destination is an encrypted volume. Without it the mirror is skipped and says
# why. The speed bump is the point — it is placed on the one dataset where
# getting it wrong is a notifiable incident rather than an inconvenience.
# ---------------------------------------------------------------------------
mirror_note="not configured (set MIRROR_DIR + STORAGE_MIRROR_ENCRYPTED=yes)"
if [[ -n "${MIRROR_DIR:-}" ]]; then
  if [[ "${STORAGE_MIRROR_ENCRYPTED:-}" != "yes" ]]; then
    mirror_note="SKIPPED — STORAGE_MIRROR_ENCRYPTED is not 'yes'"
    echo "  ⚠ off-site mirror SKIPPED: these are identity documents." >&2
    echo "    Confirm the destination is an ENCRYPTED volume (FileVault or an" >&2
    echo "    encrypted APFS volume), then set STORAGE_MIRROR_ENCRYPTED=yes." >&2
  elif [[ ! -d "${MIRROR_DIR}" ]]; then
    mirror_note="FAILED — ${MIRROR_DIR} is not mounted"
    echo "  ⚠ off-site mirror SKIPPED: ${MIRROR_DIR} is not mounted." >&2
  elif ! validate_backup_root "${MIRROR_DIR}" "${REPO_ROOT}" "${HOME}"; then
    mirror_note="FAILED — ${MIRROR_DIR} is an unsafe retention root"
    echo "  ⚠ off-site mirror SKIPPED: unsafe retention root ${MIRROR_DIR}." >&2
  elif ! mkdir -p "${MIRROR_DIR}/storage-${STAMP}" 2>/dev/null; then
    mirror_note="FAILED — ${MIRROR_DIR} is not writable"
    echo "  ⚠ off-site mirror SKIPPED: ${MIRROR_DIR} is not writable." >&2
  else
    chmod 700 "${MIRROR_DIR}/storage-${STAMP}" 2>/dev/null || true
    if cp -pR "${OUT}/." "${MIRROR_DIR}/storage-${STAMP}/" 2>/dev/null; then
      # Compare file COUNT and total bytes: unlike the DB dump there is no
      # single large file to size-check, and a half-copied bucket is the
      # failure that would otherwise pass unnoticed.
      a_n=$(find "${OUT}" -type f | wc -l | tr -d ' ')
      b_n=$(find "${MIRROR_DIR}/storage-${STAMP}" -type f | wc -l | tr -d ' ')
      a_b=$(find "${OUT}" -type f -exec wc -c {} + 2>/dev/null | tail -1 | awk '{print $1}')
      b_b=$(find "${MIRROR_DIR}/storage-${STAMP}" -type f -exec wc -c {} + 2>/dev/null | tail -1 | awk '{print $1}')
      if [[ "${a_n}" == "${b_n}" && "${a_b}" == "${b_b}" ]]; then
        mirror_note="ok — ${MIRROR_DIR}/storage-${STAMP} (${a_n} files, ${a_b} bytes)"
        echo "  · mirrored to ${MIRROR_DIR}/storage-${STAMP} (${a_n} files verified)"
        chmod -R go-rwx "${MIRROR_DIR}/storage-${STAMP}" 2>/dev/null || true
        while read -r old; do
          echo "  · pruning mirror $(basename "${old}")"
          safe_remove_backup_dir "${MIRROR_DIR}" "${old}" storage-success 2>/dev/null || true
        done < <(list_backup_dirs "${MIRROR_DIR}" storage-success | sort -r | tail -n +$((KEEP + 1)))
      else
        mirror_note="FAILED — verify mismatch (${a_n}/${a_b} here, ${b_n}/${b_b} there)"
        echo "  ⚠ mirror verify FAILED: ${a_n} files/${a_b} bytes here, ${b_n}/${b_b} there" >&2
        # `|| true` as in the copy-errored branch below: a failure to clean up
        # the MIRROR must never abort the run and quarantine the good local
        # backup (the helper returns non-zero if the mirror path is gone).
        safe_remove_backup_dir "${MIRROR_DIR}" "${MIRROR_DIR}/storage-${STAMP}" storage-success 2>/dev/null || true
      fi
    else
      mirror_note="FAILED — copy errored"
      safe_remove_backup_dir "${MIRROR_DIR}" "${MIRROR_DIR}/storage-${STAMP}" storage-success 2>/dev/null || true
    fi
  fi
fi
printf 'off-site mirror: %s\n' "${mirror_note}" >> "${OUT}/MANIFEST.txt"

# Retention: successful and quarantined failed runs never count against each
# other. Only exact storage-<UTC stamp> directory names are eligible.
while read -r old; do
  echo "  · pruning $(basename "${old}")"
  safe_remove_backup_dir "${BACKUP_DIR}" "${old}" storage-success
done < <(list_backup_dirs "${BACKUP_DIR}" storage-success | sort -r | tail -n +$((KEEP + 1)))

while read -r old; do
  echo "  · pruning failed run $(basename "${old}")"
  safe_remove_backup_dir "${BACKUP_DIR}" "${old}" storage-failed
done < <(list_backup_dirs "${BACKUP_DIR}" storage-failed | sort -r | tail -n +$((KEEP_FAILED + 1)))

cat <<'EOF'

NEXT (do not skip):
  · Copy this directory OFF this machine, ENCRYPTED. These are identity
    documents; an unencrypted copy on a laptop is a data-protection incident
    waiting to happen.
  · These files are useless without the storage.objects metadata rows, which
    live in the DATABASE dump. Keep the pair from the same day together.
EOF
