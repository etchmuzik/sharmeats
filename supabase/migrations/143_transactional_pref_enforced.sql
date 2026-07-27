-- 143_transactional_pref_enforced.sql
--
-- Documentation-only. Migration 138 shipped `notification_prefs.transactional`
-- with a comment stating it was NOT yet enforced ("Recorded and surfaced now;
-- wiring it into those senders … is a deliberate follow-up"). That follow-up
-- has now happened, so the comment would otherwise be a lie left in the schema
-- for the next reader to trust.
--
-- WHERE THE ENFORCEMENT LIVES: the `expo-push` edge function (deployed
-- 2026-07-27), NOT in the 14 SECURITY DEFINER senders. That choice matters:
--   * expo-push is the single point every DB sender routes through, and it is
--     the only place that knows the FINAL recipient list — some senders pass
--     recipientUserIds explicitly, others (e.g. driver_assigned) send none and
--     let the function resolve the order's customer;
--   * editing 14 definer bodies to add the same check is precisely the
--     "re-stating an old body silently reverts later hardening" failure that
--     house rule 2 exists to prevent. One choke point, one rule.
--
-- WHAT IS EXEMPT: `supabase/functions/expo-push/prefs.ts` holds
-- ESSENTIAL_EVENTS — courier-approaching, order-cancelled, money-moved,
-- driver-job-offer and compliance events that a preference must never
-- suppress. Everything else (order_accepted, order_delivered, new_message,
-- support_reply, tier_promoted, referral_rewarded, campaign) is suppressible.
-- The list is unit-tested both ways: essential events must stay exempt AND
-- informational ones must stay suppressible, so a future edit that guts the
-- switch fails CI.
--
-- FAILURE DIRECTION: a failed preference lookup FAILS OPEN and still sends,
-- because dropping a wanted order update is worse than one extra push.
-- Marketing is the exact opposite — `marketing_allowed()` fails CLOSED and
-- treats an absent row as "no consent". Two defaults, deliberately opposed.
--
-- Verified against production 2026-07-27 with a real opted-out customer:
--   order_accepted        -> 200 "ok (all recipients opted out)"   (suppressed)
--   order_out_for_delivery-> 200 "ok (sent 1/1, pruned 0)"          (delivered)
-- The test prefs row was removed afterwards.

comment on column public.notification_prefs.transactional is
  'Order status, chat, support and similar service pushes. Default ON. ENFORCED in the expo-push edge function, which filters recipients per push — see supabase/functions/expo-push/prefs.ts. Delivery-critical events (courier approaching, order cancelled, payment/credit, driver job offers, merchant new-order, settlements, KYC) are in ESSENTIAL_EVENTS and are NEVER suppressed by this flag, because muting notifications must not leave someone waiting in the street or unaware that money moved. A failed preference lookup fails OPEN (sends); marketing fails closed. Migs 138, 143.';

comment on table public.notification_prefs is
  'Per-customer notification consent. One row per user, created on first write (absent row = defaults: transactional ON, marketing OFF). Marketing is opt-IN and enforced by marketing_allowed() in send_push_campaign; transactional is opt-OUT and enforced in the expo-push edge function with a delivery-critical exemption list. Enforcement deliberately lives in the SENDERS, never in this client-writable table. Migs 138, 143.';
