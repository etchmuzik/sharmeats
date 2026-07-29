-- 178_lifecycle_null_user_guard.sql
--
-- Package 03 Slice G — correction to mig 177, found in PRODUCTION.
--
-- THE BUG. Two delivered orders matched reorder_cadence_sweep's 7-9 day window, yet
-- the sweep produced NO ledger row at all. Both are GUEST orders with user_id NULL.
-- The most-recent-order filter compared `o.id = (subquery)`, the correlated subquery
-- returned NULL for a null user, and `id = NULL` evaluates to NULL rather than true
-- — so the row was dropped silently before any decision could be recorded.
--
-- The outcome happened to be safe: there is no recipient, so nothing could have been
-- sent. But it was safe BY ACCIDENT, and a silent drop is indistinguishable from a
-- broken query — which is exactly how this was noticed (zero ledger rows against
-- non-zero matching orders). It is house rule 4's fail-open NULL trap, in a WHERE
-- clause rather than a role check.
--
-- WHY THIS IS A SEPARATE MIGRATION rather than an edit to 177. Mig 177 was already
-- applied to production when the bug was found, so the ledger records it. Editing
-- 177 in place would leave the repo describing something production never ran.
-- 178 re-creates both producer bodies with the fix; 177 on disk carries the same
-- corrected text so a fresh database built from the migrations lands in the same
-- state either way.
--
-- THE FIX, in two parts:
--   * `o.user_id is not null` — exclude guest orders EXPLICITLY, so the exclusion is
--     a stated decision rather than a consequence of NULL semantics;
--   * `is not distinct from` instead of `=` for the most-recent comparison, so a NULL
--     subquery result can never silently drop a row again.
--
-- Both matter even though the second is now unreachable: the explicit guard is what
-- a reader sees, and the null-safe operator is what stops a future edit
-- reintroducing the silent drop.

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
