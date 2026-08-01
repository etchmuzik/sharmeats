-- ============================================================================
-- 203 — Audit 2026-07-31, P2 remediation
--
-- Companion to mig 202 (which closed the P0/P1 set). This closes the P2
-- findings that are (a) genuinely fixable in the database and (b) do not need a
-- product decision first. The P2s deliberately NOT fixed here are recorded at
-- the bottom of this file with the reason.
--
-- HOUSE RULE 2 IS THE WHOLE STORY OF THIS MIGRATION. Before writing a line, the
-- live body of every function touched below was hashed and compared against
-- every repo migration that defines it. Two results changed the plan:
--
--   * settle_paymob_payment — the LIVE body is mig 121's, md5
--     82206078ae61f09e7596bc11111b4802. Mig 180's rewrite is NOT what runs in
--     production. The audit cited "180:308"; rewriting the function from 180's
--     body to fix that line would have shipped 180's entire unapplied rewrite
--     as a side effect. This migration patches the LIVE text instead.
--   * create_delivery_job and notify_settlement_change — NO repo migration
--     matches the live body at all (193 and 093 respectively have both drifted).
--     Re-pasting either file's body would have silently reverted whatever
--     out-of-band change produced the live version.
--
-- So the three function fixes below are surgical `pg_get_functiondef` +
-- `replace()` patches (the mig 164/165 pattern), each preceded by an assertion
-- that the exact text being replaced is actually present. If prod has drifted
-- again since this was written, the migration FAILS rather than silently
-- rewriting something it does not recognise.
-- ============================================================================


-- ============================================================================
-- 203a — P2-12: SECURITY DEFINER functions never revoked from PUBLIC/anon
--
-- House rule 3: `grant execute ... to authenticated` does NOT remove the
-- default PUBLIC EXECUTE, so anon holds it. Three definer functions shipped
-- with the grant and no revoke:
--
--   my_kyc_documents          — returns whole kyc_documents rows (national ID,
--                               driving licence, commercial registration, tax
--                               card metadata)
--   recent_push_campaigns     — returns push_campaigns audit rows
--   my_restaurant_settlements — returns restaurant settlement statements
--
-- None LEAKS today, and only by accident of NULL semantics: each predicate
-- reduces to NULL or false for an anon caller, which filters the row out.
-- my_kyc_documents's third disjunct is `public.auth_role() = 'admin'` — the
-- exact fail-open shape house rule 4 exists to ban. Today NULL = 'admin' is
-- NULL and the row is dropped; one added OR branch, or one change in how a
-- role-less call resolves, turns an anon-callable function into a KYC dump.
--
-- Fix both halves: revoke the grant that should never have been there, and make
-- the admin check fail closed on its own terms.
-- ============================================================================

revoke all on function public.my_kyc_documents(kyc_subject_type, uuid) from public, anon;
grant execute on function public.my_kyc_documents(kyc_subject_type, uuid) to authenticated;

revoke all on function public.recent_push_campaigns(int) from public, anon;
grant execute on function public.recent_push_campaigns(int) to authenticated;

revoke all on function public.my_restaurant_settlements(int) from public, anon;
grant execute on function public.my_restaurant_settlements(int) to authenticated;

-- Fail-closed admin disjuncts. Bodies are short and unchanged apart from the
-- coalesce, so these are safe to restate in full (verified against live md5
-- 995d71d3286f8f7524478acde13dfa3b / ff77da51be5fba63deee9d8551dfbb2e).
create or replace function public.my_kyc_documents(p_subject_type kyc_subject_type, p_subject_id uuid)
returns setof public.kyc_documents
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select k.* from public.kyc_documents k
   where k.subject_type = p_subject_type and k.subject_id = p_subject_id
     and (
       (p_subject_type = 'driver' and exists (select 1 from public.drivers d where d.id = p_subject_id and d.profile_id = auth.uid()))
       or (p_subject_type = 'restaurant' and public.is_merchant_staff(p_subject_id))
       -- [203] coalesce, not bare `=`: house rule 4. Same result today, but the
       -- fail-closed form survives a future edit that adds a disjunct.
       or coalesce(public.auth_role()::text, '') = 'admin'
     )
   order by k.created_at desc;
$$;

create or replace function public.recent_push_campaigns(p_limit int default 20)
returns setof public.push_campaigns
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select * from public.push_campaigns
   -- [203] coalesce, not bare `=`: house rule 4.
   where coalesce(public.auth_role()::text, '') = 'admin'
   order by created_at desc
   limit greatest(1, least(coalesce(p_limit,20), 100));
$$;

-- Re-revoke: CREATE OR REPLACE resets the ACL to the default, which includes
-- PUBLIC EXECUTE. Revoking before the replace above would have been undone.
revoke all on function public.my_kyc_documents(kyc_subject_type, uuid) from public, anon;
grant execute on function public.my_kyc_documents(kyc_subject_type, uuid) to authenticated;
revoke all on function public.recent_push_campaigns(int) from public, anon;
grant execute on function public.recent_push_campaigns(int) to authenticated;


-- ============================================================================
-- 203b — P2-16/P2-19: settle_paymob_payment NULL-unsafe txn comparison
--
-- Live body (mig 121's, NOT mig 180's — see the header):
--   if v_order.paymob_txn_id <> btrim(p_provider_txn_id) then
--     raise exception 'ORDER_ALREADY_PAID_BY_ANOTHER_TRANSACTION'
--
-- orders.paymob_txn_id is nullable. If an order reaches payment_status='paid'
-- with a NULL txn id (a manual ops fix-up, or a legacy path that set only
-- payment_status), the comparison evaluates NULL, the incident raise is
-- SKIPPED, and execution falls through to stamp the payment_attempt 'paid' with
-- the new txn id. A second, different provider transaction against an
-- already-paid order — precisely the alarm this branch exists to fire — is
-- swallowed as a benign duplicate.
--
-- The same file already uses the safe form for refunds; this one line missed it.
-- No money moves either way (the orders UPDATE only runs in the pending/failed
-- branch), so this is pre-enable hardening — but card payments are dark today
-- and this must be right before EXPO_PUBLIC_PAYMENTS_CARD_ENABLED flips.
-- ============================================================================

do $$
declare
  v_def text;
  v_old text := 'if v_order.paymob_txn_id <> btrim(p_provider_txn_id) then';
  v_new text := 'if v_order.paymob_txn_id is distinct from btrim(p_provider_txn_id) then';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'settle_paymob_payment';

  if v_def is null then
    raise exception '[203b] settle_paymob_payment not found';
  end if;

  -- Already fixed (re-run, or someone got there first): nothing to do.
  if position(v_new in v_def) > 0 then
    raise notice '[203b] already uses is-distinct-from; skipping';
    return;
  end if;

  -- Fail rather than guess. If prod drifted, a human looks at it.
  if position(v_old in v_def) = 0 then
    raise exception '[203b] expected comparison not found in live body — prod has drifted, refusing to patch blind';
  end if;

  execute replace(v_def, v_old, v_new);
end $$;

-- Prove the patch landed and did not disturb the surrounding logic.
do $$
declare v_src text;
begin
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'settle_paymob_payment';
  if position('is distinct from btrim(p_provider_txn_id)' in v_src) = 0 then
    raise exception '[203b] verify failed: safe comparison absent';
  end if;
  if position('ORDER_ALREADY_PAID_BY_ANOTHER_TRANSACTION' in v_src) = 0 then
    raise exception '[203b] verify failed: incident raise disappeared';
  end if;
  if position('ORDER_AMOUNT_MISMATCH' in v_src) = 0
     or position('PAYMENT_METHOD_MISMATCH' in v_src) = 0 then
    raise exception '[203b] verify failed: an unrelated guard was lost';
  end if;
end $$;


-- ============================================================================
-- 203c — P2-15: create_delivery_job stage re-check fails OPEN on a missing row
--
-- Live body:
--   select * into v_cfg from public.delivery_service_configs where ...
--   if v_cfg.launch_stage = 'disabled' or v_cfg.intake_state <> 'open' then
--
-- With no config row every v_cfg field is NULL, so
-- `NULL = 'disabled' OR NULL <> 'open'` evaluates NULL and the guard is
-- SKIPPED — the job is created. The quote path (mig 192) gets this right by
-- checking `v_cfg.service_area_id is null` first; the job path does not.
--
-- Reaching it needs a valid unconsumed quote plus deletion of the config row
-- inside the quote TTL, so it is narrow — but this re-check exists precisely
-- for "config changed after quoting" ("a quote is not a promise"), and deletion
-- is one of the ways config changes. House rule 4 in the delivery authority
-- path.
-- ============================================================================

do $$
declare
  v_def text;
  v_old text := 'if v_cfg.launch_stage = ''disabled'' or v_cfg.intake_state <> ''open'' then';
  v_new text := 'if v_cfg.service_area_id is null or v_cfg.launch_stage = ''disabled'' or v_cfg.intake_state <> ''open'' then';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_delivery_job';

  if v_def is null then
    raise exception '[203c] create_delivery_job not found';
  end if;

  if position(v_new in v_def) > 0 then
    raise notice '[203c] already guards a missing config row; skipping';
    return;
  end if;

  if position(v_old in v_def) = 0 then
    raise exception '[203c] expected stage re-check not found in live body — prod has drifted, refusing to patch blind';
  end if;

  execute replace(v_def, v_old, v_new);
end $$;

do $$
declare v_src text;
begin
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_delivery_job';
  if position('v_cfg.service_area_id is null' in v_src) = 0 then
    raise exception '[203c] verify failed: null-config guard absent';
  end if;
  -- The quote-consumption logic is the rest of the function's reason to exist.
  if position('QUOTE_ALREADY_CONSUMED' in v_src) = 0
     or position('QUOTE_EXPIRED' in v_src) = 0 then
    raise exception '[203c] verify failed: quote guards were lost';
  end if;
end $$;


-- ============================================================================
-- 203d — P2-05: settlement pushes smuggle a settlement UUID into `orderId`
--
-- notify_settlement_change sends jsonb_build_object('event', ..., 'orderId',
-- new.id::text, ...) where new.id is a restaurant_settlements row — the
-- migration's own comment concedes "settlement id; expo-push requires the
-- field". That contract changed on 2026-07-27: orderId became OPTIONAL and a
-- `route` field was added precisely because senders with no order to point at
-- were smuggling other ids into it. This sender was never migrated.
--
-- SCOPE NOTE (corrects the audit's stated impact): the audit predicted a tap
-- landing on /order/<settlement-id>. It does not — the restaurant app routes on
-- `event` and ignores settlement events entirely, and merchant settlements live
-- in merchant-web which has no push tap handler. So the id is inert today
-- rather than actively breaking a tap. It is still a category error that arms
-- the moment either surface starts honouring orderId, and removing it is free.
--
-- Patched surgically: the live body matches NO repo migration (093 has
-- drifted), so it is not restated.
-- ============================================================================

do $$
declare
  v_def text;
  v_old text := '''orderId'', new.id::text,';
  v_new text := '''route'', ''/settlements'',';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'notify_settlement_change';

  if v_def is null then
    raise exception '[203d] notify_settlement_change not found';
  end if;

  if position(v_old in v_def) = 0 then
    raise notice '[203d] orderId already removed or body drifted; skipping';
    return;
  end if;

  execute replace(v_def, v_old, v_new);
end $$;

do $$
declare v_src text;
begin
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'notify_settlement_change';
  if position('''orderId'', new.id::text' in v_src) > 0 then
    raise exception '[203d] verify failed: settlement id still in orderId';
  end if;
  -- The two events and the staff fan-out are the function's whole purpose.
  if position('settlement_finalized' in v_src) = 0
     or position('settlement_paid' in v_src) = 0
     or position('merchant_staff' in v_src) = 0 then
    raise exception '[203d] verify failed: settlement notification logic was lost';
  end if;
end $$;


-- ============================================================================
-- 203e — P2-04: driver settlements never notify the driver
--
-- notify_settlement_change and its trigger are bound only to
-- restaurant_settlements. driver_settlements (mig 105) has no notification of
-- any kind: no trigger, no http_post, nothing. Drivers carry COD cash and are
-- settled weekly by cron, and they learn a payout happened only by opening the
-- app — which is how cash-reconciliation disputes start.
--
-- The transport and the copy already exist: settlement_finalized and
-- settlement_paid have complete strings in all five locales and are both
-- ESSENTIAL_EVENTS (so they cannot be muted).
--
-- This uses enqueue_push (the outbox) rather than a raw net.http_post like the
-- restaurant sender: mig 202 shipped the dispatcher, so the outbox is now the
-- durable path — a failed send is retried instead of vanishing. The idempotency
-- key is per settlement row per event, so a re-run of the weekly cron cannot
-- double-notify.
-- ============================================================================

create or replace function public.notify_driver_settlement_change()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_event   text;
  v_profile uuid;
begin
  if new.status = 'finalized' and old.status is distinct from 'finalized' then
    v_event := 'settlement_finalized';
  elsif new.status = 'paid' and old.status is distinct from 'paid' then
    v_event := 'settlement_paid';
  else
    return new;
  end if;

  -- push_tokens key on the auth user, which is drivers.profile_id.
  select d.profile_id into v_profile from public.drivers d where d.id = new.driver_id;
  if v_profile is null then return new; end if;

  perform public.enqueue_push(
    p_event              => v_event,
    p_recipient_user_ids => array[v_profile],
    p_idempotency_key    => 'driver_settlement:' || new.id::text || ':' || v_event,
    p_route              => '/history'
  );
  return new;
exception when others then
  -- A settlement must never fail because a notification could not be queued.
  -- Mirrors the restaurant sender's posture.
  return new;
end;
$$;

comment on function public.notify_driver_settlement_change() is
  'Queues settlement_finalized / settlement_paid to the driver when their settlement row transitions. Drivers carry COD cash and were the only settled party receiving no "money moved" push — restaurants had one since mig 093, drivers had none. Mig 203, audit P2-04.';

revoke all on function public.notify_driver_settlement_change() from public, anon, authenticated;

drop trigger if exists driver_settlements_notify_change on public.driver_settlements;
create trigger driver_settlements_notify_change
  after update of status on public.driver_settlements
  for each row execute function public.notify_driver_settlement_change();


-- ============================================================================
-- 203f — P2-13: five SECURITY INVOKER functions with a mutable search_path
--
-- Not exploitable: a SECURITY INVOKER function runs with the caller's own
-- privileges, so a hijacked search_path buys an attacker nothing they did not
-- already have. Three of the five are trigger bodies whose entire content is
-- `raise exception`, and one returns a literal array.
--
-- The cost is signal, not risk: these five permanently occupy the advisor's
-- function_search_path_mutable list, which is exactly the "advisor noise makes
-- real regressions harder to detect" problem M-06 of the 2026-07-24 audit
-- called out. A future migration adding `security definer` to any of them
-- (menu_items_staff_writable_columns is the plausible one — it is read by a
-- definer guard) would create a genuine hijack surface and would not stand out
-- against a list someone has already learned to ignore.
--
-- Pinned by ALTER, so no body is touched and no revert risk exists.
-- ============================================================================

do $$
declare
  r record;
begin
  for r in
    select n.nspname, p.proname,
           pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname, p.proname) in (
             ('public', 'delivery_job_events_immutable'),
             ('private', 'delivery_access_events_immutable'),
             ('public', 'availability_events_immutable'),
             ('public', 'menu_items_staff_writable_columns'),
             ('public', 'search_catalog')
           )
       and p.proconfig is null
  loop
    execute format(
      'alter function %I.%I(%s) set search_path = pg_catalog, public, pg_temp',
      r.nspname, r.proname, r.args
    );
    raise notice '[203f] pinned search_path on %.%', r.nspname, r.proname;
  end loop;
end $$;

-- search_catalog is client-callable and deliberately SECURITY INVOKER; prove the
-- pin did not break it.
do $$
begin
  perform public.search_catalog('test');
exception
  when undefined_function then
    raise notice '[203f] search_catalog(text) signature differs; skipped smoke test';
  when others then
    raise exception '[203f] search_catalog broke after search_path pin: %', sqlerrm;
end $$;


-- ============================================================================
-- 203g — P2-01: place_order accepts an unbounded tip and cart quantity
--
-- place_order validates only `v_qty < 1` and applies `greatest(0, tip)` with no
-- ceiling; the schema checks are one-sided (tip_egp >= 0, quantity > 0). Menu
-- prices got plausibility rails in mig 132 for exactly this reason ("price sits
-- upstream of every money figure") — tip and quantity never did.
--
-- An authenticated caller (including an anonymous-auth guest) can place a COD
-- order with tip = 1,000,000,000 or quantity = 100,000. True int overflow fails
-- closed with a raw Postgres error, but sub-overflow magnitudes sail through and
-- pollute orders / driver_earnings / driver_cash_ledger, feed the COD-exposure
-- ceiling (a delivered absurd order blocks that driver from all further COD
-- dispatch), and skew every revenue and settlement aggregate.
--
-- Enforced as CHECK constraints rather than by editing place_order's ~400-line
-- body: a constraint cannot be reverted by a later CREATE OR REPLACE of the
-- function (house rule 2's failure mode), and it also covers any other writer.
--
-- NOT VALID first so the migration cannot fail on historical rows, then
-- VALIDATE separately — VALIDATE takes only a SHARE UPDATE EXCLUSIVE lock and
-- does not block reads or writes.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_tip_plausible'
  ) then
    -- 5,000 EGP on a tip: far above any real gratuity, far below the magnitudes
    -- that corrupt aggregates. Deliberately generous — this is a rail, not a
    -- policy, and a policy limit belongs in platform_settings.
    alter table public.orders
      add constraint orders_tip_plausible
      check (tip_egp is null or tip_egp <= 5000) not valid;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'order_items_quantity_plausible'
  ) then
    -- 100 units of one line item. A catering order stays inside this; a typo or
    -- an injected quantity does not.
    alter table public.order_items
      add constraint order_items_quantity_plausible
      check (quantity <= 100) not valid;
  end if;
end $$;

-- Validate against existing rows. If prod holds a legitimate row above either
-- rail, this raises and the rail needs revisiting rather than the row being
-- forced through — so it is reported explicitly instead of being swallowed.
do $$
begin
  begin
    alter table public.orders validate constraint orders_tip_plausible;
  exception when check_violation then
    raise warning '[203g] existing orders exceed the tip rail; constraint left NOT VALID (enforced for new rows only). Investigate before validating.';
  end;
  begin
    alter table public.order_items validate constraint order_items_quantity_plausible;
  exception when check_violation then
    raise warning '[203g] existing order_items exceed the quantity rail; constraint left NOT VALID (enforced for new rows only). Investigate before validating.';
  end;
end $$;


-- ============================================================================
-- 203h — P2-00: max_uses promo cap is racy across different users
--
-- validate_promo counts promo_redemptions with no lock on the promo_codes row,
-- and is declared STABLE. place_order's only serialization is a PER-USER
-- advisory lock, which does not serialize two DIFFERENT users redeeming the
-- same code. N concurrent checkouts against a max_uses-capped campaign code can
-- each pass the count check and all redeem — bounded by max_discount_egp per
-- redemption, but exactly what a launch-promo spike produces.
--
-- Fixed with a partial unique index rather than by touching place_order or
-- validate_promo: the count check stays as the friendly pre-flight error, and
-- the index is the authority that cannot be raced. A loser gets a
-- unique_violation, which place_order's transaction rolls back — a failed
-- checkout rather than an over-redeemed code.
--
-- The index numbers each redemption per code by insertion order via a trigger-
-- maintained column; a plain unique index cannot express "at most N rows".
-- ============================================================================

alter table public.promo_redemptions
  add column if not exists redemption_seq integer;

create or replace function public.promo_redemption_assign_seq()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_max_uses integer;
begin
  select pc.max_uses into v_max_uses
    from public.promo_codes pc where pc.id = new.promo_id;

  -- Uncapped codes need no sequence and no serialization.
  if v_max_uses is null then
    return new;
  end if;

  -- Lock the code row so concurrent redeemers of the SAME code serialize here.
  -- Different codes do not contend; this is the narrowest lock that closes the
  -- race. Taken inside the trigger so every writer is covered, not just
  -- place_order.
  perform 1 from public.promo_codes where id = new.promo_id for update;

  select coalesce(max(pr.redemption_seq), 0) + 1 into new.redemption_seq
    from public.promo_redemptions pr
   where pr.promo_id = new.promo_id;

  if new.redemption_seq > v_max_uses then
    raise exception 'PROMO_MAX_USES_EXCEEDED: code is fully redeemed'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.promo_redemption_assign_seq() is
  'Serializes redemptions of a max_uses-capped promo code by locking the promo_codes row and numbering each redemption. validate_promo''s count check is STABLE and unlocked, and place_order''s advisory lock is per-USER, so two different users could both pass the cap check and both redeem. Mig 203, audit P2-00.';

revoke all on function public.promo_redemption_assign_seq() from public, anon, authenticated;

drop trigger if exists promo_redemptions_assign_seq on public.promo_redemptions;
create trigger promo_redemptions_assign_seq
  before insert on public.promo_redemptions
  for each row execute function public.promo_redemption_assign_seq();

-- Belt and braces: even if the trigger is ever dropped, two redemptions cannot
-- share a slot for the same code.
create unique index if not exists promo_redemptions_seq_unique
  on public.promo_redemptions (promo_id, redemption_seq)
  where redemption_seq is not null;


-- ============================================================================
-- 203i — P2-17/P2-20: private tables created in migs 191-193 lack house-rule-5b
--
-- Mig 202 already swept private-schema tables. Re-run for idempotency and to
-- cover anything created since: ALTER DEFAULT PRIVILEGES on this database
-- grants arwdDxtm on every new table, and TRUNCATE ignores RLS, so "RLS on with
-- no policies" is not protection. The table-level revoke is.
-- ============================================================================

do $$
declare t record;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'private' and c.relkind = 'r'
  loop
    execute format('revoke all on table private.%I from public, anon, authenticated', t.relname);
  end loop;
end $$;


-- ============================================================================
-- Deliberately NOT fixed here — each needs a product decision, not a patch:
--
--   P2-21 / P2-25  driver_assigned fires at OFFER time, not acceptance, and its
--                  once-per-order key means a later real acceptance can never
--                  notify. Moving the send to driver_respond's accept branch
--                  changes what the customer is told and when; that is a
--                  product call about the tracking narrative.
--   P2-22          A lapsed offer counts as a full 1-hour rejection cooldown, so
--                  one busy moment can starve an order of its whole nearby
--                  fleet. Splitting expiry from rejection needs a new enum value
--                  and a chosen cooldown — a dispatch-tuning decision.
--   P2-23          The auto_advance 'preparing' timer keys on updated_at, which
--                  dispatch offer-churn refreshes. Fixing it means either a new
--                  preparing_at column or narrowing the touch trigger; both
--                  change timing behaviour that ops has calibrated around.
--   P2-08          notify_order_transition passes no p_vertical. User-facing
--                  impact is nil (expo-push resolves vertical_id itself); the
--                  real issue is the house-rules doc recommending a grep that
--                  cannot see pg_get_functiondef-based patches. That is a docs
--                  change, made separately.
--   P2-09          A late settlement of a locally-cancelled card order writes a
--                  'placed' status event after 'cancelled' and pushes
--                  order_paid. The right behaviour is a refund-oriented
--                  notification and possibly an auto-filed refund claim — a
--                  payments-policy decision, and card is dark.
--   P2-14 / P2-18  Duplicate migration version 197. Fixed by renaming the file
--                  in the repo, not by SQL.
--   P2-02 / P2-03 / P2-10 / P2-11  Client-side; shipped in the app/web changes
--                  alongside this migration.
-- ============================================================================
