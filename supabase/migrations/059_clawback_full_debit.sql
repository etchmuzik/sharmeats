-- 059_clawback_full_debit.sql
-- Close the loyalty double-earn window (pre-ship review M1).
--
-- THE HOLE (044): clawback_loyalty_on_reversal debited the customer balance
-- with `greatest(0, points_balance - v_customer_pts)`. If the customer had
-- already REDEEMED the earned points (minting a promo code with real EGP
-- value) before the order reversed, the balance was 0 and the debit silently
-- vanished — the ledger recorded -N but the balance lost nothing. On a later
-- re-delivery the accrual fired again (+N). Net result from ONE order:
-- a promo code worth N-points-of-EGP PLUS the N points back.
--
-- THE FIX: debit in full and allow points_balance to go NEGATIVE (debt).
--   - deliver(+100) -> redeem(-100, promo minted) -> cancel(-100) => balance -100
--   - re-deliver(+100) => balance 0: the re-earn pays off the promo. Correct.
--   - never re-delivered => balance stays -100; future earns repay the debt
--     first. redeem_points (049/058) already rejects when balance < cost, so a
--     negative balance simply blocks redemption until repaid.
-- The ledger (sum of delta_points) and the balance column now always agree,
-- which also keeps the 051 reconciliation exact instead of drifting.
--
-- Body is 044's clawback verbatim except the one balance-update line
-- (last-definition-wins discipline: full function body restated).

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

    -- [059] FULL debit — may go negative (debt). Previously floored at 0,
    -- which let redeemed-then-reversed points escape the clawback entirely.
    update public.customer_loyalty
       set points_balance = points_balance - v_customer_pts,
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

comment on function public.clawback_loyalty_on_reversal is
  'On a DELIVERED order reversing to a non-delivered status, inserts mirroring negative ledger rows and debits the customer balance IN FULL (may go negative = debt; redeem_points blocks while negative, future earns repay). Tier demotion happens in the next sweep.';
