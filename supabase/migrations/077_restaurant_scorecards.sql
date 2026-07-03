-- 077_restaurant_scorecards.sql
-- Restaurant performance scorecards (P1 from the 2026-07-03 gap analysis).
-- Supply quality is unmanageable without measurement. This computes, per
-- restaurant over a rolling window, the metrics that tell you which kitchens
-- blow their prep window, reject orders, or drag their rating down:
--   * orders (total in window)
--   * acceptance_rate  — accepted / (accepted + rejected)
--   * reject_rate      — rejected / total
--   * cancel_rate      — cancelled / total
--   * avg_prep_minutes — mean(ready_at - accepted_at) from order_status_events
--   * on_time_rate     — delivered on/before eta_at / delivered
--   * avg_food_rating  — mean(rating_food) where rated
--
-- Read-only, admin (all restaurants) or merchant (own). No new tables — pure
-- aggregation over orders + order_status_events. Non-destructive.

-- ============================================================================
-- restaurant_scorecard(restaurant_id, days) — one restaurant's metrics.
-- ============================================================================
create or replace function public.restaurant_scorecard(p_restaurant_id uuid, p_days int default 30)
returns table (
  restaurant_id     uuid,
  window_days       int,
  orders            int,
  accepted          int,
  rejected          int,
  cancelled          int,
  delivered         int,
  acceptance_rate   numeric,
  reject_rate       numeric,
  cancel_rate       numeric,
  on_time_rate      numeric,
  avg_prep_minutes  numeric,
  avg_food_rating   numeric
)
language plpgsql
stable
security definer set search_path = public, pg_temp
as $$
declare v_since timestamptz := now() - make_interval(days => greatest(1, coalesce(p_days,30)));
begin
  -- Authorization: admin sees any restaurant; a merchant only their own.
  if not (public.auth_role() = 'admin' or public.is_merchant_staff(p_restaurant_id)) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;

  return query
  with o as (
    select * from public.orders
     where orders.restaurant_id = p_restaurant_id and placed_at >= v_since
  ),
  -- Per-order accept/ready timestamps from the event log, for prep timing.
  ev as (
    select e.order_id,
           min(e.created_at) filter (where e.status = 'accepted') as accepted_at,
           min(e.created_at) filter (where e.status = 'ready')    as ready_at
      from public.order_status_events e
      join o on o.id = e.order_id
     group by e.order_id
  )
  select
    p_restaurant_id,
    greatest(1, coalesce(p_days,30)),
    count(*)::int,
    count(*) filter (where o.status not in ('placed','rejected'))::int,   -- accepted-or-beyond
    count(*) filter (where o.status = 'rejected')::int,
    count(*) filter (where o.status = 'cancelled')::int,
    count(*) filter (where o.status = 'delivered')::int,
    -- acceptance = accepted / (accepted + rejected); null-safe
    round(
      count(*) filter (where o.status not in ('placed','rejected'))::numeric
      / nullif(count(*) filter (where o.status not in ('placed','rejected'))
               + count(*) filter (where o.status = 'rejected'), 0), 3),
    round(count(*) filter (where o.status = 'rejected')::numeric / nullif(count(*),0), 3),
    round(count(*) filter (where o.status = 'cancelled')::numeric / nullif(count(*),0), 3),
    round(
      count(*) filter (where o.status = 'delivered' and o.delivered_at is not null and o.delivered_at <= o.eta_at)::numeric
      / nullif(count(*) filter (where o.status = 'delivered'),0), 3),
    round(avg(extract(epoch from (ev.ready_at - ev.accepted_at)) / 60.0)
          filter (where ev.ready_at is not null and ev.accepted_at is not null), 1),
    round(avg(o.rating_food) filter (where o.rating_food is not null), 2)
  from o
  left join ev on ev.order_id = o.id;
end;
$$;
revoke all on function public.restaurant_scorecard(uuid, int) from public, anon;
grant execute on function public.restaurant_scorecard(uuid, int) to authenticated;

comment on function public.restaurant_scorecard is
  'Per-restaurant performance metrics over a rolling window (default 30d): acceptance/reject/cancel rates, on-time rate, avg prep minutes, avg food rating. Admin (any) or merchant (own). Read-only aggregation over orders + order_status_events.';

-- ============================================================================
-- all_restaurant_scorecards(days) — ADMIN: the whole fleet, worst first, so ops
-- can spot the problem kitchens. Reuses restaurant_scorecard per restaurant.
-- ============================================================================
create or replace function public.all_restaurant_scorecards(p_days int default 30)
returns table (
  restaurant_id    uuid,
  restaurant_name  text,
  orders           int,
  acceptance_rate  numeric,
  reject_rate      numeric,
  cancel_rate      numeric,
  on_time_rate     numeric,
  avg_prep_minutes numeric,
  avg_food_rating  numeric
)
language plpgsql
stable
security definer set search_path = public, pg_temp
as $$
begin
  if coalesce(public.auth_role()::text,'') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;

  return query
  select r.id, r.name,
         sc.orders, sc.acceptance_rate, sc.reject_rate, sc.cancel_rate,
         sc.on_time_rate, sc.avg_prep_minutes, sc.avg_food_rating
    from public.restaurants r
    cross join lateral public.restaurant_scorecard(r.id, p_days) sc
   where r.is_active
     and sc.orders > 0
   order by sc.avg_food_rating asc nulls first, sc.reject_rate desc;
end;
$$;
revoke all on function public.all_restaurant_scorecards(int) from public, anon;
grant execute on function public.all_restaurant_scorecards(int) to authenticated;

comment on function public.all_restaurant_scorecards is
  'ADMIN: fleet-wide restaurant scorecards over a rolling window, worst first (lowest food rating, then highest reject rate). For spotting problem kitchens.';
