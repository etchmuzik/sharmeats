-- 204_audit_round_2_remainder.sql
--
-- ############################################################################
-- ##  NOT APPLIED. This file has never been run against production.          ##
-- ##  Dry-run it transaction-wrapped (BEGIN; ... ROLLBACK;) against a local  ##
-- ##  Postgres first, then apply, then run the Supabase security advisors,   ##
-- ##  then `npm run db:types` (house rules 6 and 7).                         ##
-- ############################################################################
--
-- WHAT THIS IS, AND WHY THE NUMBER JUMPS TO 204
--
-- On 2026-07-31 eleven migrations were applied DIRECTLY to production with no
-- file in this directory. By prod version/name:
--
--   20260731213852  platform_settings_secret_keys_lockdown
--   20260731221607  202a_audit_f01_admin_aal_gate
--   20260731221703  202b_audit_f04_f05_push_outbox_dispatcher
--   20260731221841  202c_audit_f06_cod_status_gate
--   20260731221911  202d_audit_f10_proof_path_fails_closed
--   20260731222016  202e_audit_f11_f12_assign_driver_lock_and_release
--   20260731222106  202f_audit_f13_driver_respond_order_check
--   20260731222146  202g_audit_f14_scheduled_orders_server_gate
--   20260731222542  202h_audit_f15_dispatch_churn_watchdog
--   20260731222648  202i_audit_f17_and_p2_sweep
--   20260731222957  202j_revoke_schedule_trigger_fn_from_public
--
-- Two files in this repo — 202_audit_round_2_security.sql and
-- 203_audit_round_2_dispatch.sql — were written BEFORE that was discovered and
-- fixed largely the SAME defects starting from the REPO's function bodies.
-- They have been deleted rather than applied, because applying them would have:
--
--   * violated house rule 2 — their bodies descend from the repo's last known
--     text, not production's, so every one of them would have silently REVERTED
--     the 2026-07-31 hardening it overlapped;
--   * created a SECOND push-outbox consumer — repo-203 scheduled a cron job
--     named 'sharmeats-push-outbox' while prod already runs
--     'sharmeats-push-outbox-dispatch'. cron.schedule upserts BY NAME, so a new
--     name is a new job, and two consumers on one queue double-send;
--   * collided numerically with the prod 202a–202j series.
--
-- So this migration starts at 204 and contains ONLY what production is still
-- genuinely missing. It DELIBERATELY DOES NOT REDO 202a–202j. Verified present
-- and correct in prod on 2026-08-01 and therefore deliberately absent here:
--   * public.require_admin() itself — 202a created it and it is correct;
--   * private.delivery_encrypt/decrypt search_path (extensions) — fixed by 202i;
--   * private.* tables carrying zero anon/authenticated grants — fixed by 202i.
--
-- METHOD. Every function redefined below was built by editing the output of
--   select pg_get_functiondef(p.oid) from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = '<name>';
-- read from PRODUCTION on 2026-08-01 — never from an older migration in this
-- repo (house rule 2). Each function below says so at its own site.
--
-- Every argument list below was checked byte-for-byte against
--   select pg_get_function_identity_arguments(p.oid) ...
-- on 2026-08-01, so no CREATE OR REPLACE here can produce a second overload and
-- the PGRST202-on-every-call failure that follows (house rule 1).
--
-- Grants are restated explicitly for every function touched, to exactly what
-- production already had (CREATE OR REPLACE preserves grants, so restating is
-- belt-and-braces and makes the intended ACL reviewable in the diff) —
-- house rule 3.
--
-- ---------------------------------------------------------------------------
-- CONTENTS
--   1.  record_cash_handin       — role check fails OPEN; no amount ceiling
--   2.  my_kyc_documents         — EXECUTE granted to PUBLIC and anon
--   3.  recent_push_campaigns    — EXECUTE granted to PUBLIC and anon
--   3b. my_restaurant_settlements / my_restaurant_tier — same defect, found
--       empirically, in a separately deletable block (see its header)
--   4.  auto_accept_sweep        — ignores restaurants.is_open
--   5.  require_admin() wired into the ten money-out RPCs  ** THE P0 **
-- ---------------------------------------------------------------------------


-- ===========================================================================
-- 1. record_cash_handin — the role check fails OPEN, and there is no ceiling.
-- ===========================================================================
--
-- Production's body (read 2026-08-01) gates on:
--
--     if (select public.auth_role()) not in ('admin','dispatcher') then
--
-- public.auth_role() returns app_role and returns NULL for a caller with no
-- role row. `NULL not in ('admin','dispatcher')` evaluates to NULL, not TRUE —
-- so the `if` never fires, the raise never happens, and the caller proceeds to
-- write the driver cash ledger. This is exactly house rule 4, in the one RPC
-- where the consequence is a forged cash movement. Note the shape differs from
-- the `<> 'admin'` case only in using `not in`; the failure mode is identical.
--
-- Fixed the same way the rest of the codebase does it: cast to text and
-- coalesce to '' first, so an unknown role compares as "not one of these" and
-- the branch raises.
--
-- Second change: a ceiling. record_cash_handin is dispatcher-callable by
-- design (dispatchers take cash off drivers at end of shift), so it is the
-- lowest-privilege path into driver_cash_ledger — and it had no bound at all.
-- admin_issue_credit already establishes the pattern and the reasoning ("a
-- fat-finger and compromised-admin blast-radius cap"), but hardcodes 5000. The
-- limits that have needed tuning in this codebase live in platform_settings
-- (driver_cod_hard_limit_egp, sla_credit_max_egp, dispatch_max_ping_age_seconds
-- …), so this one does too — a bad ceiling should be a settings UPDATE, not a
-- migration at 2am.
--
-- The bound is on abs(p_amount_egp) because 'adjustment' is the one reason that
-- may legitimately be signed either way; hand_in and write_off are already
-- forced negative by the existing -abs() below.
--
-- NOT changed: arguments, defaults, return type, volatility, search_path, the
-- reason whitelist, the zero/NULL amount check, the ledger insert, or the
-- balance recomputation. Identity args confirmed identical to production:
--   p_driver_id uuid, p_amount_egp integer, p_reason text, p_note text

insert into public.platform_settings (key, value)
values ('cash_handin_max_egp', to_jsonb(20000))
on conflict (key) do nothing;

create or replace function public.record_cash_handin(
  p_driver_id uuid,
  p_amount_egp integer,
  p_reason text default 'hand_in'::text,
  p_note text default null::text
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_actor   uuid := auth.uid();
  v_balance int;
  v_max     int;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;
  -- CHANGED 2026-08-01 (house rule 4): was
  --   if (select public.auth_role()) not in ('admin','dispatcher')
  -- which is NULL, not TRUE, for a caller with no role row — and so let them
  -- straight through to the ledger insert below.
  if coalesce(public.auth_role()::text, '') not in ('admin','dispatcher') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  if p_reason not in ('hand_in','adjustment','write_off') then
    raise exception 'INVALID_REASON' using errcode = 'check_violation';
  end if;
  if p_amount_egp is null or p_amount_egp = 0 then
    raise exception 'INVALID_AMOUNT' using errcode = 'check_violation';
  end if;

  -- NEW 2026-08-01: per-call blast-radius cap. Double coalesce on purpose —
  -- the inner one covers a NULL jsonb value, the outer covers the settings row
  -- being absent entirely (SELECT INTO leaves v_max NULL and raises nothing).
  -- A missing setting must not mean "no limit".
  select coalesce((value #>> '{}')::int, 20000) into v_max
    from public.platform_settings where key = 'cash_handin_max_egp';
  if abs(p_amount_egp) > coalesce(v_max, 20000) then
    raise exception 'AMOUNT_EXCEEDS_LIMIT' using errcode = 'check_violation';
  end if;

  if not exists (select 1 from public.drivers where id = p_driver_id) then
    raise exception 'DRIVER_NOT_FOUND' using errcode = 'check_violation';
  end if;

  insert into public.driver_cash_ledger (driver_id, delta_egp, reason, note, actor_id)
  values (
    p_driver_id,
    case when p_reason = 'adjustment' then p_amount_egp else -abs(p_amount_egp) end,
    p_reason, nullif(btrim(coalesce(p_note,'')), ''), v_actor
  );

  select coalesce(sum(delta_egp),0)::int into v_balance
    from public.driver_cash_ledger where driver_id = p_driver_id;
  return v_balance;
end;
$function$;

revoke all on function public.record_cash_handin(uuid, integer, text, text)
  from public, anon;
grant execute on function public.record_cash_handin(uuid, integer, text, text)
  to authenticated, service_role;

comment on function public.record_cash_handin(uuid, integer, text, text) is
  'Records a driver cash hand-in / adjustment / write-off. admin + dispatcher only. Role check made fail-closed 2026-08-01 (it was `NULL not in (...)`, which is NULL and let an unknown role through) and bounded by platform_settings.cash_handin_max_egp (default 20000).';


-- ===========================================================================
-- 2 & 3. my_kyc_documents and recent_push_campaigns — EXECUTE to PUBLIC + anon
-- ===========================================================================
--
-- Both had proacl `{=X/postgres, postgres=X, anon=X, authenticated=X,
-- service_role=X}` in production on 2026-08-01. The leading `=X/postgres` is
-- the PUBLIC grant. This is house rule 3: granting to `authenticated` does not
-- revoke the default PUBLIC/anon EXECUTE, and these two never had the REVOKE.
--
-- SEVERITY, honestly stated — this is defence in depth, not a live data leak.
-- Both functions gate INSIDE the query rather than by raising:
--   my_kyc_documents     … and (driver-owns-it or is_merchant_staff or auth_role() = 'admin')
--   recent_push_campaigns … where public.auth_role() = 'admin'
-- For an anon caller auth.uid() is NULL and auth_role() is NULL, so both
-- predicates are NULL, so both return zero rows. The hole is that the only
-- thing standing between anon and KYC documents / push campaign history is a
-- WHERE clause — one future edit to either body that changes the filter shape
-- turns a hardening gap into an exposure. The ACL should not be the last line.
--
-- DELIBERATELY NOT REDEFINING EITHER FUNCTION. A REVOKE/GRANT needs no body
-- change, and not touching the body means there is no possible way for this
-- migration to revert anything 202a–202j did to them. Identity arguments below
-- are copied from pg_get_function_identity_arguments on 2026-08-01:
--   my_kyc_documents      p_subject_type kyc_subject_type, p_subject_id uuid
--   recent_push_campaigns p_limit integer

revoke all on function public.my_kyc_documents(public.kyc_subject_type, uuid)
  from public, anon;
grant execute on function public.my_kyc_documents(public.kyc_subject_type, uuid)
  to authenticated, service_role;

revoke all on function public.recent_push_campaigns(integer)
  from public, anon;
grant execute on function public.recent_push_campaigns(integer)
  to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 3b. THE SAME DEFECT IN TWO MORE FUNCTIONS, FOUND EMPIRICALLY.
--
-- This block was NOT in the original list of five. It came out of sweeping
-- pg_proc for every SECURITY DEFINER function in `public` holding a PUBLIC or
-- anon EXECUTE grant, on 2026-08-01. Many hits are legitimately anon-callable
-- (validate_promo, get_shared_order, resolve_zone, quote_delivery_fee,
-- auth_role, and the trigger functions, where the ACL is irrelevant). These two
-- are not: they are `my_*` SECURITY DEFINER readers over merchant financial
-- data, and they carry PUBLIC + anon EXECUTE for the same house-rule-3 reason.
--
-- CORRECTION, 2026-08-01, from the verification pass. An earlier draft of this
-- comment claimed the sweep found only these two. It did not — that claim was
-- wrong and is retracted here rather than quietly edited away. A precise sweep
-- (grantee = 0 or grantee = anon over aclexplode(proacl)) returns 30 SECURITY
-- DEFINER functions in `public`, of which EIGHT more are self-service RPCs that
-- this migration does NOT fix and that the "legitimately anon-callable" list
-- above does not cover:
--
--   my_driver_tier()             my_loyalty_history(integer)
--   my_loyalty_status()          my_merchant_ids()
--   my_referral_code()           my_favorite_items()
--   get_notification_prefs()     anonymize_my_account()
--
-- Each was read individually and each fails closed on a NULL auth.uid() — the
-- first six raise or filter to zero rows — so this is the same hygiene class
-- described below, not live exposure, and not a reason to hold this migration.
-- They are left for a follow-up sweep so that this file stays auditable against
-- its stated scope. `anonymize_my_account` is the one to do first: it is the
-- only one of the eight that WRITES, and it carries an anon EXECUTE grant.
--
--   my_restaurant_settlements(p_limit integer)  -- filters on is_merchant_staff()
--   my_restaurant_tier()                        -- joins merchant_staff on auth.uid()
--
-- Same severity note as above: anon gets zero rows today, so this is hygiene,
-- not an incident. It is in its own block precisely so it can be deleted whole
-- if you want this migration to stay strictly to the original five items —
-- nothing else here depends on it.
-- ---------------------------------------------------------------------------

revoke all on function public.my_restaurant_settlements(integer)
  from public, anon;
grant execute on function public.my_restaurant_settlements(integer)
  to authenticated, service_role;

revoke all on function public.my_restaurant_tier()
  from public, anon;
grant execute on function public.my_restaurant_tier()
  to authenticated, service_role;


-- ===========================================================================
-- 4. auto_accept_sweep — a closed restaurant still gets orders auto-accepted.
-- ===========================================================================
--
-- The restaurant app has a "pause / close all brands" control that sets
-- restaurants.is_open = false. It stops NEW orders. It does not stop orders
-- already sitting in 'placed', because auto_accept_sweep — production body read
-- 2026-08-01 — selects on o.status, o.placed_at and o.payment_method only, and
-- never looks at the merchant at all. So a merchant who closes mid-service
-- because the kitchen is underwater watches the backlog accept itself
-- 180 seconds later, which is the precise thing the control exists to prevent.
--
-- The fix is an inner join to restaurants with is_open and is_active. Both
-- columns are NOT NULL DEFAULT true in production (checked 2026-08-01), so
-- neither can fail open on a NULL. The join being INNER is also deliberate: an
-- order whose restaurant row has gone missing should not auto-accept either.
--
-- is_active is included alongside is_open because a deactivated merchant
-- auto-accepting orders is the same bug wearing a different flag; if you want
-- this migration to touch strictly the one column named in the audit, drop the
-- `and r.is_active` line and nothing else changes.
--
-- NOT changed: the enabled/after-seconds settings reads, the payment_method
-- predicate, the ordering, the limit of 50, the per-order exception handling,
-- the status_event insert, or the return value. No arguments, so no overload
-- risk; identity args confirmed empty in production.

create or replace function public.auto_accept_sweep()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_enabled bool;
  v_after   int;
  v_count   int := 0;
  v_rec     record;
begin
  select coalesce((value #>> '{}')::bool, false) into v_enabled
    from public.platform_settings where key = 'auto_accept_enabled';
  if not v_enabled then
    return 0;
  end if;

  select coalesce((value #>> '{}')::int, 180) into v_after
    from public.platform_settings where key = 'auto_accept_after_seconds';

  for v_rec in
    select o.id
      from public.orders o
      -- NEW 2026-08-01. INNER join: no merchant row => no auto-accept.
      join public.restaurants r on r.id = o.restaurant_id
     where o.status = 'placed'
       -- The merchant's own pause switch. Both columns are NOT NULL DEFAULT
       -- true, so there is no NULL that could read as "open".
       and r.is_open
       and r.is_active
       and o.placed_at < now() - make_interval(secs => coalesce(v_after, 180))
       and (
             o.payment_method = 'cash_on_delivery'
          or (o.payment_method = 'card' and o.payment_status = 'paid')
           )
     order by o.placed_at asc
     limit 50
  loop
    begin
      update public.orders
         set status = 'accepted',
             accepted_at = now()
       where id = v_rec.id
         and status = 'placed';

      if found then
        insert into public.order_status_events (order_id, status, actor_role, actor_id, note)
        values (v_rec.id, 'accepted', null, null, 'Auto-accepted (merchant timeout)');
        v_count := v_count + 1;
      end if;
    exception when others then
      raise warning 'auto_accept_sweep: order % failed: % (%)', v_rec.id, sqlerrm, sqlstate;
    end;
  end loop;

  return v_count;
end;
$function$;

-- Production ACL on 2026-08-01 was {postgres, service_role} — cron only, no
-- client role. Restated rather than assumed (house rule 3, and the mig 201
-- lesson about not "helpfully" adding authenticated).
revoke all on function public.auto_accept_sweep() from public, anon, authenticated;
grant execute on function public.auto_accept_sweep() to service_role;

comment on function public.auto_accept_sweep() is
  'Auto-accepts merchant-timed-out orders. Since 2026-08-01 skips merchants with is_open = false or is_active = false, so the restaurant app pause control also stops orders already in flight.';


-- ===========================================================================
-- 5. ** THE P0 ** require_admin() is wired to nothing that moves money.
-- ===========================================================================
--
-- Migration 202a created public.require_admin() in production and it is
-- correct: it raises AUTH_REQUIRED on a NULL user, NOT_AUTHORIZED when
-- coalesce(auth_role()::text,'') <> 'admin', and MFA_REQUIRED when the account
-- has a verified factor enrolled but the session is not aal2. It fails closed
-- on every branch.
--
-- And on 2026-08-01 the ONLY function in the entire database that called it was
-- public.admin_mfa_posture() — a status reporter that tells you how many admins
-- have MFA enrolled. The gate built to contain a leaked admin password was
-- installed, tested, and connected to nothing. A stolen admin password on
-- 2026-08-01 still issued credit, still rewrote commission, still marked
-- settlements paid, with no second factor anywhere in the path.
--
-- BUT READ THIS BEFORE YOU THINK APPLYING THIS FILE CLOSES THAT.
-- It does not. require_admin() only reaches its MFA_REQUIRED branch when the
-- caller HAS a verified factor; production has 2 admin users and ZERO verified
-- rows in auth.mfa_factors, database-wide. So on apply, every one of the ten
-- functions below reaches exactly the AUTH_REQUIRED / NOT_AUTHORIZED checks it
-- already had, and a stolen password still works. What this migration does is
-- put the wire in place so that ENROLLING A FACTOR is what closes the hole —
-- today enrolment changes nothing, because nothing consults it.
--
-- The order therefore matters: apply this, THEN enrol TOTP on both admin
-- accounts, THEN rotate the leaked password. Enrolling first without this file
-- is also a no-op; rotating first without either is the only step that helps on
-- its own, and it should not wait for a migration.
--
-- The upside of that same fact: blast radius on apply is zero. Nobody can be
-- locked out by a branch that cannot currently fire.
--
-- WHAT IS WIRED BELOW, AND HOW THE SET WAS CHOSEN. Not from the audit's list —
-- from sweeping pg_proc for every SECURITY DEFINER function in `public` that
-- references credit_ledger, driver_cash_ledger, restaurant_settlements,
-- driver_settlements or restaurants.commission_pct, or is named admin_*, then
-- reading each body. Ten functions get the gate:
--
--   admin_issue_credit             credit_ledger via issue_credit — money out
--   admin_set_commission           sets an attacker-chosen commission rate
--   admin_set_founding_rate_until  sets the discounted-rate expiry — same money
--   admin_grant_cod_override       raises a driver's cash-in-hand ceiling
--   generate_settlements           creates merchant payables
--   finalize_settlement            makes them payable
--   mark_settlement_paid           money out
--   generate_driver_settlements    creates driver payables
--   finalize_driver_settlement     makes them payable
--   mark_driver_settlement_paid    money out
--
-- DELIBERATELY NOT WIRED, with reasons — each of these would be a regression:
--
--   record_cash_handin        dispatcher-callable BY DESIGN (item 1 above).
--                             require_admin() would lock every dispatcher out
--                             of end-of-shift cash. Item 1 fixes its own check
--                             instead.
--   redeem_credit             the CUSTOMER spending their own credit.
--   mark_cod_collected        the DRIVER banking a collected cash order.
--   issue_credit, settlement_sweep, driver_settlement_sweep,
--   driver_cod_capacity, snapshot_order_financials, stamp_order_commission_pct,
--   loyalty_tier_sweep, notify_settlement_change, reject_own_brand_settlement,
--   payment_reconciliation_findings, marketplace_integrity_findings
--                             no `authenticated` grant — cron/definer-internal.
--                             auth.uid() is NULL there, so require_admin()
--                             would raise AUTH_REQUIRED and kill the sweeps.
--   admin_mfa_posture         already calls it; and gating the posture reporter
--                             behind the gate it reports on is circular.
--   admin_test_ops_alert      read-only alert test; must stay usable DURING an
--                             incident, which is exactly when a second factor
--                             is hardest to produce.
--   admin_resolve_user_names  read-only name lookup for dashboard lists.
--   apply_as_restaurant       merchant self-signup; sets the DEFAULT commission
--                             on its own new row, not anyone else's.
--   approve_restaurant        reads commission_pct in a CASE and writes
--                             founding_rate_until; the direct lever for that is
--                             admin_set_founding_rate_until, which IS gated.
--   admin_set_merchant_type   writes commission_pct only to the fixed 100.00
--                             own-brand sentinel, never an attacker-chosen rate.
--   admin_delete_restaurant, admin_update_restaurant, admin_upsert_kitchen,
--   admin_assign_merchant_vertical, admin_set_fx_rate
--                             catalog/ops authority, not money-out. Their
--                             bodies are 1.3–2.7 KB and re-emitting them
--                             verbatim to insert one line is precisely the
--                             house-rule-2 transcription risk this migration
--                             exists to avoid. Worth a follow-up migration
--                             that does them as a batch, with a diff review.
--
-- EVERY EXISTING ROLE CHECK IS KEPT. require_admin() is added as the FIRST
-- statement of each body, in front of the checks already there — defence in
-- depth. Removing any existing check to "avoid duplication" would be a
-- regression, and all ten already fail closed via
-- coalesce(auth_role()::text,'') <> 'admin'.
--
-- CLIENT IMPACT is limited to MFA. require_admin() raises AUTH_REQUIRED and
-- NOT_AUTHORIZED with the same errcode ('check_violation') and the same message
-- strings these functions already raise, so the only genuinely NEW failure an
-- admin-web caller can see is MFA_REQUIRED — and only for an admin who has a
-- verified factor enrolled and is on an aal1 session. Admins with no factor
-- enrolled are unaffected. Check admin_mfa_posture() before applying, so you
-- know who is about to be asked for a code.
--
-- Every body below is production's, read 2026-08-01 via pg_get_functiondef,
-- with exactly one line inserted. Every argument list was confirmed identical
-- to pg_get_function_identity_arguments on the same date.
-- ---------------------------------------------------------------------------


-- --- admin_issue_credit -----------------------------------------------------
-- Prod identity args: p_user_id uuid, p_amount_egp integer, p_reason text,
--                     p_order_id uuid, p_note text
-- Body from production 2026-08-01. Only change: the perform on the first line.
create or replace function public.admin_issue_credit(
  p_user_id uuid,
  p_amount_egp integer,
  p_reason text,
  p_order_id uuid default null::uuid,
  p_note text default null::text
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  perform public.require_admin();   -- NEW 2026-08-01: the 202a gate, finally wired.
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;
  if coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  -- Only the human-compensation reasons. sla_late is machine-issued
  -- (mig 062/101); redeem belongs to redeem_credit.
  if p_reason not in ('refund', 'goodwill', 'adjustment') then
    raise exception 'INVALID_REASON' using errcode = 'check_violation';
  end if;
  -- Sanity ceiling: ~16x the 300 EGP AOV. Not a business rule -- a fat-finger
  -- and compromised-admin blast-radius cap. Two calls for a larger amount is
  -- a feature: it forces a second decision.
  if p_amount_egp is null or p_amount_egp <= 0 or p_amount_egp > 5000 then
    raise exception 'INVALID_AMOUNT' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'USER_NOT_FOUND' using errcode = 'check_violation';
  end if;

  -- Definer-to-definer: runs as owner, so issue_credit's revoked client ACL
  -- does not apply. Its ledger + balance + push side-effects are reused as-is.
  perform public.issue_credit(p_user_id, p_amount_egp, p_reason, p_order_id, p_note);
end;
$function$;

revoke all on function public.admin_issue_credit(uuid, integer, text, uuid, text)
  from public, anon;
grant execute on function public.admin_issue_credit(uuid, integer, text, uuid, text)
  to authenticated, service_role;


-- --- admin_set_commission ---------------------------------------------------
-- Prod identity args: p_restaurant_id uuid, p_pct numeric
-- Body from production 2026-08-01. Only change: the perform on the first line.
create or replace function public.admin_set_commission(
  p_restaurant_id uuid,
  p_pct numeric
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  perform public.require_admin();   -- NEW 2026-08-01.
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;
  if coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  if p_pct is null or p_pct < 0 or p_pct > 50 then
    raise exception 'INVALID_COMMISSION' using errcode = 'check_violation';
  end if;
  -- [126] Own-brand "commission" is an internal transfer, not a rate anyone
  -- pays. Settlement excludes own brands entirely; changing the rate here
  -- would only corrupt the sentinel.
  if exists (
    select 1 from public.restaurants
     where id = p_restaurant_id and merchant_type = 'own_brand'
  ) then
    raise exception 'OWN_BRAND_COMMISSION_IS_INTERNAL' using errcode = 'check_violation';
  end if;
  update public.restaurants
     set commission_pct = p_pct, updated_at = now()
   where id = p_restaurant_id;
  if not found then
    raise exception 'RESTAURANT_NOT_FOUND' using errcode = 'check_violation';
  end if;
end;
$function$;

revoke all on function public.admin_set_commission(uuid, numeric)
  from public, anon;
grant execute on function public.admin_set_commission(uuid, numeric)
  to authenticated, service_role;


-- --- admin_set_founding_rate_until ------------------------------------------
-- Prod identity args: p_restaurant_id uuid, p_until date
-- Body from production 2026-08-01. Only change: the perform on the first line.
create or replace function public.admin_set_founding_rate_until(
  p_restaurant_id uuid,
  p_until date
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  perform public.require_admin();   -- NEW 2026-08-01.
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;
  if coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  if p_until is not null and p_until > (current_date + interval '2 years')::date then
    raise exception 'INVALID_DATE' using errcode = 'check_violation';
  end if;

  update public.restaurants
     set founding_rate_until = p_until,
         updated_at = now()
   where id = p_restaurant_id;
  if not found then
    raise exception 'RESTAURANT_NOT_FOUND' using errcode = 'check_violation';
  end if;
end;
$function$;

revoke all on function public.admin_set_founding_rate_until(uuid, date)
  from public, anon;
grant execute on function public.admin_set_founding_rate_until(uuid, date)
  to authenticated, service_role;


-- --- admin_grant_cod_override -----------------------------------------------
-- Prod identity args: p_driver_id uuid, p_reason text, p_hours integer
-- Body from production 2026-08-01. Only change: the perform on the first line.
create or replace function public.admin_grant_cod_override(
  p_driver_id uuid,
  p_reason text,
  p_hours integer default 12
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_id uuid;
begin
  perform public.require_admin();   -- NEW 2026-08-01.
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;
  if coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'REASON_REQUIRED' using errcode = 'check_violation';
  end if;
  -- Bounded: an override that outlives the shift it was granted for is a
  -- silently raised limit. 72h is already generous.
  if p_hours is null or p_hours < 1 or p_hours > 72 then
    raise exception 'INVALID_DURATION' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.drivers where id = p_driver_id) then
    raise exception 'DRIVER_NOT_FOUND' using errcode = 'check_violation';
  end if;

  insert into public.driver_cod_overrides (driver_id, granted_by, reason, expires_at)
  values (p_driver_id, auth.uid(), btrim(p_reason), now() + make_interval(hours => p_hours))
  returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function public.admin_grant_cod_override(uuid, text, integer)
  from public, anon;
grant execute on function public.admin_grant_cod_override(uuid, text, integer)
  to authenticated, service_role;


-- --- generate_settlements ---------------------------------------------------
-- Prod identity args: p_period_start date, p_period_end date
-- Body from production 2026-08-01. Only change: the perform on the first line.
create or replace function public.generate_settlements(
  p_period_start date,
  p_period_end date
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_count int := 0;
begin
  perform public.require_admin();   -- NEW 2026-08-01.
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='check_violation'; end if;
  if coalesce(public.auth_role()::text,'') <> 'admin' then raise exception 'NOT_AUTHORIZED' using errcode='check_violation'; end if;
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'INVALID_PERIOD' using errcode='check_violation';
  end if;

  with agg as (
    select
      f.restaurant_id,
      count(*) as order_count,
      sum(f.subtotal_egp) as gross_sales,
      sum(f.subtotal_egp) filter (where f.payment_method='cash_on_delivery') as cod_sales,
      sum(f.subtotal_egp) filter (where f.payment_method<>'cash_on_delivery') as card_sales,
      sum(f.commission_egp) as commission,
      -- [083] platform-funded discount on COD orders that the restaurant did not
      -- receive in cash; the platform reimburses it.
      coalesce(sum(f.discount_egp) filter (where f.payment_method='cash_on_delivery'),0) as cod_discount
    from public.order_financials f
    join public.restaurants r on r.id = f.restaurant_id
    where f.delivered_at::date between p_period_start and p_period_end
      -- [126] Own brands are us. A settlement row would be a payable to
      -- ourselves. NOT NULL enum -> this cannot fail open (house rule 4).
      and r.merchant_type <> 'own_brand'
    group by f.restaurant_id
  )
  insert into public.restaurant_settlements (
    restaurant_id, period_start, period_end, order_count,
    gross_sales_egp, cod_sales_egp, card_sales_egp, commission_egp, net_payable_egp, status
  )
  select
    a.restaurant_id, p_period_start, p_period_end, a.order_count,
    a.gross_sales, coalesce(a.cod_sales,0), coalesce(a.card_sales,0), a.commission,
    coalesce(a.card_sales,0) - a.commission + a.cod_discount,  -- [083] + reimbursed COD discount
    'draft'
  from agg a
  on conflict (restaurant_id, period_start, period_end) do update set
    order_count     = excluded.order_count,
    gross_sales_egp = excluded.gross_sales_egp,
    cod_sales_egp   = excluded.cod_sales_egp,
    card_sales_egp  = excluded.card_sales_egp,
    commission_egp  = excluded.commission_egp,
    net_payable_egp = excluded.net_payable_egp,
    updated_at      = now()
  where public.restaurant_settlements.status <> 'paid';

  get diagnostics v_count = row_count;
  return v_count;
end; $function$;

revoke all on function public.generate_settlements(date, date)
  from public, anon;
grant execute on function public.generate_settlements(date, date)
  to authenticated, service_role;


-- --- finalize_settlement ----------------------------------------------------
-- Prod identity args: p_settlement_id uuid
-- Body from production 2026-08-01. Only change: the perform on the first line.
create or replace function public.finalize_settlement(p_settlement_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  perform public.require_admin();   -- NEW 2026-08-01.
  if coalesce(public.auth_role()::text,'') <> 'admin' then raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation'; end if;
  update public.restaurant_settlements
     set status = 'finalized', updated_at = now()
   where id = p_settlement_id and status = 'draft';
  if not found then raise exception 'NOT_DRAFT_OR_MISSING' using errcode = 'check_violation'; end if;
end;
$function$;

revoke all on function public.finalize_settlement(uuid) from public, anon;
grant execute on function public.finalize_settlement(uuid) to authenticated, service_role;


-- --- mark_settlement_paid ---------------------------------------------------
-- Prod identity args: p_settlement_id uuid, p_reference text
-- Body from production 2026-08-01. Only change: the perform on the first line.
create or replace function public.mark_settlement_paid(
  p_settlement_id uuid,
  p_reference text
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  perform public.require_admin();   -- NEW 2026-08-01.
  if coalesce(public.auth_role()::text,'') <> 'admin' then raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation'; end if;
  -- [131] The reference is the audit trail of a real bank transfer: a paid
  -- settlement with no reference is indistinguishable from an unpaid one.
  if nullif(btrim(coalesce(p_reference, '')), '') is null then
    raise exception 'REFERENCE_REQUIRED' using errcode = 'check_violation';
  end if;
  update public.restaurant_settlements
     set status = 'paid', paid_at = now(), paid_reference = btrim(p_reference), updated_at = now()
   where id = p_settlement_id and status = 'finalized';
  if not found then raise exception 'NOT_FINALIZED_OR_MISSING' using errcode = 'check_violation'; end if;
end;
$function$;

revoke all on function public.mark_settlement_paid(uuid, text) from public, anon;
grant execute on function public.mark_settlement_paid(uuid, text) to authenticated, service_role;


-- --- generate_driver_settlements --------------------------------------------
-- Prod identity args: p_period_start date, p_period_end date
-- Body from production 2026-08-01. Only change: the perform on the first line.
create or replace function public.generate_driver_settlements(
  p_period_start date,
  p_period_end date
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_count int := 0;
begin
  perform public.require_admin();   -- NEW 2026-08-01.
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;
  if coalesce(public.auth_role()::text,'') <> 'admin' then raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation'; end if;
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'INVALID_PERIOD' using errcode = 'check_violation';
  end if;

  with agg as (
    select e.driver_id, count(*) as delivery_count,
           sum(e.total) as gross_earnings, sum(e.cod_collected) as cod_collected
    from public.driver_earnings e
    where e.created_at::date between p_period_start and p_period_end
    group by e.driver_id
  )
  insert into public.driver_settlements (
    driver_id, period_start, period_end, delivery_count,
    gross_earnings_egp, cod_collected_egp, net_payable_egp, status
  )
  select a.driver_id, p_period_start, p_period_end, a.delivery_count,
         coalesce(a.gross_earnings,0), coalesce(a.cod_collected,0),
         coalesce(a.gross_earnings,0) - coalesce(a.cod_collected,0), 'draft'
  from agg a
  on conflict (driver_id, period_start, period_end) do update set
    delivery_count     = excluded.delivery_count,
    gross_earnings_egp = excluded.gross_earnings_egp,
    cod_collected_egp  = excluded.cod_collected_egp,
    net_payable_egp    = excluded.net_payable_egp,
    updated_at         = now()
  where public.driver_settlements.status <> 'paid';

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke all on function public.generate_driver_settlements(date, date)
  from public, anon;
grant execute on function public.generate_driver_settlements(date, date)
  to authenticated, service_role;


-- --- finalize_driver_settlement ---------------------------------------------
-- Prod identity args: p_settlement_id uuid
-- Body from production 2026-08-01. Only change: the perform on the first line.
create or replace function public.finalize_driver_settlement(p_settlement_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  perform public.require_admin();   -- NEW 2026-08-01.
  if coalesce(public.auth_role()::text,'') <> 'admin' then raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation'; end if;
  update public.driver_settlements set status = 'finalized', updated_at = now()
   where id = p_settlement_id and status = 'draft';
  if not found then raise exception 'NOT_DRAFT_OR_MISSING' using errcode = 'check_violation'; end if;
end;
$function$;

revoke all on function public.finalize_driver_settlement(uuid) from public, anon;
grant execute on function public.finalize_driver_settlement(uuid) to authenticated, service_role;


-- --- mark_driver_settlement_paid --------------------------------------------
-- Prod identity args: p_settlement_id uuid, p_reference text
-- Body from production 2026-08-01. Only change: the perform on the first line.
--
-- NOTE, not fixed here on purpose: unlike mark_settlement_paid, this one has no
-- REFERENCE_REQUIRED check ([131] was applied to the merchant side only), so a
-- driver settlement can still be marked paid with no bank reference. That is a
-- real gap but it is a NEW defect, not one of the five this migration is scoped
-- to, and it deserves its own migration and its own note in FINANCIALS.md.
create or replace function public.mark_driver_settlement_paid(
  p_settlement_id uuid,
  p_reference text
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  perform public.require_admin();   -- NEW 2026-08-01.
  if coalesce(public.auth_role()::text,'') <> 'admin' then raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation'; end if;
  update public.driver_settlements
     set status = 'paid', paid_at = now(), paid_reference = nullif(btrim(coalesce(p_reference,'')), ''), updated_at = now()
   where id = p_settlement_id and status = 'finalized';
  if not found then raise exception 'NOT_FINALIZED_OR_MISSING' using errcode = 'check_violation'; end if;
end;
$function$;

revoke all on function public.mark_driver_settlement_paid(uuid, text) from public, anon;
grant execute on function public.mark_driver_settlement_paid(uuid, text) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- POST-APPLY VERIFICATION (house rules 1, 3, 6)
--
-- 1. Exactly one overload of every function touched — the PGRST202 check:
--
--   select p.proname, count(*), string_agg(pg_get_function_identity_arguments(p.oid), ' | ')
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('record_cash_handin','auto_accept_sweep','admin_issue_credit',
--                        'admin_set_commission','admin_set_founding_rate_until',
--                        'admin_grant_cod_override','generate_settlements',
--                        'finalize_settlement','mark_settlement_paid',
--                        'generate_driver_settlements','finalize_driver_settlement',
--                        'mark_driver_settlement_paid')
--    group by p.proname having count(*) > 1;      -- must return ZERO rows
--
-- 2. No PUBLIC or anon EXECUTE left on anything touched:
--
--   select p.proname, p.proacl::text
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('my_kyc_documents','recent_push_campaigns',
--                        'my_restaurant_settlements','my_restaurant_tier',
--                        'record_cash_handin','auto_accept_sweep')
--      and (p.proacl::text like '%=X/%' or p.proacl::text like '%anon=X%');
--                                                  -- must return ZERO rows
--
-- 3. The gate is actually wired now — this is the P0 regression test:
--
--   select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.prosrc ilike '%require_admin%' order by 1;
--   -- expect 11 rows: admin_mfa_posture + the ten wired above.
--
-- 4. Then: npm run db:types, and run the Supabase security advisors.
-- ---------------------------------------------------------------------------
