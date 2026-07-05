-- 088_f4_fk_indexes.sql
-- F4 (2026-07-05 audit): btree indexes for the 20 foreign keys flagged by the
-- Supabase performance advisor (unindexed_foreign_keys). Unindexed FKs make
-- every parent DELETE/UPDATE scan the child table and slow the join paths the
-- apps use constantly (order detail, chat, status history).
--
-- Plain CREATE INDEX (not CONCURRENTLY) is intentional: migrations run inside a
-- transaction and every table here is tiny at current volume, so the lock is
-- momentary. If this is ever re-applied at large scale, use the CONCURRENTLY
-- variants from the PR body instead.
--
-- Idempotent via IF NOT EXISTS. Rollback: DROP INDEX <name>.

-- Hot path first: order-scoped children and orders' own FKs.
create index if not exists order_items_catalog_item_idx      on public.order_items (catalog_item_id);
create index if not exists order_status_events_actor_idx     on public.order_status_events (actor_id);
create index if not exists order_assignments_assigned_by_idx on public.order_assignments (assigned_by_id);
create index if not exists order_messages_sender_idx         on public.order_messages (sender_id);
create index if not exists orders_address_idx                on public.orders (address_id);
create index if not exists orders_zone_idx                   on public.orders (zone);

-- The rest of the advisor list.
create index if not exists addresses_hotel_idx               on public.addresses (hotel_id);
create index if not exists batch_candidate_log_order_b_idx   on public.batch_candidate_log (order_b);
create index if not exists delivery_fee_rules_vertical_idx   on public.delivery_fee_rules (vertical_id);
create index if not exists favorites_restaurant_idx          on public.favorites (restaurant_id);
create index if not exists kyc_documents_reviewed_by_idx     on public.kyc_documents (reviewed_by);
create index if not exists modifier_options_modifier_idx     on public.modifier_options (modifier_id);
create index if not exists modifiers_item_idx                on public.modifiers (item_id);
create index if not exists promo_redemptions_user_idx        on public.promo_redemptions (user_id);
create index if not exists push_campaigns_sent_by_idx        on public.push_campaigns (sent_by);
create index if not exists support_messages_author_idx       on public.support_messages (author_id);
create index if not exists users_default_address_idx         on public.users (default_address_id);
create index if not exists users_default_payment_method_idx  on public.users (default_payment_method_id);

-- drivers.legacy_rider_id and riders.user_id are deliberately NOT indexed here:
-- migration 091 (F8) drops that column and table. If 091 is skipped, add:
--   create index if not exists drivers_legacy_rider_idx on public.drivers (legacy_rider_id);
--   create index if not exists riders_user_idx          on public.riders (user_id);
