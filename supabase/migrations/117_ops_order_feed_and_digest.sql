-- 117_ops_order_feed_and_digest.sql
--
-- Order feed for the ops Telegram chat (same @malawany_bot wiring as migs
-- 115/116), designed deliberately LOW-NOISE: one compact line per money-
-- relevant event, silence for everything else. What notifies:
--   🛒/💳  order became real  (COD at insert; card when payment captures)
--   ❌     order cancelled/rejected (only if the feed announced it first)
--   ⚠️     card captured on an already-dead order (refund task, not an order)
--   📊     one end-of-day digest (23:55 Cairo) — orders · revenue · losses;
--          also doubles as a daily heartbeat that the alert pipeline works
-- Deliberately SILENT: per-status transitions, driver assignment, delivery,
-- COD's payment_status flip at delivery — the apps already surface those.
--
-- DB trigger, not app code: place_order is the only order writer, and pg_net's
-- request queue is transactional, so a rolled-back insert never notifies and
-- every committed order does, regardless of app version or surface.
--
-- "When is an order real?" differs by method: COD inserts payment_status=
-- 'pending' (flips 'paid' at DELIVERY — silent here); a card order becomes
-- real when paymob-webhook flips it to 'paid'. The card guard detects
-- "BECAME paid" (old IS DISTINCT FROM 'paid'), not pending->paid, so a future
-- failed->paid retry still notifies; a future prepaid-at-insert method (wallet
-- credit) is covered by the INSERT path's payment_status='paid' clause.
--
-- Merchant-editable text (restaurant_name, cancel_reason) is sanitized before
-- hitting the ops channel: <> stripped (Slack markup like <!channel> on the
-- fallback path), whitespace/newlines collapsed (line-spoofing), length capped.
--
-- Gated by platform_settings.ops_notify_orders / ops_daily_digest_enabled so
-- either can be muted without touching the webhook. NOTE for bulk operations
-- (backfills, restores): flip ops_notify_orders to false first — the trigger
-- is FOR EACH ROW and will emit one message per COD row.
--
-- Functions never raise — order placement must not fail because Telegram
-- hiccuped — same fail-open-with-warning stance as ops_alert [115/116].

insert into public.platform_settings (key, value) values
  ('ops_notify_orders',        to_jsonb(true)),
  ('ops_daily_digest_enabled', to_jsonb(true))
on conflict (key) do nothing;

create or replace function public.notify_order_ops()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_on   bool;
  v_kind text;  -- 'new' | 'paid' | 'gone'
  v_name text;
  v_line text;
begin
  -- Cheap event classification first; bail before any I/O when not ours.
  if tg_name = 'orders_notify_new_ops' then
    if new.payment_method = 'cash_on_delivery' or new.payment_status = 'paid' then
      v_kind := 'new';
    end if;
  elsif tg_name = 'orders_notify_card_paid_ops' then
    -- BECAME paid; COD stays silent (its flip happens at delivery).
    if new.payment_method is distinct from 'cash_on_delivery'
       and new.payment_status = 'paid'
       and old.payment_status is distinct from 'paid' then
      v_kind := 'paid';
    end if;
  elsif tg_name = 'orders_notify_gone_ops' then
    -- Only for orders the feed announced (COD, or a card order that paid).
    if new.status in ('cancelled', 'rejected')
       and old.status not in ('cancelled', 'rejected')
       and (new.payment_method = 'cash_on_delivery' or old.payment_status = 'paid') then
      v_kind := 'gone';
    end if;
  end if;
  if v_kind is null then
    return new;
  end if;

  select coalesce((value #>> '{}')::bool, false) into v_on
    from public.platform_settings where key = 'ops_notify_orders';
  if not coalesce(v_on, false) then
    return new;
  end if;

  v_name := left(regexp_replace(translate(new.restaurant_name, '<>', ''), '\s+', ' ', 'g'), 40);

  if v_kind = 'gone' then
    v_line := '❌ #' || new.short_code || ' ' || v_name
           || ' · EGP ' || new.total_egp
           || case when new.status = 'rejected' then ' · rejected' else '' end
           || coalesce(' · ' || nullif(left(regexp_replace(translate(
                coalesce(new.cancel_reason, ''), '<>', ''), '\s+', ' ', 'g'), 40), ''), '');
  elsif v_kind = 'paid' and new.status in ('cancelled', 'rejected') then
    -- Late card capture on a dead order: money arrived for something the
    -- kitchen will never cook — a refund task, not a new order.
    v_line := '⚠️ #' || new.short_code || ' ' || v_name
           || ' · EGP ' || new.total_egp || ' paid but ' || new.status || ' — refund needed';
  else
    v_line := case when v_kind = 'paid'
                     or new.payment_method is distinct from 'cash_on_delivery'
                   then '💳 #' else '🛒 #' end
           || new.short_code || ' ' || v_name
           || ' · ' || coalesce(jsonb_array_length(new.items), 0) || '×'
           || ' · EGP ' || new.total_egp
           || coalesce(' · ' || new.zone::text, '')
           || case when new.scheduled_for is not null
                   then ' ⏰ ' || to_char(new.scheduled_for at time zone 'Africa/Cairo', 'DD Mon HH24:MI')
                   else '' end;
  end if;

  perform public.ops_alert(v_line);
  return new;
exception when others then
  raise warning 'notify_order_ops failed for order %: % (%)', new.id, sqlerrm, sqlstate;
  return new;
end;
$$;

-- Trigger functions are invoked by the system, not clients; lock down anyway
-- (house rule for every SECURITY DEFINER function).
revoke all on function public.notify_order_ops() from public, anon, authenticated;

drop trigger if exists orders_notify_new_ops on public.orders;
create trigger orders_notify_new_ops
  after insert on public.orders
  for each row execute function public.notify_order_ops();

drop trigger if exists orders_notify_card_paid_ops on public.orders;
create trigger orders_notify_card_paid_ops
  after update of payment_status on public.orders
  for each row execute function public.notify_order_ops();

drop trigger if exists orders_notify_gone_ops on public.orders;
create trigger orders_notify_gone_ops
  after update of status on public.orders
  for each row execute function public.notify_order_ops();

create or replace function public.ops_daily_digest()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_on     bool;
  v_day    date;
  v_from   timestamptz;
  v_orders int;
  v_gone   int;
  v_rev    bigint;
  v_text   text;
begin
  select coalesce((value #>> '{}')::bool, false) into v_on
    from public.platform_settings where key = 'ops_daily_digest_enabled';
  if not coalesce(v_on, false) then
    return;
  end if;

  -- "Today" in Cairo regardless of when the UTC cron fires.
  v_day  := (now() at time zone 'Africa/Cairo')::date;
  v_from := v_day::timestamp at time zone 'Africa/Cairo';

  select count(*),
         count(*) filter (where status in ('cancelled', 'rejected')),
         coalesce(sum(total_egp) filter (where status not in ('cancelled', 'rejected')), 0)
    into v_orders, v_gone, v_rev
    from public.orders
   where placed_at >= v_from and placed_at < v_from + interval '1 day';

  if v_orders = 0 then
    -- Still sends: the zero-day line is the pipeline's daily heartbeat.
    v_text := '📊 ' || to_char(v_day, 'DD Mon') || ': no orders';
  else
    v_text := '📊 ' || to_char(v_day, 'DD Mon') || ': '
           || v_orders || ' order' || case when v_orders = 1 then '' else 's' end
           || ' · EGP ' || to_char(v_rev, 'FM9,999,999')
           || case when v_gone > 0 then ' · ' || v_gone || ' ❌' else '' end;
  end if;

  perform public.ops_alert(v_text);
exception when others then
  raise warning 'ops_daily_digest failed: % (%)', sqlerrm, sqlstate;
end;
$$;

revoke all on function public.ops_daily_digest() from public, anon, authenticated;

-- 20:55 UTC = 23:55 Cairo in summer (EEST), 22:55 in winter — end of the
-- Cairo business day either way. cron.schedule upserts by name (mig 114 pattern).
select cron.schedule('ops-daily-digest', '55 20 * * *', 'select public.ops_daily_digest();');
