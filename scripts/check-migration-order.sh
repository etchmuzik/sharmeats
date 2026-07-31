#!/usr/bin/env bash
#
# check-migration-order.sh — the migration filenames must define ONE apply order.
#
# WHY THIS EXISTS
# Migrations are applied in filename order and recorded in
# supabase_migrations.schema_migrations, which is keyed by the numeric VERSION
# prefix. Two files sharing a prefix therefore cannot both be recorded: a fresh
# replay stamps the version once, and the second file is either skipped or
# collides. Production already carries two such pairs (026_auto_accept /
# 026_referrals, and 197_dev_analysis_extensions /
# 197_gen_random_bytes_search_path_fix) — see FOLLOWUPS for the remediation
# options, which are a human decision because renumbering an APPLIED migration
# changes apply order, which is the class of change this repository's house rules
# exist because of.
#
# This gate exists so a THIRD pair is never introduced. It is deliberately
# repository-only: no database, no network, no ordering opinion beyond what the
# filenames themselves must satisfy.
#
# It checks:
#   1. no two files share a numeric prefix          (ledger version collision)
#   2. no two files share a name STEM               (scripts/check-db-drift.sh
#      matches the ledger on stems, so a duplicate stem makes an unapplied
#      migration look applied — the mig-121 incident made invisible)
#   3. every filename is NNN_lower_snake_case.sql   (a name the tooling can parse)
#
# Usage:  scripts/check-migration-order.sh
# Exit:   0 clean, 1 a rule is broken, 2 misconfiguration.
#
# EXISTING duplicates are grandfathered through scripts/migration-prefix-allow.txt
# so this can be a hard gate today. That file is SHRINK-ONLY: an entry that no
# longer duplicates anything is reported so it gets deleted, and nothing may be
# added to it without the remediation decision it stands in for.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"
ALLOW_FILE="${MIGRATION_PREFIX_ALLOW:-$REPO_ROOT/scripts/migration-prefix-allow.txt}"

if [[ ! -d "$MIGRATIONS_DIR" ]]; then
  echo "check-migration-order: $MIGRATIONS_DIR not found" >&2
  exit 2
fi

names="$(cd "$MIGRATIONS_DIR" && find . -maxdepth 1 -name '*.sql' -exec basename {} \; | sort)"
if [[ -z "$names" ]]; then
  echo "check-migration-order: no .sql files in $MIGRATIONS_DIR — suspicious" >&2
  exit 2
fi

allowed=""
if [[ -f "$ALLOW_FILE" ]]; then
  allowed="$(grep -v '^#' "$ALLOW_FILE" | grep -v '^[[:space:]]*$' || true)"
fi

fail=0

# ---------------------------------------------------------------------------
# 1. Duplicate numeric prefixes
# ---------------------------------------------------------------------------
dup_prefixes="$(sed -E 's/^([0-9]+)_.*/\1/' <<<"$names" | sort | uniq -d)"
new_dups=()
stale_allow=()
while IFS= read -r p; do
  [[ -z "$p" ]] && continue
  if grep -qx "$p" <<<"$allowed"; then continue; fi
  new_dups+=("$p")
done <<<"$dup_prefixes"

while IFS= read -r a; do
  [[ -z "$a" ]] && continue
  grep -qx "$a" <<<"$dup_prefixes" || stale_allow+=("$a")
done <<<"$allowed"

if ((${#new_dups[@]})); then
  fail=1
  echo "DUPLICATE MIGRATION PREFIX — two files claim the same ledger version:"
  for p in "${new_dups[@]}"; do
    echo "  prefix ${p}:"
    grep "^${p}_" <<<"$names" | sed 's/^/    - /'
  done
  echo "  Renumber the NEW file to the next free prefix. Never renumber one that"
  echo "  is already applied to production."
else
  echo "ok: no new duplicate migration prefixes"
fi

if ((${#stale_allow[@]})); then
  echo "note: allow-list entries that no longer duplicate anything — delete them"
  echo "      from ${ALLOW_FILE}:"
  printf '  - %s\n' "${stale_allow[@]}"
fi

# ---------------------------------------------------------------------------
# 2. Duplicate stems
# ---------------------------------------------------------------------------
dup_stems="$(sed -E 's/^[0-9]+_//' <<<"$names" | sort | uniq -d)"
if [[ -n "$dup_stems" ]]; then
  fail=1
  echo "DUPLICATE MIGRATION STEM — check-db-drift.sh matches the ledger on stems,"
  echo "so one of each pair would look applied while it never ran:"
  while IFS= read -r s; do
    [[ -z "$s" ]] && continue
    echo "  stem ${s}:"
    grep -E "^[0-9]+_${s}\$" <<<"$names" | sed 's/^/    - /'
  done <<<"$dup_stems"
else
  echo "ok: no duplicate migration stems"
fi

# ---------------------------------------------------------------------------
# 3. Filename shape
# ---------------------------------------------------------------------------
bad_shape="$(grep -vE '^[0-9]+_[a-z0-9_]+\.sql$' <<<"$names" || true)"
if [[ -n "$bad_shape" ]]; then
  fail=1
  echo "MALFORMED MIGRATION NAME — expected NNN_lower_snake_case.sql:"
  sed 's/^/  - /' <<<"$bad_shape"
else
  echo "ok: every migration filename is NNN_lower_snake_case.sql ($(grep -c . <<<"$names") files)"
fi

exit "$fail"
