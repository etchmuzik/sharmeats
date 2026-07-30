-- 170_expired_cart_sweep.sql
--
-- Package 02 Slice D — reclaim carts past their TTL horizon.
--
-- Mig 168 gave customer_carts an `expires_at` and an index on it, and said
-- cleanup would be a scheduled job rather than a delete-on-read. This is that
-- job. Without it the column is decorative and the table grows forever: every
-- customer who ever abandons a basket leaves a row behind.
--
-- ================= WHY NOT DELETE ON READ =================
-- Repeating mig 168's reasoning because it is the obvious "simplification"
-- someone will reach for later:
--   * a read path that mutates cannot live in a STABLE function or run against
--     a read replica;
--   * a customer returning one minute after expiry should still be OFFERED
--     their basket (flagged stale) rather than silently losing it. The client
--     decides that; deleting on read would take the choice away.
-- So expiry is advisory at read time and only this sweep actually reclaims.
--
-- ================= WHY THE GRANT IS EMPTY =================
-- cron.schedule runs as the job owner (postgres), not as a client role, so this
-- function needs NO execute grant to anon or authenticated — and must not have
-- one. A client-callable bulk delete over customer_carts is exactly the
-- TRUNCATE-shaped hole mig 168's grants exist to close: RLS does not constrain a
-- SECURITY DEFINER function's own statements, so anyone who could call this
-- would wipe every customer's basket, not just their own.
--
-- ================= WHY IT RETURNS A COUNT =================
-- Matching loyalty_tier_sweep and the other sweeps: the return value lands in
-- cron.job_run_details, which is how an operator sees "did this actually do
-- anything" without querying the table. A silent void function is
-- indistinguishable from a job that never ran.

create or replace function public.expired_cart_sweep()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_count int := 0;
begin
  -- A single set-based DELETE, not a per-row loop. The other sweeps loop because
  -- they do per-entity work that can fail independently (a loyalty tier update
  -- that violates a constraint must not abort the whole batch). Here every row
  -- gets the identical treatment and there is nothing to partially fail, so a
  -- loop would only be slower and hold the row locks longer.
  --
  -- The index on expires_at (mig 168) serves this predicate.
  delete from public.customer_carts
   where expires_at < now();
  get diagnostics v_count = row_count;

  -- Deliberately quiet on the zero case: this runs daily and will usually
  -- reclaim nothing, so a notice per run would be noise in the cron history.
  if v_count > 0 then
    raise notice 'expired_cart_sweep reclaimed % cart(s)', v_count;
  end if;

  return v_count;
end;
$function$;

-- NO grant to anon or authenticated, deliberately — see the header. cron runs
-- this as the job owner. The revoke is still required because ALTER DEFAULT
-- PRIVILEGES on this database hands out EXECUTE to PUBLIC on every new function
-- (house rule 3), so "not granting" would leave it callable by anyone.
revoke all on function public.expired_cart_sweep() from public, anon, authenticated;

comment on function public.expired_cart_sweep() is
  'Package 02 Slice D. Reclaims customer_carts rows past expires_at. Scheduled daily as sharmeats-expired-cart-sweep; runs as the cron job owner and is deliberately NOT executable by anon or authenticated — RLS does not constrain a definer function''s own statements, so a client-callable version would wipe every customer''s basket rather than their own. Expiry stays advisory at read time so a customer returning just after the horizon is still offered their basket (flagged stale) instead of silently losing it. Returns the row count so cron.job_run_details shows whether it did anything. Mig 170.';
