-- ============================================================================
-- TRANSCRIPT OF AN ALREADY-APPLIED MIGRATION — DO NOT RE-APPLY TO PRODUCTION.
--
--   prod ledger version : 20260731222542
--   prod ledger name    : 202h_audit_f15_dispatch_churn_watchdog
--   applied to prod     : 2026-07-31 (directly, with no file in this repo)
--   reconstructed       : 2026-08-01, from
--                         supabase_migrations.schema_migrations.statements
--
-- WHY THIS FILE EXISTS. On 2026-07-31 eleven migrations were applied straight to
-- production and never committed. The repo therefore no longer described the
-- database. This file is a byte-exact copy of what production recorded, written
-- back so that (a) the repo describes production again, and (b) a fresh database
-- rebuilt by replaying supabase/migrations/ ends up in the same state.
--
-- WHAT IT IS NOT. It is not a change. Production ALREADY has everything below.
-- Do not point this at production, do not "re-run it to be sure", and do not
-- edit it to fix a defect — a later, higher-numbered migration does that. Editing
-- a transcript makes the repo lie about production a second time.
--
-- CRON NAME. This schedules 'sharmeats-dispatch-churn-watchdog'. cron.schedule
-- upserts BY NAME: a later migration scheduling the same query under a different
-- name adds a second job rather than replacing this one.
--
-- The body below this marker is reproduced verbatim, including its own original
-- header comments (which refer to a "202" file that was never committed) and its
-- own numbering claims. Those are left untouched on purpose: this records what
-- ran, not what we wish had run. Verified byte-for-byte against the prod ledger
-- (md5 2970b20e296887df10adcb796cca513e).
-- ============================================================================
-- ===== BEGIN TRANSCRIPT =====
-- 202 section F-15 — dispatch_watchdog sees the stuck shapes that actually occur.
--
-- Mig 133 counted only `accepted`/`ready` orders with assigned_driver_id IS
-- NULL. But during an offer-churn loop auto_assign_order stamps
-- assigned_driver_id at OFFER time and the sweep clears and re-stamps it inside
-- the same 20s tick, so the column is null for milliseconds and the watchdog
-- always samples a driver. Proof it misses real incidents: the order that
-- pushed a customer every minute for over a day across 3,429 offer laps was
-- found by a USER REPORT, not by this alert (mig 200's header).
--
-- Adds the two shapes mig 133 cannot see rather than replacing it.

-- The query itself, UNGATED, in the private schema. The cron watchdog below runs
-- as `postgres` (where auth_role() is NULL) and must be able to call it; putting
-- the role check in here instead would make the watchdog raise, and its
-- `exception when others then return 0` would swallow that into a permanent
-- silent "all clear" — the exact failure class F-15 exists to end.
-- `private` has no client USAGE, so this is not reachable by anon/authenticated.
create or replace function private.dispatch_stuck_rows()
returns table (
  shape       text,
  order_id    uuid,
  status      text,
  age_minutes numeric,
  detail      text
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  -- (a) Never dispatched: the original mig 133 shape.
  select 'undispatched'::text,
         o.id,
         o.status::text,
         round(extract(epoch from (now() - o.placed_at)) / 60.0, 1),
         'live order with no driver assigned'
    from public.orders o
   where o.status in ('accepted','preparing','ready')
     and o.assigned_driver_id is null
     and o.placed_at < now() - interval '10 minutes'

  union all

  -- (b) Offer churn: a driver is always stamped, so (a) never fires, but the
  -- order keeps being re-offered and never accepted.
  select 'offer_churn'::text,
         o.id,
         o.status::text,
         round(extract(epoch from (now() - o.placed_at)) / 60.0, 1),
         're-offered ' || count(a.id)::text || ' times, never accepted'
    from public.orders o
    join public.order_assignments a on a.order_id = o.id
   where o.status in ('accepted','preparing','ready')
     and o.placed_at < now() - interval '10 minutes'
     and not exists (
       select 1 from public.order_assignments acc
        where acc.order_id = o.id and acc.status = 'accepted'
     )
   group by o.id, o.status, o.placed_at
  having count(a.id) >= 3

  union all

  -- (c) A manual offer that will never expire on its own: assign_driver creates
  -- an `offered` row with no TTL sweep behind it, so a dispatcher assigning a
  -- driver who never opens the app strands the order silently.
  select 'stale_offer'::text,
         o.id,
         o.status::text,
         -- `assigned_at` is when the offer was made; order_assignments has no
         -- `offered_at` column (verified against prod before applying).
         round(extract(epoch from (now() - a.assigned_at)) / 60.0, 1),
         'offer outstanding with no response'
    from public.orders o
    join public.order_assignments a on a.order_id = o.id
   where a.status = 'offered'
     and a.assigned_at < now() - interval '15 minutes'
     and o.status in ('placed','accepted','preparing','ready');
$$;

revoke all on function private.dispatch_stuck_rows() from public, anon, authenticated;

-- The operator-facing wrapper. SECURITY DEFINER over every live order, so it is
-- role-gated in its own body: granting EXECUTE to `authenticated` without this
-- would let any signed-in customer enumerate order ids, statuses and dispatch
-- state.
create or replace function public.dispatch_stuck_report()
returns table (
  shape       text,
  order_id    uuid,
  status      text,
  age_minutes numeric,
  detail      text
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if coalesce(public.auth_role()::text, '') not in ('admin','dispatcher') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  return query select * from private.dispatch_stuck_rows();
end;
$$;

comment on function public.dispatch_stuck_report is
  'Every currently-stuck order, by shape: undispatched (mig 133''s original class), offer_churn (re-offered repeatedly, never accepted — invisible to mig 133 because auto_assign_order stamps assigned_driver_id at offer time) and stale_offer (a manual assign_driver offer with no TTL behind it). Admin/dispatcher only. Mig 202, audit F-15: the 3,429-lap churn incident was found by a user report, not by the watchdog.';

revoke all on function public.dispatch_stuck_report() from public, anon;
grant execute on function public.dispatch_stuck_report() to authenticated, service_role;

create or replace function public.dispatch_churn_watchdog()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_rows  int;
  v_body  text;
begin
  select count(*), string_agg(
           shape || ' · ' || left(order_id::text, 8) || ' · ' ||
           status || ' · ' || age_minutes::text || 'm · ' || detail,
           E'\n' order by age_minutes desc)
    into v_rows, v_body
    -- The ungated private query: this runs as `postgres` from cron, where
    -- auth_role() is NULL and the operator-facing wrapper would (correctly)
    -- refuse. See the note on private.dispatch_stuck_rows().
    from private.dispatch_stuck_rows()
   where shape in ('offer_churn','stale_offer');

  if coalesce(v_rows, 0) = 0 then return 0; end if;

  -- ops_alert takes a single text argument (mig 115/116).
  perform public.ops_alert(
    format('[dispatch] %s order(s) stuck:%s%s', v_rows, E'\n', v_body)
  );
  return v_rows;
exception when others then
  return 0;  -- an alerting failure must never break the cron runner
end;
$function$;

comment on function public.dispatch_churn_watchdog is
  'Alerts ops about the two stuck-order shapes mig 133''s watchdog cannot see. Runs alongside it rather than replacing it. Mig 202, audit F-15.';

revoke all on function public.dispatch_churn_watchdog() from public, anon, authenticated;
grant execute on function public.dispatch_churn_watchdog() to service_role;

select cron.schedule(
  'sharmeats-dispatch-churn-watchdog',
  '*/5 * * * *',
  $$select public.dispatch_churn_watchdog()$$
);
