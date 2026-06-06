-- 013_realtime_publication.sql
-- Realtime: which tables broadcast Postgres changes to subscribed clients.
--
-- orders is already in supabase_realtime (mig 002). Add the new tables that the
-- dashboards subscribe to:
--   * order_status_events -> the customer tracking timeline + merchant queue feel
--   * order_assignments   -> the driver app (new offers) + admin dispatch board
--
-- NOTE: live driver GPS does NOT go through Realtime postgres_changes (that would
-- be thousands of throwaway writes). It uses Realtime BROADCAST on a per-order
-- channel (order:{id}:driver_loc), which needs no table and no publication entry.
-- See the live-tracking design in the plan.

do $$
begin
  -- order_status_events
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'order_status_events'
  ) then
    alter publication supabase_realtime add table public.order_status_events;
  end if;

  -- order_assignments
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'order_assignments'
  ) then
    alter publication supabase_realtime add table public.order_assignments;
  end if;
end $$;

-- Ensure REPLICA IDENTITY FULL on tables whose UPDATEs we filter/track, so
-- subscribers receive old + new row values on update (needed for some filters).
alter table public.orders            replica identity full;
alter table public.order_assignments replica identity full;
