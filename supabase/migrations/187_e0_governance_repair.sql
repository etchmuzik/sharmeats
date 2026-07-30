-- 187_e0_governance_repair.sql
--
-- Package 07 Program A: owner-decided governance repair (decisions 2026-07-30).
--
-- CONTEXT. Migs 152-166 built the E0 launch authority, but three operating
-- facts undermined it: private.platform_owners was EMPTY (the owner UUID is an
-- explicit release input that was never provided), so set_vertical_launch_stage
-- could authorize NOBODY — and commit 79c7f6c (2026-07-29) enabled grocery and
-- pharmacy by DIRECT UPDATE to seed pilot merchants, leaving both catalogs
-- anon-visible; and the two capability/access expiry sweepers existed but were
-- never scheduled; and the mig-177 lifecycle producers never consult the
-- vertical gate at all.
--
-- OWNER DECISIONS (recorded from the 2026-07-30 session):
--   1. grocery + pharmacy -> launch_stage 'private' (seeded merchants preserved
--      for pilot testing via access grants; customers see nothing);
--   2. platform owner seeded: 91967dc5-9b0c-4ce4-ad8b-9810b3aee768
--      (beyondtech.eg@gmail.com — the real admin; the ops@sharmeats.test legacy
--      seed deliberately gets nothing).
--
-- The stage change below is the LAST sanctioned direct write: with the owner
-- seeded and expansion_launch_manager granted, every future change goes through
-- set_vertical_launch_stage.

-- ============ 1. Platform owner bootstrap (database-owner act) ============
-- The out-of-band bootstrap migs 152/166 anticipate: there is deliberately no
-- onboarding RPC. Idempotent; events appended.
insert into private.platform_owners (user_id, status, granted_by_database_owner, granted_at)
values ('91967dc5-9b0c-4ce4-ad8b-9810b3aee768', 'active', true, now())
on conflict (user_id) do nothing;

insert into private.platform_owner_events (owner_user_id, action, actor_user_id, reason, occurred_at)
select '91967dc5-9b0c-4ce4-ad8b-9810b3aee768', 'granted', null,
       'bootstrap: explicit owner release input, session 2026-07-30 (mig 187)', now()
 where not exists (select 1 from private.platform_owner_events
                    where owner_user_id = '91967dc5-9b0c-4ce4-ad8b-9810b3aee768' and action = 'granted');

-- ============ 2. Root capability for the owner ============
insert into private.platform_operator_capabilities
  (user_id, capability, status, granted_by, granted_at, reason)
select '91967dc5-9b0c-4ce4-ad8b-9810b3aee768', 'expansion_launch_manager', 'active', '91967dc5-9b0c-4ce4-ad8b-9810b3aee768', now(),
       'bootstrap grant with owner seeding (mig 187); future grants via grant_platform_capability'
 where not exists (select 1 from private.platform_operator_capabilities
                    where user_id = '91967dc5-9b0c-4ce4-ad8b-9810b3aee768' and capability = 'expansion_launch_manager'
                      and status = 'active');

insert into private.platform_operator_capability_events
  (capability_grant_id, action, actor_user_id, reason, occurred_at)
select c.id, 'granted', '91967dc5-9b0c-4ce4-ad8b-9810b3aee768', 'bootstrap (mig 187)', now()
  from private.platform_operator_capabilities c
 where c.user_id = '91967dc5-9b0c-4ce4-ad8b-9810b3aee768' and c.capability = 'expansion_launch_manager' and c.status = 'active'
   and not exists (select 1 from private.platform_operator_capability_events e
                    where e.capability_grant_id = c.id and e.action = 'granted');

-- ============ 3. grocery + pharmacy -> private (audited) ============
do $mig$
declare v text;
begin
  foreach v in array array['grocery', 'pharmacy'] loop
    if exists (select 1 from public.verticals where id = v and launch_stage <> 'private') then
      insert into public.vertical_launch_events
        (vertical_id, previous_stage, new_stage, previous_is_active, new_is_active,
         reason, evidence_reference, actor_user_id, occurred_at)
      select v, launch_stage, 'private', is_active, is_active,
             'owner decision 2026-07-30: pilots go dark-private; reverses the 79c7f6c direct enable. Final direct write — RPC path usable hereafter.',
             'mig 187', '91967dc5-9b0c-4ce4-ad8b-9810b3aee768', now()
        from public.verticals where id = v;
      update public.verticals set launch_stage = 'private' where id = v;
    end if;
  end loop;
end;
$mig$;

-- ============ 4. Schedule the expiry sweepers ============
do $mig$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('sharmeats-vertical-access-expiry', '20 3 * * *',
      $job$select public.expire_vertical_private_access(200);$job$);
    perform cron.schedule('sharmeats-capability-expiry', '25 3 * * *',
      $job$select public.expire_platform_capabilities(200);$job$);
  end if;
end;
$mig$;

-- ============ 5. Lifecycle producers ask the vertical gate ============
-- Bodies rebuilt from the CURRENT prod definitions (house rule 2), one added
-- check each: a lifecycle nudge must not re-expose a vertical the recipient
-- cannot see.
CREATE OR REPLACE FUNCTION public.abandoned_cart_sweep()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_idle_hours int;
  v_live       boolean := public.lifecycle_is_live();
  v_rec        record;
  v_gate       record;
  v_msg        uuid;
  v_count      int := 0;
begin
  select coalesce((select (value #>> '{}')::int from public.platform_settings
                    where key = 'lifecycle_cart_idle_hours'), 24)
    into v_idle_hours;

  for v_rec in
    select c.user_id, c.restaurant_id, c.items, c.updated_at,
           r.is_active, r.is_open, r.name as restaurant_name, r.vertical_id
      from public.customer_carts c
      join public.restaurants r on r.id = c.restaurant_id
     where c.restaurant_id is not null
       -- customer_carts.user_id is the primary key so it cannot be null; stated
       -- anyway so both producers read identically and neither relies on a schema
       -- detail holding.
       and c.user_id is not null
       and jsonb_array_length(c.items) > 0
       and c.updated_at < now() - make_interval(hours => v_idle_hours)
       -- Never chase a cart that has already expired: its own TTL says the customer
       -- has moved on, and mig 170's sweep is about to delete it.
       and c.expires_at > now()
  loop
    begin
      -- Subject validity, per the header: a reminder to finish a basket at a shut
      -- or delisted restaurant is worse than no reminder.
      if not (v_rec.is_active and v_rec.is_open) then
        perform public.lifecycle_record(v_rec.user_id, 'abandoned_cart', v_rec.restaurant_id,
                                        false, 'subject_invalid',
                                        public.lifecycle_holdout_group(v_rec.user_id, 'abandoned_cart'));
        continue;
      end if;
      -- [mig 187] E0 gap closure: the producers postdate the vertical launch
      -- gate but never asked it. A reminder is a re-exposure path — a customer
      -- whose access to a private vertical expired must not be lured back to a
      -- storefront they can no longer open. Subject-scoped check, same as
      -- delivery_feasibility [159].
      if not public.user_can_view_vertical(v_rec.user_id, v_rec.vertical_id) then
        perform public.lifecycle_record(v_rec.user_id, 'abandoned_cart', v_rec.restaurant_id,
                                        false, 'vertical_not_visible',
                                        public.lifecycle_holdout_group(v_rec.user_id, 'abandoned_cart'));
        continue;
      end if;

      select * into v_gate
        from public.lifecycle_eligible(v_rec.user_id, 'abandoned_cart', v_rec.restaurant_id);

      if not v_gate.allowed then
        perform public.lifecycle_record(v_rec.user_id, 'abandoned_cart', v_rec.restaurant_id,
                                        false, v_gate.reason, v_gate.holdout_group);
        continue;
      end if;

      v_msg := null;
      if v_live then
        -- Marketing category, so the dispatcher applies marketing consent again at
        -- send time — defence in depth, since a customer could revoke between this
        -- decision and the actual send.
        v_msg := public.enqueue_push(
          p_event              := 'cart_reminder',
          p_order_id           := null,
          p_recipient_user_ids := array[v_rec.user_id],
          p_idempotency_key    := 'lifecycle:abandoned_cart:' || v_rec.user_id || ':' || v_rec.restaurant_id,
          p_route              := '/(tabs)/cart',
          p_vertical           := v_rec.vertical_id,
          p_category           := 'marketing');
      end if;

      -- would_send TRUE in both modes: in observe mode this is the counterfactual
      -- that consumes frequency budget, which is what makes the observed volume
      -- honest. See mig 176's header.
      perform public.lifecycle_record(v_rec.user_id, 'abandoned_cart', v_rec.restaurant_id,
                                      true, null, v_gate.holdout_group, v_msg);
      v_count := v_count + 1;
    exception when others then
      -- One bad cart must not abort the batch.
      raise warning 'abandoned_cart_sweep user(%) failed: %', v_rec.user_id, sqlerrm;
    end;
  end loop;

  return v_count;
end;
$function$;

revoke all on function public.abandoned_cart_sweep() from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reorder_cadence_sweep()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_live  boolean := public.lifecycle_is_live();
  v_rec   record;
  v_gate  record;
  v_msg   uuid;
  v_count int := 0;
begin
  for v_rec in
    select o.id, o.user_id, o.restaurant_id, o.vertical_id,
           r.is_active, r.is_open
      from public.orders o
      join public.restaurants r on r.id = o.restaurant_id
     where o.status = 'delivered'
       and o.delivered_at is not null
       -- GUEST ORDERS HAVE user_id NULL, and this must be explicit rather than
       -- incidental. Found in production: two delivered orders matched the window
       -- but produced NO ledger row at all, because the most-recent-order check
       -- below compared `o.id = (subquery)` where the subquery returned NULL for a
       -- null user — and `id = NULL` is NULL, not true, so the row was dropped
       -- silently before any decision could be recorded. The outcome happened to be
       -- safe (there is nobody to push to), but it was safe by accident, and a
       -- silent drop is indistinguishable from a broken query. House rule 4's
       -- fail-open trap, in a WHERE clause.
       and o.user_id is not null
       and (
         -- Two self-healing windows rather than two exact ages; see the header.
         (o.delivered_at between now() - interval '9 days'  and now() - interval '7 days')
         or
         (o.delivered_at between now() - interval '16 days' and now() - interval '14 days')
       )
       -- Only the customer's MOST RECENT delivered order from this restaurant is a
       -- sensible thing to reorder. Without this, a regular would be reminded about
       -- every historical order that happens to fall in the window.
       -- `is not distinct from` rather than `=`, so a NULL subquery result can
       -- never silently drop the row (see the user_id note above). With user_id
       -- non-null the subquery always returns a row, but the null-safe operator
       -- means a future change cannot reintroduce the silent-drop failure.
       and o.id is not distinct from (
         select o2.id from public.orders o2
          where o2.user_id = o.user_id and o2.restaurant_id = o.restaurant_id
            and o2.status = 'delivered'
          order by o2.delivered_at desc limit 1
       )
  loop
    begin
      if not (v_rec.is_active and v_rec.is_open) then
        perform public.lifecycle_record(v_rec.user_id, 'reorder_cadence', v_rec.id,
                                        false, 'subject_invalid',
                                        public.lifecycle_holdout_group(v_rec.user_id, 'reorder_cadence'));
        continue;
      end if;
      -- [mig 187] E0 gap closure: the producers postdate the vertical launch
      -- gate but never asked it. A reminder is a re-exposure path — a customer
      -- whose access to a private vertical expired must not be lured back to a
      -- storefront they can no longer open. Subject-scoped check, same as
      -- delivery_feasibility [159].
      if not public.user_can_view_vertical(v_rec.user_id, v_rec.vertical_id) then
        perform public.lifecycle_record(v_rec.user_id, 'reorder_cadence', v_rec.id,
                                        false, 'vertical_not_visible',
                                        public.lifecycle_holdout_group(v_rec.user_id, 'reorder_cadence'));
        continue;
      end if;

      select * into v_gate
        from public.lifecycle_eligible(v_rec.user_id, 'reorder_cadence', v_rec.id);

      if not v_gate.allowed then
        perform public.lifecycle_record(v_rec.user_id, 'reorder_cadence', v_rec.id,
                                        false, v_gate.reason, v_gate.holdout_group);
        continue;
      end if;

      v_msg := null;
      if v_live then
        v_msg := public.enqueue_push(
          p_event              := 'reorder_reminder',
          -- The order IS the subject here, so it is passed as order_id: a tap lands
          -- on that order, where "order again" already exists (Package 02 Slice A).
          p_order_id           := v_rec.id,
          p_recipient_user_ids := array[v_rec.user_id],
          p_idempotency_key    := 'lifecycle:reorder_cadence:' || v_rec.id,
          p_vertical           := v_rec.vertical_id,
          p_category           := 'marketing');
      end if;

      perform public.lifecycle_record(v_rec.user_id, 'reorder_cadence', v_rec.id,
                                      true, null, v_gate.holdout_group, v_msg);
      v_count := v_count + 1;
    exception when others then
      raise warning 'reorder_cadence_sweep order(%) failed: %', v_rec.id, sqlerrm;
    end;
  end loop;

  return v_count;
end;
$function$;

revoke all on function public.reorder_cadence_sweep() from public, anon, authenticated;
