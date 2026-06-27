-- 026_auto_accept.sql
-- Hybrid order acceptance: keep the merchant gate, add a timeout safety net.
--
-- THE PROBLEM THIS FIXES
-- Orders are created at status='placed'. Only a merchant/admin/dispatcher can
-- advance placed -> accepted (advance_order_status, mig 011). Auto-dispatch
-- (mig 025) only ever looks at orders in 'accepted'/'preparing'/'ready'. So if
-- no merchant accepts an order, it parks at 'placed' forever, never reaches the
-- dispatch sweep, and no driver is ever offered it. In production today this is
-- exactly what happens: a real order sits at 'placed' and the customer watches a
-- tracking screen that never advances.
--
-- THE FIX (hybrid)
-- The merchant can still accept on merchant-web (unchanged). But if NObody
-- accepts within a grace window, auto_accept_sweep() advances the order to
-- 'accepted' on the platform's behalf so dispatch can take over. A merchant who
-- accepts first naturally pre-empts the timeout (the order leaves 'placed', so
-- the sweep skips it).
--
-- Design notes:
--   * Gated by platform_settings.auto_accept_enabled (default false) so this is
--     INERT until you flip it on — same safety posture as dispatch_mode.
--   * Grace window in platform_settings.auto_accept_after_seconds (default 180s)
--     so ops can tune "how long to wait for the merchant" without a deploy.
--   * Only COD orders are auto-accepted. Card orders must be paid first
--     (payment_status='paid') before they're eligible — we never auto-accept an
--     unpaid card order. (Card is disabled at launch, but this keeps the rule
--     correct for when it turns on.)
--   * Writes a real order_status_events audit row with actor_role = NULL (the
--     app_role enum has no 'system' member, and the column is nullable) and a
--     clear note, so the timeline/history are honest that the PLATFORM moved the
--     order on a timeout rather than a human.
--   * Reuses the SAME pg_cron job cadence as dispatch by adding a second
--     scheduled job; both are idempotent and bounded per tick.
--
-- Non-destructive: new functions + seeded settings + one cron job.

-- ============================================================================
-- Settings: master switch (off by default) + grace window.
-- ============================================================================
insert into public.platform_settings (key, value) values
  ('auto_accept_enabled',       to_jsonb(false)),
  ('auto_accept_after_seconds', to_jsonb(180))   -- wait 3 min for the merchant
on conflict (key) do nothing;

-- ============================================================================
-- auto_accept_sweep — advance overdue 'placed' COD orders to 'accepted'.
--
-- Idempotent; safe to run every ~20s. Bounded per tick. SECURITY DEFINER so it
-- can write orders.status without going through advance_order_status' per-actor
-- auth (there is no human actor here — the platform is the actor). It still
-- mirrors the legal transition (placed -> accepted) and appends the audit event
-- advance_order_status would have written, so history stays consistent.
--
-- Returns the number of orders auto-accepted this tick.
-- ============================================================================
create or replace function public.auto_accept_sweep()
returns int
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_enabled bool;
  v_after   int;
  v_count   int := 0;
  v_rec     record;
begin
  -- Master switch. Inert until ops flips it on.
  select coalesce((value #>> '{}')::bool, false) into v_enabled
    from public.platform_settings where key = 'auto_accept_enabled';
  if not v_enabled then
    return 0;
  end if;

  select coalesce((value #>> '{}')::int, 180) into v_after
    from public.platform_settings where key = 'auto_accept_after_seconds';

  -- Find orders still waiting on the merchant past their grace window.
  -- COD only; card orders must be paid before they're eligible.
  for v_rec in
    select o.id
      from public.orders o
     where o.status = 'placed'
       and o.placed_at < now() - make_interval(secs => coalesce(v_after, 180))
       and (
             o.payment_method = 'cash_on_delivery'
          or (o.payment_method = 'card' and o.payment_status = 'paid')
           )
     order by o.placed_at asc
     limit 50  -- bound per-tick work; backlog drains over subsequent ticks
  loop
    begin
      update public.orders
         set status = 'accepted',
             accepted_at = now()
       where id = v_rec.id
         and status = 'placed';  -- re-check under no lock race: merchant may have just accepted

      -- Only count + audit if we actually moved it (merchant didn't beat us).
      -- actor_role is NULL: the app_role enum has no 'system' member, and a NULL
      -- role honestly says "no human actor — the platform did this on a timeout".
      if found then
        insert into public.order_status_events (order_id, status, actor_role, actor_id, note)
        values (v_rec.id, 'accepted', null, null, 'Auto-accepted (merchant timeout)');
        v_count := v_count + 1;
      end if;
    exception when others then
      -- Best-effort per order: one bad row must not abort the whole sweep.
      raise warning 'auto_accept_sweep: order % failed: % (%)', v_rec.id, sqlerrm, sqlstate;
    end;
  end loop;

  return v_count;
end;
$$;

comment on function public.auto_accept_sweep is
  'Hybrid acceptance safety net (run by pg_cron). When auto_accept_enabled is true, advances COD orders still at ''placed'' past auto_accept_after_seconds to ''accepted'' (system actor) so dispatch_sweep can pick them up. A merchant accepting first pre-empts it. Returns count auto-accepted.';

-- ============================================================================
-- Lock down: cron-only, never client-callable (mirrors dispatch_sweep).
-- ============================================================================
revoke all on function public.auto_accept_sweep() from public, anon, authenticated;
grant execute on function public.auto_accept_sweep() to postgres;

-- ============================================================================
-- Schedule it on the same 20s cadence as dispatch. Order matters only loosely:
-- auto_accept runs, then the next dispatch tick (<=20s later) picks up the now-
-- 'accepted' order. Running them as separate jobs keeps each one simple.
-- ============================================================================
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('sharmeats-auto-accept-sweep');
exception when others then
  null;  -- not scheduled yet
end $$;

select cron.schedule('sharmeats-auto-accept-sweep', '20 seconds', $$select public.auto_accept_sweep();$$);
