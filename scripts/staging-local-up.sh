#!/usr/bin/env bash
# staging-local-up.sh — bring up the LOCAL Supabase staging stack and prepare
# it for the Maestro customer cash-on-delivery E2E flow
# (.maestro/customer-order-cod.yaml; fixture contract in .maestro/README.md).
#
# What it does, in order:
#   1. checks docker + supabase CLI + psql are available
#   2. `supabase start` if the stack is not already running
#   3. applies supabase/migrations in PROD-LEDGER order (see below — this is
#      NOT plain filename order), stopping on the first error
#   4. applies supabase/seed.sql, then supabase/seed_menus_3restaurants.sql,
#      then supabase/staging-fixtures.sql (staging-only fixtures + hygiene)
#   5. prints the Maestro env-var exports and run command
#
# Re-runnable: if the schema is already fully migrated (marker from mig 216)
# the migration phase is skipped and only seeds + fixtures are re-applied —
# that is also the per-run hygiene pass (cancels the fixture user's open
# orders, empties the server cart). To rebuild from scratch:
#   supabase stop --no-backup && ./scripts/staging-local-up.sh

set -euo pipefail
LC_ALL=C
export LC_ALL

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIG_DIR="$REPO_ROOT/supabase/migrations"
DB_HOST=127.0.0.1
DB_PORT=54322
DB_USER=postgres
DB_NAME=postgres
export PGPASSWORD=postgres

psql_file() { # $1 = absolute path to a .sql file
  psql -X -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
       -v ON_ERROR_STOP=1 -q -f "$1"
}
psql_scalar() { # $1 = SQL returning a single value
  psql -X -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
       -v ON_ERROR_STOP=1 -qtA -c "$1"
}
die() { echo "ERROR: $*" >&2; exit 1; }

# --plan-only prints the migration plan and exits, without needing Docker, the
# Supabase CLI or a database. The plan is the part that silently rots — the
# interleave map encodes the PRODUCTION ledger order, which is not filename
# order — so it must be checkable on any machine, and in CI.
PLAN_ONLY=0
[ "${1:-}" = "--plan-only" ] && PLAN_ONLY=1

# ----------------------------------------------------------------------------
# 1) Tooling checks
# ----------------------------------------------------------------------------
if [ "$PLAN_ONLY" -eq 0 ]; then
  command -v docker >/dev/null 2>&1 \
    || die "docker not found. Install Docker Desktop and start it — the local Supabase stack runs in containers."
  docker info >/dev/null 2>&1 \
    || die "docker is installed but the daemon is not running. Start Docker Desktop and retry."
  command -v supabase >/dev/null 2>&1 \
    || die "supabase CLI not found. Install it (brew install supabase/tap/supabase) and retry."
  command -v psql >/dev/null 2>&1 \
    || die "psql not found. Install it (brew install libpq && brew link --force libpq) and retry."

  # The whole point of this environment: the fixed test OTP must be configured.
  grep -q '^201000000000 = "000000"' "$REPO_ROOT/supabase/config.toml" \
    || die "supabase/config.toml is missing the [auth.sms.test_otp] pair 201000000000 = \"000000\" — the Maestro sign-in cannot work without it."
fi

# ----------------------------------------------------------------------------
# 2) Stack up (supabase start does NOT apply migrations — we do, below)
# ----------------------------------------------------------------------------
cd "$REPO_ROOT"
if [ "$PLAN_ONLY" -eq 1 ]; then
  :
elif supabase status >/dev/null 2>&1; then
  echo "==> Local Supabase stack already running."
else
  echo "==> Starting local Supabase stack (supabase start)..."
  supabase start
fi

# ----------------------------------------------------------------------------
# 3) Build the migration list in PROD-LEDGER order (source: prod ledger,
#    verified 2026-08-07). Plain filename order is WRONG for this repo:
#      * lexicographic sort would put all five timestamped files between
#        201_* and 202_* — prod applied them at four different points
#      * two numbered files were never applied to prod at all
#    Rules encoded here:
#      SKIP 121_payment_integrity.sql
#        — prod never ran it; superseded by 180_payment_integrity_reapply.sql
#      SKIP 209_platform_settings_secret_keys_lockdown.sql
#        — duplicate of 20260731213852_* which prod applied earlier (after 201)
#      INTERLEAVE (prod-ledger positions):
#        20260724120946_kyc_upload_hardening.sql            AFTER 124, BEFORE 125
#        20260730162500_atomic_merchant_menu_import.sql     AFTER 195 \
#        20260730162600_p07_governance_hardening.sql        then, BEFORE 196
#        20260730223634_gen_random_bytes_search_path_fix.sql AFTER 197, BEFORE 198
#        20260731213852_platform_settings_secret_keys_lockdown.sql AFTER 201, BEFORE 202
# ----------------------------------------------------------------------------
declare -a ORDERED=()
NUMBERED_COUNT=0
for f in "$MIG_DIR"/[0-9][0-9][0-9]_*.sql; do
  base="$(basename "$f")"
  NUMBERED_COUNT=$((NUMBERED_COUNT + 1))
  case "$base" in
    121_payment_integrity.sql) continue ;;                       # skip: superseded by 180 (prod ledger)
    209_platform_settings_secret_keys_lockdown.sql) continue ;;  # skip: dup of 20260731213852_* (prod ledger)
    # 216 is committed but NOT applied to production: it forces customer/driver
    # clients onto private Realtime channels, so it ships with a coordinated app
    # release. Staging mirrors the prod ledger, so it stays out here too — the
    # COD flow this stack exists to run does not touch driver-location Realtime.
    216_realtime_driver_location_authorization.sql) continue ;;
  esac
  ORDERED+=("$base")
  case "$base" in
    124_signup_role_hint_lockdown.sql)
      ORDERED+=("20260724120946_kyc_upload_hardening.sql") ;;
    195_order_share_links.sql)
      ORDERED+=("20260730162500_atomic_merchant_menu_import.sql"
                "20260730162600_p07_governance_hardening.sql") ;;
    197_dev_analysis_extensions.sql)
      ORDERED+=("20260730223634_gen_random_bytes_search_path_fix.sql") ;;
    201_dispatch_requires_fresh_ping.sql)
      ORDERED+=("20260731213852_platform_settings_secret_keys_lockdown.sql") ;;
    # The 2026-08-15 hardening tranche. Production applied these AFTER 215 and
    # in THIS order, which is NOT their filename order — grants must precede
    # the modifier wrapper and the deletion guard, because it is the migration
    # that closes the default-privilege holes those two then rely on. Verified
    # against supabase_migrations.schema_migrations (versions 20260815113318 ..
    # 20260815120607) rather than inferred from the file names.
    215_driver_ping_no_status_downgrade.sql)
      ORDERED+=("20260815044240_explicit_data_api_grants.sql"
                "20260815044234_enforce_order_modifier_invariants.sql"
                "20260815050843_restrict_customer_account_deletion.sql"
                "20260815044230_repair_push_retry_state_machine.sql") ;;
  esac
done

# Sanity: (numbered - 3 skips) + 9 placed timestamped files must equal the list
# length. There are 10 timestamped files on disk; 20260815044226 (admin MFA) is
# committed but NOT applied to production — it requires every admin to hold a
# verified TOTP factor first — so, like 216, it is deliberately absent from the
# plan and excluded from this count rather than silently dropped.
TS_COUNT=$(find "$MIG_DIR" -maxdepth 1 -name '2026*_*.sql' | wc -l | tr -d ' ')
[ "$TS_COUNT" -eq 10 ] \
  || die "expected exactly 10 timestamped migrations, found $TS_COUNT — a new one landed; add its prod-ledger position to the interleave map above (or to the deliberate-skip list)."
[ -f "$MIG_DIR/20260815044226_enforce_admin_mfa_authority.sql" ] \
  || die "the admin-MFA migration is missing; it is excluded by name, so a rename would silently change the plan."
EXPECTED=$((NUMBERED_COUNT - 3 + 9))
[ "${#ORDERED[@]}" -eq "$EXPECTED" ] \
  || die "migration list length ${#ORDERED[@]} != expected $EXPECTED (numbered $NUMBERED_COUNT - 3 skips + 9 timestamped) — an interleave anchor file was probably renamed."
for m in "${ORDERED[@]}"; do
  [ -f "$MIG_DIR/$m" ] || die "migration listed but not on disk: $m"
done
echo "==> Migration plan: $EXPECTED files ($NUMBERED_COUNT numbered - 3 skipped + 9 timestamped, prod-ledger order 2026-08-15)."
if [ "$PLAN_ONLY" -eq 1 ]; then
  printf '%s\n' "${ORDERED[@]}"
  echo "==> --plan-only: plan validated, nothing applied."
  exit 0
fi

# ----------------------------------------------------------------------------
# 4) Apply migrations (skip if already fully migrated; refuse a half-migrated DB)
# ----------------------------------------------------------------------------
# Keyed to the LAST migration this script applies. It used to test for a policy
# created by 216 — but 216 is deliberately NOT in the plan (it is unapplied in
# production and needs a coordinated client release), so that marker could never
# become true and every run re-applied the whole chain. private.place_order only
# exists after 20260815044234 moved it there, which is the real end state.
FULLY_MIGRATED=$(psql_scalar "select exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'place_order')")
HAS_SCHEMA=$(psql_scalar "select exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order')")

if [ "$FULLY_MIGRATED" = "t" ]; then
  echo "==> Schema already migrated through 216 — skipping migrations (seeds + fixtures still re-applied)."
elif [ "$HAS_SCHEMA" = "t" ]; then
  die "database has a PARTIAL schema (place_order exists but the 216 marker does not). \
A previous run failed midway; migrations are not re-runnable. \
Wipe with: supabase stop --no-backup   then re-run this script."
else
  i=0
  for m in "${ORDERED[@]}"; do
    i=$((i + 1))
    printf '==> [%3d/%d] applying %s\n' "$i" "$EXPECTED" "$m"
    psql_file "$MIG_DIR/$m"
  done
  echo "==> All $EXPECTED migrations applied."
fi

# ----------------------------------------------------------------------------
# 5) Seeds, then the staging fixtures (idempotent — also the per-run hygiene)
# ----------------------------------------------------------------------------
for s in seed.sql seed_menus_3restaurants.sql staging-fixtures.sql; do
  echo "==> applying supabase/$s"
  psql_file "$REPO_ROOT/supabase/$s"
done

# ----------------------------------------------------------------------------
# 6) How to run the Maestro COD flow (values match supabase/staging-fixtures.sql)
# ----------------------------------------------------------------------------
cat <<'EOF'

============================================================================
Staging stack is ready for the Maestro COD flow.

API:      http://127.0.0.1:54321        Postgres: 127.0.0.1:54322
Point the customer app build at this stack (EXPO_PUBLIC_USE_SUPABASE=true,
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321, anon key from
`supabase status`), install it on a booted simulator/emulator, then:

export CUSTOMER_E2E_PHONE='+201000000000'
export CUSTOMER_E2E_OTP='000000'
export CUSTOMER_E2E_RESTAURANT_NAME='Fixture Restaurant'
export CUSTOMER_E2E_MENU_ITEM_NAME='Fixture Item'
export CUSTOMER_E2E_ADDRESS_ID='e2e00000-0000-4000-8000-000000000003'

maestro test .maestro/customer-order-cod.yaml

Re-run this script before every Maestro run: it re-applies the fixtures,
cancels the fixture account's open orders and empties its server cart
(the README's clean-slate contract).
============================================================================
EOF
