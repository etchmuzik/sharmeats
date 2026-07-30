-- 184_marketplace_integrity_and_food_safety.sql
--
-- Package 06: the two pre-launch guardrails the spec requires and recon found
-- absent (2026-07-30): the WEEKLY fair-marketplace integrity report (nothing
-- watched the own-brand invariants; ranking_integrity_audit is an on-demand
-- view no app reads) and URGENT food-safety escalation ('urgent' was legal in
-- the priority CHECK but unreachable — no code path set it, nothing paged).
--
-- Applied while prod has ZERO own-brand rows, deliberately: the sweep proves
-- the invariants hold from day one and alerts the week anything drifts, and
-- the paging path exists BEFORE the first kitchen serves food.

-- ============ 1. Food safety: reachable urgency + paging ============
-- The live constraint is named support_cases_reason_chk (mig 151); both names
-- dropped defensively.
alter table public.support_cases drop constraint if exists support_cases_reason_chk;
alter table public.support_cases drop constraint if exists support_cases_reason_code_check;
alter table public.support_cases add constraint support_cases_reason_chk
  check (reason_code in ('order_late','order_wrong','order_missing_items','food_quality',
                         'food_safety','payment','refund','driver','app_issue','account','other'));

-- Body taken from the CURRENT prod definition (house rule 2) with exactly two
-- deltas: 'food_safety' accepted, and mapped to priority 'urgent'.
CREATE OR REPLACE FUNCTION public.open_support_case(p_reason_code text, p_order_id uuid DEFAULT NULL::uuid, p_message text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_fr_mins int;
  v_res_mins int;
  v_existing uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;
  if p_reason_code is null or p_reason_code not in
     ('order_late','order_wrong','order_missing_items','food_quality','food_safety',
      'payment','refund','driver','app_issue','account','other') then
    raise exception 'INVALID_REASON' using errcode = 'check_violation';
  end if;
  -- An order id must belong to the CALLER. Without this check a customer could
  -- attach their case to a stranger's order and pull it into the operator view
  -- beside that order's details.
  if p_order_id is not null and not exists (
    select 1 from public.orders o where o.id = p_order_id and o.user_id = v_uid
  ) then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'check_violation';
  end if;

  -- One live case at a time per customer: a second "my order is late" while the
  -- first is still open splits the conversation and doubles the queue.
  select id into v_existing from public.support_cases
   where customer_id = v_uid and status in ('open','waiting_customer','waiting_ops')
   order by opened_at desc limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  select coalesce((value #>> '{}')::int, 60) into v_fr_mins
    from public.platform_settings where key = 'support_first_response_minutes';
  select coalesce((value #>> '{}')::int, 1440) into v_res_mins
    from public.platform_settings where key = 'support_resolution_minutes';

  insert into public.support_cases
    (customer_id, order_id, reason_code, first_response_due_at, resolution_due_at,
     priority)
  values
    (v_uid, p_order_id, p_reason_code,
     now() + make_interval(mins => coalesce(v_fr_mins, 60)),
     now() + make_interval(mins => coalesce(v_res_mins, 1440)),
     -- Money problems outrank everything else by default: a missing refund is
     -- not the same class of problem as a late meal.
     -- [mig 184] food_safety outranks even money: it pages the owner via the
     -- support_cases_urgent_page trigger and follows the incident procedure.
     case when p_reason_code = 'food_safety' then 'urgent'
          when p_reason_code in ('payment','refund') then 'high' else 'normal' end)
  returning id into v_id;

  insert into public.support_case_events (case_id, event, actor_id, metadata)
  values (v_id, 'opened', v_uid, jsonb_build_object('reason_code', p_reason_code));

  if p_message is not null and length(btrim(p_message)) > 0 then
    insert into public.support_messages (user_id, from_support, author_id, body, case_id)
    values (v_uid, false, v_uid, btrim(p_message), v_id);
    update public.support_cases set last_message_at = now() where id = v_id;
  end if;

  return v_id;
end;
$function$;

-- Grants unchanged by CREATE OR REPLACE, but restated per house rule 3.
revoke all on function public.open_support_case(text, uuid, text) from public, anon;
grant execute on function public.open_support_case(text, uuid, text) to authenticated;

create or replace function public.support_cases_urgent_page()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $fn$
begin
  -- Page immediately; NEVER block case creation on the pager. A failed alert
  -- logs a warning — the case itself is the evidence trail.
  begin
    perform public.ops_alert(
      'URGENT SUPPORT CASE (' || new.reason_code || '): case ' || new.id
      || coalesce(', order ' || new.order_id, '')
      || '. Food-safety procedure: freeze the affected item/brand, preserve evidence, explicit closure required.');
  exception when others then
    raise warning 'urgent-case paging failed: %', sqlerrm;
  end;
  return new;
end;
$fn$;
revoke all on function public.support_cases_urgent_page() from public, anon, authenticated;

drop trigger if exists support_cases_urgent_page on public.support_cases;
create trigger support_cases_urgent_page
  after insert on public.support_cases
  for each row when (new.priority = 'urgent')
  execute function public.support_cases_urgent_page();

-- ============ 2. Weekly marketplace integrity ============
create or replace function public.marketplace_integrity_findings()
returns table (check_name text, entity_id uuid, detail text)
language sql stable
security definer set search_path = public, pg_temp
as $fn$
  -- Belt over the CHECK constraint: if it is ever dropped/invalidated, this
  -- still sees a featured own brand.
  select 'featured_own_brand'::text, r.id,
         r.name || ' is own-brand AND featured — the ranking promise is broken'
    from public.restaurants r
   where r.merchant_type = 'own_brand' and coalesce(r.featured, false)
  union all
  select 'own_brand_settlement', s.id,
         'settlement row for own brand ' || r.name || ' (' || s.status || ') — third-party settlement must never include an own brand'
    from public.restaurant_settlements s
    join public.restaurants r on r.id = s.restaurant_id
   where r.merchant_type = 'own_brand'
  union all
  select 'commission_sentinel_drift', r.id,
         r.name || ' is own-brand with commission_pct=' || r.commission_pct
         || ' — the 100.00 sentinel keeps take-rate arithmetic honest'
    from public.restaurants r
   where r.merchant_type = 'own_brand' and r.commission_pct is distinct from 100.00
$fn$;
revoke all on function public.marketplace_integrity_findings() from public, anon, authenticated;

create or replace function public.marketplace_integrity_report()
returns table (check_name text, entity_id uuid, detail text)
language plpgsql stable
security definer set search_path = public, pg_temp
as $fn$
begin
  if auth.uid() is null or coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  return query
  select * from public.marketplace_integrity_findings()
  union all
  select 'own_brand_share_7d'::text, null::uuid,
         'own-brand delivered-order share last 7d: '
         || coalesce(round(100.0 * count(*) filter (where r.merchant_type = 'own_brand')
                     / nullif(count(*), 0), 1)::text, '0') || '% of ' || count(*) || ' orders'
    from public.order_financials f
    join public.restaurants r on r.id = f.restaurant_id
   where f.delivered_at >= now() - interval '7 days';
end;
$fn$;
revoke all on function public.marketplace_integrity_report() from public, anon;
grant execute on function public.marketplace_integrity_report() to authenticated;

comment on function public.marketplace_integrity_report() is
  'ADMIN ONLY: fair-marketplace invariants (featured own brands, own-brand settlement rows, commission sentinel drift) plus the 7-day own-brand share. Violations of any invariant row mean the ranking/settlement promise is broken. Mig 184.';

create or replace function public.marketplace_integrity_sweep()
returns integer
language plpgsql
security definer set search_path = public, pg_temp
as $fn$
declare v_n int; v_line text;
begin
  select count(*)::int, string_agg(distinct check_name, ', ')
    into v_n, v_line from public.marketplace_integrity_findings();
  if coalesce(v_n, 0) > 0 then
    perform public.ops_alert(
      'MARKETPLACE INTEGRITY: ' || v_n || ' violation(s) — ' || v_line
      || '. Details: marketplace_integrity_report() as admin. The fairness promise is load-bearing for merchant trust.');
  end if;
  return coalesce(v_n, 0);
end;
$fn$;
revoke all on function public.marketplace_integrity_sweep() from public, anon, authenticated;

comment on function public.marketplace_integrity_sweep() is
  'Weekly fair-marketplace check (cron sharmeats-marketplace-integrity, Mon 04:30): one aggregated ops_alert when any own-brand invariant is violated; silent when clean. Returns the violation count for cron.job_run_details. Mig 184.';

do $do$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule(
      'sharmeats-marketplace-integrity',
      '30 4 * * 1',
      $job$select public.marketplace_integrity_sweep();$job$);
  end if;
end;
$do$;
