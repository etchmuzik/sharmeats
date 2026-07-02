-- 044_loyalty_earn_clawback.sql
-- Three-sided loyalty system, part 3: earn on delivery, clawback on reversal.
--
-- Mirrors reward_referrer_on_delivery (026): an AFTER UPDATE OF status trigger
-- on orders reacts to the delivered transition. Unlike the referral reward
-- (a one-time mint), loyalty earn/clawback happen on EVERY order for EVERY
-- side (customer/driver/restaurant), so this inserts up to 3 ledger rows per
-- transition rather than minting a promo code.
--
-- Clawback: if a delivered order later moves to a non-delivered status (today
-- only 'cancelled' — orders.status has no 'refunded' state), we insert
-- mirroring negative rows so the next tier sweep (044) can demote correctly.
--
-- Concurrency: any row mutation that could double-fire on concurrent updates
-- takes a `for update` row lock first (matches reward_referrer_on_delivery's
-- pattern) to avoid double-crediting/double-clawing-back the same customer
-- balance from two orders settling at once.
--
-- Non-destructive: new functions + triggers only.

-- ============================================================================
-- accrue_loyalty_on_delivery — fires when orders.status -> 'delivered'.
-- ============================================================================
create or replace function public.accrue_loyalty_on_delivery()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_rate         int;
  v_mult         int;
  v_customer_pts int;
  v_driver_id    uuid;
begin
  if new.status <> 'delivered' or old.status = 'delivered' then return new; end if;

  select coalesce((value #>> '{}')::int, 10) into v_rate
    from public.platform_settings where key = 'loyalty_points_per_egp';

  -- Lock (or create) the customer's tier row first so the multiplier read and
  -- the ledger insert use a consistent snapshot under concurrent deliveries.
  insert into public.customer_loyalty (user_id) values (new.user_id)
    on conflict (user_id) do nothing;
  perform 1 from public.customer_loyalty where user_id = new.user_id for update;

  select case
           when tier = 'gold'   then (select coalesce((value #>> '{}')::int, 150) from public.platform_settings where key = 'loyalty_tier_multiplier_gold')
           when tier = 'silver' then (select coalesce((value #>> '{}')::int, 125) from public.platform_settings where key = 'loyalty_tier_multiplier_silver')
           else 100
         end
    into v_mult
    from public.customer_loyalty where user_id = new.user_id;

  v_customer_pts := (floor(coalesce(new.subtotal_egp,0)::numeric / greatest(v_rate,1)) * v_mult) / 100;

  if v_customer_pts > 0 then
    insert into public.loyalty_points_ledger (subject_type, subject_id, delta_points, reason, ref_order_id)
    values ('customer', new.user_id, v_customer_pts, 'order_earn', new.id);

    update public.customer_loyalty
       set points_balance = points_balance + v_customer_pts,
           updated_at = now()
     where user_id = new.user_id;
  end if;

  -- Driver: 1 ledger point per delivery (volume input to the driver tier sweep).
  if new.assigned_driver_id is not null then
    insert into public.loyalty_points_ledger (subject_type, subject_id, delta_points, reason, ref_order_id)
    values ('driver', new.assigned_driver_id, 1, 'order_earn', new.id);
  end if;

  -- Restaurant: 1 ledger point per delivered order (volume input to the tier sweep).
  insert into public.loyalty_points_ledger (subject_type, subject_id, delta_points, reason, ref_order_id)
  values ('restaurant', new.restaurant_id, 1, 'order_earn', new.id);

  return new;
exception when others then
  return new;  -- never block the delivery transition on loyalty bookkeeping
end;
$$;

revoke all on function public.accrue_loyalty_on_delivery() from public, anon, authenticated;

drop trigger if exists orders_accrue_loyalty on public.orders;
create trigger orders_accrue_loyalty
  after update of status on public.orders
  for each row execute function public.accrue_loyalty_on_delivery();

-- ============================================================================
-- clawback_loyalty_on_reversal — fires when a DELIVERED order moves away from
-- 'delivered' (today: only -> 'cancelled'). Mirrors the earn amounts as
-- negative ledger rows so the next sweep can demote tier / debit balance.
--
-- Net-outstanding scoping: an order can cycle through delivered -> cancelled
-- -> (re-accepted) -> delivered -> cancelled more than once if its status
-- flips back off 'delivered' and later returns to it (the accrual/clawback
-- guards only test the immediate old/new transition, not full order history,
-- so a second delivered transition on the same order legitimately re-fires
-- accrual and can insert a second `order_earn` row for that same
-- ref_order_id). If clawback summed *all* `order_earn` rows for the order
-- unconditionally, a second cancellation would re-claw-back points already
-- reversed by the first cancellation's clawback, over-debiting the subject.
-- Each side therefore claws back only the NET outstanding amount for this
-- order: sum(order_earn) - sum(|clawback| already issued) for that
-- (subject_type, ref_order_id) pair. This nets to the full original earn on
-- a single earn->clawback cycle (unchanged behavior) and to just the most
-- recent cycle's earn on repeated earn->clawback->earn->clawback cycles.
-- ============================================================================
create or replace function public.clawback_loyalty_on_reversal()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_customer_pts int := 0;
  v_driver_pts   int := 0;
  v_rest_pts     int := 0;
begin
  if old.status <> 'delivered' or new.status = 'delivered' then return new; end if;

  select coalesce(sum(delta_points) filter (where reason = 'order_earn'),0)
       + coalesce(sum(delta_points) filter (where reason = 'clawback'),0)
    into v_customer_pts
    from public.loyalty_points_ledger
   where subject_type = 'customer' and ref_order_id = new.id and reason in ('order_earn','clawback');

  select coalesce(sum(delta_points) filter (where reason = 'order_earn'),0)
       + coalesce(sum(delta_points) filter (where reason = 'clawback'),0)
    into v_driver_pts
    from public.loyalty_points_ledger
   where subject_type = 'driver' and ref_order_id = new.id and reason in ('order_earn','clawback');

  select coalesce(sum(delta_points) filter (where reason = 'order_earn'),0)
       + coalesce(sum(delta_points) filter (where reason = 'clawback'),0)
    into v_rest_pts
    from public.loyalty_points_ledger
   where subject_type = 'restaurant' and ref_order_id = new.id and reason in ('order_earn','clawback');

  if v_customer_pts > 0 then
    insert into public.loyalty_points_ledger (subject_type, subject_id, delta_points, reason, ref_order_id)
    values ('customer', new.user_id, -v_customer_pts, 'clawback', new.id);

    -- Lock the customer's tier row first (matches accrue's discipline) so a
    -- concurrent clawback/accrual on another order for the same customer
    -- can't race the balance update.
    perform 1 from public.customer_loyalty where user_id = new.user_id for update;

    update public.customer_loyalty
       set points_balance = greatest(0, points_balance - v_customer_pts),
           updated_at = now()
     where user_id = new.user_id;
  end if;

  if v_driver_pts > 0 and new.assigned_driver_id is not null then
    insert into public.loyalty_points_ledger (subject_type, subject_id, delta_points, reason, ref_order_id)
    values ('driver', new.assigned_driver_id, -v_driver_pts, 'clawback', new.id);
  end if;

  if v_rest_pts > 0 then
    insert into public.loyalty_points_ledger (subject_type, subject_id, delta_points, reason, ref_order_id)
    values ('restaurant', new.restaurant_id, -v_rest_pts, 'clawback', new.id);
  end if;

  return new;
exception when others then
  return new;  -- never block the status transition on loyalty bookkeeping
end;
$$;

revoke all on function public.clawback_loyalty_on_reversal() from public, anon, authenticated;

drop trigger if exists orders_clawback_loyalty on public.orders;
create trigger orders_clawback_loyalty
  after update of status on public.orders
  for each row execute function public.clawback_loyalty_on_reversal();

comment on function public.accrue_loyalty_on_delivery is
  'On orders.status -> delivered, credits customer/driver/restaurant loyalty_points_ledger rows. Customer points_balance updated immediately; tier recompute happens in the nightly sweep.';
comment on function public.clawback_loyalty_on_reversal is
  'On a DELIVERED order reversing to a non-delivered status (today: cancelled only), inserts mirroring negative ledger rows and debits the customer balance. Tier demotion happens in the next sweep.';
