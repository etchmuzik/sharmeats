-- 136_merchant_staff_role_enforcement.sql
--
-- merchant_staff.staff_role is DECORATION. This migration makes it authority.
--
-- ================= THE DEFECT =================
-- merchant_staff (007:31-37) stores staff_role text not null default 'staff',
-- and the column comment at 007:34 documents the intended vocabulary
-- 'owner' | 'manager' | 'staff'. Nothing enforces either half of that:
--
--   a) There is no CHECK constraint. Any text is accepted.
--   b) is_merchant_staff(p_restaurant_id) (007:58-69) is
--        select exists (select 1 from merchant_staff
--                       where profile_id = auth.uid() and restaurant_id = $1)
--      -- it never reads staff_role. Neither does my_merchant_ids() (007:71-79).
--
-- Every merchant authorization in the database routes through those two
-- helpers, so staff_role is consulted by NOTHING. Verified: the column is
-- written once (apply_as_restaurant, 123:156 / 129:154, always 'owner') and
-- read in exactly three places, all display-only:
--   apps/restaurant/src/orders.ts:209   selects staff_role
--   apps/restaurant/src/orders.ts:223   -> KitchenBrand.staffRole (rendered)
--   apps/merchant-web/src/app/page.tsx:111,204  reads it, renders it as a chip
--
-- Net effect: a 'staff' row has byte-identical database privileges to an
-- 'owner' row. Concretely, via merchant-web /menu, anyone the owner ever adds
-- to merchant_staff can today:
--   * rewrite price_egp on every item (MenuManager.tsx:273) -- price_egp feeds
--     order_items at placement, and commission is computed off the resulting
--     subtotal (see mig 132's header and mig 135), so this is a money column;
--   * delete the entire menu (MenuManager.tsx:285 items, :118 sections);
--   * close the storefront (page.tsx:188 restaurants.is_open).
-- The UI shows them a "staff" badge the whole time.
--
-- Today the blast radius is bounded only by an accident: merchant_staff
-- INSERT/UPDATE/DELETE are admin-only (090:150-161), so the only rows that
-- exist are the self-service 'owner' rows apply_as_restaurant created. The hole
-- is latent, not yet exploited. That is exactly when to close it -- the first
-- time ops hand-inserts a line cook, it becomes live.
--
-- ================= THE PRIVILEGE MODEL =================
-- Two tiers, not three. 'owner' and 'manager' are collapsed into one
-- capability level ("manager+"); 'staff' is the restricted tier.
--
--   staff      -- the line-cook actions, which must never wait for a manager:
--                * advance_order_status (accept / preparing / ready)
--                * toggle menu_items.is_available  (86 an out-of-stock item)
--                * read everything they read today (orders, menu, scorecard)
--   manager+   -- everything above, plus the actions that move money or take
--                the storefront offline:
--                * write menu_items.price_egp (and name/description/image/flags)
--                * INSERT / DELETE menu_items and menu_sections
--                * write modifiers / modifier_options
--                * toggle restaurants.is_open
--
-- Why owner and manager are NOT separated: nothing in the product distinguishes
-- them, and inventing a distinction here would mean guessing which of the two
-- may edit prices. A tier that exists in the vocabulary but grants nothing
-- different is the same class of lie this migration is fixing. If an
-- owner-only capability ever appears (payout details, staff removal), it gets
-- its own explicit check against staff_role = 'owner' at that time.
--
-- ================= THE CRUX: is_available AND price_egp =================
-- Both are columns of menu_items, written by the SAME UPDATE from the SAME
-- client file. RLS cannot restrict columns (house rule 5), so the split cannot
-- be expressed as a policy. Four options were considered:
--
--   (1) Column-level UPDATE grant split. Impossible: grants are per-ROLE
--       (`authenticated`), not per-row. staff and manager are the same
--       Postgres role -- both are `authenticated`. A grant cannot tell them
--       apart. REJECTED as structurally incapable.
--
--   (2) Move privileged writes behind a SECURITY DEFINER RPC. Correct for the
--       blessed path, but it does not BIND: the table grant that MenuManager
--       uses today would still be there, so a staff account could keep calling
--       PostgREST directly and skip the RPC entirely. Fixing that means
--       revoking UPDATE on menu_items from authenticated wholesale -- which
--       also kills the 86 toggle (apps/restaurant/src/menu.ts:40), forcing a
--       second RPC, a coordinated Expo release, and a window where the shipped
--       restaurant app cannot mark items out of stock. REJECTED: too much
--       moving surface for the benefit, and it strands a native binary.
--
--   (3) A BEFORE UPDATE trigger comparing OLD to NEW. Binds EVERY writer --
--       MenuManager, the shipped restaurant app, a future CSV importer, a
--       manual psql UPDATE -- because it lives on the table, not on a path.
--       It is the only option that can distinguish "changed is_available only"
--       from "changed price_egp" at all, since that distinction is per-STATEMENT
--       and per-ROW, which is precisely the granularity a trigger has and a
--       grant does not. Needs no client change to keep working. CHOSEN.
--
--   (4) Split menu_items into two tables (availability separate from pricing).
--       Real column-level enforcement, but a rewrite of every read path,
--       place_order included. Wildly disproportionate. REJECTED.
--
-- So: triggers for the column-granularity cases (menu_items UPDATE), and
-- ordinary RLS policy clauses for the cases where the whole statement is
-- privileged (INSERT/DELETE on menu_items and menu_sections, and the
-- modifier tables). Policies are preferred wherever they suffice, because they
-- are declarative and visible to the advisors; the trigger is used only where a
-- policy provably cannot reach.
--
-- The trigger is written to fail CLOSED and to be self-limiting:
--   * it only ever RESTRICTS relative to today's behaviour;
--   * it exempts admin and any definer/service context, so admin tooling,
--     approve_restaurant and future importers are unaffected;
--   * it compares OLD vs NEW with IS DISTINCT FROM, so a no-op write of an
--     unchanged privileged column is NOT treated as a privileged write (the
--     merchant-web ItemEditor at MenuManager.tsx:262-274 always PUTs the full
--     payload, including an unchanged price_egp -- a naive "price_egp is
--     present" test would break the availability checkbox in that form).
--
-- ================= BACKWARD COMPATIBILITY =================
-- This is the part that could cause an incident, so it is stated explicitly.
--
-- Every merchant_staff row in prod today was written by apply_as_restaurant
-- with the literal 'owner' (123:157, 129:155). Any row created another way
-- (hand SQL by ops) took the column DEFAULT, which is 'staff' (007:34).
-- We cannot query prod from here, so we do NOT assume: the migration
-- normalizes defensively instead.
--
--   * Rows already 'owner'/'manager'/'staff' -> untouched.
--   * Any other value (case/whitespace variants like 'Owner', ' owner ',
--     or genuinely out-of-vocabulary text) -> normalized by lower(btrim(...))
--     if that lands in the vocabulary.
--   * Anything still unrecognized -> promoted to 'owner', NOT demoted to
--     'staff', and the fact is reported via ops_alert. Rationale: an
--     unrecognized value today carries FULL privileges, because staff_role is
--     ignored. Demoting it would silently strip a live merchant of access to
--     their own menu -- the exact production incident this section exists to
--     prevent. Promoting preserves the status quo for that row and leaves a
--     loud trail for a human to reclassify. Fail-open is the correct direction
--     for BACKFILL specifically; the runtime checks below all fail closed.
--   * Additionally: a restaurant whose staff rows contain NO manager+ at all
--     would be locked out of its own price editing with nobody able to fix it
--     (merchant_staff writes are admin-only). Any such restaurant gets its
--     OLDEST staff row promoted to 'owner', with an ops_alert. Expected to
--     match zero rows in prod; it is the safety net that makes "locked out of
--     your own menu" unreachable.
--
-- The consequence for a live merchant at apply time: NONE. Every existing
-- account ends up manager+ and keeps exactly the access it has now. The
-- migration is a no-op on today's data and only bites when ops adds the first
-- real 'staff' row. That is deliberate -- a security migration that changes
-- nothing for existing users on the day it lands is one that cannot page you.
--
-- ================= WHY A NEW HELPER, NOT A CHANGED ONE =================
-- is_merchant_staff() is NOT touched. It is called from ~40 places across the
-- schema, not the 18 write clauses in 090: orders_select (090:35), the whole
-- menu/modifier policy set (090:37-122), restaurants_read (095:23),
-- restaurants_merchant_update (089:169-171), kyc_documents (089:178,185),
-- order_items / order_status_events (012:96,106), restaurant_settlements
-- (074:64,176), restaurant_loyalty (052:59), can_access_order_thread (067:44),
-- send_order_message (067:121), restaurant_scorecard (077:43),
-- advance_order_status (011:319, and its later bodies 015/029/033/050/054/103).
-- Redefining it as "manager or owner" would silently revoke a line cook's
-- ability to SEE the order queue, message a customer, or advance an order --
-- turning a privilege fix into an outage across surfaces that were never
-- reviewed here. "Is this person attached to this merchant at all?" is a
-- genuinely useful and correct predicate; it is simply not an authorization
-- predicate for privileged writes.
--
-- So a NEW helper is added: is_merchant_manager(uuid). Same shape as the
-- original (LANGUAGE SQL, STABLE, SECURITY DEFINER, pinned search_path) so it
-- inlines into policy quals identically and costs the same index probe.
-- New name + new signature = no overload hazard under house rule 1; the two
-- functions are unrelated objects that happen to read the same table.
--
-- ================= CHECK CONSTRAINT =================
-- Added, after the normalization above, over exactly {'owner','manager',
-- 'staff'} -- the vocabulary 007:34 already claims. NOT VALID then VALIDATE
-- (house pattern from 132) so the add takes no rewrite lock; VALIDATE is safe
-- because the normalization ran first and left no violating row. A CHECK is
-- what stops the next hand-inserted 'Staff' or 'cook' from quietly becoming an
-- unrecognized -- and therefore, per the backfill rule, privileged -- value.
--
-- ================= STAFF SELF-SERVICE: DELIBERATELY NOT INCLUDED =========
-- Letting a merchant add their own colleagues is a real product gap
-- (merchant_staff writes are admin-only, 090:150-161, so today ops does it by
-- hand). It is NOT in this migration. Reasons: it needs a UI that does not
-- exist, an invite/identity flow (you cannot add a colleague who has no
-- account, and matching by phone means a lookup across public.users that has
-- its own exposure question), and a removal path. Shipping a
-- privilege-GRANTING RPC in the same migration that first makes privileges
-- mean something doubles the review surface at the worst moment. The
-- enforcement below is a strict narrowing and stands alone; self-service lands
-- separately, on top of a staff_role that is already load-bearing, where the
-- escalation rules (a manager may never mint an owner; the target restaurant
-- must come from my_merchant_ids(), never from a client argument) can be
-- reviewed on their own merits.
--
-- ================= HOW A REFUSAL SURFACES (read before touching clients) ====
-- The two enforcement mechanisms here fail in VISIBLY DIFFERENT ways, and the
-- difference is not intuitive. Verified by execution, 2026-07-27:
--
--   * A TRIGGER raises. SQLSTATE 23514 ('check_violation'), message prefixed
--     'MANAGER_REQUIRED: '. PostgREST surfaces a real error object.
--   * An RLS POLICY denial on INSERT raises 42501 -- WITH CHECK is a constraint.
--   * An RLS POLICY denial on UPDATE or DELETE DOES NOT RAISE AT ALL. The USING
--     qual is a row FILTER: the statement simply matches zero rows and reports
--     success. PostgREST returns 204 with error = null.
--
-- So for the policy-only paths in section 5 (menu_sections update/delete,
-- menu_items delete, modifier writes) a refused staff-tier write looks like a
-- successful one to any client that only inspects `error`. That is why:
--   (a) restaurants gets a trigger too (section 6b) rather than relying on the
--       narrowed policy alone -- an is_open toggle that lies is an incident;
--   (b) the merchant clients chain .select('id') and treat a zero-row result as
--       a refusal (see lib/capabilities.ts deniedByNoRows);
--   (c) hiding the control for the staff tier is the PRIMARY defence, not a
--       cosmetic nicety -- for these paths the error handler genuinely cannot
--       be the safety net.
--
-- ================= SCOPE NOT COVERED =================
-- kyc_documents INSERT stays STAFF-TIER. 089:178 permits the restaurant arm on
-- is_merchant_staff(subject_id), and apps/merchant-web/src/lib/kyc.ts:95 writes
-- it. Uploading identity/banking evidence is arguably at least as sensitive as
-- the is_open toggle this migration DID move, so the inconsistency is
-- deliberate and called out rather than left to be discovered: KYC upload is
-- part of the ONBOARDING flow, which runs before any second staffer plausibly
-- exists, and narrowing it risks blocking a merchant mid-application for a
-- capability nobody has yet demonstrated is being abused. Revisit when staff
-- self-service ships -- at that point a manager+ gate on the restaurant arm of
-- kyc_documents_insert is the natural companion change. Flagged as a judgement
-- call for the product owner, not an oversight.
--
-- restaurants.is_open is moved to manager+ via restaurants_merchant_update.
-- Note that the same policy also gates the five payout_* columns granted at
-- 126:163 -- so this migration additionally makes payout-detail edits
-- manager-only, which is the desired direction (bank/IBAN is money authority)
-- but is a widening of THIS migration's stated scope; flagged rather than
-- hidden. See the UNCERTAIN note at the end of this file.
--
-- Idempotent (drop-if-exists + create, add-column-if-not-exists pattern).
-- Additive: no column dropped, no policy loosened, no function signature
-- changed.
--
-- ROLLBACK (restores pre-136 behaviour exactly):
--   drop trigger if exists trg_menu_items_privileged_columns on public.menu_items;
--   drop function if exists public.menu_items_guard_privileged_columns();
--   drop function if exists public.menu_items_staff_writable_columns();
--   drop trigger if exists trg_restaurants_privileged_columns on public.restaurants;
--   drop function if exists public.restaurants_guard_privileged_columns();
--   alter table public.merchant_staff drop constraint if exists merchant_staff_role_chk;
--   -- restore the four policies to their is_merchant_staff() form:
--   alter policy menu_items_merchant_insert on public.menu_items
--     with check (public.is_merchant_staff(restaurant_id) or ((select auth_role()) = 'admin'::public.app_role));
--   alter policy menu_items_merchant_delete on public.menu_items
--     using (public.is_merchant_staff(restaurant_id) or ((select auth_role()) = 'admin'::public.app_role));
--   alter policy menu_sections_merchant_insert on public.menu_sections
--     with check (public.is_merchant_staff(restaurant_id) or ((select auth_role()) = 'admin'::public.app_role));
--   alter policy menu_sections_merchant_update on public.menu_sections
--     using (public.is_merchant_staff(restaurant_id) or ((select auth_role()) = 'admin'::public.app_role))
--     with check (public.is_merchant_staff(restaurant_id) or ((select auth_role()) = 'admin'::public.app_role));
--   alter policy menu_sections_merchant_delete on public.menu_sections
--     using (public.is_merchant_staff(restaurant_id) or ((select auth_role()) = 'admin'::public.app_role));
--   -- modifiers / modifier_options: swap is_merchant_manager back to
--   --   is_merchant_staff in the six clauses restated in section 5 below.
--   -- restaurants_merchant_update is NOT altered by this migration (see the
--   --   note in section 6), so there is nothing to restore on that policy;
--   --   dropping trg_restaurants_privileged_columns above is the whole revert.
--   drop function if exists public.is_merchant_manager(uuid);
-- The helper is left dropped last because the policies reference it.

-- ---------------------------------------------------------------------------
-- 1. Normalize existing staff_role values BEFORE any constraint or check can
--    reject them. Order matters: every statement below assumes the vocabulary
--    already holds.
-- ---------------------------------------------------------------------------

-- 1a. Case/whitespace variants that are really in-vocabulary.
update public.merchant_staff
   set staff_role = lower(btrim(staff_role))
 where staff_role is distinct from lower(btrim(staff_role))
   and lower(btrim(staff_role)) in ('owner', 'manager', 'staff');

-- 1b. Genuinely unrecognized values -> 'owner' (status quo preserving; see the
--     BACKWARD COMPATIBILITY header). Reported, never silent.
do $$
declare
  v_rows text;
begin
  select string_agg(format('%s/%s=%L', profile_id, restaurant_id, staff_role), ', ')
    into v_rows
    from public.merchant_staff
   where staff_role not in ('owner', 'manager', 'staff');

  if v_rows is not null then
    update public.merchant_staff
       set staff_role = 'owner'
     where staff_role not in ('owner', 'manager', 'staff');

    raise warning 'mig 136: promoted out-of-vocabulary merchant_staff rows to owner: %', v_rows;
    begin
      perform public.ops_alert(
        'mig 136: merchant_staff rows had out-of-vocabulary staff_role and were promoted to ''owner'' '
        || '(status-quo preserving -- they had full privileges before 136). Reclassify by hand: ' || v_rows);
    exception when others then null;  -- an alert failure must not abort the migration
    end;
  end if;
end $$;

-- 1c. Safety net: a restaurant with staff rows but NO manager+ would be locked
--     out of its own price/menu editing, and merchant_staff writes are
--     admin-only (090:150-161) so it could not self-heal. Promote the oldest
--     row. Expected to affect zero restaurants.
do $$
declare
  v_rows text;
begin
  -- Enumerate BEFORE updating. The obvious shape here -- a single
  -- `update ... returning ms.restaurant_id into v_rows` -- is a LANDMINE: when
  -- two or more restaurants need promoting, RETURNING ... INTO raises
  -- "query returned more than one row" (P0003) and aborts the whole migration.
  -- Verified against a local Postgres on 2026-07-27 with two orphaned
  -- restaurants seeded: it throws, it does not merely capture an arbitrary row.
  -- A CTE that collects the target list first is both correct and a complete
  -- report, so the ops_alert can name every affected restaurant instead of
  -- saying "at least one".
  with orphaned as (
    select restaurant_id
      from public.merchant_staff
     group by restaurant_id
    having count(*) filter (where staff_role in ('owner', 'manager')) = 0
  ),
  targets as (
    select distinct on (ms.restaurant_id) ms.profile_id, ms.restaurant_id
      from public.merchant_staff ms
      join orphaned o on o.restaurant_id = ms.restaurant_id
     order by ms.restaurant_id, ms.created_at asc, ms.profile_id asc
  ),
  promoted as (
    update public.merchant_staff ms
       set staff_role = 'owner'
      from targets t
     where ms.profile_id = t.profile_id
       and ms.restaurant_id = t.restaurant_id
    returning ms.restaurant_id, ms.profile_id
  )
  select string_agg(format('%s (profile %s)', restaurant_id, profile_id), ', ')
    into v_rows
    from promoted;

  if v_rows is not null then
    raise warning 'mig 136: promoted the oldest staff row to owner for restaurants that had no manager+: %', v_rows;
    begin
      perform public.ops_alert(
        'mig 136: restaurant(s) had merchant_staff rows but no owner/manager; the oldest staff row '
        || 'of each was promoted to ''owner'' so they are not locked out of their own menu: ' || v_rows);
    exception when others then null;
    end;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. CHECK constraint: the vocabulary 007:34 always claimed.
--    NOT VALID then VALIDATE (house pattern, mig 132) -- no rewrite lock.
-- ---------------------------------------------------------------------------
alter table public.merchant_staff
  drop constraint if exists merchant_staff_role_chk;
alter table public.merchant_staff
  add constraint merchant_staff_role_chk
    check (staff_role in ('owner', 'manager', 'staff')) not valid;
alter table public.merchant_staff
  validate constraint merchant_staff_role_chk;

comment on constraint merchant_staff_role_chk on public.merchant_staff is
  'staff_role vocabulary, enforced from mig 136 (declared in a comment since 007:34, unenforced until now). Binds every writer including hand SQL. An out-of-vocabulary value would be treated as non-manager by is_merchant_manager() and would therefore silently strip access rather than grant it -- the CHECK is what keeps that unreachable.';

comment on column public.merchant_staff.staff_role is
  'AUTHORITY as of mig 136 (before 136 it was display-only and read by nothing). ''owner''/''manager'' are one capability tier (manager+): price_egp writes, menu item/section create+delete, modifier writes, restaurants.is_open and payout_* edits. ''staff'' is the line-cook tier: advance_order_status, toggling menu_items.is_available, and all reads. Checked via is_merchant_manager(); presence-only checks still use is_merchant_staff().';

-- ---------------------------------------------------------------------------
-- 3. is_merchant_manager() -- the NEW helper. is_merchant_staff() is
--    deliberately unchanged (see header): ~40 call sites depend on its
--    "attached at all" meaning, including a line cook's order-queue read.
--    Same shape as 007:58-69 so it inlines into policy quals identically.
-- ---------------------------------------------------------------------------
create or replace function public.is_merchant_manager(p_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.merchant_staff
    where profile_id = auth.uid()
      and restaurant_id = p_restaurant_id
      and staff_role in ('owner', 'manager')
  );
$$;

-- House rule 3: granting to authenticated does NOT revoke the default
-- PUBLIC/anon execute. Revoke first, then grant.
revoke all on function public.is_merchant_manager(uuid) from public, anon;
grant execute on function public.is_merchant_manager(uuid) to authenticated;

comment on function public.is_merchant_manager(uuid) is
  'Is the caller an owner/manager of this merchant? The privileged-write counterpart to is_merchant_staff() (007), which answers only "attached at all" and must keep doing so -- it gates a line cook''s order reads, messaging and advance_order_status from ~40 call sites. Returns false for staff_role = ''staff'' and for a NULL auth.uid(): fails CLOSED (an exists() over zero rows is false, never NULL -- house rule 4). Mig 136.';

-- ---------------------------------------------------------------------------
-- 4. menu_items: the crux. Structure and price are manager+; availability is
--    staff. INSERT/DELETE are whole-statement decisions, so they are POLICY.
--    UPDATE is a per-column decision, which a policy cannot express (house
--    rule 5), so it stays open at the policy layer and is narrowed by the
--    trigger in section 4b.
-- ---------------------------------------------------------------------------

-- 4a. Policies. Restated with alter policy so the surrounding F5/F10 shape
--     (single permissive policy per action, initplan-wrapped auth calls) is
--     preserved exactly; only the merchant predicate changes.
--     menu_items_read and menu_items_merchant_update keep is_merchant_staff:
--     a line cook must still read the full menu (including unavailable items)
--     and must still be able to 86 one.
alter policy menu_items_merchant_insert on public.menu_items
  with check (public.is_merchant_manager(restaurant_id) or ((select auth_role()) = 'admin'::public.app_role));
alter policy menu_items_merchant_delete on public.menu_items
  using (public.is_merchant_manager(restaurant_id) or ((select auth_role()) = 'admin'::public.app_role));

-- 4b. The trigger. This is the only mechanism that can separate two columns of
--     one UPDATE issued by one Postgres role (`authenticated`) -- see the CRUX
--     section. It binds every writer because it lives on the table.
--
--     Privileged columns = everything a line cook has no business changing.
--     is_available and sort_order are deliberately NOT privileged: 86'ing an
--     item and reordering the board are shift-floor actions.
-- 4b-i. The staff-writable ALLOW-LIST. Deliberately a table constant, not a
--       literal buried in the function body, so it is greppable and so the
--       review question is always "may a line cook change THIS?" rather than
--       "did anyone remember to add THIS to the deny list?".
--
--       DENY-BY-DEFAULT IS THE WHOLE POINT. The first draft of this trigger
--       named the seven columns a staffer may NOT change. That is a deny-list,
--       and it was WRONG: menu_items has FIFTEEN columns (002:219-231 plus
--       sku/barcode/unit/requires_prescription added by 006:67-71), so the
--       draft left six of them staff-writable. Verified by execution against a
--       prod-faithful fixture on 2026-07-27: as staff_role='staff',
--         update menu_items set sku='PWNED'                => ALLOWED
--         update menu_items set barcode='PWNED'            => ALLOWED
--         update menu_items set unit='kg'                  => ALLOWED
--         update menu_items set requires_prescription=true => ALLOWED
--         update menu_items set created_at='2000-01-01'    => ALLOWED
--       requires_prescription is the pharmacy vertical's dispensing gate
--       (006:70). A line cook flipping it to false on a controlled product is
--       precisely the class of harm this migration exists to prevent, and it
--       survived the deny-list because the validation fixture had been built
--       from 002 alone and did not have the 006 columns to test.
--
--       The deeper defect is structural rather than a missed column: with a
--       deny-list, EVERY future `alter table menu_items add column` is
--       staff-writable until somebody remembers to edit this function. The
--       allow-list inverts that — a new column is manager+ on the day it is
--       added, and widening it is a deliberate, reviewable act.
create or replace function public.menu_items_staff_writable_columns()
returns text[]
language sql
immutable
as $$
  -- is_available: 86'ing a sold-out dish is the defining line-cook action and
  --               the reason the staff tier exists at all.
  -- sort_order:   reordering the board mid-shift is cosmetic and reversible.
  -- Everything else on menu_items -- price, identity, taxonomy, tenancy,
  -- pharmacy/grocery attributes -- is manager+.
  select array['is_available', 'sort_order']::text[];
$$;

comment on function public.menu_items_staff_writable_columns() is
  'The ALLOW-LIST of menu_items columns a staff-tier merchant user may change; everything else is manager+ (mig 136). Deny-by-default: a column added by a future migration is manager+ automatically and must be added here explicitly to become staff-writable. Read by menu_items_guard_privileged_columns().';

create or replace function public.menu_items_guard_privileged_columns()
returns trigger
language plpgsql
-- VOLATILE (the default), not STABLE. The body only reads, so STABLE happens to
-- work, but a trigger function's volatility is not consulted for planning the
-- way a scalar function's is, and marking a trigger STABLE is a standing
-- invitation for the next editor to add a write and get a subtle misbehaviour
-- instead of an error. Left explicit so nobody "tightens" it back.
security definer
set search_path = public, pg_temp
as $function$
declare
  v_changed text[];
begin
  -- Exempt contexts with NO JWT at all: service_role, psql, the migration
  -- runner, a batch importer run out-of-band. auth.uid() reads the
  -- request.jwt.claims GUC, so it is NULL exactly when there is no request
  -- identity, and nothing here should stand in the way of platform tooling.
  --
  -- IMPORTANT, AND NOT WHAT THE FIRST DRAFT CLAIMED: this does NOT exempt
  -- SECURITY DEFINER RPCs. SECURITY DEFINER changes the EXECUTING ROLE; it does
  -- not touch the request GUC, so auth.uid() inside a definer function is still
  -- the calling user's uuid. Verified by execution on 2026-07-27: a definer
  -- function returning auth.uid(), called by a staff user, returned that user's
  -- uuid, not NULL. No definer RPC writes menu_items today, so nothing is
  -- broken -- but the next author who adds a bulk price importer as a definer
  -- RPC must know it will be subject to this trigger for every non-manager
  -- caller. If such an RPC needs a genuine bypass, give it an EXPLICIT and
  -- greppable one (`set local app.menu_guard_bypass = 'on'` checked here),
  -- never an assumption about definer semantics.
  if auth.uid() is null then
    return new;
  end if;
  if coalesce(public.auth_role()::text, '') = 'admin' then   -- house rule 4: fail closed
    return new;
  end if;

  -- Already manager+ for this item's restaurant? Nothing to restrict.
  -- Checked against NEW.restaurant_id and OLD.restaurant_id both, so an
  -- attempt to move an item to another merchant cannot launder authority.
  if public.is_merchant_manager(new.restaurant_id)
     and public.is_merchant_manager(old.restaurant_id) then
    return new;
  end if;

  -- Not manager+. Diff OLD against NEW generically and keep every changed key
  -- that is not on the allow-list. to_jsonb() enumerates the row's ACTUAL
  -- columns, so this stays correct across future ADD COLUMNs with no edit here.
  --
  -- IS DISTINCT FROM (not "was the column supplied") because merchant-web's
  -- ItemEditor PUTs the whole payload on every save (MenuManager.tsx:262-274):
  -- an unchanged price_egp must not read as a price write, or the availability
  -- checkbox in that same form breaks for the staff tier. jsonb comparison is
  -- the right equality here -- both sides are rendered from the same row type,
  -- so a value that did not change renders identically.
  select coalesce(array_agg(n.key order by n.key), '{}'::text[])
    into v_changed
    from jsonb_each(to_jsonb(new)) n
    left join jsonb_each(to_jsonb(old)) o on o.key = n.key
   where n.value is distinct from o.value
     and not (n.key = any (public.menu_items_staff_writable_columns()));

  if array_length(v_changed, 1) is not null then
    raise exception
      'MANAGER_REQUIRED: changing % on a menu item requires an owner or manager (you are staff)',
      array_to_string(v_changed, ', ')
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

revoke all on function public.menu_items_guard_privileged_columns() from public, anon, authenticated;

comment on function public.menu_items_guard_privileged_columns() is
  'BEFORE UPDATE on menu_items: a staff-tier merchant user may change ONLY the columns listed by menu_items_staff_writable_columns() (is_available, sort_order); every other column -- price, identity, taxonomy, tenancy, and the grocery/pharmacy attributes from mig 006 -- is manager+. DENY-BY-DEFAULT via a to_jsonb(NEW)/to_jsonb(OLD) diff, so a column added by a future migration is manager+ automatically. A trigger rather than a policy because the split is per-COLUMN and RLS cannot restrict columns (house rule 5), and rather than a column GRANT because staff and manager are both the Postgres role `authenticated` and a grant cannot distinguish them. Binds every writer -- MenuManager, the shipped restaurant app, importers, hand SQL. Exempts admin and contexts with NO request JWT (service_role, psql, migrations); it does NOT exempt SECURITY DEFINER RPCs, which inherit the caller''s auth.uid(). Mig 136.';

drop trigger if exists trg_menu_items_privileged_columns on public.menu_items;
create trigger trg_menu_items_privileged_columns
  before update on public.menu_items
  for each row execute function public.menu_items_guard_privileged_columns();

-- ---------------------------------------------------------------------------
-- 5. menu_sections / modifiers / modifier_options: ALL writes are manager+.
--    There is no staff-tier action on any of them -- a line cook does not
--    restructure the board mid-shift -- so unlike menu_items these need no
--    trigger and no column split. Whole-statement decision, plain policy.
--    Reads are untouched (menu_sections read qual is TRUE, 090:65-66).
-- ---------------------------------------------------------------------------
alter policy menu_sections_merchant_insert on public.menu_sections
  with check (public.is_merchant_manager(restaurant_id) or ((select auth_role()) = 'admin'::public.app_role));
alter policy menu_sections_merchant_update on public.menu_sections
  using (public.is_merchant_manager(restaurant_id) or ((select auth_role()) = 'admin'::public.app_role))
  with check (public.is_merchant_manager(restaurant_id) or ((select auth_role()) = 'admin'::public.app_role));
alter policy menu_sections_merchant_delete on public.menu_sections
  using (public.is_merchant_manager(restaurant_id) or ((select auth_role()) = 'admin'::public.app_role));

-- modifiers / modifier_options have no restaurant_id; gate via the item join,
-- exactly as 090:83-122 does. Shape preserved verbatim, predicate swapped.
alter policy modifiers_merchant_insert on public.modifiers
  with check (exists (select 1 from public.menu_items mi
    where mi.id = modifiers.item_id
      and (public.is_merchant_manager(mi.restaurant_id) or ((select auth_role()) = 'admin'::public.app_role))));
alter policy modifiers_merchant_update on public.modifiers
  using (exists (select 1 from public.menu_items mi
    where mi.id = modifiers.item_id
      and (public.is_merchant_manager(mi.restaurant_id) or ((select auth_role()) = 'admin'::public.app_role))))
  with check (exists (select 1 from public.menu_items mi
    where mi.id = modifiers.item_id
      and (public.is_merchant_manager(mi.restaurant_id) or ((select auth_role()) = 'admin'::public.app_role))));
alter policy modifiers_merchant_delete on public.modifiers
  using (exists (select 1 from public.menu_items mi
    where mi.id = modifiers.item_id
      and (public.is_merchant_manager(mi.restaurant_id) or ((select auth_role()) = 'admin'::public.app_role))));

alter policy modifier_options_merchant_insert on public.modifier_options
  with check (exists (select 1 from public.modifiers m
    join public.menu_items mi on mi.id = m.item_id
    where m.id = modifier_options.modifier_id
      and (public.is_merchant_manager(mi.restaurant_id) or ((select auth_role()) = 'admin'::public.app_role))));
alter policy modifier_options_merchant_update on public.modifier_options
  using (exists (select 1 from public.modifiers m
    join public.menu_items mi on mi.id = m.item_id
    where m.id = modifier_options.modifier_id
      and (public.is_merchant_manager(mi.restaurant_id) or ((select auth_role()) = 'admin'::public.app_role))))
  with check (exists (select 1 from public.modifiers m
    join public.menu_items mi on mi.id = m.item_id
    where m.id = modifier_options.modifier_id
      and (public.is_merchant_manager(mi.restaurant_id) or ((select auth_role()) = 'admin'::public.app_role))));
alter policy modifier_options_merchant_delete on public.modifier_options
  using (exists (select 1 from public.modifiers m
    join public.menu_items mi on mi.id = m.item_id
    where m.id = modifier_options.modifier_id
      and (public.is_merchant_manager(mi.restaurant_id) or ((select auth_role()) = 'admin'::public.app_role))));

-- ---------------------------------------------------------------------------
-- 6. restaurants: closing the storefront is manager+ -- enforced by a TRIGGER,
--    with the policy deliberately LEFT as is_merchant_staff().
--
--    This looks backwards, so here is the reason, which cost a test cycle to
--    learn and is the single most surprising fact in this migration:
--
--      AN RLS DENIAL ON UPDATE OR DELETE DOES NOT RAISE. The USING qual is a
--      row FILTER, evaluated BEFORE the row is handed to any BEFORE-UPDATE
--      trigger. A denied UPDATE therefore matches zero rows and PostgREST
--      returns 204 with error = null. The client sees SUCCESS.
--
--    Verified twice by execution on 2026-07-27. First: with
--    restaurants_merchant_update narrowed to is_merchant_manager(), a staff
--    `update restaurants set is_open=false` returned NO error, 0 rows, and
--    is_open stayed true. Second -- and this is why the obvious fix does not
--    work -- ADDING a BEFORE UPDATE trigger did NOT make it loud: the trigger
--    never fired, because RLS had already filtered the row out of the
--    statement. A trigger cannot rescue a policy denial; the policy has to let
--    the row through for the trigger to have anything to inspect.
--
--    Why the silent shape is dangerous HERE specifically:
--    apps/merchant-web/src/app/page.tsx and apps/restaurant/src/orders.ts
--    (setRestaurantOpen) both flip the toggle optimistically and roll back only
--    `if (error)`. A staffer taps "pause orders", the badge reads Closed, they
--    put the phone down -- and the storefront keeps taking tickets. A kitchen
--    that believes it is closed while customers are still ordering is a real
--    incident, not a cosmetic one.
--
--    So the enforcement is inverted relative to sections 4a/5:
--      * the POLICY stays at is_merchant_staff() -- unchanged from 089:169-171,
--        so a staff-tier row still reaches the executor;
--      * the TRIGGER (6b) decides the tier and RAISES MANAGER_REQUIRED.
--    Net authority is identical to narrowing the policy; only the failure mode
--    differs, and it differs in the direction that cannot lie to a kitchen.
--
--    A reviewer will reasonably ask why sections 4a/5 do not get the same
--    treatment. Because there the silent shape is tolerable and the trigger
--    would be pure cost: a refused section rename or item delete leaves the
--    board visibly unchanged, and the client re-renders from the DB after every
--    write (MenuManager's onChanged -> load), so the merchant SEES the
--    non-change immediately. Nothing diverges from reality. is_open has no such
--    self-correction: the divergence is invisible on the merchant's own screen
--    and only shows up as unexpected orders.
--
--    restaurants_read (095:21-25) is NOT touched either: a line cook must still
--    see their own restaurant row even when is_active = false.
-- ---------------------------------------------------------------------------

-- 6b. The tier check, as a trigger, so the refusal is LOUD.
create or replace function public.restaurants_guard_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_changed text[];
begin
  -- Same exemption semantics as menu_items_guard_privileged_columns(): no JWT
  -- (service_role / psql / migrations) and admin pass through. NOT an exemption
  -- for SECURITY DEFINER RPCs -- see that function's comment. This matters more
  -- here, because approve_restaurant / apply_as_restaurant DO write this table:
  -- they run from admin or platform contexts, and the guard below only ever
  -- fires for a merchant-tier caller changing a manager+ column, so they are
  -- unaffected either way.
  if auth.uid() is null then
    return new;
  end if;
  if coalesce(public.auth_role()::text, '') = 'admin' then
    return new;
  end if;
  if public.is_merchant_manager(new.id) and public.is_merchant_manager(old.id) then
    return new;
  end if;

  -- Not manager+. If they are not attached to this merchant AT ALL, say nothing
  -- specific -- restaurants_merchant_update's USING qual has already filtered
  -- that case to zero rows before we get here, so reaching this line means the
  -- caller IS attached and is simply staff-tier. Fall through to the diff.
  --
  -- The allow-list is empty by construction: a staff-tier user may change
  -- NOTHING on restaurants. The diff is still computed so the error names the
  -- column they actually touched (is_open reads very differently from
  -- payout_iban in a support conversation). Columns outside the 126:163 grant
  -- are unreachable from a client anyway.
  select coalesce(array_agg(n.key order by n.key), '{}'::text[])
    into v_changed
    from jsonb_each(to_jsonb(new)) n
    left join jsonb_each(to_jsonb(old)) o on o.key = n.key
   where n.value is distinct from o.value;

  if array_length(v_changed, 1) is not null then
    raise exception
      'MANAGER_REQUIRED: changing % on a restaurant requires an owner or manager (you are staff)',
      array_to_string(v_changed, ', ')
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

revoke all on function public.restaurants_guard_privileged_columns() from public, anon, authenticated;

comment on function public.restaurants_guard_privileged_columns() is
  'BEFORE UPDATE on restaurants: turns a staff-tier merchant write into a LOUD MANAGER_REQUIRED (23514) instead of the silent zero-row no-op an RLS denial produces on UPDATE. Clients toggle is_open optimistically and roll back only on error, so a silent refusal would leave the kitchen believing it had stopped intake while orders kept arriving. Exempts admin and any NULL-auth.uid() context. Mig 136.';

drop trigger if exists trg_restaurants_privileged_columns on public.restaurants;
create trigger trg_restaurants_privileged_columns
  before update on public.restaurants
  for each row execute function public.restaurants_guard_privileged_columns();

-- ---------------------------------------------------------------------------
-- 7. Index support. is_merchant_manager filters on staff_role on top of the
--    (profile_id, restaurant_id) PK probe, so the PK already answers it with a
--    single index tuple + one heap check -- no new index is warranted. Stated
--    so a reviewer does not go looking. merchant_staff is tiny (one row per
--    staffer per restaurant) and section 1c's group-by is a one-off.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- UNCERTAIN -- flagged rather than papered over:
--
-- 1. PAYOUT COLUMNS BECOME MANAGER+ TOO. Section 6 narrows
--    restaurants_merchant_update, which gates every client-writable column on
--    restaurants: is_open AND payout_method/payout_bank_name/payout_iban/
--    payout_wallet/payout_holder (granted 126:163, from mig 105). Making bank
--    details manager+ is almost certainly right -- arguably they should be
--    owner-only -- but it is broader than "toggling is_open". Splitting it
--    would require a second trigger on restaurants of the same shape as
--    section 4b. Deliberately not done: the direction is safe (narrowing) and
--    a payout edit by a line cook is not a capability anyone asked for. Confirm
--    with the product owner that no non-manager staffer is expected to submit
--    payout details during onboarding -- apps/merchant-web/src/lib/onboarding.ts
--    and the KYC flow should be re-walked before this applies, since the
--    onboarding wizard runs as the freshly created 'owner' (123:157) and is
--    therefore fine, but a later payout EDIT screen may not be.
--
-- 2. PROD DATA IS UNVERIFIED. There is no prod DB access in this session, so
--    the claim "every existing row is 'owner'" is inferred from
--    apply_as_restaurant (123:157, 129:155) being the only writer in the repo,
--    not observed. Section 1 is written to be correct either way, but BEFORE
--    APPLYING, run:
--      select staff_role, count(*) from public.merchant_staff group by 1;
--      select restaurant_id, count(*),
--             count(*) filter (where staff_role in ('owner','manager')) as mgrs
--        from public.merchant_staff group by 1 having
--             count(*) filter (where staff_role in ('owner','manager')) = 0;
--    The second query MUST return zero rows after section 1c; if it returns
--    rows before, section 1c is doing real work and the ops_alert should be
--    read carefully rather than dismissed.
--
-- 2b. THE 1c INVARIANT IS ONE-SHOT, NOT CONTINUOUSLY ENFORCED. Section 1c
--    guarantees "every restaurant with staff rows has at least one manager+"
--    only for the data present AT APPLY TIME. Nothing stops the state
--    recurring afterwards: if an admin deletes a restaurant's last owner row,
--    or hand-inserts a lone 'staff' row for a new merchant, that merchant can
--    no longer edit its own prices, menu structure or is_open -- and because
--    merchant_staff writes are admin-only (090:150-161) and this migration
--    deliberately ships no self-service RPC, it cannot heal itself. Verified
--    reachable by execution on 2026-07-27.
--    NOT enforced with a constraint trigger here, deliberately: a deferred
--    trigger that can ABORT an admin's merchant_staff DELETE is a new failure
--    mode in an ops path, added in the same migration that first makes the
--    column mean anything. The cheaper and safer control is procedural plus
--    detection. OPS RULE: never delete a restaurant's last owner/manager row.
--    Add the note-2 second query to the periodic ops sweep so an orphan pages
--    someone instead of surfacing as a confused merchant support ticket.
--
-- 3. RESOLVED (was: "section 1c reports incompletely"). The original 1c used
--    `update ... returning ms.restaurant_id into v_rows`, believed to capture an
--    arbitrary single row. It does not -- with two or more orphaned restaurants
--    it raises P0003 "query returned more than one row" and ABORTS THE
--    MIGRATION. Reproduced against a local Postgres on 2026-07-27. 1c now wraps
--    the UPDATE in a CTE and string_aggs the result, which is both crash-free
--    and a complete enumeration, so the ops_alert names every affected
--    restaurant. The diagnostic query in note 2 remains the pre-apply check.
--
-- 4. CI COVERAGE: scripts/test-security-migrations.sh runs the 40-case
--    Postgres matrix in supabase/tests/136_staff_role_*.sql against a fresh
--    database. App-level Vitest and Deno tests cannot exercise these triggers,
--    so this database matrix MUST remain in the security runner if either
--    trigger body or the allow-list is edited.
--
--    VALIDATION ACTUALLY PERFORMED (PostgreSQL 18.4, local, 2026-07-27).
--    Stated narrowly and only for what was observed, because an earlier draft
--    of this header claimed a "24/24 pass" that its fixture was structurally
--    incapable of producing -- that fixture omitted the four columns migration
--    006 added, which is exactly why the deny-list hole below went undetected.
--    A validation claim that cannot be reproduced is worse than none.
--
--    The fixture (supabase/tests/136_staff_role_fixture.sql) is rebuilt from
--    the REAL DDL: 002 + 006:67-71 (all 15 menu_items columns) + 105/126
--    (payout_*) + 132 (both price CHECKs) + the full 090 policy set including
--    modifiers/modifier_options + 095 + the 081/126 column grants. Seeded:
--    owner/manager/staff at one restaurant, a staff-only restaurant, a
--    ' Owner ' whitespace variant, an out-of-vocabulary 'cook', and an admin.
--
--    Observed:
--      * fixture + migration apply clean from an empty database (rc=0), and the
--        two backfill ops_alerts fire with the expected row enumerations;
--      * NEGATIVE, staff tier: price_egp / name / description / image / flags /
--        section_id / restaurant_id / sku / barcode / unit /
--        requires_prescription / created_at all raise 23514 MANAGER_REQUIRED;
--        menu_items INSERT raises 42501; menu_items DELETE, menu_sections
--        UPDATE+DELETE and restaurants UPDATE are refused (the last now loudly,
--        via 6b; the policy-only ones as zero-row no-ops -- see the HOW A
--        REFUSAL SURFACES section);
--      * POSITIVE, staff tier: is_available and sort_order succeed, and the
--        full-payload-with-unchanged-price save (the MenuManager.tsx:262-274
--        shape) succeeds -- the case a naive "was the column supplied" test
--        breaks;
--      * POSITIVE, owner/manager tier: price, structure, insert, delete and
--        is_open all succeed;
--      * admin is exempt; cross-tenant writes refused for every tier;
--      * the CHECK rejects 'cook' post-normalization;
--      * idempotent across three consecutive applications;
--      * the whole file runs and reverts inside BEGIN/ROLLBACK (house rule 6).
--
--    THREE defects were found BY EXECUTION and fixed here, none visible to
--    inspection:
--      a) the original guard was a DENY-LIST of seven columns while menu_items
--         has fifteen. Staff could write sku, barcode, unit,
--         requires_prescription (the pharmacy dispensing gate) and created_at.
--         Now an allow-list -- see section 4b-i.
--      b) staff writes to restaurants failed SILENTLY (zero rows, no error),
--         so an optimistic client toggle would show "Closed" on a storefront
--         still taking orders. Now a trigger raises -- see section 6b.
--      c) the trigger's exemption comment asserted that auth.uid() is NULL
--         inside SECURITY DEFINER functions. It is not: SECURITY DEFINER
--         changes the executing role, not the request GUC. A definer function
--         called by a staff user returned that user's uuid. The comment is
--         corrected in 4b; the behaviour was always right, the documented
--         contract was not, and the next author would have relied on it.
-- ---------------------------------------------------------------------------
