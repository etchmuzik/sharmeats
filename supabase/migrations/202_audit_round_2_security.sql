-- 202_audit_round_2_security.sql
--
-- STATUS: **NOT APPLIED**. Written 2026-07-31 from the round-2 audit; it has
-- never been run against production, a branch, or the local harness beyond the
-- transaction-wrapped replay in supabase/tests/202_audit_round_2_security.test.sql.
-- Apply the usual way — `BEGIN; \i this file; ROLLBACK;` against a local
-- Postgres with the production schema first, then the Supabase security
-- advisors afterwards, then `npm run db:types`.
--
-- Everything here is transactional DDL (ALTER FUNCTION, CREATE OR REPLACE
-- FUNCTION, GRANT/REVOKE, a settings INSERT). There is no CREATE INDEX
-- CONCURRENTLY, no ALTER TYPE ... ADD VALUE, nothing that must run outside a
-- transaction — so the whole file can be wrapped and rolled back cleanly, which
-- is the point of the dry run in house rule 6.
--
-- Every statement is re-runnable: REVOKE/GRANT are idempotent, ALTER FUNCTION
-- ... SET overwrites, CREATE OR REPLACE keeps the same signature, and the
-- settings insert is ON CONFLICT DO NOTHING.
--
-- Six defects, no new behaviour. Nothing here adds a feature or a table.
--
--   1. record_cash_handin's role check fails OPEN on a NULL role, and has no
--      amount ceiling.
--   2. recent_push_campaigns is EXECUTE-able by PUBLIC/anon.
--   3. my_kyc_documents (and my_restaurant_settlements) likewise.
--   4. private.delivery_encrypt/decrypt pin a search_path that cannot see
--      pgcrypto, so they raise 42883 on every call in production.
--   5. Five private-schema tables from migs 191-193 never got the house-rule-5b
--      revoke.
--   6. The five advisor-flagged mutable-search_path functions.
--
-- NOT touched, deliberately: settle_paymob_payment has the same house-rule-4
-- NULL-unsafe `<>` as record_cash_handin. All card-payment work is deferred by
-- the owner, and card is dark in prod
-- (EXPO_PUBLIC_PAYMENTS_CARD_ENABLED=false), so it is written up in
-- FOLLOWUPS-migration-202.md rather than half-fixed here.


-- ===========================================================================
-- 1. record_cash_handin — fail closed on a NULL role, and cap the amount.
-- ===========================================================================
--
-- TWO PROBLEMS, ONE FUNCTION.
--
-- (a) The role gate is `if (select public.auth_role()) not in ('admin','dispatcher')`.
--     auth_role() is `select role from public.users where id = auth.uid()`, so
--     it returns NULL for any caller with no row in public.users — an
--     authenticated JWT whose signup trigger did not fire, a service-role call,
--     or anyone whose user row was deleted. `NULL not in (...)` is NULL, and
--     plpgsql treats a NULL `if` as false, so the exception is NOT raised and
--     the caller proceeds. That is the exact fail-open shape house rule 4
--     exists to ban. coalesce(...::text, '') makes the unknown case fail closed.
--
-- (b) There is no ceiling on p_amount_egp. This RPC is DISPATCHER-callable and
--     it is the only thing that moves a driver's cash liability down: a
--     'hand_in' or 'write_off' erases cash the driver is holding, and a
--     negative 'adjustment' does the same with a nicer name. A dispatcher who
--     wants to make 40,000 EGP of custody disappear needs one call. Mig 149
--     already bounds how much cash a driver may ACCUMULATE
--     (driver_cod_hard_limit_egp = 5000); nothing bounded how much may be
--     written off in one act.
--
-- The ceiling is two platform_settings rows, following the shape every other
-- limit in this database uses (cod_max_active_orders_per_user 065,
-- sla_credit_max_egp 062, max_delivery_radius_m 079, driver_cod_*_limit_egp
-- 149): `coalesce((value #>> '{}')::int, <default>)`, tunable without a
-- migration.
--
-- Two settings rather than one, because the two acts are not the same act:
--
--   cash_handin_max_egp (20000) — a real deposit. Generous on purpose: a
--     driver's cash ceiling is 5000 and observe mode means it is not yet
--     enforced, so a multi-shift catch-up deposit is plausible. This is a
--     fat-finger and mass-erasure guard, not an operating limit.
--
--   cash_adjustment_max_egp (2000) — a correction or a write-off. Corrections
--     are small by nature (a short count, a rounding, a damaged note). A
--     LARGE write-off is a decision someone should have to make deliberately by
--     raising the setting, not something that fits inside a routine RPC call.
--
-- Both are checked on abs(), because 'adjustment' is signed and the dangerous
-- direction is the negative one.
--
-- HOUSE RULE 1: same argument list (uuid, int, text, text) as mig 104, so
-- CREATE OR REPLACE amends the existing function rather than creating a second
-- overload. HOUSE RULE 2: the body below starts from mig 104's definition,
-- which grep confirms is the ONLY definition — no later migration recreates or
-- ALTERs record_cash_handin, so there is no later hardening to revert. The two
-- changes are the coalesce on the role check and the ceiling block; everything
-- else, including `set search_path to 'public', 'pg_temp'`, is byte-identical.

insert into public.platform_settings (key, value) values
  ('cash_handin_max_egp',     to_jsonb(20000)),
  ('cash_adjustment_max_egp', to_jsonb(2000))
on conflict (key) do nothing;

create or replace function public.record_cash_handin(
  p_driver_id uuid,
  p_amount_egp int,
  p_reason text default 'hand_in',
  p_note text default null
)
returns int
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_actor uuid := auth.uid();
  v_balance int;
  v_max int;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;
  -- House rule 4: coalesce to '' so a caller with no public.users row (NULL
  -- role) is refused. `NULL not in (...)` is NULL, which plpgsql reads as
  -- false, which would have let them through.
  if coalesce((select public.auth_role())::text, '') not in ('admin','dispatcher') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  if p_reason not in ('hand_in','adjustment','write_off') then
    raise exception 'INVALID_REASON' using errcode = 'check_violation';
  end if;
  if p_amount_egp is null or p_amount_egp = 0 then
    raise exception 'INVALID_AMOUNT' using errcode = 'check_violation';
  end if;

  -- Ceiling. Checked on abs() because 'adjustment' is signed and the direction
  -- that destroys custody is the negative one.
  if p_reason = 'hand_in' then
    select coalesce((value #>> '{}')::int, 20000) into v_max
      from public.platform_settings where key = 'cash_handin_max_egp';
    v_max := coalesce(v_max, 20000);
  else
    select coalesce((value #>> '{}')::int, 2000) into v_max
      from public.platform_settings where key = 'cash_adjustment_max_egp';
    v_max := coalesce(v_max, 2000);
  end if;
  if abs(p_amount_egp) > v_max then
    raise exception 'AMOUNT_ABOVE_CEILING' using errcode = 'check_violation',
      detail = format('reason=%s amount=%s ceiling=%s', p_reason, p_amount_egp, v_max);
  end if;

  if not exists (select 1 from public.drivers where id = p_driver_id) then
    raise exception 'DRIVER_NOT_FOUND' using errcode = 'check_violation';
  end if;

  -- hand_in and write_off DECREASE the driver's held cash (store as negative);
  -- adjustment is signed as passed (admin can correct up or down).
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

-- House rule 3, restated after the replace (CREATE OR REPLACE preserves the
-- existing ACL, but stating it keeps the grant next to the definition and makes
-- the file safe to replay onto a database where 104's revoke never landed).
revoke all on function public.record_cash_handin(uuid, int, text, text) from public, anon;
grant execute on function public.record_cash_handin(uuid, int, text, text) to authenticated;

comment on function public.record_cash_handin is
  'ADMIN/DISPATCHER: record a driver cash hand-in (−), adjustment (±), or write-off (−). Returns the driver''s new cash-on-hand balance. Role check fails CLOSED on a NULL role (house rule 4) and the amount is capped by platform_settings.cash_handin_max_egp / cash_adjustment_max_egp. Migs 104, 202.';


-- ===========================================================================
-- 2+3. Definer functions that were granted to authenticated but never revoked
--      from PUBLIC.
-- ===========================================================================
--
-- House rule 3, in its exact failure mode: `grant execute ... to authenticated`
-- does NOT remove the default PUBLIC EXECUTE that every function is created
-- with. anon therefore holds EXECUTE on all three of these SECURITY DEFINER
-- functions today, and they appear in the advisor's anon-executable-definer
-- list.
--
-- None of them leaks at HEAD, and it is worth being precise about why, because
-- the reason is not the design — it is NULL semantics. Each one's predicate
-- reduces to `auth.uid()`-based ownership or `public.auth_role() = 'admin'`;
-- for anon both are NULL, and a NULL row filter drops the row. So they fail
-- closed by accident of three-valued logic rather than by an authorization
-- check. That is fine until someone adds an OR branch.
--
-- Two changes per function: the missing REVOKE, and the admin disjunct
-- rewritten to the fail-closed `coalesce(...::text,'') = 'admin'` shape that
-- house rule 4 mandates, so the accident becomes a decision.
--
-- HOUSE RULE 2 check: grep confirms 075:123 is the only definition of
-- my_kyc_documents, 078:141 the only one of recent_push_campaigns, and 074:169
-- the only one of my_restaurant_settlements. Nothing later amended any of them,
-- so restating these bodies reverts no hardening. Signatures unchanged
-- (house rule 1).

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
       -- House rule 4: `auth_role() = 'admin'` is NULL for a role-less caller.
       -- It filters the row out today, but "unknown" must be an explicit no.
       or coalesce(public.auth_role()::text, '') = 'admin'
     )
   order by k.created_at desc;
$$;
revoke all on function public.my_kyc_documents(kyc_subject_type, uuid) from public, anon;
grant execute on function public.my_kyc_documents(kyc_subject_type, uuid) to authenticated;

comment on function public.my_kyc_documents is
  'A driver / merchant staffer lists their OWN KYC documents; admin sees any. SECURITY DEFINER over kyc_documents (national ID, licence, commercial registration), so it is revoked from PUBLIC/anon and the admin disjunct fails closed on a NULL role. Migs 075, 202.';

create or replace function public.recent_push_campaigns(p_limit int default 20)
returns setof public.push_campaigns
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select * from public.push_campaigns
   -- House rule 4, same reasoning as my_kyc_documents above.
   where coalesce(public.auth_role()::text, '') = 'admin'
   order by created_at desc
   limit greatest(1, least(coalesce(p_limit,20), 100));
$$;
revoke all on function public.recent_push_campaigns(int) from public, anon;
grant execute on function public.recent_push_campaigns(int) to authenticated;

comment on function public.recent_push_campaigns is
  'ADMIN: the campaign audit trail, newest first, limit clamped 1..100. Revoked from PUBLIC/anon and the admin check fails closed on a NULL role. Migs 078, 202.';

-- Same grant-without-revoke as the two above (074:180). The predicate here is
-- is_merchant_staff(), which is already a fail-closed EXISTS, so this one needs
-- only the ACL fix — no body change, and therefore no house-rule-2 exposure.
revoke all on function public.my_restaurant_settlements(int) from public, anon;
grant execute on function public.my_restaurant_settlements(int) to authenticated;


-- ===========================================================================
-- 4. private.delivery_encrypt / delivery_decrypt cannot see pgcrypto.
-- ===========================================================================
--
-- Identical bug to the four functions mig 197 fixed, in two functions 197
-- missed: its plpgsql_check sweep filtered on nspname = 'public', and these
-- live in `private`.
--
-- Both pin `set search_path = private, public, pg_temp` (193:30, 193:47) and
-- then call bare pgp_sym_encrypt / pgp_sym_decrypt (193:39, 193:56). pgcrypto
-- is installed in the `extensions` schema on this project — 197's header
-- records the live check on 2026-07-30 (`to_regprocedure('gen_random_bytes(integer)')`
-- NULL under a public-only search_path, resolving only as
-- `extensions.gen_random_bytes`). So on production every call to either
-- function raises 42883 the moment it reaches the pgp_sym_* line, and
-- create_delivery_job (193:433-441) calls delivery_encrypt for every endpoint
-- and parcel snapshot. Package 08 cannot create a single job the day the dark
-- flag opens.
--
-- IS THIS SAFE FOR EXISTING CIPHERTEXT? Yes, and for two independent reasons.
--
--   (i) There is no existing ciphertext. private.delivery_job_endpoints and
--       private.delivery_job_parcel_details are written by exactly one caller,
--       create_delivery_job, which calls delivery_encrypt on every insert — and
--       that call cannot have succeeded on production, because the function
--       resolution fails first. A row can only exist if the encrypt worked, and
--       the encrypt cannot have worked. (Delivery is also still disabled and
--       internal-only.)
--
--   (ii) Even if a row did exist, this changes nothing about the ciphertext.
--        The fix is name RESOLUTION, not algorithm: pgp_sym_encrypt/decrypt are
--        the same pgcrypto functions with the same Vault key
--        ('delivery_pii_key_v1') either way. `public` still precedes
--        `extensions` in the list, so on any environment where pgcrypto happens
--        to sit in public (a fresh local replay of migs 001/002 does exactly
--        that, which is why the harness never caught this) the identical
--        function is chosen and behaviour is unchanged.
--
-- ALTER FUNCTION ... SET, exactly as 197 did, rather than CREATE OR REPLACE:
-- it touches only proconfig and leaves both bodies byte-for-byte intact, which
-- is the whole point of house rule 2. pg_temp stays LAST — that is the property
-- that actually prevents shadowing. `extensions` is owned by supabase_admin and
-- unprivileged roles cannot create in it, so adding it opens no hijack surface.
--
-- If a future reader finds rows in those tables that predate this migration,
-- STOP and investigate before assuming (i) — it would mean the encrypt path
-- resolved somewhere unexpected and the key provenance needs checking.

alter function private.delivery_encrypt(text)
  set search_path = private, public, extensions, pg_temp;

alter function private.delivery_decrypt(bytea)
  set search_path = private, public, extensions, pg_temp;

-- 193:63-64 already revoked these; restated so a replay onto a database where
-- that line did not land still ends fail-closed (house rule 3).
revoke all on function private.delivery_encrypt(text) from public, anon, authenticated;
revoke all on function private.delivery_decrypt(bytea) from public, anon, authenticated;


-- ===========================================================================
-- 5. House-rule-5b revoke for the five private tables from migs 191-193.
-- ===========================================================================
--
-- These five were created without the `revoke all ... from public, anon,
-- authenticated` that every public-schema table in migs 150-201 gets, and that
-- 152:244 and 166:55 already applied to earlier PRIVATE tables — so the
-- convention covers this schema, these five just missed it.
--
-- What protects them today is that schema USAGE on `private` is revoked
-- (152:197) and PostgREST does not expose the schema. 193:62 says so itself:
-- "the missing schema-USAGE grant is a barrier, not a policy." One future
-- `grant usage on schema private to <role>` — for a helper, a reporting view, a
-- PostgREST-exposed function — and whatever ACLs these tables carry become
-- live, including on delivery_job_endpoints (contact PII ciphertext) and
-- delivery_job_transitions (the state machine that IS delivery authority; a
-- TRUNCATE there ignores RLS and silently disarms every transition check).
--
-- Explicit table list rather than `revoke all on all tables in schema private`
-- so that a table added later is not silently swept in and assumed handled.

revoke all on table private.delivery_access_events      from public, anon, authenticated;  -- 191:104
revoke all on table private.delivery_quotes             from public, anon, authenticated;  -- 192:71
revoke all on table private.delivery_job_endpoints      from public, anon, authenticated;  -- 193:157
revoke all on table private.delivery_job_parcel_details from public, anon, authenticated;  -- 193:173
revoke all on table private.delivery_job_transitions    from public, anon, authenticated;  -- 193:225


-- ===========================================================================
-- 6. Pin search_path on the five advisor-flagged functions.
-- ===========================================================================
--
-- All five are SECURITY INVOKER, so a hijacked search_path buys an attacker
-- nothing they did not already have — this is not an escalation path and is not
-- being fixed because it is exploitable. It is being fixed because five
-- permanent WARN rows on function_search_path_mutable are five rows an operator
-- has to remember are benign, and the day a migration adds `security definer`
-- to one of them (menu_items_staff_writable_columns is the plausible one — it
-- is read by the definer trigger menu_items_guard_privileged_columns) the
-- genuinely dangerous entry will look exactly like the four benign ones.
-- Advisor noise is what let the delivery_encrypt bug above sit unnoticed.
--
-- ALTER, not CREATE OR REPLACE: bodies untouched (house rule 2, house rule 6).
--
-- Three are trigger bodies whose entire content is `raise exception`; they
-- reference no object at all, so the pin is purely declarative.

alter function public.availability_events_immutable()      set search_path = public, pg_temp;   -- 188:108
alter function public.delivery_job_events_immutable()      set search_path = public, pg_temp;   -- 193:213
alter function private.delivery_access_events_immutable()  set search_path = private, public, pg_temp;  -- 191:114

-- IMMUTABLE, body is a literal `select array['is_available','sort_order']`.
-- Pinning costs the planner's ability to inline it, so the guard trigger now
-- makes a real function call per privileged-column check instead of folding a
-- constant. On a per-row trigger over menu_items that is noise.
alter function public.menu_items_staff_writable_columns()  set search_path = public, pg_temp;   -- 136:453

-- search_catalog is anon-callable and every reference in it is already
-- schema-qualified (public.menu_items, public.restaurants), so the pin changes
-- no resolution. It does stop the planner inlining the SQL body into the
-- calling query. That is acceptable here and worth stating: the LIMIT is
-- INSIDE the body (clamped 1..100) and the keyset ORDER BY still uses
-- menu_items_name_keyset_idx, so the bounded work is identical; what is lost is
-- pushdown of any outer PostgREST filter into the scan, over at most 100 rows.
-- It remains SECURITY INVOKER, so mig-153 RLS is still the visibility
-- authority either way — the reason inlining could not be allowed to matter.
alter function public.search_catalog(text, text, uuid, int, text, uuid)
  set search_path = public, pg_temp;                                                          -- 188:126
