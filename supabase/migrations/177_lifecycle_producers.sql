-- 177_lifecycle_producers.sql
--
-- Package 03 Slice G / Package 02 Slice E — the first two lifecycle producers.
--
-- ================= BOTH SHIP DARK =================
-- Every decision goes through lifecycle_eligible (mig 176) and is recorded, but
-- enqueue_push is called ONLY when lifecycle_is_live() — which is false until an
-- operator changes `lifecycle_mode`. So applying this migration and scheduling the
-- cron jobs sends nothing. The ledger fills with what WOULD have gone out, which
-- is the evidence the go-live decision should be made from.
--
-- ================= WHY VALIDITY IS CHECKED HERE, NOT IN THE GATE =================
-- lifecycle_eligible owns the gates that are the same for every producer: consent,
-- quiet hours, caps, active order, idempotency, holdout. It deliberately does NOT
-- know what a "valid subject" means, because that differs completely per producer —
-- a cart is valid if its restaurant is open and its lines still exist; a delivered
-- order is valid if the restaurant is still active. Pushing that into the shared
-- gate would mean a giant CASE on event name, which is how one producer's change
-- breaks another.
--
-- So each producer checks its own subject validity FIRST, records
-- 'subject_invalid' if it fails, and only then asks the shared gate.
--
-- ================= WHY NO LOCKING =================
-- Unlike the push dispatcher (mig 173), these sweeps do not need SKIP LOCKED. Two
-- overlapping runs cannot double-send, because lifecycle_eligible's idempotency
-- check refuses a (user, event, subject) that already has a would_send row — the
-- second run sees the first run's ledger entry. The ledger IS the lock.

-- ---------------------------------------------------------------------------
-- 1. Abandoned cart
-- ---------------------------------------------------------------------------
-- Subject is the CART'S RESTAURANT, not the cart itself: customer_carts is keyed by
-- user and mutates in place, so its id is stable forever and idempotency keyed on it
-- would send exactly one abandoned-cart reminder per customer per lifetime. Keying
-- on the restaurant means a customer who abandons a Fish Market cart this week and
-- a Koshari cart next week gets both reminders, which is the intent, while
-- re-abandoning the SAME restaurant's cart does not re-remind.
create or replace function public.abandoned_cart_sweep()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_idle_hours int;
  v_live       boolean := public.lifecycle_is_live();
  v_rec        record;
  v_gate       record;
  v_msg        uuid;
  v_count      int := 0;
begin
  select coalesce((select (value #>> '{}')::int from public.platform_settings
                    where key = 'lifecycle_cart_idle_hours'), 24)
    into v_idle_hours;

  for v_rec in
    select c.user_id, c.restaurant_id, c.items, c.updated_at,
           r.is_active, r.is_open, r.name as restaurant_name, r.vertical_id
      from public.customer_carts c
      join public.restaurants r on r.id = c.restaurant_id
     where c.restaurant_id is not null
       -- customer_carts.user_id is the primary key so it cannot be null; stated
       -- anyway so both producers read identically and neither relies on a schema
       -- detail holding.
       and c.user_id is not null
       and jsonb_array_length(c.items) > 0
       and c.updated_at < now() - make_interval(hours => v_idle_hours)
       -- Never chase a cart that has already expired: its own TTL says the customer
       -- has moved on, and mig 170's sweep is about to delete it.
       and c.expires_at > now()
  loop
    begin
      -- Subject validity, per the header: a reminder to finish a basket at a shut
      -- or delisted restaurant is worse than no reminder.
      if not (v_rec.is_active and v_rec.is_open) then
        perform public.lifecycle_record(v_rec.user_id, 'abandoned_cart', v_rec.restaurant_id,
                                        false, 'subject_invalid',
                                        public.lifecycle_holdout_group(v_rec.user_id, 'abandoned_cart'));
        continue;
      end if;

      select * into v_gate
        from public.lifecycle_eligible(v_rec.user_id, 'abandoned_cart', v_rec.restaurant_id);

      if not v_gate.allowed then
        perform public.lifecycle_record(v_rec.user_id, 'abandoned_cart', v_rec.restaurant_id,
                                        false, v_gate.reason, v_gate.holdout_group);
        continue;
      end if;

      v_msg := null;
      if v_live then
        -- Marketing category, so the dispatcher applies marketing consent again at
        -- send time — defence in depth, since a customer could revoke between this
        -- decision and the actual send.
        v_msg := public.enqueue_push(
          p_event              := 'cart_reminder',
          p_order_id           := null,
          p_recipient_user_ids := array[v_rec.user_id],
          p_idempotency_key    := 'lifecycle:abandoned_cart:' || v_rec.user_id || ':' || v_rec.restaurant_id,
          p_route              := '/(tabs)/cart',
          p_vertical           := v_rec.vertical_id,
          p_category           := 'marketing');
      end if;

      -- would_send TRUE in both modes: in observe mode this is the counterfactual
      -- that consumes frequency budget, which is what makes the observed volume
      -- honest. See mig 176's header.
      perform public.lifecycle_record(v_rec.user_id, 'abandoned_cart', v_rec.restaurant_id,
                                      true, null, v_gate.holdout_group, v_msg);
      v_count := v_count + 1;
    exception when others then
      -- One bad cart must not abort the batch.
      raise warning 'abandoned_cart_sweep user(%) failed: %', v_rec.user_id, sqlerrm;
    end;
  end loop;

  return v_count;
end;
$function$;

revoke all on function public.abandoned_cart_sweep() from public, anon, authenticated;

comment on function public.abandoned_cart_sweep() is
  'Package 03 Slice G. Finds carts untouched for lifecycle_cart_idle_hours and decides whether to remind. Subject is the cart''s RESTAURANT, not the cart: customer_carts is keyed by user and mutates in place, so its id never changes and idempotency on it would allow exactly one reminder per customer per lifetime. Skips carts past their own TTL (the customer has moved on) and shut or delisted restaurants (recorded as subject_invalid). Enqueues only when lifecycle_is_live(); otherwise records the counterfactual. Mig 177.';

-- ---------------------------------------------------------------------------
-- 2. Reorder cadence
-- ---------------------------------------------------------------------------
-- The spec asks for a 7/14-day cadence after a delivered order. Subject is the
-- ORDER, so each delivered order can prompt at most one reminder ever — and the
-- per-event weekly cap stops a customer with ten delivered orders getting ten
-- nudges in one week.
--
-- WHY A WINDOW AND NOT AN EXACT AGE. A cron job that fires daily and looks for
-- "exactly 7 days old" misses any order whose anniversary falls in a run that was
-- skipped, delayed or failed — and silently, which is the worst kind of miss. A
-- window (7-9 and 14-16 days) is self-healing: a missed run is caught by the next.
-- The order-level idempotency is what stops the window sending three times.
create or replace function public.reorder_cadence_sweep()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_live  boolean := public.lifecycle_is_live();
  v_rec   record;
  v_gate  record;
  v_msg   uuid;
  v_count int := 0;
begin
  for v_rec in
    select o.id, o.user_id, o.restaurant_id, o.vertical_id,
           r.is_active, r.is_open
      from public.orders o
      join public.restaurants r on r.id = o.restaurant_id
     where o.status = 'delivered'
       and o.delivered_at is not null
       -- GUEST ORDERS HAVE user_id NULL, and this must be explicit rather than
       -- incidental. Found in production: two delivered orders matched the window
       -- but produced NO ledger row at all, because the most-recent-order check
       -- below compared `o.id = (subquery)` where the subquery returned NULL for a
       -- null user — and `id = NULL` is NULL, not true, so the row was dropped
       -- silently before any decision could be recorded. The outcome happened to be
       -- safe (there is nobody to push to), but it was safe by accident, and a
       -- silent drop is indistinguishable from a broken query. House rule 4's
       -- fail-open trap, in a WHERE clause.
       and o.user_id is not null
       and (
         -- Two self-healing windows rather than two exact ages; see the header.
         (o.delivered_at between now() - interval '9 days'  and now() - interval '7 days')
         or
         (o.delivered_at between now() - interval '16 days' and now() - interval '14 days')
       )
       -- Only the customer's MOST RECENT delivered order from this restaurant is a
       -- sensible thing to reorder. Without this, a regular would be reminded about
       -- every historical order that happens to fall in the window.
       -- `is not distinct from` rather than `=`, so a NULL subquery result can
       -- never silently drop the row (see the user_id note above). With user_id
       -- non-null the subquery always returns a row, but the null-safe operator
       -- means a future change cannot reintroduce the silent-drop failure.
       and o.id is not distinct from (
         select o2.id from public.orders o2
          where o2.user_id = o.user_id and o2.restaurant_id = o.restaurant_id
            and o2.status = 'delivered'
          order by o2.delivered_at desc limit 1
       )
  loop
    begin
      if not (v_rec.is_active and v_rec.is_open) then
        perform public.lifecycle_record(v_rec.user_id, 'reorder_cadence', v_rec.id,
                                        false, 'subject_invalid',
                                        public.lifecycle_holdout_group(v_rec.user_id, 'reorder_cadence'));
        continue;
      end if;

      select * into v_gate
        from public.lifecycle_eligible(v_rec.user_id, 'reorder_cadence', v_rec.id);

      if not v_gate.allowed then
        perform public.lifecycle_record(v_rec.user_id, 'reorder_cadence', v_rec.id,
                                        false, v_gate.reason, v_gate.holdout_group);
        continue;
      end if;

      v_msg := null;
      if v_live then
        v_msg := public.enqueue_push(
          p_event              := 'reorder_reminder',
          -- The order IS the subject here, so it is passed as order_id: a tap lands
          -- on that order, where "order again" already exists (Package 02 Slice A).
          p_order_id           := v_rec.id,
          p_recipient_user_ids := array[v_rec.user_id],
          p_idempotency_key    := 'lifecycle:reorder_cadence:' || v_rec.id,
          p_vertical           := v_rec.vertical_id,
          p_category           := 'marketing');
      end if;

      perform public.lifecycle_record(v_rec.user_id, 'reorder_cadence', v_rec.id,
                                      true, null, v_gate.holdout_group, v_msg);
      v_count := v_count + 1;
    exception when others then
      raise warning 'reorder_cadence_sweep order(%) failed: %', v_rec.id, sqlerrm;
    end;
  end loop;

  return v_count;
end;
$function$;

revoke all on function public.reorder_cadence_sweep() from public, anon, authenticated;

comment on function public.reorder_cadence_sweep() is
  'Package 03 Slice G / Package 02 Slice E. Reminds a customer about a delivered order at the 7-day and 14-day marks. Uses self-healing WINDOWS (7-9 and 14-16 days) rather than exact ages, because a daily cron looking for "exactly 7 days" silently misses any order whose anniversary fell in a skipped or failed run; order-level idempotency stops the window sending twice. Only the customer''s most recent delivered order per restaurant qualifies, or a regular would be reminded about every historical order in the window. Enqueues only when lifecycle_is_live(). Mig 177.';
