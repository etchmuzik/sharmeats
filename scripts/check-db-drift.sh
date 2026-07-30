#!/usr/bin/env bash
#
# check-db-drift.sh — proves the repository and the production database agree.
#
# Package 04 Slice A. This check exists because migration 121 sat on disk for 58
# migrations while production silently lacked its objects — and two deployed edge
# functions called RPCs that did not exist. Nothing in CI could have noticed:
# typecheck passes against generated types, and Deno tests never call the DB.
#
# Two independent checks, either of which would have caught it:
#
#   1. LEDGER: every supabase/migrations/NNN_name.sql must have a row in
#      supabase_migrations.schema_migrations whose name matches. A file with no
#      ledger row is authored-but-never-applied.
#   2. RPC REFERENCES: every public.* function name invoked via .rpc('...') in
#      supabase/functions/ must exist in production pg_proc. A missing one means
#      deployed code calls a function that cannot be there.
#
# Usage:
#   DATABASE_URL=postgres://... scripts/check-db-drift.sh
#
# Exit codes: 0 clean, 1 drift found, 2 misconfiguration.
#
# The ledger check compares STEMS — the name with any leading numeric/timestamp
# prefix stripped — because the ledger's names are inconsistent in three verified
# ways (2026-07-30): four rows are stamped under prefix-less names
# (auto_advance_kitchen = 039_*), one file was renumbered after application
# (099_pin_trigger_* is ledgered as 095_pin_trigger_*), and one file carries a
# timestamp prefix its ledger row lacks. A reconciliation suffix
# (stem__NEVER_RUN_superseded_by_180) counts as PRESENT — the gap is explained,
# which is the whole point.
#
# 64 historical migrations were applied by hand and never stamped; they live in
# scripts/db-drift-baseline.txt (shrink-only — see its header). The check fails
# only on files that are neither ledgered NOR baselined: a NEW authored-but-
# never-applied migration, i.e. the mig-121 incident happening again.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"
FUNCTIONS_DIR="$REPO_ROOT/supabase/functions"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "check-db-drift: DATABASE_URL is required" >&2
  exit 2
fi
if [[ ! -d "$MIGRATIONS_DIR" ]]; then
  echo "check-db-drift: $MIGRATIONS_DIR not found" >&2
  exit 2
fi

fail=0

# ---------------------------------------------------------------------------
# 1. Every migration file has a ledger row
# ---------------------------------------------------------------------------
# One round-trip: fetch all ledger names, then compare locally. A database with
# no ledger at all is a MISCONFIGURATION (wrong DATABASE_URL, or a scratch restore
# that skipped supabase_migrations) — not drift; report it as such.
if ! ledger_names="$(psql "$DATABASE_URL" -tAc \
  "select name from supabase_migrations.schema_migrations" 2>/tmp/drift_ledger_err)"; then
  echo "check-db-drift: cannot read the migration ledger — wrong database?" >&2
  cat /tmp/drift_ledger_err >&2
  exit 2
fi

# Stems present in the ledger (prefix stripped once, e.g. "039_" or a timestamp).
ledger_stems="$(sed -E 's/^[0-9]+_//' <<<"$ledger_names")"

BASELINE="${DRIFT_BASELINE:-$REPO_ROOT/scripts/db-drift-baseline.txt}"
baseline_names=""
if [[ -f "$BASELINE" ]]; then
  baseline_names="$(grep -v '^#' "$BASELINE" | grep -v '^[[:space:]]*$' || true)"
fi

missing_ledger=()
stale_baseline=()
while IFS= read -r f; do
  base="$(basename "$f" .sql)"
  stem="$(sed -E 's/^[0-9]+_//' <<<"$base")"
  if grep -qx "$stem" <<<"$ledger_stems" \
     || grep -q "^${stem}__" <<<"$ledger_stems"; then
    # Ledgered. If it is ALSO baselined, the baseline entry is stale — nudge,
    # so the list only ever shrinks.
    if grep -qx "$base" <<<"$baseline_names"; then
      stale_baseline+=("$base")
    fi
    continue
  fi
  if grep -qx "$base" <<<"$baseline_names"; then
    continue  # known historical hand-application; explained in the baseline file
  fi
  missing_ledger+=("$base")
done < <(find "$MIGRATIONS_DIR" -maxdepth 1 -name '[0-9]*_*.sql' | sort)

if ((${#missing_ledger[@]})); then
  fail=1
  echo "DRIFT: migration files with NO ledger row and NO baseline entry"
  echo "       (authored but never applied? — this is the mig-121 incident shape):"
  printf '  - %s\n' "${missing_ledger[@]}"
else
  echo "ok: every migration file is ledgered or baselined ($(grep -c . <<<"$baseline_names") baseline entries)"
fi
if ((${#stale_baseline[@]})); then
  echo "note: baseline entries now present in the ledger — remove them from $BASELINE:"
  printf '  - %s\n' "${stale_baseline[@]}"
fi

# ---------------------------------------------------------------------------
# 2. Every RPC name referenced by edge functions exists in the database
# ---------------------------------------------------------------------------
# Matches .rpc('name') / .rpc("name") across supabase/functions/*. MULTILINE:
# prettier splits long calls as `.rpc(\n  "name",` and a line-based grep silently
# missed settle_paymob_payment and finalize_full_card_refund — the exact calls this
# check exists for. A checker that false-passes is worse than none, so extraction
# slurps whole files (perl -0777) and lets \s cross newlines.
rpc_names="$(find "$FUNCTIONS_DIR" -name '*.ts' -exec perl -0777 -ne \
  'print "$1\n" while /\.rpc\(\s*["\x27]([a-zA-Z0-9_]+)["\x27]/gs' {} + | sort -u)"

if [[ -z "$rpc_names" ]]; then
  echo "check-db-drift: no .rpc() references found under supabase/functions — suspicious" >&2
  exit 2
fi

# One round-trip: existence for the whole list at once.
quoted="$(printf "'%s'," $rpc_names)"; quoted="${quoted%,}"
missing_rpcs="$(psql "$DATABASE_URL" -tAc "
  select r.name
    from unnest(array[${quoted}]) as r(name)
   where not exists (
     select 1 from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = r.name)")"

if [[ -n "$missing_rpcs" ]]; then
  fail=1
  echo "DRIFT: edge functions call RPCs that DO NOT EXIST in the database:"
  while IFS= read -r r; do
    # Same multiline matcher as extraction — a single-line grep here found nothing
    # AND its exit 1 aborted this loop under set -e, truncating the report to the
    # first missing RPC. `|| true` because "no files matched" is not an error.
    refs="$(find "$FUNCTIONS_DIR" -name '*.ts' -exec perl -0777 -ne \
      'print "$ARGV\n" if /\.rpc\(\s*["\x27]'"$r"'["\x27]/s' {} + || true)"
    echo "  - $r  (referenced by:)"
    sed 's/^/      /' <<<"$refs"
  done <<<"$missing_rpcs"
else
  echo "ok: every edge-function RPC reference exists in the database"
fi

exit "$fail"
