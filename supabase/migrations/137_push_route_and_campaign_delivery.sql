-- 137_push_route_and_campaign_delivery.sql
--
-- Marketing campaigns have never delivered a push, and two transactional
-- pushes deep-link to screens that cannot load. One root cause, one fix.
--
-- All three function bodies below were taken from `pg_get_functiondef` against
-- PRODUCTION on 2026-07-27 (house rule 2), not from the migration files that
-- first defined them.
--
-- ================= ROOT CAUSE =================
-- The expo-push edge function required a non-empty `orderId` on EVERY push
-- ("event + orderId required" -> 400). But not every push is about an order,
-- so callers worked around the check in two incompatible ways:
--
--   a) send_push_campaign (mig 078) passed orderId ''. That is falsy, so the
--      edge function rejected the request with 400 and NOTHING was delivered.
--      Worse, the campaign row is inserted BEFORE the fire-and-forget
--      net.http_post, and pg_net never reports back, so the admin UI showed
--      the campaign as sent. Every campaign ever "sent" delivered zero pushes.
--
--   b) issue_credit (prod body, from mig 101) passed
--      coalesce(p_order_id::text, p_user_id::text) -- a USER id when the credit
--      has no order -- and reward_referrer_on_delivery (prod body, from 122)
--      passed the REFERRED FRIEND'S order id. Both satisfy the check; both are
--      then used by the client as an order id. routeForNotification sends any
--      payload with an orderId to /order/<id>, so:
--        * "Credit was added to your wallet. Tap to see it." opens
--          /order/<userId> -- an order that does not exist.
--        * "Your friend ordered, your discount is ready." opens an order the
--          recipient does not own (and RLS will not show them).
--
-- ================= THE FIX =================
-- The edge function (deployed alongside this migration) now requires only
-- `event`, treats `orderId` as optional, and accepts an explicit `route` for
-- the in-app destination. orderId still routes when present, so old senders
-- and already-installed binaries behave exactly as before.
--
-- This migration updates the three DB-side senders to match:
--   1. send_push_campaign  -- drop the empty orderId, add route '/', and record
--                             a truthful delivery outcome (below).
--   2. issue_credit        -- stop passing a user id as an order id; route
--                             wallet credits to /rewards.
--   3. reward_referrer_on_delivery -- stop pointing at someone else's order;
--                             route referral rewards to /rewards.
--
-- ================= THE SECOND DEFECT: A COUNTER THAT CANNOT FAIL =================
-- push_campaigns.recipients is written before the send from the SEGMENT SIZE,
-- and apps/admin-web renders it as "{n} sent". It is structurally incapable of
-- reporting a delivery failure -- which is exactly why (a) above went unnoticed.
-- Fixing delivery without fixing the counter would just hide the next failure.
--
-- pg_net is fire-and-forget: net.http_post returns a request id immediately and
-- the response lands later in net._http_response. So an honest counter cannot
-- be a single number written at send time. Instead:
--   * `recipients` keeps its meaning but is renamed in intent: how many users
--     we RESOLVED (had a push token). Comment says so.
--   * `net_request_id` stores the pg_net request id, and `delivery_status`
--     starts as 'dispatched' -- NOT 'sent'.
--   * reconcile_push_campaigns() reads net._http_response and settles each
--     campaign to 'delivered' (2xx) or 'failed' (anything else, with the
--     status code and body), so a 400 like the one this migration fixes can
--     never again read as success. It is scheduled every 5 minutes.
-- The admin UI is updated in the same commit to show the settled status.

-- ---------------------------------------------------------------------------
-- 1. Delivery-outcome columns
-- ---------------------------------------------------------------------------
alter table public.push_campaigns
  add column if not exists net_request_id  bigint,
  add column if not exists delivery_status text not null default 'dispatched',
  add column if not exists delivery_detail text,
  add column if not exists settled_at      timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'push_campaigns_delivery_status_chk'
  ) then
    alter table public.push_campaigns
      add constraint push_campaigns_delivery_status_chk
      check (delivery_status in ('dispatched','delivered','failed','not_attempted'));
  end if;
end $$;

comment on column public.push_campaigns.recipients is
  'How many customers were RESOLVED for this segment (i.e. had a push token) at send time. This is NOT a delivery count -- it is written before the send and cannot reflect failure. Read delivery_status for the outcome. Mig 137.';
comment on column public.push_campaigns.delivery_status is
  'dispatched = handed to pg_net, outcome unknown yet; delivered = expo-push returned 2xx; failed = non-2xx or transport error (see delivery_detail); not_attempted = zero recipients or functions_base_url unset. Settled by reconcile_push_campaigns(). Mig 137.';
comment on column public.push_campaigns.net_request_id is
  'The pg_net request id, joined against net._http_response by reconcile_push_campaigns() to settle delivery_status. Mig 137.';

-- Existing rows predate the fix. They were dispatched with an empty orderId
-- and rejected 400 by the edge function, so they are known failures -- but
-- their pg_net responses have long since been pruned, so mark them explicitly
-- rather than leaving them to look 'dispatched' forever.
update public.push_campaigns
   set delivery_status = 'failed',
       delivery_detail = 'Pre-mig-137: sent with empty orderId, rejected 400 by expo-push. No push was delivered.',
       settled_at = now()
 where net_request_id is null and delivery_status = 'dispatched';

-- ---------------------------------------------------------------------------
-- 2. send_push_campaign -- prod body + route, no empty orderId, honest status
-- ---------------------------------------------------------------------------
create or replace function public.send_push_campaign(
  p_title text, p_body text, p_segment text, p_segment_param text default null::text
)
returns integer
language plpgsql
security definer set search_path to 'public','pg_temp'
as $function$
declare
  v_agent   uuid := auth.uid();
  v_base    text;
  v_secret  text;
  v_headers jsonb;
  v_ids     jsonb;
  v_count   int;
  v_days    int;
  v_campaign_id uuid;
  v_req_id  bigint;
begin
  if v_agent is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;
  if coalesce(public.auth_role()::text,'') <> 'admin' then raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation'; end if;
  if p_title is null or length(btrim(p_title)) = 0 or p_body is null or length(btrim(p_body)) = 0 then
    raise exception 'EMPTY_COPY' using errcode = 'check_violation';
  end if;
  if p_segment not in ('all','lapsed','never_ordered','zone') then
    raise exception 'INVALID_SEGMENT' using errcode = 'check_violation';
  end if;

  if p_segment = 'all' then
    select coalesce(jsonb_agg(distinct pt.user_id::text), '[]'::jsonb) into v_ids
      from public.push_tokens pt
      join public.users u on u.id = pt.user_id and u.role = 'customer';

  elsif p_segment = 'lapsed' then
    v_days := coalesce(nullif(btrim(coalesce(p_segment_param,'')),'')::int, 30);
    select coalesce(jsonb_agg(distinct pt.user_id::text), '[]'::jsonb) into v_ids
      from public.push_tokens pt
      join public.users u on u.id = pt.user_id and u.role = 'customer'
     where exists (select 1 from public.orders o where o.user_id = pt.user_id)
       and not exists (
         select 1 from public.orders o
          where o.user_id = pt.user_id and o.placed_at >= now() - make_interval(days => v_days)
       );

  elsif p_segment = 'never_ordered' then
    select coalesce(jsonb_agg(distinct pt.user_id::text), '[]'::jsonb) into v_ids
      from public.push_tokens pt
      join public.users u on u.id = pt.user_id and u.role = 'customer'
     where not exists (select 1 from public.orders o where o.user_id = pt.user_id);

  else
    select coalesce(jsonb_agg(distinct pt.user_id::text), '[]'::jsonb) into v_ids
      from public.push_tokens pt
      join public.users u on u.id = pt.user_id and u.role = 'customer'
     where exists (
       select 1 from public.orders o
        where o.user_id = pt.user_id and o.zone::text = p_segment_param
     );
  end if;

  v_count := coalesce(jsonb_array_length(v_ids), 0);

  insert into public.push_campaigns (title, body, segment, segment_param, recipients, sent_by, delivery_status)
  values (btrim(p_title), btrim(p_body), p_segment, p_segment_param, v_count, v_agent,
          case when v_count = 0 then 'not_attempted' else 'dispatched' end)
  returning id into v_campaign_id;

  if v_count = 0 then return 0; end if;

  select value #>> '{}' into v_base from public.platform_settings where key = 'functions_base_url';
  if v_base is null or v_base = '' then
    -- Nothing was even attempted; say so rather than leaving it 'dispatched'.
    update public.push_campaigns
       set delivery_status = 'not_attempted',
           delivery_detail = 'platform_settings.functions_base_url is unset — no push was attempted.',
           settled_at = now()
     where id = v_campaign_id;
    return v_count;
  end if;

  begin
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_internal_secret';
  exception when others then v_secret := null;
  end;
  v_headers := '{"Content-Type": "application/json"}'::jsonb;
  if v_secret is not null and v_secret <> '' then
    v_headers := v_headers || jsonb_build_object('x-internal-secret', v_secret);
  end if;

  -- No orderId: a campaign is not about an order. `route` sends a tap to the
  -- home screen instead of the nowhere it went before.
  select net.http_post(
    url     := v_base || '/expo-push',
    body    := jsonb_build_object(
                 'event', 'campaign',
                 'route', '/',
                 'title', btrim(p_title), 'body', btrim(p_body),
                 'recipientUserIds', v_ids
               ),
    headers := v_headers
  ) into v_req_id;

  update public.push_campaigns set net_request_id = v_req_id where id = v_campaign_id;

  return v_count;
end;
$function$;

revoke all on function public.send_push_campaign(text, text, text, text) from public, anon;
grant execute on function public.send_push_campaign(text, text, text, text) to authenticated;

comment on function public.send_push_campaign(text, text, text, text) is
  'Admin-only marketing push to a customer segment. Returns the number of RESOLVED recipients (not a delivery count — read push_campaigns.delivery_status, settled by reconcile_push_campaigns()). Sends no orderId (a campaign is not about an order) and routes taps to /. Migs 078, 137.';

-- ---------------------------------------------------------------------------
-- 3. reconcile_push_campaigns -- settle dispatched campaigns from pg_net
-- ---------------------------------------------------------------------------
create or replace function public.reconcile_push_campaigns()
returns integer
language plpgsql
security definer set search_path to 'public','pg_temp'
as $function$
declare v_settled int := 0;
begin
  with settled as (
    update public.push_campaigns c
       set delivery_status = case when r.status_code between 200 and 299 then 'delivered' else 'failed' end,
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
         delivery_detail = 'No pg_net response found before it was pruned — delivery unconfirmed.',
         settled_at = now()
   where delivery_status = 'dispatched'
     and created_at < now() - interval '12 hours';

  -- Anything that failed is an operator-visible problem: a campaign the admin
  -- believes went out did not.
  begin
    perform public.ops_alert('push campaign FAILED to deliver: ' || left(coalesce(delivery_detail,''), 200))
      from public.push_campaigns
     where delivery_status = 'failed' and settled_at >= now() - interval '10 minutes';
  exception when others then null;
  end;

  return v_settled;
end;
$function$;

revoke all on function public.reconcile_push_campaigns() from public, anon, authenticated;

comment on function public.reconcile_push_campaigns() is
  'Settles push_campaigns.delivery_status from net._http_response: 2xx -> delivered, anything else -> failed (with status + body). Campaigns older than 12h whose pg_net response was pruned are marked failed rather than left "dispatched", because an unconfirmable send must not read as success. Runs every 5 minutes; alerts ops on failures. Mig 137.';

select cron.unschedule('sharmeats-push-campaign-reconcile')
 where exists (select 1 from cron.job where jobname = 'sharmeats-push-campaign-reconcile');

select cron.schedule(
  'sharmeats-push-campaign-reconcile',
  '*/5 * * * *',
  $cron$select public.reconcile_push_campaigns();$cron$
);

-- ---------------------------------------------------------------------------
-- 4. issue_credit -- prod body, minus the user-id-as-order-id smuggling
-- ---------------------------------------------------------------------------
-- Body from prod (mig 101 lineage) verbatim, except the push payload.
create or replace function public.issue_credit(
  p_user_id uuid, p_amount_egp integer, p_reason text,
  p_order_id uuid default null::uuid, p_note text default null::text
)
returns void
language plpgsql
security definer set search_path to 'public','pg_temp'
as $function$
declare v_actor uuid := auth.uid(); v_base text;
begin
  if p_amount_egp is null or p_amount_egp <= 0 then raise exception 'INVALID_AMOUNT' using errcode='check_violation'; end if;
  if p_reason not in ('refund','goodwill','sla_late','redeem','adjustment') then raise exception 'INVALID_REASON' using errcode='check_violation'; end if;
  if p_reason <> 'sla_late' and coalesce(public.auth_role()::text,'') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode='check_violation';
  end if;
  if p_reason = 'sla_late' and p_order_id is null then
    raise exception 'SLA_CREDIT_REQUIRES_ORDER' using errcode='check_violation';
  end if;
  insert into public.credit_ledger (user_id, delta_egp, reason, ref_order_id, note, actor_id)
  values (p_user_id, p_amount_egp, p_reason, p_order_id, p_note, v_actor);
  insert into public.customer_credit_balance (user_id, balance_egp) values (p_user_id, p_amount_egp)
  on conflict (user_id) do update set balance_egp = public.customer_credit_balance.balance_egp + p_amount_egp, updated_at = now();
  if p_reason <> 'redeem' then
    begin
      select value #>> '{}' into v_base from public.platform_settings where key='functions_base_url';
      if v_base is not null and v_base <> '' then
        -- orderId is now ONLY a real order id (null when the credit has none --
        -- previously this sent p_user_id, so the tap opened /order/<userId>).
        -- The wallet lives on /rewards, which is what the copy promises.
        perform net.http_post(
          url := v_base || '/expo-push',
          body := jsonb_build_object(
                    'event','credit_issued',
                    'orderId', coalesce(p_order_id::text, ''),
                    'route','/rewards',
                    'recipientUserIds', jsonb_build_array(p_user_id::text)),
          headers := public.push_headers());
      end if;
    exception when others then null;
    end;
  end if;
end;
$function$;

revoke all on function public.issue_credit(uuid, integer, text, uuid, text) from public, anon, authenticated;

comment on function public.issue_credit(uuid, integer, text, uuid, text) is
  'Credits a customer wallet and notifies them. Client EXECUTE stays revoked (mig 101: an authenticated caller could mint sla_late credit); admins go through admin_issue_credit (mig 130), and the SLA engine calls it as definer. Push routes to /rewards and sends an orderId only when there is a real order. Migs 062, 101, 137.';

-- ---------------------------------------------------------------------------
-- 5. reward_referrer_on_delivery -- prod body, minus the foreign order id
-- ---------------------------------------------------------------------------
create or replace function public.reward_referrer_on_delivery()
returns trigger
language plpgsql
security definer set search_path to 'public','pg_temp'
as $function$
declare
  v_ref public.referrals; v_reward int; v_code text;
begin
  if new.status <> 'delivered' or old.status = 'delivered' then return new; end if;
  select * into v_ref from public.referrals where order_id = new.id and reward_status = 'pending' for update;
  if not found then return new; end if;
  select coalesce((value #>> '{}')::int, 50) into v_reward from public.platform_settings where key = 'referral_referrer_reward_egp';
  v_code := 'REF-' || upper(encode(extensions.gen_random_bytes(16), 'hex'));
  -- [058] bind the reward code to the referrer.
  insert into public.promo_codes (code, kind, value, per_user_limit, is_active, owner_user_id)
  values (upper(v_code), 'fixed', greatest(1, coalesce(v_reward,50)), 1, true, v_ref.referrer_id);
  update public.referrals set reward_status = 'rewarded', reward_code = upper(v_code), rewarded_at = now() where id = v_ref.id;
  declare v_base text;
  begin
    select value #>> '{}' into v_base from public.platform_settings where key = 'functions_base_url';
    if v_base is not null and v_base <> '' then
      -- [137] No orderId: new.id is the REFERRED FRIEND'S order, which the
      -- referrer cannot open (RLS) -- tapping the reward push used to land on a
      -- blank order screen. The reward code lives on /rewards.
      perform net.http_post(
        url := v_base || '/expo-push',
        body := jsonb_build_object(
                  'event','referral_rewarded',
                  'route','/rewards',
                  'recipientUserIds', jsonb_build_array(v_ref.referrer_id::text)),
        headers := public.push_headers());  -- [081] was hardcoded; restore secret
    end if;
  exception when others then null;
  end;
  return new;
exception when others then return new;
end;
$function$;

revoke all on function public.reward_referrer_on_delivery() from public, anon, authenticated;

comment on function public.reward_referrer_on_delivery() is
  'On the delivered transition: mints the referrer''s reward promo code and notifies them. The push carries no orderId (the order belongs to the referred friend, not the recipient) and routes to /rewards. Migs 038, 058, 081, 122, 137.';
