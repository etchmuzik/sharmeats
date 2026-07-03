-- 084_weekly_settlement_cron.sql
-- MEDIUM audit finding: generate_settlements is admin-button-only, so the promised
-- weekly Sunday restaurant payout never builds unless a human clicks /finance.
-- Add settlement_sweep() (runs the generation logic for the just-ended Mon–Sun
-- week WITHOUT the admin auth gate, since cron runs as postgres/owner) and
-- schedule it every Monday 03:00. The admin /finance button + generate_settlements
-- remain for ad-hoc/back-fill runs; both are idempotent (on conflict upsert,
-- never touching 'paid' rows), so a manual and a cron run for the same period are safe.

create or replace function public.settlement_sweep()
returns integer language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_start date;
  v_end   date;
  v_count int := 0;
begin
  -- Just-ended week: previous Monday .. previous Sunday (ISO week, dow: Mon=1).
  v_start := (date_trunc('week', now()) - interval '7 days')::date;   -- previous Monday
  v_end   := (date_trunc('week', now()) - interval '1 day')::date;    -- previous Sunday

  with agg as (
    select
      f.restaurant_id,
      count(*) as order_count,
      sum(f.subtotal_egp) as gross_sales,
      sum(f.subtotal_egp) filter (where f.payment_method='cash_on_delivery') as cod_sales,
      sum(f.subtotal_egp) filter (where f.payment_method<>'cash_on_delivery') as card_sales,
      sum(f.commission_egp) as commission,
      coalesce(sum(f.discount_egp) filter (where f.payment_method='cash_on_delivery'),0) as cod_discount
    from public.order_financials f
    where f.delivered_at::date between v_start and v_end
    group by f.restaurant_id
  )
  insert into public.restaurant_settlements (
    restaurant_id, period_start, period_end, order_count,
    gross_sales_egp, cod_sales_egp, card_sales_egp, commission_egp, net_payable_egp, status
  )
  select
    a.restaurant_id, v_start, v_end, a.order_count,
    a.gross_sales, coalesce(a.cod_sales,0), coalesce(a.card_sales,0), a.commission,
    coalesce(a.card_sales,0) - a.commission + a.cod_discount,
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

revoke all on function public.settlement_sweep() from public, anon, authenticated;

-- Every Monday 03:00 UTC — statements for the just-ended Mon–Sun week are ready
-- for the admin to finalize + pay.
select cron.schedule('sharmeats-weekly-settlement', '0 3 * * 1', $$select public.settlement_sweep();$$);
