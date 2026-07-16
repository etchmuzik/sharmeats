-- 112_account_deletion_fk_and_anonymize.sql
--
-- HIGH (final audit 2026-07-16): account deletion hard-fails with HTTP 500.
--
-- The delete-account edge function calls anonymize_my_account() then
-- auth.admin.deleteUser(uid), which cascades auth.users -> public.users. But
-- FOUR foreign keys reference public.users with ON DELETE NO ACTION, so the
-- cascade aborts if the user has any referencing row:
--
--   order_messages.sender_id   NOT NULL, NO ACTION  -> blocks ANY customer who
--                                                      sent an order-chat message
--                                                      (the audit's finding; prod
--                                                      already has affected users)
--   support_messages.author_id nullable,  NO ACTION -> blocks users who authored
--                                                      support messages
--   kyc_documents.reviewed_by  nullable,  NO ACTION -> blocks deleting a reviewer
--   push_campaigns.sent_by     nullable,  NO ACTION -> blocks deleting a sender
--
-- The comprehensive FK scan found all four (the audit only named order_messages).
-- Fix: convert all four to ON DELETE SET NULL so the delete cascade nulls the
-- actor reference instead of aborting — matching how order_status_events.actor_id
-- and order_assignments.assigned_by_id already behave. This makes deletion work
-- for every account type (customer, driver, merchant, admin), not just customers
-- with no chat history.
--
-- The FK SET NULL only nulls the *reference*; the free-text message BODY the user
-- wrote can still carry PII ("ring room 412, ask for Sarah"). So anonymize_my_
-- account is extended to scrub the caller's own message bodies before the users
-- row is removed. body is NOT NULL on both tables, so we overwrite with a marker.

-- DROP ... IF EXISTS on every constraint so this migration is safely re-runnable
-- (partial-failure retry, db reset replay, staging that already has it) — matches
-- the repo's idempotent-DDL convention (mig 022). DROP-then-ADD is idempotent
-- because a replay drops the already-SET-NULL constraint and re-adds it identically.

-- ── FK 1: order_messages.sender_id (also relax NOT NULL so SET NULL is legal) ──
alter table public.order_messages alter column sender_id drop not null;
alter table public.order_messages drop constraint if exists order_messages_sender_id_fkey;
alter table public.order_messages
  add constraint order_messages_sender_id_fkey
  foreign key (sender_id) references public.users(id) on delete set null;

-- ── FK 2: support_messages.author_id (already nullable) ──
alter table public.support_messages drop constraint if exists support_messages_author_id_fkey;
alter table public.support_messages
  add constraint support_messages_author_id_fkey
  foreign key (author_id) references public.users(id) on delete set null;

-- ── FK 3: kyc_documents.reviewed_by (already nullable) ──
alter table public.kyc_documents drop constraint if exists kyc_documents_reviewed_by_fkey;
alter table public.kyc_documents
  add constraint kyc_documents_reviewed_by_fkey
  foreign key (reviewed_by) references public.users(id) on delete set null;

-- ── FK 4: push_campaigns.sent_by (already nullable) ──
alter table public.push_campaigns drop constraint if exists push_campaigns_sent_by_fkey;
alter table public.push_campaigns
  add constraint push_campaigns_sent_by_fkey
  foreign key (sent_by) references public.users(id) on delete set null;

-- ── Extend the scrub. Body is preserved verbatim from prod (do not start from an
--    older copy) with one new block (2f) added; every other line is unchanged. ──
create or replace function public.anonymize_my_account()
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'No authenticated user in context'
      using errcode = 'check_violation';
  end if;

  -- 2a. ACTIVE-ORDER GUARD. Refuse while an order is in flight: detaching and
  --     scrubbing it would destroy the address/room/GPS/contact the active
  --     delivery (and any refund/support path) needs. The Edge Function maps
  --     this to HTTP 409 so the client tells the user to finish/cancel first.
  --     Terminal statuses per order_status_type (mig 002/009): delivered,
  --     cancelled, rejected.
  if exists (
    select 1 from public.orders
    where user_id = v_uid
      and status not in ('delivered', 'cancelled', 'rejected')
  ) then
    raise exception 'ACTIVE_ORDER'
      using errcode = 'check_violation';
  end if;

  -- 2b. Detach + scrub the caller's orders (idempotent: only rows still owned).
  --     DEFAULT-DENY across the WHOLE order row — every column that can carry
  --     identity, location, free text, or health data is nulled/rebuilt, not
  --     just address_snapshot. Retained columns are the financial/operational
  --     skeleton (amounts, status, restaurant, timestamps, coarse zone), which
  --     is what the tax/audit record needs.
  --       address_snapshot : to_jsonb(<full addresses row>) -> ALLOWLIST rebuild
  --                          keeping only the coarse, non-identifying `kind`.
  --       rider            : a driver (a person) -> replaced wholesale.
  --       dropoff_geo      : the customer's exact GPS pin (geography Point) ->
  --                          nulled. The coarse `zone` is retained for analytics.
  --       kitchen_notes /  : customer free text ("ring room 412, ask for Sarah,
  --       cancel_reason      +20…") -> nulled.
  --       aggregate_allergens: health data -> nulled.
  --       items            : line snapshots can carry per-line `notes` free
  --                          text -> strip the notes from each element.
  --       history          : append-only status log that can carry notes ->
  --                          reset to an empty array.
  update public.orders o
  set
    deleted_user_ref    = coalesce(o.deleted_user_ref, o.user_id),
    user_id             = null,
    anonymized_at       = now(),
    address_snapshot    = case
      when o.address_snapshot is null then null
      else jsonb_strip_nulls(jsonb_build_object(
        'kind',       o.address_snapshot -> 'kind',
        'anonymized', to_jsonb(true)
      ))
    end,
    rider               = case when o.rider is null then null
                               else jsonb_build_object('anonymized', true) end,
    dropoff_geo         = null,
    kitchen_notes       = null,
    cancel_reason       = null,
    aggregate_allergens = null,
    items               = case
      when o.items is null then null
      else (
        select coalesce(jsonb_agg(elem - 'notes'), '[]'::jsonb)
        from jsonb_array_elements(o.items) as elem
      )
    end,
    history             = '[]'::jsonb
  where o.user_id = v_uid;

  -- 2c. Scrub free-text notes on the caller's own order status events
  --     (e.g. "delivered to room 412"). Scoped via the retained owner ref
  --     (deleted_user_ref was just set in 2b above) so we never touch other
  --     customers' audit trails. actor_id is left to its existing ON DELETE
  --     SET NULL (handled, correctly scoped, by the cascade).
  update public.order_status_events e
  set note = null
  from public.orders o
  where e.order_id = o.id
    and o.deleted_user_ref = v_uid
    and e.note is not null;

  -- 2d. order_items (-> orders ON DELETE CASCADE) are retained with the orders;
  --     scrub their per-line free-text `notes` (e.g. "no onions, room 412").
  update public.order_items oi
  set notes = null
  from public.orders o
  where oi.order_id = o.id
    and o.deleted_user_ref = v_uid
    and oi.notes is not null;

  -- 2f. [mig 112] Scrub the caller's own chat message bodies. The FK on
  --     order_messages.sender_id / support_messages.author_id is now ON DELETE
  --     SET NULL, so the delete cascade nulls the author reference but retains
  --     the row; the body is free text the user wrote and may carry PII, so
  --     overwrite it here (body is NOT NULL, hence a marker not NULL). Only the
  --     caller's own messages are touched.
  update public.order_messages
  set body = '[deleted]'
  where sender_id = v_uid;

  update public.support_messages
  set body = '[deleted]'
  where author_id = v_uid;

  -- 2e. Everything else is handled by the auth.users -> public.users cascade:
  --       addresses / payment_methods / push_tokens / favorites /
  --       merchant_staff           -> ON DELETE CASCADE (removed with the user)
  --       order_status_events.actor_id, promo_redemptions.user_id,
  --       drivers.profile_id, order_assignments.assigned_by_id,
  --       order_messages.sender_id, support_messages.author_id,   -- [mig 112]
  --       kyc_documents.reviewed_by, push_campaigns.sent_by       -- [mig 112]
  --                                -> ON DELETE SET NULL (nulled by the cascade)
  --       users.default_address_id / default_payment_method_id
  --                                -> the users row itself is removed.
end;
$function$;
