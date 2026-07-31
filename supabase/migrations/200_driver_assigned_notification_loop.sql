-- 200_driver_assigned_notification_loop.sql
--
-- Stop the customer being pushed "Driver on the way" once a minute, forever.
--
-- REPORTED 2026-07-31 from a live TestFlight order: a single order kept pushing
-- "A driver is heading to the restaurant for your order" roughly every minute
-- for over a day, and was still going when reported.
--
-- THE LOOP. notify_order_transition (mig 073) fires driver_assigned on the
-- transition `old.assigned_driver_id is null -> new.assigned_driver_id is not
-- null`. That guard is correct only if assignment happens once. It doesn't:
--
--   1. auto_assign_order (mig 189) sets orders.assigned_driver_id  -> PUSH
--   2. the offer is not accepted; offer_expires_at passes (~45s default)
--   3. the dispatch sweep (every 20s) marks the assignment 'rejected' and
--      sets orders.assigned_driver_id = null      (mig 025, still live)
--   4. the same sweep re-dispatches to the next nearest driver -> back to 1
--
-- Every trip round that loop is a fresh null -> not-null transition, so every
-- trip is another push to the customer. An order nobody accepts pushes forever.
-- The driver-side 'new_offer' push is correct to repeat — each driver genuinely
-- has a new offer. The CUSTOMER-side one is not: "a driver is on the way" is
-- interesting exactly once.
--
-- THE FIX, and why it is this one. The push outbox (mig 171) already has
-- `push_messages.idempotency_key text not null unique`, and enqueue_push
-- (mig 172) is the supported way in. notify_order_transition simply predates
-- both and still does a raw net.http_post, bypassing the dedupe that would have
-- caught this. Routing it through enqueue_push with a key of
-- 'driver_assigned:<order_id>' makes the second and subsequent sends no-ops at
-- the database level — not "unlikely", structurally impossible, enforced by a
-- unique index rather than by the trigger reasoning correctly.
--
-- This also fixes the CURRENT stuck order: the first enqueue after this
-- migration takes the key, and every later one collides and does nothing.
--
-- The other two events in this trigger move to enqueue_push as well. They are
-- keyed on transitions that genuinely happen once per order, so they were not
-- misbehaving, but leaving one raw http_post beside two queued ones is how the
-- next person reintroduces this bug.
--
-- House rules: same argument list (none) so no second overload is created
-- (rule 1); body started from mig 073, the only existing definition, verified
-- via `grep -l 'function public.notify_order_transition'` returning exactly one
-- file (rule 2); REVOKE re-applied below (rule 3).

create or replace function public.notify_order_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_drv_uid uuid;
  v_staff   uuid[];
begin
  -- 1. Driver assigned -> tell the customer "a driver is on the way".
  --    ONCE PER ORDER. See the header: assignment recycles on offer expiry, so
  --    the transition itself is not a reliable "this happened once" signal.
  if new.assigned_driver_id is not null and old.assigned_driver_id is null then
    perform public.enqueue_push(
      p_event           => 'driver_assigned',
      p_order_id        => new.id,
      p_idempotency_key => 'driver_assigned:' || new.id::text
    );
  end if;

  -- 2. Order ready AND a driver is assigned -> ping that driver to come pick up.
  --    Keyed per (order, driver): a re-dispatch to a DIFFERENT driver should
  --    reach that driver, but the same driver must not be nagged twice.
  if new.status = 'ready' and old.status is distinct from 'ready'
     and new.assigned_driver_id is not null then
    select d.profile_id into v_drv_uid from public.drivers d where d.id = new.assigned_driver_id;
    if v_drv_uid is not null then
      perform public.enqueue_push(
        p_event              => 'order_ready_pickup',
        p_order_id           => new.id,
        p_recipient_user_ids => array[v_drv_uid],
        p_idempotency_key    => 'order_ready_pickup:' || new.id::text || ':' || new.assigned_driver_id::text
      );
    end if;
  end if;

  -- 3. Low food rating just submitted -> alert the restaurant's staff.
  --    A rating can only go null -> not-null once, but key it anyway.
  if new.rating_food is not null and old.rating_food is null and new.rating_food <= 2 then
    select coalesce(array_agg(distinct ms.profile_id), '{}')::uuid[] into v_staff
      from public.merchant_staff ms where ms.restaurant_id = new.restaurant_id;
    if v_staff is not null and cardinality(v_staff) > 0 then
      perform public.enqueue_push(
        p_event              => 'low_rating',
        p_order_id           => new.id,
        p_recipient_user_ids => v_staff,
        p_idempotency_key    => 'low_rating:' || new.id::text
      );
    end if;
  end if;

  return new;
exception when others then
  -- Best-effort, exactly as before: a notification must never block an order
  -- write. enqueue_push swallows its own errors too, so this is belt and braces.
  raise warning 'notify_order_transition(%) failed: %', new.id, sqlerrm;
  return new;
end;
$$;

revoke all on function public.notify_order_transition() from public, anon, authenticated;

comment on function public.notify_order_transition() is
  'Order-transition notifications, queued through enqueue_push so the push outbox unique index dedupes them. driver_assigned is keyed per ORDER, not per assignment, because dispatch offer-expiry recycles assigned_driver_id and would otherwise re-notify the customer every cycle (2026-07-31 incident).';

-- The trigger binding is unchanged (mig 073) and still points at this function;
-- re-created here only so a fresh database built from migrations is identical
-- to one that has been migrated in place.
drop trigger if exists orders_notify_transition on public.orders;
create trigger orders_notify_transition
  after update on public.orders
  for each row
  execute function public.notify_order_transition();
