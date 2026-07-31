#!/usr/bin/env bash
#
# check-cron-liveness.sh — proves the scheduled jobs are still RUNNING.
#
# WHY THIS EXISTS
# Every automated safety net in this platform is a pg_cron job: dispatch_sweep
# assigns drivers, auto_advance_sweep moves kitchens along, payment_reconciliation
# finds money that went missing, site_health_sweep watches the web surfaces.
# Nothing watched the watchers.
#
# dispatch_watchdog's own cron-health signal counts FAILED runs in
# cron.job_run_details. That makes it structurally blind to the most likely
# failure mode: a job that has simply STOPPED — unscheduled by hand, disabled
# after a restore, or never created because a migration was authored and never
# applied. A job that does not run produces no failure rows, so a failure count
# stays at zero and reads as healthy. If dispatch_sweep died tonight, the first
# report would be a customer wondering why nobody came.
#
# This asks the opposite question: for every job the repository schedules, has it
# succeeded RECENTLY ENOUGH for its own cadence?
#
# Usage:
#   DATABASE_URL=postgres://... scripts/check-cron-liveness.sh
#
# Exit codes: 0 all live, 1 dead/missing/disabled/failing jobs found,
#             2 misconfiguration (no DATABASE_URL, no pg_cron, no permission).
#
# EXPECTED JOBS COME FROM THE REPOSITORY, NOT A HARDCODED LIST.
# Every `cron.schedule('name', ...)` and `cron.unschedule('name')` in
# supabase/migrations is extracted in apply order and the LAST operation per name
# wins — exactly how Postgres ends up. So a job the repo deliberately stopped
# (mig 196 unschedules sharmeats-batch-shadow) is not expected, a job a new
# migration adds is expected the moment it lands, and this checker never needs
# hand-maintaining. Full-line SQL comments are stripped first: mig 196 quotes the
# old batch-shadow schedule inside a comment, and a naive grep resurrects it.
#
# TOLERANCE is derived from each job's own schedule:
#   allowed lag = period + max(period / 2, 5 minutes)
# So a 20-second sweep is dead after ~5 minutes of silence, a daily job after
# 36 hours, a weekly job after 10.5 days. The 5-minute floor keeps the
# 20-second jobs from flapping on a single slow minute.
#
# THE RUN HISTORY IS PURGED AFTER 2 DAYS (mig 196), which is SHORTER than the
# allowed lag of the weekly jobs. For those, "no rows" cannot be distinguished
# from "purged", so they are reported UNVERIFIABLE rather than failed — an
# honest "cannot tell" beats a false alarm that teaches the operator to ignore
# this script. See FOLLOWUPS for the retention change that would close the gap.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "check-cron-liveness: DATABASE_URL is required" >&2
  exit 2
fi
if [[ ! -d "$MIGRATIONS_DIR" ]]; then
  echo "check-cron-liveness: $MIGRATIONS_DIR not found" >&2
  exit 2
fi

# ---------------------------------------------------------------------------
# 1. What the repository says should be scheduled
# ---------------------------------------------------------------------------
# perl -0777 so `perform cron.schedule(\n  'name',` — the guarded form used by
# migs 181/182/184/187 — is matched as readily as the single-line form. Files are
# walked in sorted order, which is apply order (prefixes are zero-padded, so
# lexical and numeric agree, and the timestamp-prefixed files sort last).
extract_ops() {
  while IFS= read -r f; do
    sed -E 's/^[[:space:]]*--.*$//' "$f" | perl -0777 -ne \
      'print "$1\t$2\n" while /cron\.(schedule|unschedule)\s*\(\s*\x27([a-z0-9_-]+)\x27/gis'
  done < <(find "$MIGRATIONS_DIR" -maxdepth 1 -name '[0-9]*_*.sql' | sort)
}

expected_names="$(extract_ops | awk -F'\t' '
  { op[$2] = $1; order[$2] = order[$2] ? order[$2] : ++n }
  END { for (name in op) if (op[name] == "schedule") print order[name] "\t" name }
' | sort -n | cut -f2)"

if [[ -z "$expected_names" ]]; then
  echo "check-cron-liveness: no cron.schedule() calls found in $MIGRATIONS_DIR — suspicious" >&2
  exit 2
fi

expected_count="$(grep -c . <<<"$expected_names")"

# ---------------------------------------------------------------------------
# 2. Ask the database
# ---------------------------------------------------------------------------
if ! psql "$DATABASE_URL" -tAc \
  "select 1 from pg_extension where extname = 'pg_cron'" 2>/tmp/cron_liveness_err | grep -q 1; then
  echo "check-cron-liveness: pg_cron is not installed on this database — wrong target?" >&2
  cat /tmp/cron_liveness_err >&2
  exit 2
fi

if ! psql "$DATABASE_URL" -tAc "select count(*) from cron.job" >/dev/null 2>/tmp/cron_liveness_err; then
  echo "check-cron-liveness: cannot read cron.job — the connecting role needs select on it" >&2
  cat /tmp/cron_liveness_err >&2
  exit 2
fi

quoted="$(printf "'%s'," $expected_names)"; quoted="${quoted%,}"

# One round-trip. The verdict is computed in SQL so the period arithmetic happens
# where the timestamps live and no clock skew between this host and the database
# can turn a healthy job into a dead one.
report="$(psql "$DATABASE_URL" -tA -F'|' -c "
with expected(jobname) as (
  select unnest(array[${quoted}]::text[])
),
scheduled as (
  select
    jobid,
    jobname,
    schedule,
    active,
    case
      -- pg_cron interval syntax ('20 seconds'), used by the three fast sweeps.
      when schedule ~ '^[[:space:]]*[0-9]+[[:space:]]+seconds?[[:space:]]*\$'
        then (substring(schedule from '[0-9]+'))::int * interval '1 second'
      when schedule ~ '^[[:space:]]*[0-9]+[[:space:]]+minutes?[[:space:]]*\$'
        then (substring(schedule from '[0-9]+'))::int * interval '1 minute'
      when schedule ~ '^[[:space:]]*[0-9]+[[:space:]]+hours?[[:space:]]*\$'
        then (substring(schedule from '[0-9]+'))::int * interval '1 hour'
      -- 5-field cron. Coarsest field that is pinned decides the period.
      when split_part(schedule, ' ', 1) = '*' then interval '1 minute'
      when split_part(schedule, ' ', 1) like '*/%'
        then (replace(split_part(schedule, ' ', 1), '*/', ''))::int * interval '1 minute'
      when split_part(schedule, ' ', 5) <> '*' then interval '7 days'
      when split_part(schedule, ' ', 3) <> '*' or split_part(schedule, ' ', 4) <> '*'
        then interval '31 days'
      when split_part(schedule, ' ', 2) = '*' then interval '1 hour'
      else interval '1 day'
    end as period
  from cron.job
),
tolerated as (
  select s.*, s.period + greatest(s.period / 2, interval '5 minutes') as allowed_lag
    from scheduled s
),
runs as (
  select
    jobid,
    max(start_time) filter (where status = 'succeeded') as last_ok,
    max(start_time)                                     as last_any
  from cron.job_run_details
  group by jobid
),
history as (
  select coalesce(now() - min(start_time), interval '0 seconds') as span
    from cron.job_run_details
)
select
  case
    when t.jobname is null                                       then 'MISSING'
    when e.jobname is null                                       then 'EXTRA'
    when not t.active                                            then 'DISABLED'
    when r.last_ok is not null
     and now() - r.last_ok <= t.allowed_lag                      then 'OK'
    when r.last_ok is null and h.span < t.allowed_lag            then 'UNVERIFIABLE'
    when r.last_any is not null
     and now() - r.last_any <= t.allowed_lag                     then 'FAILING'
    else 'DEAD'
  end                                                             as verdict,
  coalesce(e.jobname, t.jobname)                                  as jobname,
  coalesce(t.schedule, '-')                                       as schedule,
  coalesce(
    case when r.last_ok is null then 'never succeeded'
         else 'last ok ' || to_char(r.last_ok, 'YYYY-MM-DD HH24:MI') || 'Z ('
              || date_trunc('second', now() - r.last_ok) || ' ago)' end,
    'no run history')                                             as detail,
  coalesce(date_trunc('second', t.allowed_lag)::text, '-')        as allowed_lag
from expected e
full join tolerated t on t.jobname = e.jobname
left join runs r on r.jobid = t.jobid
cross join history h
order by 1, 2
" 2>/tmp/cron_liveness_err)" || {
  echo "check-cron-liveness: the liveness query failed" >&2
  cat /tmp/cron_liveness_err >&2
  exit 2
}

# ---------------------------------------------------------------------------
# 3. Report
# ---------------------------------------------------------------------------
fail=0
dead=(); unverifiable=(); extra=()

echo "cron liveness — ${expected_count} job(s) expected by supabase/migrations"
echo

while IFS='|' read -r verdict jobname schedule detail allowed_lag; do
  [[ -z "$verdict" ]] && continue
  printf '  %-13s %-38s %-14s %s\n' "$verdict" "$jobname" "$schedule" "$detail"
  case "$verdict" in
    OK) ;;
    UNVERIFIABLE) unverifiable+=("$jobname (tolerance ${allowed_lag} exceeds the run-history retention)") ;;
    EXTRA)        extra+=("$jobname ($schedule)") ;;
    MISSING)      fail=1; dead+=("$jobname — scheduled by a migration but ABSENT from cron.job") ;;
    DISABLED)     fail=1; dead+=("$jobname — present but active=false, so it never fires") ;;
    FAILING)      fail=1; dead+=("$jobname — running but every recent run FAILED; ${detail}") ;;
    DEAD)         fail=1; dead+=("$jobname — no successful run within ${allowed_lag}; ${detail}") ;;
    *)            fail=1; dead+=("$jobname — unrecognised verdict '${verdict}'") ;;
  esac
done <<<"$report"

echo
if ((${#dead[@]})); then
  echo "DEAD CRON: the platform is silently not doing this work:"
  printf '  - %s\n' "${dead[@]}"
  echo
  echo "  Diagnose:  select jobid, jobname, schedule, active from cron.job order by jobname;"
  echo "             select * from cron.job_run_details order by start_time desc limit 20;"
  echo "  Re-arm:    re-run the migration that schedules it (cron.schedule upserts by name)."
else
  echo "ok: every scheduled job has succeeded within its own cadence"
fi

if ((${#unverifiable[@]})); then
  echo "note: cannot verify these — cron.job_run_details is purged after 2 days (mig 196),"
  echo "      which is shorter than their schedule. Not treated as a failure:"
  printf '  - %s\n' "${unverifiable[@]}"
fi

if ((${#extra[@]})); then
  echo "note: jobs in cron.job that NO migration schedules — created by hand, or left"
  echo "      behind by a migration that was later rewritten:"
  printf '  - %s\n' "${extra[@]}"
fi

exit "$fail"
