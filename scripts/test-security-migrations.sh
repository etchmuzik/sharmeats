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
  "supabase/tests/20260724120946_kyc_upload_hardening.test.sql" \
  "supabase/tests/124_signup_role_hint_lockdown.test.sql" \
  "supabase/tests/126_cloud_kitchen_foundation.test.sql" \
  "supabase/tests/127_129_service_area.test.sql" \
  "supabase/tests/130_133_ops_finance.test.sql"
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

staff_role_database="test_136_merchant_staff_role_enforcement"
"${postgres_bin_dir}/createdb" \
  -h "${test_socket_dir}" \
  -p "${test_db_port}" \
  "${staff_role_database}"
"${postgres_bin_dir}/psql" \
  -X \
  -v ON_ERROR_STOP=1 \
  -h "${test_socket_dir}" \
  -p "${test_db_port}" \
  -d "${staff_role_database}" \
  -f "${project_root}/supabase/tests/136_staff_role_fixture.sql"
"${postgres_bin_dir}/psql" \
  -X \
  -v ON_ERROR_STOP=1 \
  -h "${test_socket_dir}" \
  -p "${test_db_port}" \
  -d "${staff_role_database}" \
  -f "${project_root}/supabase/migrations/136_merchant_staff_role_enforcement.sql"
"${postgres_bin_dir}/psql" \
  -X \
  -v ON_ERROR_STOP=1 \
  -h "${test_socket_dir}" \
  -p "${test_db_port}" \
  -d "${staff_role_database}" \
  -c "alter table public.menu_items add column promo_price_egp int;"

staff_role_output="$(
  "${postgres_bin_dir}/psql" \
    -X \
    -v ON_ERROR_STOP=1 \
    -h "${test_socket_dir}" \
    -p "${test_db_port}" \
    -d "${staff_role_database}" \
    -f "${project_root}/supabase/tests/136_staff_role_assertions.sql"
)"
printf '%s\n' "${staff_role_output}"

if grep -Fq "*** FAIL ***" <<<"${staff_role_output}"; then
  echo "Migration 136 staff-role assertions failed." >&2
  exit 1
fi

staff_role_passes="$(grep -c '^PASS ' <<<"${staff_role_output}")"
if [[ "${staff_role_passes}" -ne 40 ]]; then
  echo "Expected 40 migration 136 PASS lines, got ${staff_role_passes}." >&2
  exit 1
fi

"${postgres_bin_dir}/psql" \
  -X \
  -v ON_ERROR_STOP=1 \
  -h "${test_socket_dir}" \
  -p "${test_db_port}" \
  -d "${staff_role_database}" \
  -f "${project_root}/supabase/migrations/20260730162500_atomic_merchant_menu_import.sql"
"${postgres_bin_dir}/psql" \
  -X \
  -v ON_ERROR_STOP=1 \
  -h "${test_socket_dir}" \
  -p "${test_db_port}" \
  -d "${staff_role_database}" \
  -f "${project_root}/supabase/tests/20260730162500_merchant_menu_import.test.sql"

echo "Security migration tests passed."
