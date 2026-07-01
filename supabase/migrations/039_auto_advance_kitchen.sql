-- 039_auto_advance_kitchen.sql
-- Keep the pipeline moving past 'accepted' when no merchant is working the queue.
--
-- THE GAP THIS FIXES
-- auto_accept (mig 026) advances 'placed' -> 'accepted' on a timeout, and
-- dispatch offers 'accepted' orders to a driver. But three forward transitions —
-- accepted -> preparing -> ready — are MERCHANT-ONLY in advance_order_status
-- (011_rpcs.sql:335-336). If the restaurant isn't actively clicking those in the
-- dashboard (the realistic case until the restaurant app is adopted), an order
-- auto-accepts, gets a driver offered, but then sits at 'accepted'/'preparing'
-- forever: the customer's tracking screen stalls and the driver never gets a
-- clean 'ready' signal. Same class of stall as the original 'placed' stall, one
-- step downstream.
--
-- THE FIX (mirror of auto_accept_sweep)
-- A flag-gated pg_cron sweep that advances kitchen states on a grace timer, one
-- hop per tick per order, so timing stays realistic (a kitchen needs time to
-- cook — we don't jump straight to 'ready'):
--   accepted  --(grace)-->  preparing  --(grace)-->  ready
-- An order accepted at T reaches 'preparing' at ~T+grace and 'ready' at ~T+2·grace.
-- A merchant acting first always pre-empts it (the order leaves the state, so the
-- sweep's guarded UPDATE no-ops).
--
-- Design notes:
--   * Gated by platform_settings.auto_advance_enabled (default FALSE) — inert
--     until ops flips it on, exactly like auto_accept. This is a launch aid, not
--     a replacement for a real restaurant acting; turn it OFF once the restaurant
--     app is in use and kitchens drive their own states.
--   * Grace window in platform_settings.auto_advance_after_seconds (default 240s
--     = 4 min per hop; kitchens are slower than the accept decision).
--   * Only COD, or paid card (never auto-advance an unpaid card order).
--   * Writes a real order_status_events audit row with actor_role = NULL (no human
--     actor — the platform advanced it on a timeout), matching auto_accept's honest
--     null-actor convention (the app_role enum has no 'system' member).
--   * Per-order try/catch so one bad row can't abort the whole sweep.
--
-- Non-destructive: 2 seeded settings + 1 function + 1 cron job.

-- ── Settings: master switch (off by default) + per-hop grace window. ──────────
insert into public.platform_settings (key, value) values
  ('auto_advance_enabled',       to_jsonb(false)),
  ('auto_advance_after_seconds', to_jsonb(240))   -- 4 min in each kitchen state
on conflict (key) do nothing;

-- ── auto_advance_sweep — nudge overdue 'accepted'/'preparing' orders forward. ─
create or replace function public.auto_advance_sweep()
returns int
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_enabled bool;
  v_after   int;
  v_count   int := 0;
  v_rec     record;
  v_next    order_status_type;
  v_since   timestamptz;
begin
  -- Master switch. Inert until ops flips it on.
  select coalesce((value #>> '{}')::bool, false) into v_enabled
    from public.platform_settings where key = 'auto_advance_enabled';
  if not v_enabled then
    return 0;
  end if;

  select coalesce((value #>> '{}')::int, 240) into v_after
    from public.platform_settings where key = 'auto_advance_after_seconds';

  -- Orders sitting in a kitchen state past their grace window. We use the
  -- timestamp the order ENTERED the current state (accepted_at for 'accepted';
  -- for 'preparing' there is no dedicated column, so fall back to updated_at,
  -- which touch_updated_at stamps on every status change → the moment it became
  -- 'preparing'). One hop per row per tick.
  for v_rec in
    select o.id, o.status,
           case o.status
             when 'accepted'  then coalesce(o.accepted_at, o.placed_at)
             when 'preparing' then coalesce(o.updated_at, o.accepted_at, o.placed_at)
           end as since
      from public.orders o
     where o.status in ('accepted','preparing')
       and (
             o.payment_method = 'cash_on_delivery'
          or (o.payment_method = 'card' and o.payment_status = 'paid')
           )
     order by o.placed_at asc
     limit 50  -- bound per-tick work; backlog drains over subsequent ticks
  loop
    -- Not overdue yet? skip.
    if v_rec.since is null or v_rec.since > now() - make_interval(secs => coalesce(v_after, 240)) then
      continue;
    end if;

    v_next := case v_rec.status
                when 'accepted'  then 'preparing'::order_status_type
                when 'preparing' then 'ready'::order_status_type
              end;

    begin
      update public.orders
         set status     = v_next,
             ready_at   = case when v_next = 'ready' then now() else ready_at end,
             updated_at = now()
       where id = v_rec.id
         and status = v_rec.status;  -- re-check: a merchant may have just moved it

      -- Only count + audit if we actually moved it (merchant didn't beat us).
      if found then
        insert into public.order_status_events (order_id, status, actor_role, actor_id, note)
        values (v_rec.id, v_next, null, null, 'Auto-advanced (merchant timeout)');
        v_count := v_count + 1;
      end if;
    exception when others then
      -- Best-effort per order: one bad row must not abort the whole sweep.
      raise warning 'auto_advance_sweep: order % (% -> %) failed: % (%)',
        v_rec.id, v_rec.status, v_next, sqlerrm, sqlstate;
    end;
  end loop;

  return v_count;
end;
$$;

comment on function public.auto_advance_sweep is
  'Kitchen-progress safety net (run by pg_cron). When auto_advance_enabled is true, nudges COD/paid orders one hop forward (accepted->preparing->ready) once they''ve sat past auto_advance_after_seconds, so the pipeline doesn''t stall when no merchant is working the queue. A merchant acting first pre-empts it. Returns count advanced. Turn OFF once restaurants drive their own states via the restaurant app.';

-- Lock it down: trigger/cron + admin only, never a client RPC.
revoke all on function public.auto_advance_sweep() from public, anon, authenticated;

-- ── Schedule: every 20s, same cadence as the other sweeps. ────────────────────
select cron.schedule('sharmeats-auto-advance-sweep', '20 seconds', $$select public.auto_advance_sweep();$$);
