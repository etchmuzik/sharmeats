#!/usr/bin/env bash

# Regression tests for the production backup safety/coverage contract.
# Runs entirely against temporary directories and a fake Storage HTTP client.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_TMP_BASE="${TMPDIR:-/tmp}"
TEST_ROOT="$(mktemp -d "${TEST_TMP_BASE%/}/sharmeats-backup-test.XXXXXX")"

cleanup() {
  case "${TEST_ROOT}" in
    "${TEST_TMP_BASE%/}"/sharmeats-backup-test.*) rm -rf -- "${TEST_ROOT}" ;;
    *) echo "refusing to clean unexpected test root: ${TEST_ROOT}" >&2 ;;
  esac
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

mkdir -p "${TEST_ROOT}/bin" "${TEST_ROOT}/home"

# Fake Storage API. The synthetic `test` bucket contains 1,001 objects at its
# root so a backup implementation that forgets offset pagination captures only
# the first 1,000. Other buckets are empty but successfully readable.
cat > "${TEST_ROOT}/bin/curl" <<'FAKE_CURL'
#!/usr/bin/env bash
set -euo pipefail

body='{}'
out=''
url=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    -d) body="$2"; shift 2 ;;
    -o) out="$2"; shift 2 ;;
    -H|-X|-w|--max-time) shift 2 ;;
    -f|-s|-S|-fsS|-sS) shift ;;
    *) url="$1"; shift ;;
  esac
done

if [[ "${url}" == *'/storage/v1/object/list/'* ]]; then
  python3 - "${body}" "${url}" <<'PY'
import json
import sys

body = json.loads(sys.argv[1])
url = sys.argv[2]
bucket = url.rsplit('/', 1)[-1]
offset = int(body.get('offset', 0))
if bucket != 'test':
    print('[]')
elif offset == 0:
    print(json.dumps([
        {'id': f'id-{i}', 'name': f'file-{i:04d}.jpg', 'metadata': {'size': 1}}
        for i in range(1000)
    ]))
elif offset == 1000:
    print(json.dumps([
        {'id': 'id-1000', 'name': 'file-1000.jpg', 'metadata': {'size': 1}}
    ]))
else:
    print('[]')
PY
  exit 0
fi

if [[ -n "${out}" ]]; then
  printf x > "${out}"
  exit 0
fi

exit 22
FAKE_CURL
chmod +x "${TEST_ROOT}/bin/curl"

cat > "${TEST_ROOT}/bin/launchctl" <<'FAKE_LAUNCHCTL'
#!/usr/bin/env bash
set -euo pipefail
case "${FAKE_LAUNCHCTL_MODE:-missing}" in
  healthy)
    printf '%s\n' '- 0 com.sharmeats.backup' '- 0 com.sharmeats.storage-backup'
    ;;
  missing)
    ;;
esac
FAKE_LAUNCHCTL
chmod +x "${TEST_ROOT}/bin/launchctl"

source "${REPO_ROOT}/scripts/lib/backup-paths.sh"

safe_root="${TEST_ROOT}/safe-backups"
mkdir -p "${safe_root}"
validate_backup_root "${safe_root}" "${REPO_ROOT}" "${TEST_ROOT}/home"

if validate_backup_root "/" "${REPO_ROOT}" "${TEST_ROOT}/home" 2>/dev/null; then
  fail 'root directory was accepted as a backup root'
fi
if validate_backup_root "${TEST_ROOT}/home" "${REPO_ROOT}" "${TEST_ROOT}/home" 2>/dev/null; then
  fail 'home directory was accepted as a backup root'
fi
if validate_backup_root "${REPO_ROOT}" "${REPO_ROOT}" "${TEST_ROOT}/home" 2>/dev/null; then
  fail 'repository root was accepted as a backup root'
fi
ln -s "${safe_root}" "${TEST_ROOT}/linked-backups"
if validate_backup_root "${TEST_ROOT}/linked-backups" "${REPO_ROOT}" "${TEST_ROOT}/home" 2>/dev/null; then
  fail 'symlink was accepted as a backup root'
fi

pagination_root="${TEST_ROOT}/pagination"
PATH="${TEST_ROOT}/bin:${PATH}" \
  BACKUP_DIR="${pagination_root}" \
  HOME="${TEST_ROOT}/home" \
  SUPABASE_SERVICE_ROLE_KEY='test-service-key' \
  SUPABASE_URL='https://example.invalid' \
  BUCKETS='test' \
  KEEP=5 \
  bash "${REPO_ROOT}/scripts/backup-storage.sh" >/dev/null

pagination_manifest="$(find "${pagination_root}" -name MANIFEST.txt -type f -print -quit)"
[[ -n "${pagination_manifest}" ]] || fail 'pagination run produced no manifest'
grep -q '^objects: 1001$' "${pagination_manifest}" \
  || fail 'storage backup did not paginate past the first 1,000 objects'

default_root="${TEST_ROOT}/default-buckets"
PATH="${TEST_ROOT}/bin:${PATH}" \
  BACKUP_DIR="${default_root}" \
  HOME="${TEST_ROOT}/home" \
  SUPABASE_SERVICE_ROLE_KEY='test-service-key' \
  SUPABASE_URL='https://example.invalid' \
  KEEP=5 \
  bash "${REPO_ROOT}/scripts/backup-storage.sh" >/dev/null

default_manifest="$(find "${default_root}" -name MANIFEST.txt -type f -print -quit)"
grep -Eq '^buckets: .*avatars' "${default_manifest}" \
  || fail 'default storage backup omitted the avatars bucket'

retention_root="${TEST_ROOT}/retention"
mkdir -p \
  "${retention_root}/storage-20240101T000000Z" \
  "${retention_root}/storage-20990101T000000Z-FAILED" \
  "${retention_root}/storage-20990102T000000Z-FAILED" \
  "${retention_root}/storage-20990103T000000Z-FAILED"
PATH="${TEST_ROOT}/bin:${PATH}" \
  BACKUP_DIR="${retention_root}" \
  HOME="${TEST_ROOT}/home" \
  SUPABASE_SERVICE_ROLE_KEY='test-service-key' \
  SUPABASE_URL='https://example.invalid' \
  BUCKETS='kyc' \
  KEEP=2 \
  KEEP_FAILED=5 \
  bash "${REPO_ROOT}/scripts/backup-storage.sh" >/dev/null
[[ -d "${retention_root}/storage-20240101T000000Z" ]] \
  || fail 'failed storage runs counted against successful retention'

health_root="${TEST_ROOT}/health"
db_dir="${health_root}/20260815T000000Z"
storage_dir="${health_root}/storage-20260815T000000Z"
mkdir -p "${db_dir}" "${storage_dir}/kyc"
printf schema > "${db_dir}/schema.sql"
printf data > "${db_dir}/data.sql"
printf 'objects: 0\n' > "${storage_dir}/MANIFEST.txt"

# Run the checker and capture BOTH its exit status and its message: asserting
# only "exited non-zero" cannot tell the intended failure apart from an
# unrelated breakage, so every one of these cases would still "pass" if the
# check broke for the wrong reason.
run_health_check() {  # usage: run_health_check <expect: pass|fail> <substring> <desc> [env...]
  local expect="$1" needle="$2" desc="$3"; shift 3
  local out status
  set +e
  out="$(PATH="${TEST_ROOT}/bin:${PATH}" \
    BACKUP_DIR="${health_root}" \
    HOME="${TEST_ROOT}/home" \
    MAX_AGE_HOURS=26 \
    env "$@" bash "${REPO_ROOT}/scripts/check-backup-freshness.sh" 2>&1)"
  status=$?
  set -e
  if [[ "${expect}" == pass ]]; then
    (( status == 0 )) || fail "${desc}: expected healthy, exited ${status} — ${out}"
  else
    (( status != 0 )) || fail "${desc}: expected a failure, exited 0 — ${out}"
  fi
  [[ "${out}" == *"${needle}"* ]] \
    || fail "${desc}: expected message to mention '${needle}', got — ${out}"
}

run_health_check pass 'storage' 'healthy local layout' FAKE_LAUNCHCTL_MODE=healthy
run_health_check fail 'schedule' 'missing schedulers' FAKE_LAUNCHCTL_MODE=missing

# An off-site mirror holding only the DB copy is a SUPPORTED layout
# (setup-mac-backup-mirror.sh offers "database mirrors, storage stays
# laptop-only"), so it must stay green unless storage mirroring was opted into
# with STORAGE_MIRROR_ENCRYPTED=yes.
mirror_root="${TEST_ROOT}/mirror"
mkdir -p "${mirror_root}/20260815T000000Z"
printf schema > "${mirror_root}/20260815T000000Z/schema.sql"
printf data > "${mirror_root}/20260815T000000Z/data.sql"

run_health_check pass 'storage NOT mirrored' 'DB-only mirror without opt-in' \
  FAKE_LAUNCHCTL_MODE=healthy MIRROR_DIR="${mirror_root}"
run_health_check fail 'contains no storage backup' 'DB-only mirror WITH storage opt-in' \
  FAKE_LAUNCHCTL_MODE=healthy MIRROR_DIR="${mirror_root}" STORAGE_MIRROR_ENCRYPTED=yes

touch -t 202001010000 "${storage_dir}"
run_health_check fail 'storage backup' 'stale storage backup' FAKE_LAUNCHCTL_MODE=healthy

echo 'backup operation regression tests passed'
