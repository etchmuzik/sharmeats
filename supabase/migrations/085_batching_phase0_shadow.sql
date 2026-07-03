-- 085_batching_phase0_shadow.sql
--
-- ORDER BATCHING — PHASE 0 (SHADOW / DARK). See docs/BATCHING-DESIGN.md.
--
-- Goal: measure how often two orders are ELIGIBLE to be carried together by one
-- driver, WITHOUT changing dispatch, the apps, or anything a user sees. This is
-- pure instrumentation: a cron logs candidate pairs into a shadow table so we can
-- answer "is batching worth building the UI for at Sharm's volume?" before we
-- invest in it.
--
-- Nothing here assigns, offers, or groups real orders. No app reads these
-- objects. The two tables from the design (delivery_batches / delivery_batch_stops)
-- are intentionally NOT created yet — they belong to Phase 1 (real dispatch).
--
-- SAFE BY CONSTRUCTION:
--   * batch_candidates() is read-only (SELECT only) — it never writes to orders.
--   * the shadow logger only INSERTs into its own table.
--   * all thresholds live in platform_settings so they're tunable without a deploy.

-- ---------------------------------------------------------------------------
-- Tunable thresholds (seed defaults; override via platform_settings UPDATE)
-- ---------------------------------------------------------------------------
insert into public.platform_settings (key, value) values
  ('batch_enabled',              to_jsonb(false)),  -- Phase 1 flag; unused in Phase 0
  ('batch_max_orders',           to_jsonb(2)),      -- cap per batch at launch
  ('batch_max_pickup_gap_m',     to_jsonb(400)),    -- max distance between the two pickups (m)
  ('batch_max_dropoff_gap_m',    to_jsonb(1500)),   -- max distance between the two dropoffs (m) — "on the way" proxy
  ('batch_ready_window_min',     to_jsonb(6)),      -- both orders ready within this many minutes
  ('batch_shadow_logging',       to_jsonb(true))    -- Phase 0 logging on/off
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Shadow log — one row per eligible pair the sweep observes
-- ---------------------------------------------------------------------------
create table if not exists public.batch_candidate_log (
  id             uuid primary key default gen_random_uuid(),
  observed_at    timestamptz not null default now(),
  order_a        uuid not null references public.orders(id) on delete cascade,
  order_b        uuid not null references public.orders(id) on delete cascade,
  same_restaurant boolean not null,
  pickup_gap_m   int,
  dropoff_gap_m  int,
  ready_gap_min  numeric(6,1),
  zone           text,
  -- Guard: log each unordered pair at most once (order_a < order_b enforced by the finder).
  constraint batch_candidate_log_pair_uq unique (order_a, order_b)
);

comment on table public.batch_candidate_log is
  'PHASE 0 SHADOW: eligible batch pairs observed by the sweep. Instrumentation only — no order is actually batched. See docs/BATCHING-DESIGN.md.';

alter table public.batch_candidate_log enable row level security;
-- Admin-only read (analytics). No client writes; only the SECURITY DEFINER sweep inserts.
create policy batch_candidate_log_admin_read on public.batch_candidate_log
  for select using (coalesce(public.auth_role()::text,'') = 'admin');

-- ---------------------------------------------------------------------------
-- batch_candidates() — READ-ONLY. Returns currently-eligible pairs.
-- ---------------------------------------------------------------------------
-- Eligibility (all thresholds from platform_settings):
--   * both orders active + unassigned (no driver yet) + not scheduled/at-risk
--   * both 'ready' (or ready within the ready-window)
--   * same zone
--   * pickups within batch_max_pickup_gap_m
--   * dropoffs within batch_max_dropoff_gap_m ("on the way" proxy via st_distance)
-- Returns unordered pairs with order_a < order_b (stable dedupe key).
create or replace function public.batch_candidates()
returns table (
  order_a uuid, order_b uuid, same_restaurant boolean,
  pickup_gap_m int, dropoff_gap_m int, ready_gap_min numeric, zone text
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with cfg as (
    select
      coalesce((select (value #>> '{}')::int from public.platform_settings where key='batch_max_pickup_gap_m'), 400)  as max_pickup_gap,
      coalesce((select (value #>> '{}')::int from public.platform_settings where key='batch_max_dropoff_gap_m'), 1500) as max_dropoff_gap,
      coalesce((select (value #>> '{}')::int from public.platform_settings where key='batch_ready_window_min'), 6)     as ready_window
  ),
  -- Candidate orders: active, not yet assigned to a driver, not scheduled, in a
  -- dispatch-ready state, with a known dropoff.
  cand as (
    select o.id, o.restaurant_id, o.zone::text as zone, o.dropoff_geo,
           coalesce(o.ready_at, o.placed_at) as ready_ts,
           r.geo as pickup_geo
    from public.orders o
    join public.restaurants r on r.id = o.restaurant_id
    where o.status in ('ready','preparing')
      and o.assigned_driver_id is null
      and o.scheduled_for is null
      and o.dropoff_geo is not null
  )
  select
    a.id, b.id,
    (a.restaurant_id = b.restaurant_id) as same_restaurant,
    st_distance(a.pickup_geo, b.pickup_geo)::int   as pickup_gap_m,
    st_distance(a.dropoff_geo, b.dropoff_geo)::int as dropoff_gap_m,
    round((abs(extract(epoch from (a.ready_ts - b.ready_ts))) / 60.0)::numeric, 1) as ready_gap_min,
    a.zone
  from cand a
  join cand b
    on a.id < b.id                    -- unordered pair, stable key
   and a.zone = b.zone                -- same delivery zone
  cross join cfg
  where st_distance(a.pickup_geo, b.pickup_geo)  <= cfg.max_pickup_gap
    and st_distance(a.dropoff_geo, b.dropoff_geo) <= cfg.max_dropoff_gap
    and abs(extract(epoch from (a.ready_ts - b.ready_ts))) / 60.0 <= cfg.ready_window;
$function$;

revoke all on function public.batch_candidates() from public, anon, authenticated;
grant execute on function public.batch_candidates() to postgres;
-- Admin may call it for a live "what would batch right now?" view.
grant execute on function public.batch_candidates() to authenticated;

comment on function public.batch_candidates is
  'PHASE 0: read-only. Returns order pairs currently eligible to batch (does NOT batch them). Thresholds from platform_settings.';

-- ---------------------------------------------------------------------------
-- Shadow sweep — logs new eligible pairs. Owner-only; scheduled by cron.
-- ---------------------------------------------------------------------------
create or replace function public.batch_shadow_sweep()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_n int := 0;
begin
  if not coalesce((select (value #>> '{}')::boolean from public.platform_settings where key='batch_shadow_logging'), false) then
    return 0;
  end if;

  insert into public.batch_candidate_log
    (order_a, order_b, same_restaurant, pickup_gap_m, dropoff_gap_m, ready_gap_min, zone)
  select c.order_a, c.order_b, c.same_restaurant, c.pickup_gap_m, c.dropoff_gap_m, c.ready_gap_min, c.zone
  from public.batch_candidates() c
  on conflict (order_a, order_b) do nothing;  -- each pair logged once

  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

revoke all on function public.batch_shadow_sweep() from public, anon, authenticated;
grant execute on function public.batch_shadow_sweep() to postgres;

comment on function public.batch_shadow_sweep is
  'PHASE 0: logs newly-eligible batch pairs to batch_candidate_log. Instrumentation only.';

-- Run every 2 minutes (matches the dispatch cadence). Pure logging — cheap.
select cron.schedule('sharmeats-batch-shadow', '*/2 * * * *', $$select public.batch_shadow_sweep();$$);
