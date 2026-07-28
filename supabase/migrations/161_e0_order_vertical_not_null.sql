-- 161_e0_order_vertical_not_null.sql
--
-- Package 07 Program A0 (session E0) — finish the order-vertical snapshot.
--
-- TWO problems with migration 157, both measured against production.
--
-- (1) NULLABLE SNAPSHOT. 157 adds orders.vertical_id, backfills it and sets a
--     default, but never SET NOT NULL. A snapshot column that can be NULL is not
--     a snapshot: every consumer has to decide what NULL means, and the honest
--     answers ("unknown" vs "food") differ. Production history is verifiably all
--     food (23 orders, every one joined to a vertical_id='food' merchant), so
--     the column can be closed rather than left ambiguous.
--
-- (2) THE BACKFILL SIDE EFFECT IS FIXED IN 157 ITSELF, NOT HERE.
--     157's backfill writes to every historical order, and `orders` is in the
--     supabase_realtime publication with 9 UPDATE-firing triggers -- including
--     orders_touch_updated_at. An earlier draft of THIS file tried to correct
--     that, which was too late to work: in the ordered replay 157 runs first,
--     so by the time 161 executes the updated_at rewrite and the Realtime burst
--     have already happened and 161 matches zero rows. Because none of 152-162
--     is applied yet, the correct fix was to change 157 at the source, and that
--     is where it now lives (session_replication_role = 'replica' around a
--     backfill scoped to `vertical_id is null`).
--
--     This file therefore does ONE thing: close the column. The residual
--     backfill below is a safety net for a database where 157's backfill could
--     not resolve a row, and is expected to match ZERO rows in the ordered
--     replay.

-- ---------------------------------------------------------------------------
-- 1. Residual safety net (expected: ZERO rows).
-- ---------------------------------------------------------------------------
-- 157 has already backfilled, with triggers suppressed. This exists only so
-- SET NOT NULL below cannot fail on a database where some row escaped -- and it
-- carries the same session_replication_role guard so that even in that unusual
-- case updated_at is preserved.
do $$
declare
  v_n int;
  v_bad int;
begin
  -- Refuse to guess: every NULL row must be resolvable from its merchant.
  select count(*) into v_bad
    from public.orders o
    left join public.restaurants r on r.id = o.restaurant_id
   where o.vertical_id is null and r.id is null;
  if v_bad > 0 then
    raise exception 'mig161: % order(s) have no merchant to derive a vertical from -- refusing to default them', v_bad;
  end if;

  set local session_replication_role = 'replica';

  update public.orders o
     set vertical_id = r.vertical_id
    from public.restaurants r
   where r.id = o.restaurant_id
     and o.vertical_id is null;
  get diagnostics v_n = row_count;

  -- Back to normal for the rest of the transaction, so anything below (and any
  -- later statement in this migration run) has ordinary trigger behaviour.
  set local session_replication_role = 'origin';

  raise notice 'mig161: backfilled % order(s) with updated_at and triggers preserved', v_n;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Close the column.
-- ---------------------------------------------------------------------------
-- The default stays: place_order's trigger stamps the real vertical on INSERT
-- (mig 157), and the default only covers a direct INSERT that omits the column,
-- which the trigger then corrects. NOT NULL is what makes the guarantee.
alter table public.orders alter column vertical_id set not null;

comment on column public.orders.vertical_id is
  'The vertical this order was placed under, snapshotted at placement (mig 157) and NOT NULL since mig 161. Immutable by trigger: reassigning the merchant later never rewrites an order''s history. NOT NULL matters because a nullable snapshot forces every consumer to invent a meaning for NULL -- "unknown" and "food" are different claims, and only one of them is true.';
