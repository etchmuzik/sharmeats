#!/usr/bin/env bash
#
# Prove the EAS upload still contains the app source — and still excludes the
# things it is supposed to.
#
# WHY THIS EXISTS. The root .easignore listed `supabase/` under "repo docs and
# tooling not needed to compile an app". Gitignore semantics make an unanchored
# directory rule match at ANY depth, so it silently deleted
# apps/customer/src/data/supabase/ — all 24 files of the production data layer —
# from every archive uploaded to EAS. Every build from 2026-07-31 died in Bundle
# JavaScript with "Unable to resolve module ../src/data/supabase/client".
#
# Nothing caught it. Typecheck, tests, lint and `expo export` all read the
# WORKING TREE, which was complete; only the uploaded archive was missing files,
# and the only signal was a build failure twenty minutes and one credit later.
# That is the gap this closes: the archive contents become a CI-time assertion
# instead of a build-time surprise.
#
# HOW. `git check-ignore` is git's own ignore engine — the same semantics
# eas-cli's filter implements — pointed at .easignore via core.excludesFile.
# Feeding it TRACKED files is what makes the result unambiguous: a tracked file
# cannot be matched by .gitignore (it would not be tracked), so any hit whose
# source is .easignore is a file the upload would lose.
#
# It asserts BOTH directions. A check that only proved "nothing is excluded"
# would pass if someone deleted .easignore entirely — which is how the archive
# went back to 164 MB and started shipping .env.
#
# Usage:  ./scripts/check-easignore.sh     (exit 0 clean, 1 dirty)

set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

EASIGNORE=".easignore"
[[ -f "$EASIGNORE" ]] || { echo "✗ $EASIGNORE not found at repo root" >&2; exit 1; }

fail=0

# ---------------------------------------------------------------------------
# 1. Everything the bundler needs MUST survive the filter.
#
#    Deliberately broad: the failure was in a directory nobody thought to list.
#    Enumerating what must survive by "all tracked app source" rather than by a
#    hand-written list is the only version that would have caught src/data/.
# ---------------------------------------------------------------------------
#    `*.md` is excluded from the enumeration, not from the rule: dropping a
#    README out of the archive is intentional and cannot break a bundle, so
#    flagging it would train people to ignore this check's output.
mapfile -t must_ship < <(
  git ls-files -- \
    'apps/*/src/**' 'apps/*/app/**' 'apps/*/assets/**' \
    'apps/*/app.json' 'apps/*/app.config.js' 'apps/*/eas.json' \
    'apps/*/package.json' 'apps/*/package-lock.json' \
    'apps/*/babel.config.js' 'apps/*/metro.config.js' 'apps/*/tsconfig.json' \
    'apps/*/plugins/**' \
    'packages/*/**' \
  | grep -v '\.md$'
)

if (( ${#must_ship[@]} == 0 )); then
  echo "✗ enumerated 0 source files — the glob is wrong, not the repo" >&2
  exit 1
fi

# -v prints "source:line:pattern<TAB>path". Keep only .easignore hits.
dropped="$(
  printf '%s\n' "${must_ship[@]}" \
    | git -c core.excludesFile="$EASIGNORE" check-ignore -v --no-index --stdin 2>/dev/null \
    | grep "^${EASIGNORE}:" || true
)"

if [[ -n "$dropped" ]]; then
  fail=1
  count=$(printf '%s\n' "$dropped" | wc -l | tr -d ' ')
  echo "✗ .easignore removes ${count} source file(s) from the EAS upload:" >&2
  echo >&2
  printf '%s\n' "$dropped" | head -20 | while IFS=$'\t' read -r rule path; do
    printf '    %-55s  dropped by  %s\n' "$path" "$rule" >&2
  done
  [[ $count -gt 20 ]] && echo "    … and $((count - 20)) more" >&2
  echo >&2
  echo "  A directory rule without a leading slash matches at ANY depth." >&2
  echo "  Anchor it: 'supabase/' -> '/supabase/'." >&2
  echo >&2
fi

# ---------------------------------------------------------------------------
# 2. The heavy repo-root trees MUST still be excluded.
#
#    Without this, deleting .easignore passes part 1 and quietly restores the
#    92 MB of store screenshots and the repo-root supabase/ tree to every
#    upload — the problem .easignore was added to solve.
# ---------------------------------------------------------------------------
must_exclude=(
  "supabase/migrations/001_init.sql"
  "docs/OPS-RUNBOOK.md"
  "landing/package.json"
  ".github/workflows/ci.yml"
)

for path in "${must_exclude[@]}"; do
  # Only assert on paths that actually exist, so a repo reshuffle does not
  # produce a green check that is asserting nothing.
  [[ -e "$path" ]] || continue
  if ! git -c core.excludesFile="$EASIGNORE" check-ignore -q --no-index "$path"; then
    fail=1
    echo "✗ $path is NOT excluded — it will be uploaded to EAS on every build" >&2
  fi
done

if (( fail )); then
  echo "See .easignore and the 2026-08-01 incident note in its header." >&2
  exit 1
fi

echo "✓ .easignore: ${#must_ship[@]} source files survive the filter; repo-root docs/supabase/landing/.github excluded"
