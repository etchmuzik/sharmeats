-- 125_founding_rate_expiry.sql
--
-- Founding-cohort commission expiry tracking.
--
-- WHY: docs/restaurant-loi.md gives the founding cohort 12% for "the first 3
-- months from your go-live date", after which the standard 15% applies
-- (docs/FINANCIALS.md). Nothing in the schema recorded when that window ends —
-- there is no go-live timestamp at all (only created_at/updated_at, and
-- updated_at is churned by unrelated edits). Without an explicit date the
-- expiry can only be guessed, so a "who is still on 12%" report would print
-- authoritative-looking but wrong dates. This adds the date as real, auditable
-- data instead.
--
-- BACKFILL: deliberately NONE. Every restaurant currently in prod is seed/demo
-- data from platform testing, not a real merchant, so any backfilled date would
-- be fiction. Existing rows keep founding_rate_until = NULL and the admin report
-- shows them as "not set" rather than inventing an expiry. Real go-live dates
-- are set by an admin (set_founding_rate_until) or stamped automatically for
-- self-onboarded restaurants at approval time.
--
-- The rate itself is NEVER changed automatically by this migration or by any
-- cron: expiry is surfaced to a human who applies it via the existing
-- admin_set_commission RPC. Changing a merchant's commercial terms without a
-- person deciding would be a surprise mid-week rate change.
--
-- Forward-only, idempotent. Rollback: drop the column + the two functions.

-- ---------------------------------------------------------------------------
-- 1) Schema
-- ---------------------------------------------------------------------------
alter table public.restaurants
  add column if not exists founding_rate_until date;

comment on column public.restaurants.founding_rate_until is
  'Date the founding-cohort commission rate stops applying (LOI: 3 months from go-live). NULL = no founding window recorded (standard rate, or a legacy/seed row). Written only by approve_restaurant and set_founding_rate_until; never auto-applied to commission_pct.';

-- Partial index: the admin report only ever scans rows that HAVE a window.
create index if not exists restaurants_founding_expiry_idx
  on public.restaurants (founding_rate_until)
  where founding_rate_until is not null;

-- ---------------------------------------------------------------------------
-- 2) admin_set_founding_rate_until — set/clear the window for one restaurant.
-- Admin-only, fail-closed, same house pattern as admin_set_commission (123).
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_founding_rate_until(
  p_restaurant_id uuid,
  p_until         date
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;
  if coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  -- A far-future date is almost certainly a typo (e.g. year 20260 instead of 2026).
  if p_until is not null and p_until > (current_date + interval '2 years')::date then
    raise exception 'INVALID_DATE' using errcode = 'check_violation';
  end if;

  update public.restaurants
     set founding_rate_until = p_until,
         updated_at = now()
   where id = p_restaurant_id;
  if not found then
    raise exception 'RESTAURANT_NOT_FOUND' using errcode = 'check_violation';
  end if;
end;
$function$;

revoke all on function public.admin_set_founding_rate_until(uuid, date) from public, anon;
grant execute on function public.admin_set_founding_rate_until(uuid, date) to authenticated;

comment on function public.admin_set_founding_rate_until is
  'ADMIN: set (or clear, with NULL) a restaurant''s founding-rate expiry date. Reporting only — does not touch commission_pct. Mig 125.';

-- ---------------------------------------------------------------------------
-- 3) founding_rate_report — the admin report, computed server-side.
-- Returns every restaurant that is BELOW the standard rate or has a window
-- recorded, with a status the UI renders directly. Admin-only.
-- ---------------------------------------------------------------------------
create or replace function public.founding_rate_report()
returns table (
  restaurant_id   uuid,
  name            text,
  zone            text,
  is_active       boolean,
  commission_pct  numeric,
  founding_rate_until date,
  days_remaining  int,
  status          text,
  delivered_orders bigint,
  food_egp_30d    bigint,
  forgone_egp_30d bigint
)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_standard numeric := 15.0;  -- docs/FINANCIALS.md standard commission
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;
  if coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;

  return query
  with agg as (
    select o.restaurant_id,
           count(*) filter (where o.status = 'delivered') as delivered,
           -- Commission is charged on the food subtotal (docs/FINANCIALS.md),
           -- i.e. orders.subtotal_egp — never on delivery fees or tips.
           coalesce(sum(o.subtotal_egp) filter (
             where o.status = 'delivered' and o.placed_at >= now() - interval '30 days'
           ), 0)::bigint as food_30d
      from public.orders o
     group by o.restaurant_id
  )
  select r.id,
         r.name,
         r.zone::text,
         r.is_active,
         r.commission_pct,
         r.founding_rate_until,
         case when r.founding_rate_until is null then null
              else (r.founding_rate_until - current_date) end as days_remaining,
         case
           when r.commission_pct >= v_standard then 'standard'
           when r.founding_rate_until is null then 'no_expiry_set'
           when r.founding_rate_until < current_date then 'expired'
           when r.founding_rate_until <= (current_date + 30) then 'expiring_soon'
           else 'active'
         end as status,
         coalesce(a.delivered, 0)::bigint,
         coalesce(a.food_30d, 0)::bigint,
         -- What the reduced rate costs per 30 days, at the current food volume.
         (coalesce(a.food_30d, 0) * greatest(v_standard - r.commission_pct, 0) / 100)::bigint
    from public.restaurants r
    left join agg a on a.restaurant_id = r.id
   where r.commission_pct < v_standard
      or r.founding_rate_until is not null
   order by
     case
       when r.commission_pct >= v_standard then 4
       when r.founding_rate_until is null then 3
       when r.founding_rate_until < current_date then 0
       when r.founding_rate_until <= (current_date + 30) then 1
       else 2
     end,
     r.founding_rate_until nulls last,
     r.name;
end;
$function$;

revoke all on function public.founding_rate_report() from public, anon;
grant execute on function public.founding_rate_report() to authenticated;

comment on function public.founding_rate_report is
  'ADMIN: founding-cohort commission report — who is below the 15% standard, when their window ends, and what the discount costs per 30 days. Read-only. Mig 125.';

-- ---------------------------------------------------------------------------
-- 4) Self-onboarded restaurants get their window stamped at APPROVAL time
-- (that is their real go-live). Body is migration 123's approve_restaurant
-- verbatim, with only the founding-window stamp added to the approve branch.
-- ---------------------------------------------------------------------------
create or replace function public.approve_restaurant(
  p_restaurant_id uuid,
  p_decision      text,
  p_reason        text default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_docs int;
  v_items int;
  v_name text;
  v_founding_months int;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;
  if coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;

  select name into v_name from public.restaurants
   where id = p_restaurant_id and onboarding_status in ('submitted','rejected');
  if v_name is null then
    raise exception 'RESTAURANT_NOT_FOUND' using errcode = 'check_violation';
  end if;

  if p_decision = 'approve' then
    -- 3 required doc types, each with an approved document (mig 075 trail).
    select count(distinct doc_type) into v_docs
      from public.kyc_documents
     where subject_type = 'restaurant' and subject_id = p_restaurant_id
       and status = 'approved'
       and doc_type in ('commercial_reg','tax_card','food_license');
    if v_docs < 3 then
      raise exception 'KYC_INCOMPLETE' using errcode = 'check_violation';
    end if;

    select count(*) into v_items
      from public.menu_items where restaurant_id = p_restaurant_id;
    if v_items < 1 then
      raise exception 'MENU_EMPTY' using errcode = 'check_violation';
    end if;

    -- [125] Approval IS go-live for a self-onboarded restaurant. If it is being
    -- approved on a below-standard rate and no window was set by hand, stamp the
    -- LOI's 3 months from today so the discount cannot run forever unnoticed.
    select coalesce((value #>> '{}')::int, 3) into v_founding_months
      from public.platform_settings where key = 'founding_rate_months';

    update public.restaurants
       set onboarding_status = 'approved',
           is_active = true,
           -- is_open stays as-is (false from apply): the merchant opens when ready.
           onboarding_rejection_reason = null,
           founding_rate_until = case
             when founding_rate_until is not null then founding_rate_until
             when commission_pct < 15.0 then
               (current_date + (coalesce(v_founding_months, 3) || ' months')::interval)::date
             else null
           end,
           updated_at = now()
     where id = p_restaurant_id;

    begin
      perform public.ops_alert('✅ Restaurant approved & live (closed until owner opens): ' || v_name);
    exception when others then null;
    end;

  elsif p_decision = 'reject' then
    if p_reason is null or btrim(p_reason) = '' then
      raise exception 'REASON_REQUIRED' using errcode = 'check_violation';
    end if;
    update public.restaurants
       set onboarding_status = 'rejected',
           is_active = false,
           onboarding_rejection_reason = btrim(p_reason),
           updated_at = now()
     where id = p_restaurant_id;

    begin
      perform public.ops_alert('❌ Restaurant application rejected: ' || v_name);
    exception when others then null;
    end;

  else
    raise exception 'INVALID_DECISION' using errcode = 'check_violation';
  end if;
end;
$function$;

revoke all on function public.approve_restaurant(uuid, text, text) from public, anon;
grant execute on function public.approve_restaurant(uuid, text, text) to authenticated;

comment on function public.approve_restaurant is
  'ADMIN: approve (requires 3 approved KYC docs + >=1 menu item — verified here, not in the UI) or reject (reason required) a submitted restaurant. Sole writer of onboarding_status. Stamps founding_rate_until on approval when the rate is below standard. Migs 123, 125.';

-- Tunable window length; default 3 months per the LOI.
insert into public.platform_settings (key, value)
values ('founding_rate_months', '3'::jsonb)
on conflict (key) do nothing;
