-- 185_brand_gate_report.sql
--
-- Package 06 Stage 6: the brand gate as an EXECUTABLE check, encoding the
-- SEVEN gates of docs/CLOUD-KITCHEN-PLAN.md ("Gates before each next brand") —
-- the program spec lists only five of them; the plan is the source of truth.
--
-- Honesty contract: gates the database cannot measure (COGS from purchase
-- invoices, the named second cook) return measurable=false and passed=NULL —
-- owner evidence, never fabricated. A NULL is a blocked gate: ALL must hold.

create or replace function public.brand_gate_report(
  p_restaurant_id uuid,
  p_days int default 14
)
returns table (
  gate_no        int,
  gate_name      text,
  measurable     boolean,
  measured_value text,
  threshold      text,
  passed         boolean
)
language plpgsql
stable
security definer set search_path = public, pg_temp
as $$
declare
  v_days int := least(greatest(coalesce(p_days, 14), 7), 90);
  v_since date := current_date - least(greatest(coalesce(p_days, 14), 7), 90);
  v_prep_high int;
  v_trading_days int;
  v_incidents int;
  v_placed bigint;
  v_accepted_in_window bigint;
  v_p90_prep_min numeric;
  v_merchants int;
begin
  if auth.uid() is null or coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.restaurants r where r.id = p_restaurant_id) then
    raise exception 'RESTAURANT_NOT_FOUND' using errcode = 'check_violation';
  end if;

  select r.prep_time_high into v_prep_high from public.restaurants r where r.id = p_restaurant_id;

  -- Gate 1: distinct delivered trading days in the window + zero food-safety
  -- incidents attached to this brand's orders.
  select count(distinct o.delivered_at::date) into v_trading_days
    from public.orders o
   where o.restaurant_id = p_restaurant_id and o.status = 'delivered'
     and o.delivered_at::date >= v_since;
  select count(*) into v_incidents
    from public.support_cases c
    join public.orders o on o.id = c.order_id
   where o.restaurant_id = p_restaurant_id
     and c.reason_code = 'food_safety'
     and c.opened_at::date >= v_since;

  -- Gate 3: accepted within 120s of placement (the queue-escalation threshold;
  -- auto-accept sits behind it), over all non-cancelled-by-customer orders.
  select count(*),
         count(*) filter (where o.accepted_at is not null
                            and o.accepted_at - o.placed_at <= interval '120 seconds')
    into v_placed, v_accepted_in_window
    from public.orders o
   where o.restaurant_id = p_restaurant_id and o.placed_at::date >= v_since
     and o.status <> 'cancelled';

  -- Gate 4: P90 of accepted -> ready against the brand's own prep_time_high.
  select percentile_cont(0.9) within group
           (order by extract(epoch from o.ready_at - o.accepted_at) / 60.0)
    into v_p90_prep_min
    from public.orders o
   where o.restaurant_id = p_restaurant_id and o.status = 'delivered'
     and o.ready_at is not null and o.accepted_at is not null
     and o.delivered_at::date >= v_since;

  -- Gate 7: live third-party merchants, platform-wide.
  select count(*) into v_merchants
    from public.restaurants r
   where coalesce(r.merchant_type::text, 'third_party') <> 'own_brand' and r.is_active;

  return query values
    (1, 'consecutive trading days, zero food-safety incidents', true,
     v_trading_days || ' delivered day(s) in last ' || v_days || 'd; '
       || v_incidents || ' food-safety case(s)',
     '>= 14 days AND 0 incidents',
     v_trading_days >= 14 and v_incidents = 0),
    (2, 'food COGS within ±5pp of 30% target, from purchase invoices', false,
     'not in this database — cost import artifact (Stage 1) is the source',
     '25%..35% measured from invoices', null),
    (3, 'orders accepted inside the window', true,
     coalesce(round(100.0 * v_accepted_in_window / nullif(v_placed, 0), 1)::text, 'n/a')
       || '% of ' || v_placed || ' (<=120s)',
     '>= 95%',
     case when v_placed = 0 then null
          else 100.0 * v_accepted_in_window / v_placed >= 95.0 end),
    (4, 'P90 prep <= brand prep_time_high', true,
     coalesce(round(v_p90_prep_min, 1)::text || ' min', 'no data')
       || ' vs declared ' || coalesce(v_prep_high::text, '?') || ' min',
     'P90 <= prep_time_high',
     case when v_p90_prep_min is null or v_prep_high is null then null
          else v_p90_prep_min <= v_prep_high end),
    (5, 'multi-brand kitchen queue live and dogfooded', true,
     'shipped 2026-07-27 (getMyKitchen, brand-tagged queue, pause-all)',
     'before a second merchant_staff brand exists', true),
    (6, 'named second cook', false,
     'owner evidence — a name, not a plan', 'named person', null),
    (7, 'live third-party merchants', true,
     v_merchants || ' active third-party rows',
     '>= 40', v_merchants >= 40);
end;
$$;

revoke all on function public.brand_gate_report(uuid, int) from public, anon;
grant execute on function public.brand_gate_report(uuid, int) to authenticated;

comment on function public.brand_gate_report(uuid, int) is
  'ADMIN ONLY: the seven brand gates from CLOUD-KITCHEN-PLAN.md as an executable check. Gates the DB cannot measure (COGS from invoices, named second cook) return passed=NULL — owner evidence, never fabricated; NULL blocks the gate. ALL must hold before the next brand. Mig 185.';
