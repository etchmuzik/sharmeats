-- 160_e0_durable_compatibility.sql
--
-- Package 07 Program A0 (session E0) — durable vertical compatibility, audited
-- merchant creation, non-oracle authorization, and catalog identity in the
-- immutable order snapshot. Every finding below was reproduced against the
-- production schema before being changed.
--
-- ===========================================================================
-- 1. vertical_id MUST NOT BE NULLABLE.
-- ===========================================================================
-- Measured: restaurants.vertical_id is `is_nullable = YES` with default 'food',
-- and 0 rows are NULL today. A nullable authority column is a permanent trap --
-- a NULL merchant belongs to no vertical, so every gate that asks "which
-- vertical is this?" gets NULL and the fail-closed predicates cannot classify
-- it. Because production is already clean, this can simply be closed.
--
-- Backfill first (a no-op today, correct if a NULL is ever introduced between
-- writing this and applying it), then make it structural.

update public.restaurants set vertical_id = 'food' where vertical_id is null;
alter table public.restaurants alter column vertical_id set not null;

comment on column public.restaurants.vertical_id is
  'Owning vertical. NOT NULL (mig 160): a nullable authority column would let a merchant belong to no vertical, which every gate would then have to guess about. Written ONLY by admin_assign_merchant_vertical, which audits the change.';

-- ===========================================================================
-- 2. ASSIGNMENT COMPATIBILITY IS NOT DURABLE.
-- ===========================================================================
-- vertical_assignment_blockers refuses a move when the catalog holds Rx items
-- the target vertical cannot express -- but that is POINT-IN-TIME. Measured:
-- `authenticated` holds UPDATE on public.menu_items and
-- menu_items_merchant_update lets an owner/manager write any column, so a
-- manager can set requires_prescription = true immediately AFTER a move and the
-- invariant the assignment enforced is silently gone.
--
-- The check must be STRUCTURAL, on the catalog write itself. Two ways in must
-- both be closed, and the first version of this migration only closed one:
--
--   (a) flipping requires_prescription on an item, and
--   (b) MOVING an already-Rx item to another merchant by rewriting
--       restaurant_id -- which changes the owning vertical without touching
--       requires_prescription at all.
--
-- So the trigger fires on `requires_prescription OR restaurant_id`, and the
-- decision is made on the RESULTING ROW rather than on what changed. There is
-- no "unchanged value" early return: the question is never "did this column
-- change?" but "is this row, as it will exist, allowed where it now lives?"

-- --- 2d. APPLY-TIME PREFLIGHT. ---------------------------------------------
-- The trigger above guards FUTURE writes only. Rows that already violate the
-- invariant would sit there undetected: reads still surface them, the catalog
-- still sells them, and the first symptom would be an unexplained refusal the
-- next time someone edited an unrelated field on that row.
--
-- Measured at authoring time: 0 Rx items exist in production and 0 sit in a
-- vertical without the capability -- so this is expected to be a no-op. It is
-- included anyway because "expected zero" is exactly the assumption that should
-- be ASSERTED at apply time rather than trusted: this migration is meant to be
-- replayable against a restored backup or a future database where that is no
-- longer true, and silently installing a constraint that existing data violates
-- is how a latent inconsistency becomes a production incident later.
do $mig160_preflight$
declare v_n int; v_detail text;
begin
  select count(*), string_agg(distinct r.vertical_id, ', ')
    into v_n, v_detail
    from public.menu_items mi
    join public.restaurants r on r.id = mi.restaurant_id
   where coalesce(mi.requires_prescription, false)
     and coalesce((select (v.capabilities->>'supports_prescription')::boolean
                     from public.verticals v where v.id = r.vertical_id), false) = false;

  if v_n > 0 then
    raise exception
      'mig160 preflight: % existing prescription item(s) sit in vertical(s) [%] that cannot express them',
      v_n, v_detail
      using hint = 'Move those merchants to a prescription-capable vertical, or clear requires_prescription, before applying. This migration will not install a rule that current data violates.';
  end if;
  raise notice 'mig160 preflight: no pre-existing prescription/vertical conflicts';
end;
$mig160_preflight$;

create or replace function public.menu_items_enforce_vertical_capability()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_vertical text;
  v_caps jsonb;
begin
  -- Non-Rx rows are unconstrained: sku/barcode/unit are universal catalog
  -- metadata (all 1038 production items carry them), NOT a vertical signal.
  if coalesce(new.requires_prescription, false) = false then
    return new;
  end if;

  -- The row is Rx. Revalidate against wherever it now lives -- deliberately
  -- WITHOUT an "old value was already true" early return, which would let an
  -- existing Rx item be moved into food by rewriting restaurant_id alone.
  --
  -- Skip only when nothing relevant actually moved, so unrelated edits to a
  -- legitimately-Rx pharmacy item stay cheap and lock-free.
  if tg_op = 'UPDATE'
     and old.restaurant_id = new.restaurant_id
     and coalesce(old.requires_prescription, false) = true then
    return new;
  end if;

  -- CANONICAL LOCK ORDER: merchant row, then vertical advisory -- the same
  -- order place_order and admin_assign_merchant_vertical use. The row lock is
  -- what serialises this write against a concurrent reassignment: one waits,
  -- and whichever runs second sees the other's committed result.
  select r.vertical_id into v_vertical
    from public.restaurants r where r.id = new.restaurant_id for update;
  if not found then
    raise exception 'MERCHANT_NOT_FOUND' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('vertical:' || v_vertical, 0));

  select capabilities into v_caps from public.verticals where id = v_vertical;
  if coalesce((v_caps->>'supports_prescription')::boolean, false) = false then
    raise exception
      'VERTICAL_CAPABILITY_REQUIRED: % does not support prescription items', v_vertical
      using errcode = 'check_violation',
            hint = 'Move the merchant to a vertical with supports_prescription first.';
  end if;
  return new;
end;
$function$;

drop trigger if exists menu_items_vertical_capability on public.menu_items;
create trigger menu_items_vertical_capability
  before insert or update of requires_prescription, restaurant_id on public.menu_items
  for each row execute function public.menu_items_enforce_vertical_capability();

comment on function public.menu_items_enforce_vertical_capability() is
  'Makes vertical compatibility DURABLE (mig 160). vertical_assignment_blockers is point-in-time and `authenticated` holds UPDATE on menu_items, so a manager could set requires_prescription right after an assignment and void the invariant. This enforces it on the catalog write itself for every writer, and validates the RESULTING ROW on requires_prescription OR restaurant_id -- an already-Rx item moved into food by rewriting restaurant_id alone is caught too. Takes the canonical merchant-row-then-vertical-advisory lock, so it serialises against a concurrent reassignment.';

-- ===========================================================================
-- 3. ADMIN CAN CREATE A MERCHANT IN ANY VERTICAL, UNAUDITED.
-- ===========================================================================
-- Measured: restaurants_admin_insert WITH CHECK (auth_role() = 'admin'), and
-- `authenticated` holds INSERT. So an admin could create a grocery or pharmacy
-- merchant directly -- no reason, no audit row, no compatibility check --
-- bypassing admin_assign_merchant_vertical entirely. Creation was the hole the
-- assignment RPC never covered.
--
-- FIX: creation pins the vertical to the default EXPLICITLY. An earlier draft
-- wrote `coalesce(vertical_id, 'food') = 'food'`, which would have accepted an
-- explicit NULL -- that is now impossible (section 1) and, more importantly,
-- would have been the wrong contract: a policy must state what it requires, not
-- silently reinterpret a missing value.

drop policy if exists restaurants_admin_insert on public.restaurants;
create policy restaurants_admin_insert on public.restaurants
  for insert to authenticated
  with check (
    (( select public.auth_role() ) = 'admin'::app_role)
    -- Creation cannot choose a vertical. Moving a merchant is an AUDITED act
    -- (admin_assign_merchant_vertical); creating one straight into grocery or
    -- pharmacy would produce a merchant in a non-default vertical with no
    -- actor, no reason and no compatibility check on record.
    and vertical_id = 'food'
  );

comment on policy restaurants_admin_insert on public.restaurants is
  'Admins may create merchants, but only in the default vertical (mig 160). The check was previously role-only, so an admin could create a grocery/pharmacy merchant directly and bypass admin_assign_merchant_vertical -- no audit, no reason, no compatibility check. Requires vertical_id = ''food'' explicitly rather than coalescing a NULL, so the policy states its requirement instead of reinterpreting a missing value.';

-- ===========================================================================
-- 4. AUTHORIZE BEFORE VALIDATING (existence oracle).
-- ===========================================================================
-- grant_vertical_private_access validated the target vertical and user BEFORE
-- checking the caller's capability. A customer could therefore distinguish a
-- real hidden vertical from a fabricated one, and probe whether an arbitrary
-- uuid is a real user, purely from which error came back.
--
-- FIX: authorize FIRST. An unauthorized caller gets exactly one refusal and
-- learns nothing about what exists.

create or replace function public.grant_vertical_private_access(
  p_vertical_id text, p_user_id uuid, p_cohort text, p_reason text,
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
declare v_actor uuid := auth.uid(); v_id uuid; v_old uuid; v_gen int;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode='check_violation'; end if;

  -- AUTHORIZE FIRST (mig 160). Every check below leaks existence, so none of
  -- them may run for a caller who is not allowed to ask the question.
  perform public.assert_platform_capability(v_actor, 'expansion_launch_manager');

  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'REASON_REQUIRED' using errcode='check_violation';
  end if;
  if not exists (select 1 from public.verticals where id = p_vertical_id) then
    raise exception 'VERTICAL_NOT_FOUND' using errcode='check_violation';
  end if;
  if not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'USER_NOT_FOUND' using errcode='check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('vertical:' || p_vertical_id, 0));

  update public.vertical_private_access
     set status='revoked', revoked_at=now(), revoked_by=v_actor
   where vertical_id=p_vertical_id and user_id=p_user_id and status='active'
  returning id into v_old;

  if v_old is not null then
    insert into public.vertical_private_access_events (grant_id, action, actor_user_id, reason)
    values (v_old, 'revoked', v_actor, 'superseded by regrant: ' || btrim(p_reason));
  end if;

  select coalesce(max(generation), 0) + 1 into v_gen
    from public.vertical_private_access
   where vertical_id=p_vertical_id and user_id=p_user_id;

  insert into public.vertical_private_access
    (vertical_id, user_id, generation, status, cohort, reason, expires_at, granted_by)
  values (p_vertical_id, p_user_id, v_gen, 'active', p_cohort, btrim(p_reason),
          p_expires_at, v_actor)
  returning id into v_id;

  insert into public.vertical_private_access_events (grant_id, action, actor_user_id, reason)
  values (v_id, 'granted', v_actor, btrim(p_reason));

  return v_id;
end;
$function$;

revoke all on function public.grant_vertical_private_access(text, uuid, text, text, timestamptz) from public, anon;
grant execute on function public.grant_vertical_private_access(text, uuid, text, text, timestamptz) to authenticated;

comment on function public.grant_vertical_private_access(text, uuid, text, text, timestamptz) is
  'Grant a private-vertical cohort seat. AUTHORIZES BEFORE VALIDATING (mig 160): the earlier order raised VERTICAL_NOT_FOUND / USER_NOT_FOUND before checking the caller''s capability, letting an unauthorized caller distinguish a real hidden vertical from a fabricated one and probe whether a uuid is a real user. An unauthorized caller now receives exactly one refusal.';

-- ===========================================================================
-- 5. `IF NOT FOUND`, NOT NULL-AS-NOT-FOUND.
-- ===========================================================================
-- admin_assign_merchant_vertical tested `if v_prev is null then MERCHANT_NOT_
-- FOUND`. That conflated "no such merchant" with "merchant exists but its
-- vertical is NULL" -- two different facts with two different correct
-- responses. Section 1 makes the second impossible, but the CHECK itself was
-- still wrong, and correctness should not rest on a constraint elsewhere.

create or replace function public.admin_assign_merchant_vertical(
  p_restaurant_id uuid, p_new_vertical_id text, p_reason text
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_actor uuid := auth.uid();
  v_prev  text;
  v_block record;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;
  if coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'REASON_REQUIRED' using errcode = 'check_violation';
  end if;

  -- CANONICAL LOCK ORDER: the merchant ROW first (matching place_order and the
  -- menu_items trigger), then both verticals' advisory keys in a stable
  -- least/greatest order so two opposite-direction reassignments cannot
  -- deadlock.
  select vertical_id into v_prev from public.restaurants
   where id = p_restaurant_id for update;
  if not found then
    raise exception 'MERCHANT_NOT_FOUND' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('vertical:' || least(v_prev, p_new_vertical_id), 0));
  perform pg_advisory_xact_lock(hashtextextended('vertical:' || greatest(v_prev, p_new_vertical_id), 0));

  -- Re-check blockers AFTER the locks: an order placed while we waited is now
  -- visible, and this is the read that decides.
  select * into v_block from public.vertical_assignment_blockers(p_restaurant_id, p_new_vertical_id) limit 1;
  if v_block.code is not null then
    raise exception 'VERTICAL_ASSIGNMENT_BLOCKED: % (%)', v_block.code, v_block.detail
      using errcode = 'check_violation';
  end if;

  update public.restaurants set vertical_id = p_new_vertical_id where id = p_restaurant_id;

  insert into public.merchant_vertical_events
    (restaurant_id, previous_vertical_id, new_vertical_id, reason, actor_user_id)
  values (p_restaurant_id, v_prev, p_new_vertical_id, btrim(p_reason), v_actor);
end;
$function$;

revoke all on function public.admin_assign_merchant_vertical(uuid, text, text) from public, anon;
grant execute on function public.admin_assign_merchant_vertical(uuid, text, text) to authenticated;

-- ===========================================================================
-- 6. CATALOG IDENTITY IN THE IMMUTABLE ORDER SNAPSHOT.
-- ===========================================================================
-- orders.vertical_id (mig 157) records WHICH vertical, but the lines record
-- only name/price/modifiers. Measured: order_items has no sku, barcode, unit or
-- requires_prescription, and the DEPLOYED place_order body mentions none of
-- them (grep count: 0). Without them a delivered pharmacy order cannot later
-- prove it contained a prescription item, and a grocery line cannot prove which
-- SKU or unit was actually sold once the catalog moves on.
--
-- Adding and freezing the columns is NOT sufficient on its own: a frozen column
-- that no writer populates stays permanently NULL while looking like evidence.
-- Section 6c therefore rebuilds place_order so the fields are actually stamped,
-- into BOTH order_items and the orders.items JSON.

-- --- 6a. Columns ------------------------------------------------------------
alter table public.order_items
  add column if not exists sku_snapshot text,
  add column if not exists barcode_snapshot text,
  add column if not exists unit_snapshot text,
  add column if not exists requires_prescription_snapshot boolean;

-- Backfill from the live catalog. Exact only where the item still exists and
-- has not been edited, so this is recorded as best-effort for history rather
-- than claimed as historical truth -- which is precisely why the snapshot must
-- exist going forward. Rows whose catalog item is gone stay NULL: an honest
-- unknown, not a fabricated value.
update public.order_items oi
   set sku_snapshot = mi.sku,
       barcode_snapshot = mi.barcode,
       unit_snapshot = mi.unit,
       requires_prescription_snapshot = mi.requires_prescription
  from public.menu_items mi
 where mi.id = oi.catalog_item_id
   and oi.sku_snapshot is null
   and oi.barcode_snapshot is null
   and oi.unit_snapshot is null
   and oi.requires_prescription_snapshot is null;

comment on column public.order_items.sku_snapshot is
  'Catalog SKU AT PLACEMENT (mig 160). Snapshotted, not joined: the catalog moves on and a settled line must still say what was sold. Pre-mig-160 rows were backfilled from the current catalog where the item still exists -- best-effort for history, authoritative from now on. NULL means the catalog item was already gone.';
comment on column public.order_items.requires_prescription_snapshot is
  'Whether the item required a prescription AT PLACEMENT (mig 160). A delivered order must be able to prove this without depending on the live catalog, which can be edited or deleted.';

-- --- 6b. Freeze -------------------------------------------------------------
create or replace function public.order_items_freeze_catalog_snapshot()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.sku_snapshot is distinct from old.sku_snapshot
     or new.barcode_snapshot is distinct from old.barcode_snapshot
     or new.unit_snapshot is distinct from old.unit_snapshot
     or new.requires_prescription_snapshot is distinct from old.requires_prescription_snapshot then
    raise exception 'ORDER_ITEM_SNAPSHOT_IS_IMMUTABLE'
      using errcode = 'check_violation',
            hint = 'Catalog identity is captured at placement and cannot be rewritten.';
  end if;
  return new;
end;
$function$;

drop trigger if exists order_items_freeze_snapshot on public.order_items;
create trigger order_items_freeze_snapshot
  before update on public.order_items
  for each row execute function public.order_items_freeze_catalog_snapshot();

-- --- 6c. Make place_order actually stamp them -------------------------------
-- Built PROGRAMMATICALLY from the DEPLOYED body via pg_get_functiondef, never
-- retyped. Hand-copying this function once already dropped dispatch_mode,
-- history, fulfillment_type, the ETA derivation and the promo inserts; the
-- three replacements below are asserted to have applied, so a body that drifts
-- from the expected shape fails loudly here instead of silently shipping a
-- reverted function.
--
-- NOTE the temp table is written with a POSITIONAL `insert into _lines values
-- (...)`, so the new columns must be appended to BOTH the declaration and that
-- insert or the positions silently shift.
do $mig160$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_src is null then
    raise exception 'mig160: place_order not found -- refusing to guess at its body';
  end if;

  -- (1) widen the temp table
  v_new := replace(v_src,
    'create temporary table _lines (item_id uuid, name text, unit_price int, qty int, mods jsonb, line_total int, notes text) on commit drop;',
    'create temporary table _lines (item_id uuid, name text, unit_price int, qty int, mods jsonb, line_total int, notes text, sku text, barcode text, unit text, requires_prescription boolean) on commit drop;');
  if v_new = v_src then
    raise exception 'mig160: could not widen _lines -- deployed place_order body differs from expectation';
  end if;
  v_src := v_new;

  -- (2) stamp the catalog fields from the row place_order ALREADY read into
  --     v_item (menu_items), so this adds no extra lookup and cannot disagree
  --     with the price/availability decisions made from that same row.
  v_new := replace(v_src,
    'insert into _lines values (v_item.id, v_item.name, v_item.price_egp, v_qty, coalesce(v_mods_snap,''[]''::jsonb), v_line_total, v_line->>''notes'');',
    'insert into _lines values (v_item.id, v_item.name, v_item.price_egp, v_qty, coalesce(v_mods_snap,''[]''::jsonb), v_line_total, v_line->>''notes'', v_item.sku, v_item.barcode, v_item.unit, coalesce(v_item.requires_prescription, false));');
  if v_new = v_src then
    raise exception 'mig160: could not stamp _lines -- deployed place_order body differs from expectation';
  end if;
  v_src := v_new;

  -- (3) carry them into the orders.items JSON snapshot
  v_new := replace(v_src,
    'jsonb_build_object(''itemId'', item_id, ''name'', name, ''basePriceEgp'', unit_price, ''quantity'', qty, ''modifierChoices'', mods, ''notes'', notes, ''lineTotalEgp'', line_total)',
    'jsonb_build_object(''itemId'', item_id, ''name'', name, ''basePriceEgp'', unit_price, ''quantity'', qty, ''modifierChoices'', mods, ''notes'', notes, ''lineTotalEgp'', line_total, ''sku'', sku, ''barcode'', barcode, ''unit'', unit, ''requiresPrescription'', requires_prescription)');
  if v_new = v_src then
    raise exception 'mig160: could not extend orders.items JSON -- deployed place_order body differs from expectation';
  end if;
  v_src := v_new;

  -- (4) and into the order_items rows
  v_new := replace(v_src,
    'insert into public.order_items (order_id, catalog_item_id, name_snapshot, unit_price_snapshot, quantity, modifiers_snapshot, line_total, notes)
  select v_order_id, item_id, name, unit_price, qty, mods, line_total, notes from _lines;',
    'insert into public.order_items (order_id, catalog_item_id, name_snapshot, unit_price_snapshot, quantity, modifiers_snapshot, line_total, notes, sku_snapshot, barcode_snapshot, unit_snapshot, requires_prescription_snapshot)
  select v_order_id, item_id, name, unit_price, qty, mods, line_total, notes, sku, barcode, unit, requires_prescription from _lines;');
  if v_new = v_src then
    raise exception 'mig160: could not extend order_items insert -- deployed place_order body differs from expectation';
  end if;

  execute v_new;
end;
$mig160$;

-- place_order is SECURITY DEFINER; re-assert its grants after the replace.
--
-- The signature is DERIVED from pg_proc, never written out here. An earlier
-- draft of this migration hand-typed a 12-arg list that did not exist -- the
-- real one is (uuid,uuid,jsonb,text,integer,text,text,timestamptz,text,uuid,
-- dropoff_preference,text) -- and under ON_ERROR_STOP that single wrong
-- identity aborts the entire migration. Deriving it also means a future arg
-- change cannot silently leave these grants pointing at a stale signature.
--
-- House rule 1 is asserted first: exactly ONE overload must exist, or the app
-- gets PGRST202 on every checkout.
do $mig160_grants$
declare
  v_sig text;
  v_n   int;
begin
  select count(*), min(p.oid::regprocedure::text) into v_n, v_sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';

  if v_n <> 1 then
    raise exception 'mig160: expected exactly 1 place_order overload, found % -- PostgREST would fail with PGRST202', v_n;
  end if;

  execute format('revoke all on function %s from public, anon', v_sig);
  execute format('grant execute on function %s to authenticated', v_sig);
end;
$mig160_grants$;
