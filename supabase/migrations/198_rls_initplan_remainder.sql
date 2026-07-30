-- 198_rls_initplan_remainder.sql
--
-- The six RLS policies migration 089 did not reach.
--
-- A bare `auth.uid()` inside a USING clause is re-evaluated FOR EVERY ROW the
-- policy examines, so a filtered scan costs O(rows) function calls instead of
-- one. Wrapping it as `(select auth.uid())` promotes it to an InitPlan that
-- Postgres evaluates once per query. Same value, same semantics — auth.uid(),
-- auth_role() and i_have_platform_capability() are all STABLE, so hoisting them
-- out of the per-row loop cannot change a result.
--
-- This is migration 089's pattern (f5_rls_initplan) applied to the policies
-- added after it: 089 predates support_cases, vertical_private_access,
-- driver_cod_overrides, notification_consent_events and the delivery_jobs pair.
--
-- Why now, when the tables are nearly empty: this is the one performance fix on
-- the advisor list that costs nothing to hold. Unlike an index it consumes no
-- storage and slows no write, so there is no reason to defer it until the
-- tables are big enough to hurt. (The 28 unindexed-foreign-key findings are
-- deliberately NOT actioned here — see the PR description.)
--
-- Policy roles and commands are reproduced exactly as they exist in production,
-- read from pg_policies rather than from the original migrations: the two
-- delivery_* policies apply to PUBLIC (no TO clause) and the other four to
-- authenticated. Getting that wrong would silently widen or narrow access.

-- ---------------------------------------------------------------------------
-- 1. notification_consent_events — simple ownership
-- ---------------------------------------------------------------------------
drop policy if exists notification_consent_events_own_select on public.notification_consent_events;
create policy notification_consent_events_own_select
  on public.notification_consent_events for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 2. driver_cod_overrides — ownership via the drivers table
-- ---------------------------------------------------------------------------
drop policy if exists driver_cod_overrides_own_select on public.driver_cod_overrides;
create policy driver_cod_overrides_own_select
  on public.driver_cod_overrides for select to authenticated
  using (
    exists (
      select 1 from public.drivers d
       where d.id = driver_cod_overrides.driver_id
         and d.profile_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 3. vertical_private_access — ownership or the expansion capability
-- ---------------------------------------------------------------------------
drop policy if exists vertical_private_access_own_select on public.vertical_private_access;
create policy vertical_private_access_own_select
  on public.vertical_private_access for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.i_have_platform_capability('expansion_launch_manager'))
  );

-- ---------------------------------------------------------------------------
-- 4. support_cases — the customer, or ops
-- ---------------------------------------------------------------------------
drop policy if exists support_cases_own_select on public.support_cases;
create policy support_cases_own_select
  on public.support_cases for select to authenticated
  using (
    customer_id = (select auth.uid())
    -- house rule 4: coalesce keeps a NULL role failing CLOSED, exactly as the
    -- production policy does today. Preserved verbatim apart from the hoist.
    or coalesce((select public.auth_role())::text, '') = any (array['admin', 'dispatcher'])
  );

-- ---------------------------------------------------------------------------
-- 5. delivery_jobs — participants or dispatch/support capability
--    NOTE: applies to PUBLIC (no TO clause), matching production.
-- ---------------------------------------------------------------------------
drop policy if exists delivery_jobs_participant_read on public.delivery_jobs;
create policy delivery_jobs_participant_read
  on public.delivery_jobs for select
  using (
    requester_user_id = (select auth.uid())
    or created_by_user_id = (select auth.uid())
    or exists (
      select 1 from public.drivers d
       where d.id = delivery_jobs.assigned_driver_id
         and d.profile_id = (select auth.uid())
    )
    or (select public.i_have_platform_capability('delivery_dispatch'))
    or (select public.i_have_platform_capability('delivery_support'))
  );

-- ---------------------------------------------------------------------------
-- 6. delivery_job_events — inherits its parent job's visibility
--    NOTE: applies to PUBLIC (no TO clause), matching production.
-- ---------------------------------------------------------------------------
drop policy if exists delivery_job_events_participant_read on public.delivery_job_events;
create policy delivery_job_events_participant_read
  on public.delivery_job_events for select
  using (
    exists (
      select 1 from public.delivery_jobs j
       where j.id = delivery_job_events.delivery_job_id
         and (
           j.requester_user_id = (select auth.uid())
           or j.created_by_user_id = (select auth.uid())
           or exists (
             select 1 from public.drivers d
              where d.id = j.assigned_driver_id
                and d.profile_id = (select auth.uid())
           )
         )
    )
    or (select public.i_have_platform_capability('delivery_dispatch'))
    or (select public.i_have_platform_capability('delivery_support'))
  );
