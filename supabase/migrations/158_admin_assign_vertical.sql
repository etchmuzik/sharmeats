-- 158_admin_assign_vertical.sql
--
-- Package 07 Program A0 (session E0) — merchant vertical assignment, audited,
-- with incompatible-live-change rejection.
--
-- WHY THIS IS THE LAST E0 PIECE. Migration 157 snapshots orders.vertical_id
-- precisely because reassignment is coming; this is the thing it protects
-- against. Until now there was NO path to move a merchant between verticals:
--
--   * authenticated has NO UPDATE grant on public.restaurants (verified);
--   * admin_update_restaurant() takes 18 parameters and vertical_id is not
--     among them (verified against the deployed body);
--   * mig 136's privileged-column guard does not list vertical_id, because
--     nothing could write it anyway.
--
-- So this RPC becomes the ONLY writer, and it must be the narrow one.
--
-- WHAT "INCOMPATIBLE" ACTUALLY MEANS HERE, measured rather than assumed:
--
--   * ALL 1038 menu items in production carry sku/barcode/unit. Those columns
--     are therefore NOT a grocery signal -- a rule like "has SKUs => grocery
--     catalog, block the move" would permanently freeze every food merchant.
--     They are universal catalog metadata and are deliberately ignored.
--   * `requires_prescription` IS genuinely vertical-specific (0 items use it
--     today). Moving a catalog that uses it into a vertical whose capabilities
--     do not include supports_prescription would strand data the target
--     workflow cannot express, so that is rejected.
--   * An ACTIVE ORDER is rejected unconditionally. An order in flight was
--     placed under one vertical's rules -- its fee rule, its terminology, its
--     snapshot -- and moving the merchant mid-flight makes the live order and
--     the merchant disagree about what it is. Production currently has one
--     order in 'ready', so this rule is exercised against real data.
--
-- The check is CAPABILITY-DRIVEN, not a hardcoded pair list: adding a vertical
-- later must not require editing this function.

-- ---------------------------------------------------------------------------
-- 1. Seed the capability hints mig 152 introduced. Bounded presentation/config
--    hints -- NOT security authority; the rules below read them, but every
--    server rule is still stated explicitly.
-- ---------------------------------------------------------------------------
update public.verticals
   set capabilities = jsonb_build_object(
     'supports_scheduled', true, 'supports_weighted_items', false,
     'supports_substitutions', false, 'supports_prescription', false,
     'supports_age_check', false)
 where id = 'food' and capabilities = '{}'::jsonb;

update public.verticals
   set capabilities = jsonb_build_object(
     'supports_scheduled', true, 'supports_weighted_items', false,
     'supports_substitutions', false, 'supports_prescription', false,
     'supports_age_check', true)
 where id = 'grocery' and capabilities = '{}'::jsonb;

update public.verticals
   set capabilities = jsonb_build_object(
     'supports_scheduled', false, 'supports_weighted_items', false,
     'supports_substitutions', false, 'supports_prescription', true,
     'supports_age_check', true)
 where id = 'pharmacy' and capabilities = '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- 2. Audit trail. Reassignment is a merchant-identity change: who did it, when,
--    from what, to what and why must outlive the merchant row.
-- ---------------------------------------------------------------------------
create table if not exists public.merchant_vertical_events (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  previous_vertical_id text,
  new_vertical_id      text not null,
  reason         text not null,
  -- No FK: the actor must survive their own account deletion, exactly as in
  -- mig 155. A uuid that no longer resolves is still the historical fact.
  actor_user_id  uuid,
  occurred_at    timestamptz not null default now()
);

create index if not exists merchant_vertical_events_restaurant_idx
  on public.merchant_vertical_events (restaurant_id, occurred_at desc);

-- House rule 5b: revoke before granting; TRUNCATE ignores RLS.
revoke all on table public.merchant_vertical_events from public, anon, authenticated;
alter table public.merchant_vertical_events enable row level security;
-- Operator-facing history: no client policy at all. Read through admin surfaces.

drop trigger if exists merchant_vertical_events_no_mutate on public.merchant_vertical_events;
create trigger merchant_vertical_events_no_mutate
  before update or delete on public.merchant_vertical_events
  for each row execute function public.vertical_access_events_immutable();

comment on table public.merchant_vertical_events is
  'Append-only audit of merchant vertical reassignment (Package 07 A0). Immutable by trigger, and actor_user_id carries no FK so the record survives the actor''s account deletion. Mig 158.';

-- ---------------------------------------------------------------------------
-- 3. Compatibility check, exposed separately so an admin UI can PREVIEW the
--    answer before offering the action -- and so the reasons are testable
--    without performing a move.
-- ---------------------------------------------------------------------------
create or replace function public.vertical_assignment_blockers(
  p_restaurant_id uuid, p_new_vertical_id text
)
returns table (code text, detail text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_current text;
  v_caps jsonb;
  v_n int;
begin
  select vertical_id into v_current from public.restaurants where id = p_restaurant_id;
  if v_current is null then
    code := 'MERCHANT_NOT_FOUND'; detail := 'no such merchant'; return next; return;
  end if;

  select capabilities into v_caps from public.verticals where id = p_new_vertical_id;
  if v_caps is null then
    code := 'VERTICAL_NOT_FOUND'; detail := p_new_vertical_id; return next; return;
  end if;

  if v_current = p_new_vertical_id then
    code := 'NO_CHANGE'; detail := 'merchant is already in ' || p_new_vertical_id;
    return next; return;
  end if;

  -- ACTIVE ORDERS. Unconditional: an in-flight order was placed under the
  -- current vertical's rules and its snapshot cannot be rewritten (mig 157).
  select count(*) into v_n from public.orders
   where restaurant_id = p_restaurant_id
     and status not in ('delivered','cancelled','rejected');
  if v_n > 0 then
    code := 'ACTIVE_ORDERS';
    detail := v_n || ' order(s) in flight; finish or cancel them first';
    return next;
  end if;

  -- CATALOG the TARGET cannot express. Only genuinely vertical-specific data
  -- counts: sku/barcode/unit are universal (all 1038 production items carry
  -- them) and are deliberately NOT treated as a signal.
  if coalesce((v_caps->>'supports_prescription')::boolean, false) = false then
    select count(*) into v_n from public.menu_items
     where restaurant_id = p_restaurant_id and requires_prescription;
    if v_n > 0 then
      code := 'CATALOG_REQUIRES_PRESCRIPTION';
      detail := v_n || ' item(s) need a prescription, which ' || p_new_vertical_id
             || ' does not support';
      return next;
    end if;
  end if;

  return;
end;
$function$;

revoke all on function public.vertical_assignment_blockers(uuid, text) from public, anon;
grant execute on function public.vertical_assignment_blockers(uuid, text) to authenticated;

comment on function public.vertical_assignment_blockers(uuid, text) is
  'Why a merchant cannot move to a vertical: zero rows means the move is allowed. Exposed separately so an admin UI can PREVIEW the answer rather than discovering it on failure. Capability-driven, so adding a vertical needs no edit here. sku/barcode/unit are deliberately ignored -- they are universal catalog metadata (all 1038 production items carry them), not a grocery signal. Mig 158.';

-- ---------------------------------------------------------------------------
-- 4. The assignment itself.
-- ---------------------------------------------------------------------------
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

  -- Serialise against BOTH verticals' launch changes and any in-flight order
  -- on this merchant: the same key place_order and set_vertical_launch_stage
  -- take. Locked in a stable order (source then target) so two concurrent
  -- reassignments in opposite directions cannot deadlock.
  perform pg_advisory_xact_lock(hashtextextended('vertical:' || least(
            (select vertical_id from public.restaurants where id = p_restaurant_id),
            p_new_vertical_id), 0));
  perform pg_advisory_xact_lock(hashtextextended('vertical:' || greatest(
            (select vertical_id from public.restaurants where id = p_restaurant_id),
            p_new_vertical_id), 0));

  select vertical_id into v_prev from public.restaurants
   where id = p_restaurant_id for update;
  if v_prev is null then
    raise exception 'MERCHANT_NOT_FOUND' using errcode = 'check_violation';
  end if;

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

comment on function public.admin_assign_merchant_vertical(uuid, text, text) is
  'The ONLY writer of restaurants.vertical_id (Package 07 A0). Admin-only, fails closed, requires a reason, appends an immutable merchant_vertical_events row, and REFUSES a move that is incompatible -- active orders, or catalog data the target vertical cannot express. Takes the same advisory lock as place_order and set_vertical_launch_stage (both verticals, in a stable order to avoid deadlock) and RE-CHECKS blockers after acquiring it, so an order placed during the wait is seen. Orders already placed keep their snapshotted vertical (mig 157); reassignment never rewrites history. Mig 158.';
