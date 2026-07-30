-- 196_cron_history_retention_and_shadow_stop.sql
--
-- Free-tier compute recovery. Found via pg_stat_statements 2026-07-30: the
-- database had burned ~6 HOURS of CPU serving 23 orders. Nothing here changes
-- anything a user sees.
--
-- ROOT CAUSE
-- cron.job_run_details held 115,159 rows / 25 MB — 44% of the entire 57 MB
-- database and its single largest object — with NO index except its runid
-- primary key. Two hot paths sequentially scan it:
--
--   * dispatch_watchdog() every 2 minutes, filtering start_time > now() - 5m.
--     Measured at 267 ms per call: 5x slower than any other sweep and the
--     largest per-call cost in the system (20,116 calls, 1.5 CPU-hours).
--   * the retention purge from mig 114, filtering start_time < now() - 7 days.
--
-- Migration 114 correctly identified this table as the bloat source and added
-- the purge, but never indexed it, so both paths still scanned 25 MB.
--
-- THE OBVIOUS FIX IS NOT AVAILABLE — DO NOT RETRY IT
-- `create index on cron.job_run_details (start_time)` fails with
-- "42501: must be owner of table job_run_details". The table is owned by
-- supabase_admin; the project's postgres role has DELETE but not ownership, so
-- this cannot be indexed on Supabase at any tier. Verified 2026-07-30.
--
-- So the table has to be made SMALL instead of fast to scan. Retention drops
-- 7 days -> 2. Nothing reads beyond 5 minutes of it (the watchdog's window);
-- 7 days was a guess in mig 114 and is precisely what holds the steady state at
-- 115k rows. Two days keeps real debugging history at roughly 27k rows / 6 MB,
-- which also returns ~19 MB — a third of the database — to the free-tier quota.
--
-- The watchdog also moves 2 min -> 5 min. Its stuck-order threshold is 10
-- minutes (platform_settings.dispatch_stuck_order_minutes), so detection
-- latency stays well inside the window that matters. Smaller table plus lower
-- cadence takes it from ~192 s/day of CPU to roughly 19 s.
--
-- sharmeats-batch-shadow is unscheduled. It is Phase 0 SHADOW instrumentation
-- (mig 085) whose entire purpose is to answer "is order batching worth building
-- at Sharm's volume?" — and after 19,761 runs and ~52 minutes of CPU it has
-- logged EXACTLY ZERO candidate pairs, because two concurrent batchable orders
-- cannot exist when 23 orders exist in total. It measures a question that
-- cannot have an answer yet, and it is also a third of the row growth feeding
-- the bloat above.
--
-- The function and batch_candidate_log table are deliberately KEPT — the Phase
-- 0 design is sound and worth running once there is real concurrent volume:
--   select cron.schedule('sharmeats-batch-shadow', '*/2 * * * *',
--                        $$select public.batch_shadow_sweep()$$);
--
-- DELIBERATELY NOT CHANGED: dispatch_sweep stays at 20 seconds. At 2.4
-- CPU-hours it is the largest single line item, but it is the core dispatch
-- loop and its cadence is customer-visible latency on driver assignment.
-- Trading that for compute recoverable elsewhere for free would be the wrong
-- way round.

-- ---------------------------------------------------------------------------
-- 1. Trim the backlog now, then hold retention at 2 days.
-- ---------------------------------------------------------------------------
delete from cron.job_run_details where start_time < now() - interval '2 days';

-- cron.schedule upserts by name, so this replaces mig 114's 7-day command
-- rather than creating a second job. Same name, same 04:00 UTC slot.
select cron.schedule(
  'sharmeats-purge-cron-history',
  '0 4 * * *',
  $$delete from cron.job_run_details where start_time < now() - interval '2 days'$$
);

-- ---------------------------------------------------------------------------
-- 2. Watchdog every 5 minutes instead of every 2.
-- ---------------------------------------------------------------------------
select cron.schedule(
  'sharmeats-dispatch-watchdog',
  '*/5 * * * *',
  $$select public.dispatch_watchdog()$$
);

-- ---------------------------------------------------------------------------
-- 3. Stop the shadow sweep (keeping the function and its table).
-- ---------------------------------------------------------------------------
-- Guarded: cron.unschedule() raises if the job is absent, and this migration
-- must stay replayable on a fresh database where it was never created.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'sharmeats-batch-shadow') then
    perform cron.unschedule('sharmeats-batch-shadow');
  end if;
end;
$$;
