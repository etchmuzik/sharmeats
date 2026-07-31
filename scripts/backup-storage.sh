#!/usr/bin/env bash
#
# Off-site backup of the production Storage buckets (kyc, delivery-proof, avatars).
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
#   Every object in EVERY bucket the project has, preserving each bucket's
#   internal path layout, plus a manifest of what was downloaded.
#
#   THE BUCKET LIST IS DISCOVERED, NOT HARDCODED. It used to be the single
#   literal `kyc`, written when kyc was the only bucket. Migration 194 then added
#   `delivery-proof` -- proof-of-delivery photos, the evidence in any "it never
#   arrived" dispute -- and migration 167 added `avatars`, and neither was backed
#   up by anything. Nothing failed and nothing warned; the script simply kept
#   backing up the one bucket it had been told about. So the list now comes from
#   the Storage API, and a bucket added by a future migration is covered the next
#   time this runs. BUCKETS is still honoured as an explicit override for ad-hoc
#   runs; when it is set, discovery is skipped.
#
#   CRITICAL_BUCKETS is asserted present in whatever list is used. An empty or
#   truncated API response would otherwise back up nothing and report success --
#   the same silent-nothing failure this file's header already warns about.
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
#   BUCKETS='kyc' ./scripts/backup-storage.sh   # override discovery, ad-hoc only
#
# SCHEDULING
#   scripts/com.sharmeats.storage-backup.plist runs this daily at 03:30 local,
#   half an hour after the database backup, so a database dump and the storage
#   objects it references are taken from the same day. Install it the same way as
#   the database job -- see the header of that plist.
#
# The downloaded files are identity documents. They are written 0600 into a
# 0700 directory and must never enter git. Under Egypt's PDPL they are personal
# data: keep the off-site copy encrypted, and delete it when the retention
# period in docs/OPS-RUNBOOK.md expires.

set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-ilqpsebcfbaoaogimhud}"
SUPABASE_URL="${SUPABASE_URL:-https://${PROJECT_REF}.supabase.co}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/sharmeats-backups}"
KEEP="${KEEP:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${BACKUP_DIR}/storage-${STAMP}"

# Buckets to capture. Empty = discover from the Storage API (see the header).
BUCKETS="${BUCKETS:-}"

# Buckets whose loss is unrecoverable from anything else in the system. If a
# discovered (or overridden) list does not contain these, something is wrong with
# the list rather than with the project, and backing up the rest and calling it a
# success would be worse than stopping.
#   kyc            merchant/driver identity documents -- re-collectable only from a human
#   delivery-proof proof-of-delivery photos -- the evidence in a payment dispute
CRITICAL_BUCKETS="kyc delivery-proof"

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

# Discover the bucket list unless one was supplied. `-f` so an auth failure is a
# non-zero exit rather than a JSON error body that parses to an empty list --
# "no buckets" and "wrong key" must not look the same.
if [[ -z "${BUCKETS}" ]]; then
  bucket_json=$(curl -fsS \
    "${SUPABASE_URL}/storage/v1/bucket" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}")
  BUCKETS=$(python3 -c '
import json,sys
print(" ".join(b["id"] for b in json.load(sys.stdin)))' <<<"${bucket_json}")
  echo "  · discovered buckets: ${BUCKETS:-<none>}"
else
  echo "  · buckets (from BUCKETS): ${BUCKETS}"
fi

missing_critical=""
for critical in ${CRITICAL_BUCKETS}; do
  found=0
  for bucket in ${BUCKETS}; do
    [[ "${bucket}" == "${critical}" ]] && { found=1; break; }
  done
  [[ "${found}" -eq 1 ]] || missing_critical="${missing_critical} ${critical}"
done
if [[ -n "${missing_critical}" ]]; then
  cat >&2 <<EOF
ERROR: the bucket list is missing:${missing_critical}

Those buckets hold the only copy of identity documents and delivery-proof
photos. A run that skipped them would write a manifest, exit 0, and leave you
believing they were backed up.

If BUCKETS was set by hand, include them. Otherwise the Storage API returned a
list that does not match the schema -- check the service-role key and the
project ref before trusting anything else in this backup.
EOF
  exit 1
fi

total_objects=0
total_bytes=0

bucket_tally=""

for bucket in ${BUCKETS}; do
  echo "  · bucket: ${bucket}"
  mkdir -p "${OUT}/${bucket}"
  bucket_objects=0

  # The list endpoint is NOT recursive: it returns entries for one prefix, where
  # a "folder" comes back as an entry whose `id` is null. Walk the tree with an
  # explicit queue so nested paths (kyc stores per-subject folders) are covered.
  # A recursive shell function would work too, but the queue keeps the failure
  # mode obvious: if a prefix errors, we stop rather than silently skipping it.
  prefixes=("")
  while [[ ${#prefixes[@]} -gt 0 ]]; do
    prefix="${prefixes[0]}"
    prefixes=("${prefixes[@]:1}")

    body=$(python3 -c '
import json,sys
print(json.dumps({"prefix": sys.argv[1], "limit": 1000,
                  "sortBy": {"column": "name", "order": "asc"}}))' "${prefix}")

    listing=$(curl -fsS -X POST \
      "${SUPABASE_URL}/storage/v1/object/list/${bucket}" \
      -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
      -H "Content-Type: application/json" \
      -d "${body}")

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
      bucket_objects=$((bucket_objects + 1))
      total_bytes=$((total_bytes + ${size:-0}))
      echo "      ${path} (${size:-?} bytes)"
    done < <(python3 -c '
import json,sys
for e in json.load(sys.stdin):
    meta = e.get("metadata") or {}
    kind = "file" if e.get("id") else "dir"
    print("\t".join([kind, e.get("name",""), str(meta.get("size",0))]))' <<<"${listing}")
  done
  bucket_tally="${bucket_tally}  ${bucket}: ${bucket_objects}"$'\n'
done

{
  echo "project_ref: ${PROJECT_REF}"
  echo "taken_at_utc: ${STAMP}"
  echo "taken_by: $(whoami)@$(hostname)"
  echo "buckets: ${BUCKETS}"
  echo "objects: ${total_objects}"
  echo "bytes: ${total_bytes}"
  echo "objects_per_bucket:"
  printf '%s' "${bucket_tally}"
  echo "git_head: $(git -C "$(dirname "$0")/.." rev-parse --short HEAD 2>/dev/null || echo n/a)"
  if [[ "${total_objects}" -eq 0 ]]; then
    echo "note: zero objects. Expected while no merchant has completed KYC upload"
    echo "      and no driver has delivered with a photo."
    echo "      This is NOT treated as a failure -- an empty private bucket and a"
    echo "      permission problem are distinguished by the API call succeeding,"
    echo "      which it did (a bad key would have failed the curl above)."
  fi
} > "${OUT}/MANIFEST.txt"

chmod -R go-rwx "${OUT}"

trap - EXIT
echo "✓ storage backup complete: ${OUT}"
cat "${OUT}/MANIFEST.txt"

# Retention, matching backup-prod.sh's policy.
ls -1d "${BACKUP_DIR}"/storage-*/ 2>/dev/null | sort -r | tail -n +$((KEEP + 1)) | while read -r old; do
  echo "  · pruning $(basename "${old}")"
  rm -rf "${old}"
done

cat <<'EOF'

NEXT (do not skip):
  · Copy this directory OFF this machine, ENCRYPTED. These are identity
    documents; an unencrypted copy on a laptop is a data-protection incident
    waiting to happen.
  · These files are useless without the storage.objects metadata rows, which
    live in the DATABASE dump. Keep the pair from the same day together.
EOF
