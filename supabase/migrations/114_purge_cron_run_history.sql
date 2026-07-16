-- 114_purge_cron_run_history.sql
--
-- LOW (final-audit completeness critic, 2026-07-16): cron.job_run_details had
-- grown to 44 MB / ~270k rows since 2026-06-23 (the largest object in the DB —
-- the entire business dataset is <2 MB) with no purge job. Three jobs run every
-- 20s (dispatch-sweep, auto-accept, auto-advance) plus two every 2 min, so the
-- run-history table grows ~13k rows/day unbounded. pg_cron never trims it itself.
--
-- Fix: (1) one-shot purge of the existing backlog (keep the last 7 days), and
-- (2) a daily job that keeps it trimmed. job_run_details is pure execution-history
-- log data — pruning old rows has no functional effect. Uses start_time (always
-- set) rather than end_time (null for in-flight runs) so nothing running is hit.

-- (1) Immediate backlog purge — stops the bloat now instead of in 7 days.
--     (Disk is reclaimed by autovacuum; this halts unbounded growth immediately.)
delete from cron.job_run_details where start_time < now() - interval '7 days';

-- (2) Daily purge at 04:00 UTC (a quiet hour). cron.schedule upserts by name, so
--     this is idempotent on replay — matches the repo pattern (migs 066/084/105).
select cron.schedule(
  'sharmeats-purge-cron-history',
  '0 4 * * *',
  $$delete from cron.job_run_details where start_time < now() - interval '7 days'$$
);
