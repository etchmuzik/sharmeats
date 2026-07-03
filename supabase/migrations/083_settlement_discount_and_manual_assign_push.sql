-- 083_settlement_discount_and_manual_assign_push.sql
-- Two more audit findings:
--   H3 (financial): settlement over-charges restaurants for platform-funded
--       discounts on COD orders. order_financials snapshots only GROSS subtotal;
--       on COD the driver collects the DISCOUNTED total, so cash reaching the
--       restaurant = subtotal - discount, yet settlement books gross subtotal as
--       cash held AND charges commission on gross. The restaurant is over-billed
--       by the full discount on every discounted COD order. Fix: snapshot the
--       discount, and on COD credit the platform-funded discount back into
--       net_payable (the platform funded it, so it owes the restaurant that cash).
--   H4 (notifications): manual dispatcher assign_driver sends NO new_offer push,
--       so a manually-assigned driver isn't notified — exactly the recovery path
--       used when auto-dispatch fails. Add the same push block auto_assign_order uses.
--
-- Zero live exposure today (0 order_financials rows, 0 settlements), so this is a
-- correctness fix ahead of first real settlement, not a data repair.
-- Worked example (audit's): COD subtotal 300, discount 50, commission 15% (=45).
--   old net_payable = card(0) - commission(45)            = -45  (restaurant "owes" 45)
--   new net_payable = card(0) - commission(45) + cod_disc(50) = +5 (correct)

-- H3a: snapshot the discount at delivery.
alter table public.order_financials add column if not exists discount_egp int not null default 0;

create or replace function public.snapshot_order_financials()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_rate numeric(5,2); v_vat_pct int; v_commission int; v_grace int;
  v_pct int; v_max int; v_late_min numeric; v_credit int;
begin
  if new.status <> 'delivered' or old.status = 'delivered' then return new; end if;

  select commission_pct into v_rate from public.restaurants where id = new.restaurant_id;
  v_rate := coalesce(v_rate, 12.0);
  v_commission := floor(coalesce(new.subtotal_egp, 0) * v_rate / 100.0)::int;
  select coalesce((value #>> '{}')::int, 0) into v_vat_pct from public.platform_settings where key = 'commission_vat_pct';

  insert into public.order_financials (
    order_id, restaurant_id, subtotal_egp, discount_egp, commission_pct, commission_egp,
    commission_vat_egp, delivery_fee_egp, payment_method, delivered_at
  ) values (
    new.id, new.restaurant_id, coalesce(new.subtotal_egp, 0), coalesce(new.discount_egp, 0),
    v_rate, v_commission,
    floor(v_commission * coalesce(v_vat_pct,0) / 100.0)::int,
    coalesce(new.delivery_fee_egp, 0), new.payment_method,
    coalesce(new.delivered_at, now())
  ) on conflict (order_id) do nothing;

  select coalesce((value #>> '{}')::int, 15)  into v_grace from public.platform_settings where key = 'sla_credit_grace_minutes';
  select coalesce((value #>> '{}')::int, 10)  into v_pct   from public.platform_settings where key = 'sla_credit_pct';
  select coalesce((value #>> '{}')::int, 100) into v_max   from public.platform_settings where key = 'sla_credit_max_egp';

  v_late_min := extract(epoch from (coalesce(new.delivered_at, now()) - new.eta_at)) / 60.0;
  if v_late_min > v_grace then
    v_credit := least(v_max, floor(coalesce(new.subtotal_egp, 0) * v_pct / 100.0)::int);
    if v_credit > 0 then
      begin
        perform public.issue_credit(new.user_id, v_credit, 'sla_late', new.id,
          'Auto late credit: ' || round(v_late_min)::text || ' min late');
      exception when unique_violation then null;
      end;
    end if;
  end if;
  return new;
exception when others then
  return new;
end; $function$;

-- H3b: settlement math — credit platform-funded discounts back on COD.
create or replace function public.generate_settlements(p_period_start date, p_period_end date)
returns integer language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_count int := 0;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='check_violation'; end if;
  if coalesce(public.auth_role()::text,'') <> 'admin' then raise exception 'NOT_AUTHORIZED' using errcode='check_violation'; end if;
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'INVALID_PERIOD' using errcode='check_violation';
  end if;

  with agg as (
    select
      f.restaurant_id,
      count(*) as order_count,
      sum(f.subtotal_egp) as gross_sales,
      sum(f.subtotal_egp) filter (where f.payment_method='cash_on_delivery') as cod_sales,
      sum(f.subtotal_egp) filter (where f.payment_method<>'cash_on_delivery') as card_sales,
      sum(f.commission_egp) as commission,
      -- [083] platform-funded discount on COD orders that the restaurant did not
      -- receive in cash; the platform reimburses it.
      coalesce(sum(f.discount_egp) filter (where f.payment_method='cash_on_delivery'),0) as cod_discount
    from public.order_financials f
    where f.delivered_at::date between p_period_start and p_period_end
    group by f.restaurant_id
  )
  insert into public.restaurant_settlements (
    restaurant_id, period_start, period_end, order_count,
    gross_sales_egp, cod_sales_egp, card_sales_egp, commission_egp, net_payable_egp, status
  )
  select
    a.restaurant_id, p_period_start, p_period_end, a.order_count,
    a.gross_sales, coalesce(a.cod_sales,0), coalesce(a.card_sales,0), a.commission,
    coalesce(a.card_sales,0) - a.commission + a.cod_discount,  -- [083] + reimbursed COD discount
    'draft'
  from agg a
  on conflict (restaurant_id, period_start, period_end) do update set
    order_count     = excluded.order_count,
    gross_sales_egp = excluded.gross_sales_egp,
    cod_sales_egp   = excluded.cod_sales_egp,
    card_sales_egp  = excluded.card_sales_egp,
    commission_egp  = excluded.commission_egp,
    net_payable_egp = excluded.net_payable_egp,
    updated_at      = now()
  where public.restaurant_settlements.status <> 'paid';

  get diagnostics v_count = row_count;
  return v_count;
end; $function$;

-- H4: manual assign_driver now pushes the new_offer to the driver (parity with
-- auto_assign_order). Body = mig 081 assign_driver plus the best-effort push.
create or replace function public.assign_driver(p_order_id uuid, p_driver_id uuid)
returns void language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_role app_role := public.auth_role(); v_user uuid := auth.uid();
  v_prof uuid; v_base text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode='check_violation'; end if;
  if coalesce(v_role::text,'') not in ('admin','dispatcher') then raise exception 'NOT_AUTHORIZED' using errcode='check_violation'; end if;
  if not exists (select 1 from public.drivers where id=p_driver_id and is_active and is_verified and status<>'offline') then
    raise exception 'DRIVER_NOT_ELIGIBLE: driver must be active, verified and online' using errcode='check_violation'; end if;

  update public.order_assignments set status='reassigned', responded_at=now() where order_id=p_order_id and status in ('offered','accepted');
  insert into public.order_assignments (order_id, driver_id, status, assigned_by, assigned_by_id) values (p_order_id,p_driver_id,'offered','dispatcher',v_user);
  update public.orders set assigned_driver_id=p_driver_id, rider=public.rider_snapshot(p_driver_id) where id=p_order_id;

  -- [083] Notify the manually-assigned driver (was silent; recovery path when
  -- auto-dispatch fails). Best-effort; a push failure must not abort the assign.
  begin
    select profile_id into v_prof from public.drivers where id = p_driver_id;
    select value #>> '{}' into v_base from public.platform_settings where key='functions_base_url';
    if v_prof is not null and v_base is not null and v_base <> '' then
      perform net.http_post(
        url := v_base || '/expo-push',
        body := jsonb_build_object('event','new_offer','orderId',p_order_id::text,'recipientUserIds',jsonb_build_array(v_prof::text)),
        headers := public.push_headers());
    end if;
  exception when others then null;
  end;
end; $function$;

revoke all on function public.assign_driver(uuid,uuid) from public, anon;
grant execute on function public.assign_driver(uuid,uuid) to authenticated;
