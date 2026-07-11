-- 097_saved_orders_restaurant_index.sql
-- The unindexed_foreign_keys advisor flagged saved_orders.restaurant_id after
-- mig 086 added the table (it postdated the FK-index sweep in mig 088). Small
-- table, but the covering index keeps restaurant DELETEs from scanning it and
-- clears the last advisor row.
-- Idempotent. Rollback: drop index saved_orders_restaurant_idx.
create index if not exists saved_orders_restaurant_idx on public.saved_orders (restaurant_id);
