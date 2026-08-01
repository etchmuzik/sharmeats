-- 205_sla_credit_integrity.sql
--
-- ############################################################################
-- ##  NOT APPLIED. This file has never been run against production.          ##
-- ##  Dry-run it transaction-wrapped (BEGIN; ... ROLLBACK;) against a local  ##
-- ##  Postgres first, then apply, then run the Supabase security advisors,   ##
-- ##  then `npm run db:types` (house rules 6 and 7).                         ##
-- ############################################################################
--
-- THE PLATFORM HAS PAID OUT MORE IN LATE-DELIVERY CREDITS THAN IT HAS EARNED
-- IN COMMISSION. Measured on production 2026-08-01:
--
--   lifetime commission   sum(commission_egp) from order_financials   EGP 149
--   lifetime sla_late     sum(delta_egp) from credit_ledger           EGP 155
--   lifetime gross margin                                            EGP  -6
--
-- Eight sla_late credits have ever been issued. Six of them name an order, and
-- every one of those six was minted by the same event: an ADMIN flipping a
-- long-abandoned order to 'delivered' days later. From production:
--
--   order      placed_at          eta_at             delivered_at        late
--   4e4de671   07-01 20:07        07-01 20:37        07-05 09:53:24      5116 min
--   1f6b01a1   06-27 19:33        06-27 20:03        07-05 09:53:31     10910 min
--   54747f28   07-02 22:58        07-02 23:28        07-05 09:52:37      3504 min
--   66de399a   07-02 22:54        07-02 23:24        07-05 09:53:13      3509 min
--   96b2968b   07-05 11:18        07-05 12:00        07-06 06:24:12      1104 min
--   be890f69   07-06 23:58        07-07 00:52        07-10 16:13:00      5240 min
--
-- Four of the six land within 68 SECONDS of each other on 2026-07-05, and every
-- one carries an order_status_events row with actor_role='admin' and the SAME
-- admin actor_id. This was one person clearing a backlog of stale orders in a
-- single sitting, and the SLA engine read each keystroke as a delivery that had
-- taken between 18 hours and 7.5 days, and paid out on it.
--
-- WHY IT HAPPENS. advance_order_status writes `delivered_at = now()` at the
-- moment of the transition. So delivered_at is not "when the food reached a
-- door" — it is "when somebody pressed the button". snapshot_order_financials
-- then computes
--
--     v_late_min := extract(epoch from (coalesce(new.delivered_at, now()) - new.eta_at)) / 60.0;
--
-- which for the paved path is exactly `now() - eta_at`, i.e. WALL CLOCK SINCE
-- THE PROMISE. A promise made on 27 June and closed out on 5 July is 7.5 days
-- of lateness that no customer ever experienced, because no food ever moved.
--
-- The lifetime numbers make the shape unmissable: 6 of 12 delivered orders were
-- credited — a 50% payout rate — and NOT ONE of them was a late delivery. The
-- only genuinely late delivery in the platform's history (1213b15e, 6 minutes)
-- was correctly NOT credited, because 6 < the 15-minute grace.
--
-- ============================ THE CONSTRAINT ================================
-- The 15-minute promise is PUBLISHED, in four strings in the customer app
-- (apps/customer/src/i18n/locales/*.json): checkout.promiseSub, order.slaChip,
-- order.slaLine, wallet.subtitle. Egypt's Consumer Protection Law 181/2018
-- makes a published promise enforceable. So this migration does NOT touch the
-- grace, the rate, or the cap. A customer whose food is 20 minutes late is
-- credited exactly as they are today, with no support call. Verified below and
-- in supabase/tests/205_sla_credit_integrity.test.sql.
--
-- BUT BE PRECISE ABOUT WHAT IT DOES NARROW, because the constraint is legal and
-- this file must not overstate its own safety. An earlier draft of this comment
-- claimed the migration "does not touch the automatic delivery of the credit."
-- That was false and is retracted. Item 1 below makes the credit automatic only
-- within (15, 180] minutes. Above 180 the customer gets an ops alert and a human
-- decision instead of an automatic payment, so `order.slaLine` — "credited
-- automatically. No support call needed." — is not literally true in (180, ∞).
--
-- The empirical exposure of that gap is currently zero, and the separation is
-- not marginal: across all 12 delivered orders the largest GENUINE lateness is
-- 5.8 minutes, and the smallest bookkeeping flip is 1104 minutes. Nothing has
-- ever landed between them — the populations are ~190x apart. So no real
-- customer has ever been in the narrowed range, and none has ever been paid for
-- being in it either.
--
-- That is an argument about today's data, not a guarantee about tomorrow's. It
-- is a business and legal call, not a code one. Two ways to close it, for the
-- owner to choose:
--   (a) accept the narrowing and amend `order.slaLine` to say a delivery more
--       than three hours late is reviewed by a person — which is what any
--       operator would actually do; or
--   (b) keep the copy and raise sla_credit_max_late_minutes, accepting that
--       stale-order cleanups above the new bound pay out again.
-- Doing neither leaves a published string that is true in practice and false in
-- principle. This migration ships (a)'s mechanism without (a)'s copy change,
-- because rewriting a customer-facing legal promise is not a migration's call.
--
-- What changes otherwise is only which EVENTS count as a late delivery.
--
-- ============================== THE FIX =====================================
--
-- 1. BOUND THE AUTO-CREDIT WINDOW — new setting sla_credit_max_late_minutes,
--    default 180. Past three hours the claim is not a late delivery; it is a
--    stuck or abandoned order, and the correct response is a human, not a
--    machine payment.
--
--    Why 180 and not something else. The two populations are separated by two
--    orders of magnitude and there is nothing in between:
--      * the promise itself (place_order's honest eta_at) runs 30–60 minutes
--        past placement across every order in the table;
--      * the largest lateness on a delivery that actually happened is 6 min;
--      * the SMALLEST bookkeeping flip is 1,104 min (18.4 hours).
--    Any bound in (6, 1104) separates them perfectly. 180 is picked from the
--    operational end rather than fitted to the data: it is 3x the longest ETA
--    the pricing engine has ever quoted (60 min), so a delivery that goes genuinely,
--    catastrophically wrong — driver breakdown plus a remake plus a
--    reassignment — still lands inside it and still auto-credits. Beyond it the
--    customer has long since phoned, cancelled, or been refunded; nobody in
--    Sharm accepts a kofta four hours after ordering it. Being a
--    platform_setting, it is tunable without a migration if the pilot proves
--    otherwise. It is NOT a way to switch the promise off: a value at or below
--    the grace would make the credit window empty and silently kill a published
--    guarantee, so the function refuses it and falls back to 180.
--
--    Skipping SILENTLY would be worse than the bug, so the skip is loud: an
--    ops_alert naming the order, the customer, the lateness and the amount a
--    human would otherwise have paid, plus a `raise warning` so the record
--    survives even when ops_alert_webhook_url is unset. The customer still gets
--    paid if they deserve it — through admin_issue_credit, by someone who
--    looked. Note admin_issue_credit REFUSES reason 'sla_late' (mig 130: that
--    reason is machine-issued only), so the human path is 'goodwill'. That also
--    means the credit_ledger_one_sla_per_order unique index stays free, and a
--    genuinely late delivery on the same order could still auto-credit later.
--
--    The backlog is derivable at any time — no new table is needed to find who
--    is owed:
--
--      select o.id, o.short_code, o.user_id, o.subtotal_egp, o.eta_at, o.delivered_at,
--             round(extract(epoch from (o.delivered_at - o.eta_at))/60.0) as late_min
--        from public.orders o
--       where o.status = 'delivered'
--         and o.eta_at is not null
--         and o.delivered_at > o.eta_at + interval '180 minutes'
--         and not exists (select 1 from public.credit_ledger c
--                          where c.ref_order_id = o.id and c.reason = 'sla_late')
--       order by o.delivered_at desc;
--
-- 2. REQUIRE A REAL DELIVERY TIMESTAMP — `coalesce(new.delivered_at, now())`
--    is gone from the SLA arithmetic. A NULL delivered_at measured against the
--    wall clock accrues unbounded lateness forever; it is the mechanism by
--    which a missing value becomes a 28-day claim. No timestamp, no evidence of
--    a delivery, nothing to have been late for — so: no credit, and an alert,
--    because a 'delivered' row with no delivered_at is itself a data-integrity
--    event.
--
--    Today advance_order_status is the ONLY writer of status='delivered' and it
--    always stamps delivered_at in the same UPDATE, so on the paved path this
--    branch is unreachable. It is a fail-closed guard against the next writer,
--    not the fix. Being honest about that matters: item 1 is the fix.
--
--    The coalesce in the order_financials INSERT above is DELIBERATELY LEFT
--    ALONE. order_financials.delivered_at is NOT NULL, so removing it there
--    would turn a missing timestamp into an UNBILLED ORDER — trading a payout
--    bug for a revenue bug. Billing wants a bookkeeping date; the SLA wants
--    evidence. They are allowed to differ.
--
-- 3. ONLY CREDIT A GENUINE DELIVERY — already true. The first statement of the
--    production body returns early unless this transition ENTERS 'delivered'.
--    It is restated here fail-closed (house rule 4): the old
--    `new.status <> 'delivered' or old.status = 'delivered'` yields NULL rather
--    than TRUE if either side is NULL, and a NULL `if` does not take the early
--    return — it falls through and bills. OLD is never NULL on an AFTER UPDATE
--    row trigger and orders.status is NOT NULL, so this is a no-op today. It is
--    written as `is distinct from` / explicit NULL test so it stays a no-op if
--    the trigger is ever redefined as INSERT OR UPDATE, where OLD *is* NULL.
--
-- 4. NOT DONE: excluding deliveries advanced by machine bookkeeping. Two
--    findings from production kill this idea rather than defer it.
--
--    (a) auto_advance_sweep CANNOT produce a delivery. Its whole state machine
--        is `accepted -> preparing -> ready`; it never writes 'delivered' and
--        never sets delivered_at. It cannot fire this credit path at all, so
--        there is nothing here to exclude. The six bad credits were admins, not
--        the sweep.
--
--    (b) The actor is NOT VISIBLE from inside this trigger, and adding it would
--        be a trap. advance_order_status inserts its order_status_events row
--        AFTER the `update public.orders`. This is an AFTER ... FOR EACH ROW
--        trigger, so it runs at the end of that UPDATE — before the event row
--        exists. A lookup here would silently read the PREVIOUS event
--        (out_for_delivery) and gate a published guarantee on it. Making it
--        work means reordering advance_order_status, i.e. editing the only
--        writer of orders.status to serve a credit rule. Not worth it.
--
--    And it would be the wrong rule anyway: an admin closing out a genuinely
--    30-minutes-late delivery for a driver whose phone died SHOULD credit. The
--    bound in (1) already separates that case from the 18-hour flips, using the
--    lateness itself rather than a proxy for it.
--
-- 5. FOUND WHILE READING THE BODY — a missing platform_settings row silently
--    BREAKS THE PROMISE. All three settings are read as
--
--      select coalesce((value #>> '{}')::int, 15) into v_grace
--        from public.platform_settings where key = 'sla_credit_grace_minutes';
--
--    and the coalesce is INSIDE the select list. plpgsql's SELECT INTO sets its
--    target to NULL when NO ROW MATCHES, so the coalesce never runs and the
--    "default" is not a default at all. Delete or rename that row and:
--      * v_grace NULL   -> `v_late_min > v_grace` is NULL -> no credit, ever;
--      * v_pct   NULL   -> v_credit NULL -> `v_credit > 0` NULL -> no credit;
--      * v_max   NULL   -> least(NULL, x) = x in Postgres, so the 100 EGP CAP
--                          SILENTLY DISAPPEARS while the other two fail closed.
--    All three rows exist in production today (15 / 10 / 100, verified
--    2026-08-01), so nothing is broken right now — but the body's own comment
--    says "a silent miss is a broken promise", and this is precisely a silent
--    miss. Fixed by defaulting AFTER the select, which is the only place a
--    default can survive a zero-row read.
--
-- ============ WHAT IS PRESERVED, AND HOW YOU CAN SEE IT ======================
-- Byte-identical to production: the grace (15), the rate (10%), the cap (100),
-- `least(v_max, floor(subtotal * v_pct / 100.0)::int)`, the strict `>` on the
-- grace, the `> 0` credit test, the unique_violation swallow that enforces one
-- credit per order (062:83-85), both independent exception handlers, the
-- ops_alert + `raise warning` on failure, the commission/VAT arithmetic, the
-- commission_pct_snapshot resolution and its standard-rate fallback alert, and
-- the order_financials insert including its own coalesce.
--
-- Trace, 20-minutes-late order, subtotal 110 EGP, BEFORE and AFTER:
--   grace 15, pct 10, max 100, max_late 180
--   status enters 'delivered'                     -> continue      (unchanged)
--   delivered_at present                          -> continue      (new, passes)
--   v_late_min = 20.0
--   20.0 > 15                                     -> late          (unchanged)
--   v_credit = least(100, floor(110*10/100)) = 11 (unchanged)
--   20.0 > 180 ? no                               -> auto-credit   (new, passes)
--   issue_credit(user, 11, 'sla_late', order, 'Auto late credit: 20 min late')
--   => identical row in credit_ledger, identical push, identical wallet copy.
--
-- METHOD (house rules 1 and 2). The body below was produced by editing the
-- output of
--   select pg_get_functiondef(p.oid) from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'snapshot_order_financials';
-- read from PRODUCTION on 2026-08-01 — not from migration 135, which is one
-- revision of this body among four (062 -> 075 -> 083 -> 135) and is exactly
-- how 202/203 came to be deleted from this branch.
--
-- Identity checked on the live database the same day:
--   pg_get_function_identity_arguments -> '' (trigger function, no arguments)
--   pg_get_function_result             -> 'trigger'
--   provolatile 'v', prosecdef true, proconfig {search_path=public, pg_temp}
--   proacl {postgres=X/postgres, service_role=X/postgres}
-- All reproduced verbatim below, so this CREATE OR REPLACE cannot mint a second
-- overload and the PGRST202-on-every-call failure that follows.
--
-- NOT DONE HERE, ON PURPOSE: the eight historical sla_late credits, EGP 155,
-- are left exactly where they are. That money is in customers' wallets and has
-- been spendable for weeks; clawing it back is the owner's call and a support
-- conversation, not a migration's. This file changes only what happens NEXT.

-- ---------------------------------------------------------------------------
-- The bound. Tunable without a migration; refused if it would empty the
-- credit window (see item 1).
-- ---------------------------------------------------------------------------
insert into public.platform_settings (key, value)
values ('sla_credit_max_late_minutes', to_jsonb(180))
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- The trigger body. Same name, same (empty) argument list, same trigger return
-- type, same security/search_path — no new overload, and the existing
-- orders_snapshot_financials trigger keeps pointing at it untouched.
-- ---------------------------------------------------------------------------
create or replace function public.snapshot_order_financials()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_rate numeric(5,2); v_vat_pct int; v_commission int; v_grace int;
  v_pct int; v_max int; v_late_min numeric; v_credit int;
  v_standard numeric(5,2);
  v_max_late int;                                        -- 205
begin
  -- 205 item 3: same gate as production, restated fail-closed. Continue ONLY
  -- when this transition ENTERS 'delivered' from a known, different status.
  if new.status is distinct from 'delivered'::order_status_type
     or old.status is null
     or old.status = 'delivered'::order_status_type then
    return new;
  end if;

  -- DEFECT 1: prefer the rate frozen at placement; fall back to the live rate
  -- for orders placed before mig 135 (identical to the old behaviour).
  v_rate := new.commission_pct_snapshot;
  if v_rate is null then
    select commission_pct into v_rate from public.restaurants where id = new.restaurant_id;
  end if;

  -- DEFECT 2: fall back to the STANDARD rate (15), never the founding rate.
  if v_rate is null then
    select coalesce((value #>> '{}')::numeric, 15) into v_standard
      from public.platform_settings where key = 'standard_commission_pct';
    v_rate := coalesce(v_standard, 15);
    -- Unreachable given restaurants.commission_pct is NOT NULL -- so if it
    -- happens, say so rather than silently billing a guess.
    begin
      perform public.ops_alert(
        'commission rate missing for order ' || new.id::text ||
        ' (restaurant ' || new.restaurant_id::text || ') — billed at standard ' || v_rate::text || '%');
    exception when others then null;
    end;
  end if;

  v_commission := floor(coalesce(new.subtotal_egp, 0) * v_rate / 100.0)::int;
  select coalesce((value #>> '{}')::int, 0) into v_vat_pct
    from public.platform_settings where key = 'commission_vat_pct';

  -- DEFECT 3a: the money snapshot gets its own handler. A failure is recorded
  -- for repair and raised as a WARNING -- never silently dropped. The delivery
  -- itself still succeeds: the food is at the door and refusing the status
  -- transition would strand a completed order.
  --
  -- 205: the coalesce on delivered_at STAYS here. order_financials.delivered_at
  -- is NOT NULL; dropping it would turn a missing timestamp into an unbilled
  -- order. Billing wants a bookkeeping date, the SLA wants evidence.
  begin
    insert into public.order_financials (
      order_id, restaurant_id, subtotal_egp, discount_egp, commission_pct, commission_egp,
      commission_vat_egp, delivery_fee_egp, payment_method, delivered_at
    ) values (
      new.id, new.restaurant_id, coalesce(new.subtotal_egp, 0), coalesce(new.discount_egp, 0),
      v_rate, v_commission,
      floor(v_commission * coalesce(v_vat_pct,0) / 100.0)::int,
      coalesce(new.delivery_fee_egp, 0), new.payment_method,
      coalesce(new.delivered_at, now())
    ) on conflict (order_id) do nothing;
  exception when others then
    begin
      insert into public.order_financials_failures (order_id, sqlstate, message)
      values (new.id, sqlstate, sqlerrm)
      on conflict (order_id) do update
        set failed_at = now(), sqlstate = excluded.sqlstate, message = excluded.message;
      perform public.ops_alert('UNBILLED ORDER ' || new.id::text ||
        ' — order_financials snapshot failed: ' || sqlerrm);
    exception when others then null;
    end;
    raise warning 'snapshot_order_financials: order % not billed (%): %', new.id, sqlstate, sqlerrm;
  end;

  -- DEFECT 3b: the SLA credit gets its own handler, so its failure can neither
  -- abort the snapshot above nor vanish. The published promise is
  -- "credited if 15+ minutes late" — a silent miss is a broken promise.
  begin
    select coalesce((value #>> '{}')::int, 15)  into v_grace from public.platform_settings where key = 'sla_credit_grace_minutes';
    select coalesce((value #>> '{}')::int, 10)  into v_pct   from public.platform_settings where key = 'sla_credit_pct';
    select coalesce((value #>> '{}')::int, 100) into v_max   from public.platform_settings where key = 'sla_credit_max_egp';

    -- 205 item 5: SELECT INTO sets its target to NULL when no row matches, so
    -- the coalesce above never fires for a MISSING key. Default out here, where
    -- a zero-row read can still be caught. Same numbers, same promise.
    v_grace := coalesce(v_grace, 15);
    v_pct   := coalesce(v_pct, 10);
    v_max   := coalesce(v_max, 100);

    -- 205 item 1: the auto-credit window. A bound at or below the grace would
    -- empty the credit window and silently retire a published guarantee, so it
    -- is refused rather than honoured.
    select coalesce((value #>> '{}')::int, 180) into v_max_late
      from public.platform_settings where key = 'sla_credit_max_late_minutes';
    if v_max_late is null or v_max_late <= v_grace then
      v_max_late := 180;
    end if;

    -- The delivered_at check comes FIRST, and deliberately outside the eta_at
    -- test. An earlier draft nested it inside `if new.eta_at is not null`, which
    -- made the integrity alert unreachable for the one row shape that needs it
    -- most: delivered, no delivered_at, AND no eta_at — which produced no credit,
    -- no alert and no warning at all. A row marked delivered with no delivery
    -- timestamp is a data-integrity event whether or not a promise was ever made.
    if new.delivered_at is null then
      -- 205 item 2: no timestamp, no evidence of a delivery. Never measure
      -- against the wall clock — that is how a NULL becomes a 28-day claim.
      begin
        perform public.ops_alert(
          'SLA credit SKIPPED for order ' || new.id::text ||
          ' — status is delivered but delivered_at is NULL, so lateness is unknowable.' ||
          ' Investigate the writer; compensate via admin_issue_credit (reason goodwill) if owed.');
      exception when others then null;
      end;
      raise warning 'snapshot_order_financials: order % delivered with NULL delivered_at; SLA credit skipped', new.id;

    elsif new.eta_at is not null then
      -- eta_at NULL with a real delivered_at is not an error: no promise was
      -- made, so there is nothing to be late for and nothing to alert about.
        v_late_min := extract(epoch from (new.delivered_at - new.eta_at)) / 60.0;
        if v_late_min > v_grace then
          v_credit := least(v_max, floor(coalesce(new.subtotal_egp, 0) * v_pct / 100.0)::int);

          -- `and v_credit > 0` so a stale flip on a zero-value order does not
          -- page ops to say nobody would have been paid anything. The bound test
          -- sits above the credit test, so without this an EGP 0 order produced
          -- a WITHHELD alert reading "would have been auto-credited EGP 0".
          if v_late_min > v_max_late and v_credit > 0 then
            -- Beyond the bound this is not a late delivery — it is a stuck or
            -- abandoned order being closed out. Pay nobody automatically; name
            -- it loudly so a human decides. Alert AND warning, because
            -- ops_alert returns silently when no webhook is configured.
            begin
              perform public.ops_alert(
                'SLA credit WITHHELD for order ' || new.id::text ||
                ' — ' || round(v_late_min)::text || ' min past ETA (bound ' || v_max_late::text ||
                '). Looks like a stale-order cleanup, not a late delivery.' ||
                ' Customer ' || coalesce(new.user_id::text, 'unknown') ||
                ' would have been auto-credited EGP ' || coalesce(v_credit, 0)::text ||
                '. Review and use admin_issue_credit (reason goodwill) if genuinely owed.');
            exception when others then null;
            end;
            raise warning 'snapshot_order_financials: order % is % min late (bound %); SLA credit withheld for human review',
              new.id, round(v_late_min), v_max_late;

          elsif v_credit > 0 then
            begin
              perform public.issue_credit(new.user_id, v_credit, 'sla_late', new.id,
                'Auto late credit: ' || round(v_late_min)::text || ' min late');
            exception when unique_violation then null;  -- one credit per order (062:83-85)
            end;
          end if;
        end if;
    end if;
  exception when others then
    begin
      perform public.ops_alert('SLA credit FAILED for late order ' || new.id::text || ': ' || sqlerrm);
    exception when others then null;
    end;
    raise warning 'snapshot_order_financials: SLA credit failed for order %: %', new.id, sqlerrm;
  end;

  return new;
end;
$function$;

-- Grants restated to exactly what production carries today
-- ({postgres=X/postgres, service_role=X/postgres}). Definer-internal: the
-- trigger runs as owner, no client role ever calls it directly (house rule 3).
revoke all on function public.snapshot_order_financials() from public, anon, authenticated;
grant execute on function public.snapshot_order_financials() to service_role;

comment on function public.snapshot_order_financials() is
  'AFTER UPDATE OF status ON orders. Books commission into order_financials and issues the published 15-minute late-delivery credit. Mig 205 bounds the auto-credit at sla_credit_max_late_minutes (180) and requires a real delivered_at, so stale-order cleanup alerts a human instead of minting money.';

-- ---------------------------------------------------------------------------
-- POST-APPLY VERIFICATION (house rules 1, 6, 7)
--
-- 1. Exactly one overload, still a trigger function — the PGRST202 check:
--
--   select count(*), string_agg(coalesce(nullif(pg_get_function_identity_arguments(p.oid),''),'<none>'), ' | ')
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'snapshot_order_financials';
--   -- expect exactly 1 row, count = 1, args '<none>'
--
-- 2. The trigger still points at it and is still enabled:
--
--   select tgname, tgenabled, pg_get_triggerdef(oid)
--     from pg_trigger where tgname = 'orders_snapshot_financials';
--   -- expect: AFTER UPDATE OF status ON public.orders FOR EACH ROW, tgenabled 'O'
--
-- 3. No client EXECUTE leaked in:
--
--   select proacl::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'snapshot_order_financials';
--   -- expect {postgres=X/postgres,service_role=X/postgres}
--
-- 4. The bound is present and sane:
--
--   select key, value from public.platform_settings
--    where key in ('sla_credit_grace_minutes','sla_credit_pct','sla_credit_max_egp',
--                  'sla_credit_max_late_minutes');
--   -- expect 15, 10, 100, 180 — the first three UNCHANGED.
--
-- 5. The promise is still live end to end. Place a real order in staging, let
--    it go 16+ minutes past eta_at, deliver it through advance_order_status,
--    and confirm a credit_ledger row with reason='sla_late' appears and the
--    wallet screen shows it. That is the assertion the i18n strings make.
--
-- 6. Then: npm run db:types, and run the Supabase security advisors.
-- ---------------------------------------------------------------------------
