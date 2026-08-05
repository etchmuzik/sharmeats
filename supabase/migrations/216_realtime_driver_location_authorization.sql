-- 216_realtime_driver_location_authorization.sql
--
-- Live driver GPS is personal location data. It travels on a per-order Realtime
-- Broadcast channel, but a topic name is not authorization: a public Broadcast
-- channel lets any client that learns/guesses its name subscribe and receive
-- every fix. The order UUID appears in client state and must be treated as an
-- identifier, not a secret.
--
-- Realtime authorization is a two-part contract:
--   1. these RLS policies decide who may join/read or send on a private topic;
--   2. both client channels set `config.private: true` (customer + driver).
-- A public and private channel with the same text are distinct, so old public
-- clients receive no private fixes. Deploy this migration with the coordinated
-- customer/driver release; do not roll out only one side and expect live GPS.
--
-- Supabase owns the realtime schema. Its docs explicitly permit managing RLS
-- policies on realtime.messages, but not altering the schema, grants, or table
-- settings. Keep this migration to policies only.

-- The expression returns NULL for any noncanonical topic, so the UUID cast is
-- safe and such a channel matches no order. Keeping it inline lets the orders
-- primary-key index serve the join-time authorization check.
--
-- `extension = 'broadcast'` is essential: Realtime evaluates policies against
-- a synthetic `realtime.messages` row at join time, and a policy that omits it
-- would accidentally grant future Presence/other message types on this topic.

drop policy if exists realtime_driver_location_customer_receive on realtime.messages;
create policy realtime_driver_location_customer_receive
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and exists (
      select 1
      from public.orders o
      where o.id = (
        (regexp_match(
          (select realtime.topic()),
          '^order:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}):driver_loc$'
        ))[1]
      )::uuid
        and o.user_id = (select auth.uid())
    )
  );

drop policy if exists realtime_driver_location_assigned_driver_send on realtime.messages;
create policy realtime_driver_location_assigned_driver_send
  on realtime.messages for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and exists (
      select 1
      from public.orders o
      join public.drivers d on d.id = o.assigned_driver_id
      where o.id = (
        (regexp_match(
          (select realtime.topic()),
          '^order:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}):driver_loc$'
        ))[1]
      )::uuid
        and d.profile_id = (select auth.uid())
    )
  );

comment on policy realtime_driver_location_customer_receive on realtime.messages is
  'Only the customer who owns order:<uuid>:driver_loc may receive its private Broadcast fixes (mig 216).';
comment on policy realtime_driver_location_assigned_driver_send on realtime.messages is
  'Only the driver currently assigned to order:<uuid>:driver_loc may send its private Broadcast fixes (mig 216).';
