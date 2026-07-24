#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
postgres_bin_dir="$(pg_config --bindir)"
test_work_dir="$(mktemp -d "${TMPDIR:-/tmp}/sharmeats-db-tests.XXXXXX")"
test_data_dir="${test_work_dir}/data"
test_socket_dir="${test_work_dir}/socket"
test_db_port="$((55000 + RANDOM % 5000))"

mkdir -p "${test_socket_dir}"

cleanup() {
  if [[ -f "${test_data_dir}/postmaster.pid" ]]; then
    "${postgres_bin_dir}/pg_ctl" \
      -D "${test_data_dir}" \
      -m immediate \
      -w stop >/dev/null
  fi

  case "${test_work_dir}" in
    "${TMPDIR:-/tmp}"/sharmeats-db-tests.*)
      rm -rf -- "${test_work_dir}"
      ;;
    *)
      echo "Refusing to remove unexpected test directory: ${test_work_dir}" >&2
      ;;
  esac
}
trap cleanup EXIT

"${postgres_bin_dir}/initdb" \
  -D "${test_data_dir}" \
  --auth=trust \
  --encoding=UTF8 \
  --no-locale >/dev/null

"${postgres_bin_dir}/pg_ctl" \
  -D "${test_data_dir}" \
  -o "-F -p ${test_db_port} -k ${test_socket_dir}" \
  -w start >/dev/null

for test_file in \
  "supabase/tests/120_runtime_and_kyc_integrity_fixes.test.sql" \
  "supabase/tests/121_payment_integrity.test.sql" \
  "supabase/tests/122_referral_reward_crypto_fix.test.sql" \
  "supabase/tests/20260724120946_kyc_upload_hardening.test.sql"
do
  test_database="test_$(basename "${test_file}" .test.sql | tr -c '[:alnum:]' '_')"
  "${postgres_bin_dir}/createdb" \
    -h "${test_socket_dir}" \
    -p "${test_db_port}" \
    "${test_database}"
  "${postgres_bin_dir}/psql" \
    -X \
    -v ON_ERROR_STOP=1 \
    -h "${test_socket_dir}" \
    -p "${test_db_port}" \
    -d "${test_database}" \
    -f "${project_root}/${test_file}"
done

echo "Security migration tests passed."
