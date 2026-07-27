-- 146_campaign_provider_accepted.sql
--
-- Package 03 A4 — stop calling an edge-function HTTP 2xx "delivered".
--
-- THE LIE. Migration 137 settles a campaign to delivery_status='delivered' when
-- the pg_net response to the expo-push call is 2xx, and the admin UI renders
-- that as a green "Delivered". What a 2xx actually means is:
--
--     the edge function accepted the request.
--
-- It does not mean Expo accepted the messages, that APNs/FCM accepted them,
-- that a device received anything, or that a human saw a notification. The
-- function returns 200 even for "ok (no tokens)" and "ok (all recipients opted
-- out)" -- literally zero pushes -- and those settle as "Delivered" today.
--
-- An operator reading that green label has been told something untrue about
-- their own system. That is the same class of defect as the fake transactional
-- switch (mig 143): a control surface that reports a state it cannot know.
--
-- THE FIX is naming, not mechanism. The state itself is real and worth keeping;
-- it is simply "the transport accepted the request", so it is now called
-- `provider_accepted`. `delivered` is reserved for a stronger source we do not
-- have yet -- Expo receipts (Slice E) are the next rung, and even those only
-- prove APNs/FCM acceptance, never display.
--
-- BACK-COMPAT. The CHECK constraint accepts BOTH values and existing rows are
-- migrated, so:
--   * an admin-web build that predates this migration keeps working (it maps
--     'delivered'; it will show the raw string for the new value until it is
--     redeployed, which is why the UI in this commit accepts both);
--   * nothing that reads delivery_status breaks mid-deploy.
-- The old value is not dropped from the constraint here. Narrowing it belongs
-- in a later migration, once every surface has been redeployed and no row has
-- been written with 'delivered' for a full retention window.

-- 1. Widen the constraint FIRST, so the backfill below cannot violate it.
alter table public.push_campaigns
  drop constraint if exists push_campaigns_delivery_status_chk;

alter table public.push_campaigns
  add constraint push_campaigns_delivery_status_chk
  check (delivery_status in (
    'dispatched',
    'provider_accepted',  -- the transport accepted the request (was: delivered)
    'delivered',          -- DEPRECATED, retained for old rows and old readers
    'failed',
    'not_attempted'
  ));

-- 2. Migrate existing rows. There is exactly one campaign in production and it
--    is 'failed', so this is a no-op today -- but it must exist, or a future
--    restore of an older backup would leave rows the new UI cannot label.
update public.push_campaigns
   set delivery_status = 'provider_accepted'
 where delivery_status = 'delivered';

-- 3. Stop writing the old value. Body derived from the DEPLOYED definition
--    (pg_get_functiondef, 2026-07-28); the ONLY change is the literal on the
--    2xx branch and the wording of the pruned-response detail.
create or replace function public.reconcile_push_campaigns()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_settled int := 0;
begin
  with settled as (
    update public.push_campaigns c
       set delivery_status = case
             -- 2xx from the edge function == the transport accepted the
             -- request. NOT device delivery. See this migration's header.
             when r.status_code between 200 and 299 then 'provider_accepted'
             else 'failed'
           end,
           delivery_detail = case
             when r.status_code between 200 and 299 then left(coalesce(r.content, ''), 500)
             else 'HTTP ' || r.status_code::text || ': ' || left(coalesce(r.content, r.error_msg, ''), 500)
           end,
           settled_at = now()
      from net._http_response r
     where r.id = c.net_request_id
       and c.delivery_status = 'dispatched'
    returning 1
  )
  select count(*) into v_settled from settled;

  -- pg_net prunes _http_response (default ~6h). A campaign whose response is
  -- gone can never be settled from it; call that out rather than leaving a row
  -- stuck on 'dispatched' forever, which would read as "still in progress".
  update public.push_campaigns
     set delivery_status = 'failed',
         delivery_detail = 'No pg_net response found before it was pruned — the transport outcome is unknown.',
         settled_at = now()
   where delivery_status = 'dispatched'
     and created_at < now() - interval '12 hours';

  -- Anything that failed is an operator-visible problem: a campaign the admin
  -- believes went out did not.
  begin
    perform public.ops_alert('push campaign FAILED to reach the transport: ' || left(coalesce(delivery_detail,''), 200))
      from public.push_campaigns
     where delivery_status = 'failed' and settled_at >= now() - interval '10 minutes';
  exception when others then null;
  end;

  return v_settled;
end;
$function$;

comment on column public.push_campaigns.delivery_status is
  'Transport outcome, NOT device delivery. dispatched = handed to pg_net, outcome unknown; provider_accepted = the expo-push edge function returned 2xx, i.e. it ACCEPTED THE REQUEST (it returns 200 even for "no tokens" and "all recipients opted out", so this is not proof any push was sent, let alone displayed); failed = non-2xx, transport error, or a pg_net response pruned before settlement; not_attempted = zero recipients or functions_base_url unset. "delivered" is DEPRECATED and retained only for pre-mig-146 rows -- it is reserved for a stronger source (Expo receipts, and even those prove only APNs/FCM acceptance). Settled by reconcile_push_campaigns(). Migs 137, 146.';

comment on column public.push_campaigns.recipients is
  'How many customers were RESOLVED for this segment AND passed the marketing consent gate at send time. Written BEFORE the send, so it cannot reflect any failure: it is an audience size, never a delivery count. Read delivery_status for the transport outcome. Migs 137, 146.';
