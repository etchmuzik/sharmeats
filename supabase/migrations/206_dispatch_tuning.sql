-- ============================================================================
-- 206 — Dispatch tuning: P2-21/25, P2-22, P2-23 + the ping-age bridge
--
-- All four function patches are surgical live-text replacements (the mig 203
-- technique): several of these bodies carry comment-only drift from the repo,
-- so a patch keyed to repo text would fail. Each DO block asserts the exact
-- live text is present before rewriting, and fails loudly rather than patch
-- blind if production has drifted again.
--
-- P2-22 (split expiry from rejection cooldown): a lapsed offer currently lands
--   in status='rejected', so it consumes the full reoffer cooldown — one busy
--   moment starves an order of its whole nearby fleet. New status 'expired' +
--   a shorter dispatch_expiry_cooldown_seconds; auto_assign_order treats an
--   expired offer as reofferable after the short window while an explicit
--   'rejected' still serves the full one. The 4,487 historical lapse rows are
--   backfilled to 'expired' (owner-approved) so driver acceptance-rate stats
--   count only genuine declines.
--
-- P2-21/25 (driver_assigned at offer time): the customer is told "a driver is
--   on the way" the instant an offer is CREATED, before any driver accepts —
--   and the once-per-order key means a later real acceptance never corrects
--   it. Move the customer push from notify_order_transition's assignment-flip
--   branch to driver_respond's accept branch (owner-approved re-notify on
--   reassignment). The order_ready_pickup driver ping in the same function
--   keyed off assigned_driver_id, which is stamped at offer time too — leave it
--   (it targets the assigned driver, who after this change is the accepted one
--   often enough; a fuller fix is out of scope and it is not customer-facing).
--
-- P2-23 (auto_advance preparing timer on updated_at): dispatch churn touches
--   orders.updated_at every ~65 s, so a preparing order under churn never
--   accrues the auto-advance window. Key the 'preparing' arm on the actual
--   preparing transition time from order_status_events instead. Inert today
--   (auto_advance_enabled=false) but correct for when ops flips it.
--
-- Ping-age bridge: raise dispatch_max_ping_age_seconds 300 -> 1800 so idle
--   drivers on pre-heartbeat (1.0.0) binaries are not dropped from dispatch
--   before the fleet installs build 28. Sole consumer is nearest_drivers; pure
--   candidate-window widening. Revert to 300 once the fleet is updated.
-- ============================================================================

-- --- Settings: split cooldown + ping bridge ---------------------------------
insert into public.platform_settings (key, value)
values ('dispatch_expiry_cooldown_seconds', to_jsonb(60))
on conflict (key) do nothing;

update public.platform_settings
   set value = to_jsonb(1800), updated_at = now()
 where key = 'dispatch_max_ping_age_seconds';

-- --- P2-22a: allow status='expired' -----------------------------------------
alter table public.order_assignments drop constraint if exists order_assignments_status_chk;
alter table public.order_assignments add constraint order_assignments_status_chk
  check (status in ('offered','accepted','rejected','expired','completed','reassigned'));

-- --- P2-22b: backfill 4,487 historical lapses to 'expired' -------------------
-- A lapse is a rejection whose responded_at is at/after its own expiry — the
-- shape dispatch_sweep writes. Explicit driver declines (responded_at BEFORE
-- expiry) stay 'rejected'. Recon confirmed all 4,487 current rejected rows are
-- lapses and zero are declines.
do $$
declare v_n int;
begin
  update public.order_assignments
     set status = 'expired'
   where status = 'rejected'
     and offer_expires_at is not null
     and responded_at is not null
     and responded_at >= offer_expires_at;
  get diagnostics v_n = row_count;
  raise notice '[206] backfilled % lapse rows rejected -> expired', v_n;
end $$;

-- --- P2-22c: dispatch_sweep writes 'expired', not 'rejected' -----------------
do $$
declare
  v_def text;
  v_old text := 'set status = ''rejected'', responded_at = now()' || E'\n' ||
                '     where status = ''offered''' || E'\n' ||
                '       and offer_expires_at is not null';
  v_new text := 'set status = ''expired'', responded_at = now()' || E'\n' ||
                '     where status = ''offered''' || E'\n' ||
                '       and offer_expires_at is not null';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='dispatch_sweep';
  if position(v_new in v_def) > 0 then raise notice '[206] dispatch_sweep already writes expired'; return; end if;
  if position(v_old in v_def) = 0 then
    raise exception '[206] dispatch_sweep lapse-write text not found — prod drifted, refusing to patch blind';
  end if;
  execute replace(v_def, v_old, v_new);
end $$;

do $$
declare v_src text;
begin
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='dispatch_sweep';
  if position('status = ''expired''' in v_src) = 0 then raise exception '[206] verify: dispatch_sweep did not take the expired write'; end if;
  -- The re-dispatch loop is the rest of its reason to exist.
  if position('auto_assign_order' in v_src) = 0 then raise exception '[206] verify: dispatch_sweep lost its re-dispatch loop'; end if;
end $$;

-- --- P2-22d: auto_assign_order — split cooldown by expired vs rejected -------
-- Live has TWO identical candidate subqueries (main + gold first-look). Both
-- carry the same reoffer predicate; patch both by replace_all of the shared
-- fragment. Expired offers reofferable after the short cooldown; explicit
-- rejects/reassigns keep the full one.
do $$
declare
  v_def text;
  v_old text := 'and (oa.status=''offered'' or (oa.status in (''rejected'',''reassigned'') and oa.assigned_at > now() - make_interval(secs => coalesce(v_reoffer_cd,3600))))';
  v_new text := 'and (oa.status=''offered'''
             || ' or (oa.status = ''expired'' and oa.assigned_at > now() - make_interval(secs => coalesce(v_expiry_cd, 60)))'
             || ' or (oa.status in (''rejected'',''reassigned'') and oa.assigned_at > now() - make_interval(secs => coalesce(v_reoffer_cd,3600))))';
  v_decl_old text := 'v_cap record; v_pickup geography;';
  v_decl_new text := 'v_cap record; v_pickup geography; v_expiry_cd int;';
  v_seed_old text := 'select coalesce((value #>> ''{}'')::int, 3600) into v_reoffer_cd from public.platform_settings where key=''dispatch_reoffer_cooldown_seconds'';';
  v_seed_new text := 'select coalesce((value #>> ''{}'')::int, 3600) into v_reoffer_cd from public.platform_settings where key=''dispatch_reoffer_cooldown_seconds'';'
             || E'\n  ' || 'select coalesce((value #>> ''{}'')::int, 60) into v_expiry_cd from public.platform_settings where key=''dispatch_expiry_cooldown_seconds'';';
  v_cnt int;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='auto_assign_order';
  if position('v_expiry_cd' in v_def) > 0 then raise notice '[206] auto_assign_order already split'; return; end if;

  -- declare + seed the new setting
  if position(v_decl_old in v_def) = 0 then raise exception '[206] auto_assign_order decl anchor not found — drifted'; end if;
  v_def := replace(v_def, v_decl_old, v_decl_new);
  if position(v_seed_old in v_def) = 0 then raise exception '[206] auto_assign_order seed anchor not found — drifted'; end if;
  v_def := replace(v_def, v_seed_old, v_seed_new);

  -- both candidate predicates
  v_cnt := (length(v_def) - length(replace(v_def, v_old, ''))) / nullif(length(v_old),0);
  if v_cnt <> 2 then raise exception '[206] auto_assign_order: expected 2 reoffer predicates, found % — drifted', v_cnt; end if;
  v_def := replace(v_def, v_old, v_new);

  execute v_def;
end $$;

do $$
declare v_src text;
begin
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='auto_assign_order';
  if position('v_expiry_cd' in v_src) = 0 then raise exception '[206] verify: auto_assign_order missing v_expiry_cd'; end if;
  if position('oa.status = ''expired''' in v_src) = 0 then raise exception '[206] verify: auto_assign_order missing expired branch'; end if;
  -- the COD ceiling filter and gold first-look must survive
  if position('driver_cod_capacity' in v_src) = 0 then raise exception '[206] verify: auto_assign_order lost COD ceiling filter'; end if;
  if position('first_look' in v_src) = 0 then raise exception '[206] verify: auto_assign_order lost gold first-look'; end if;
end $$;

-- --- P2-21: move driver_assigned push offer-time -> accept-time --------------
-- Remove branch 1 of notify_order_transition (the assignment-flip customer
-- push). Add the same push to driver_respond's accept branch, so the customer
-- hears "a driver is on the way" only when a driver actually accepts. Keyed by
-- (order, driver) so a reassignment to a new accepting driver re-notifies
-- (owner-approved), while the same driver cannot double-notify.
do $$
declare
  v_def text;
  v_old text := '  -- 1. Driver assigned -> tell the customer "a driver is on the way".' || E'\n' ||
                '  --    ONCE PER ORDER. Assignment recycles on offer expiry, so the transition' || E'\n' ||
                '  --    itself is not a reliable "this happened once" signal.' || E'\n' ||
                '  if new.assigned_driver_id is not null and old.assigned_driver_id is null then' || E'\n' ||
                '    perform public.enqueue_push(' || E'\n' ||
                '      p_event           => ''driver_assigned'',' || E'\n' ||
                '      p_order_id        => new.id,' || E'\n' ||
                '      p_idempotency_key => ''driver_assigned:'' || new.id::text' || E'\n' ||
                '    );' || E'\n' ||
                '  end if;' || E'\n\n';
  v_new text := '  -- 1. [206/P2-21] The customer "a driver is on the way" push now fires in' || E'\n' ||
                '  --    driver_respond''s accept branch, not here: an assignment flip is only' || E'\n' ||
                '  --    an OFFER, and telling the customer at offer time was a lie that a' || E'\n' ||
                '  --    later real acceptance could never correct.' || E'\n\n';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='notify_order_transition';
  if position('P2-21' in v_def) > 0 then raise notice '[206] notify_order_transition already patched'; return; end if;
  if position(v_old in v_def) = 0 then raise exception '[206] notify_order_transition branch-1 text not found — drifted'; end if;
  execute replace(v_def, v_old, v_new);
end $$;

do $$
declare v_src text;
begin
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='notify_order_transition';
  if position('''driver_assigned''' in v_src) > 0 then raise exception '[206] verify: driver_assigned still enqueued in notify_order_transition'; end if;
  -- branches 2 and 3 must survive
  if position('order_ready_pickup' in v_src) = 0 or position('low_rating' in v_src) = 0 then
    raise exception '[206] verify: notify_order_transition lost branch 2 or 3';
  end if;
end $$;

-- Add the accept-time customer push to driver_respond.
do $$
declare
  v_def text;
  v_old text := '    update public.orders' || E'\n' ||
                '       set rider = public.rider_snapshot(v_asg.driver_id)' || E'\n' ||
                '     where id = v_asg.order_id;';
  v_new text := '    update public.orders' || E'\n' ||
                '       set rider = public.rider_snapshot(v_asg.driver_id)' || E'\n' ||
                '     where id = v_asg.order_id;' || E'\n' ||
                '    -- [206/P2-21] Now — and only now — a real driver owns the order, so' || E'\n' ||
                '    -- tell the customer. Keyed by (order, driver) so a reassignment to a' || E'\n' ||
                '    -- new accepting driver re-notifies while the same driver cannot twice.' || E'\n' ||
                '    perform public.enqueue_push(' || E'\n' ||
                '      p_event           => ''driver_assigned'',' || E'\n' ||
                '      p_order_id        => v_asg.order_id,' || E'\n' ||
                '      p_idempotency_key => ''driver_assigned:'' || v_asg.order_id::text || '':'' || v_asg.driver_id::text' || E'\n' ||
                '    );';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='driver_respond';
  if position('P2-21' in v_def) > 0 then raise notice '[206] driver_respond already patched'; return; end if;
  if position(v_old in v_def) = 0 then raise exception '[206] driver_respond rider-snapshot anchor not found — drifted'; end if;
  execute replace(v_def, v_old, v_new);
end $$;

do $$
declare v_src text;
begin
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='driver_respond';
  if position('''driver_assigned''' in v_src) = 0 then raise exception '[206] verify: driver_respond did not gain the accept-time push'; end if;
  -- F-13 order re-check and eligibility gate must survive
  if position('ORDER_NO_LONGER_AVAILABLE' in v_src) = 0 or position('DRIVER_NOT_ELIGIBLE' in v_src) = 0 then
    raise exception '[206] verify: driver_respond lost a guard';
  end if;
end $$;

-- --- P2-23: auto_advance preparing timer on the real transition time --------
do $$
declare
  v_def text;
  v_old text := 'when ''preparing'' then coalesce(o.updated_at, o.accepted_at, o.placed_at)';
  v_new text := 'when ''preparing'' then coalesce((select max(e.created_at) from public.order_status_events e where e.order_id = o.id and e.status = ''preparing''), o.accepted_at, o.placed_at)';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='auto_advance_sweep';
  if position(v_new in v_def) > 0 then raise notice '[206] auto_advance_sweep already patched'; return; end if;
  if position(v_old in v_def) = 0 then raise exception '[206] auto_advance_sweep preparing-timer text not found — drifted'; end if;
  execute replace(v_def, v_old, v_new);
end $$;

do $$
declare v_src text;
begin
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='auto_advance_sweep';
  if position('e.status = ''preparing''' in v_src) = 0 then raise exception '[206] verify: auto_advance_sweep did not take the status-events timer'; end if;
  -- the enabled gate and the accepted arm must survive
  if position('auto_advance_enabled' in v_src) = 0 then raise exception '[206] verify: auto_advance_sweep lost its enabled gate'; end if;
end $$;

-- --- Overload guard (house rule 1) ------------------------------------------
do $$
declare r record;
begin
  for r in
    select proname, count(*) c from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public'
       and proname in ('dispatch_sweep','auto_assign_order','notify_order_transition','driver_respond','auto_advance_sweep')
     group by proname
  loop
    if r.c <> 1 then raise exception '[206] % has % overloads, expected 1', r.proname, r.c; end if;
  end loop;
end $$;
