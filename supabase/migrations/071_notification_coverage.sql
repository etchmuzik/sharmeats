-- 071_notification_coverage.sql
-- Close the notification gaps from the 2026-07-03 A-to-X coverage audit.
-- The happy path (accepted->…->delivered, new order, new offer, chat) was
-- covered; the UNHAPPY paths and the new money/support features were not.
--
-- This migration wires the HIGH-severity gaps:
--   1. order_rejected  -> customer (restaurant declined; was total silence)
--   2. order_cancelled -> customer (ops/customer cancelled)
--   3. order cancelled/rejected -> the RESTAURANT too (stop cooking a dead order)
--   4. credit_issued   -> customer, from issue_credit (SLA late-credit AND
--      refund/goodwill) — a silently-granted wallet balance is now announced.
-- (payment_failed push lives in the paymob-webhook edge function; support-reply
--  and support-message pushes shipped in mig 070.)
--
-- expo-push COPY companion keys: order_rejected, order_cancelled,
-- order_cancelled_merchant, credit_issued (added to the edge function).
-- Non-destructive: CREATE OR REPLACE two functions. Fail-open throughout.

-- ============================================================================
-- notify_order_status_event — now covers rejected + cancelled for BOTH the
-- customer and the restaurant, keeping every existing branch byte-for-byte.
-- ============================================================================
create or replace function public.notify_order_status_event()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_event      text;
  v_base       text;
  v_secret     text;
  v_headers    jsonb;
  v_recipients jsonb;
  v_rest       uuid;
begin
  select value #>> '{}' into v_base
    from public.platform_settings where key = 'functions_base_url';
  if v_base is null or v_base = '' then return new; end if;

  -- [035] internal secret from Vault; fail open (no header) if absent.
  begin
    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'push_internal_secret';
  exception when others then
    v_secret := null;
  end;
  v_headers := '{"Content-Type": "application/json"}'::jsonb;
  if v_secret is not null and v_secret <> '' then
    v_headers := v_headers || jsonb_build_object('x-internal-secret', v_secret);
  end if;

  -- ── New-order push to the RESTAURANT's staff (unchanged from 040). ─────────
  if new.status = 'placed' then
    select restaurant_id into v_rest from public.orders where id = new.order_id;
    if v_rest is null then return new; end if;
    select coalesce(jsonb_agg(distinct ms.profile_id::text), '[]'::jsonb)
      into v_recipients
      from public.merchant_staff ms
     where ms.restaurant_id = v_rest;
    if v_recipients is null or v_recipients = '[]'::jsonb then return new; end if;
    perform net.http_post(
      url     := v_base || '/expo-push',
      body    := jsonb_build_object('event', 'order_placed_merchant',
                   'orderId', new.order_id::text, 'recipientUserIds', v_recipients),
      headers := v_headers
    );
    return new;
  end if;

  -- ── Cancelled / rejected: notify the customer AND the restaurant. ─────────
  if new.status in ('cancelled', 'rejected') then
    -- Customer.
    perform net.http_post(
      url     := v_base || '/expo-push',
      body    := jsonb_build_object(
                   'event', case when new.status = 'rejected' then 'order_rejected' else 'order_cancelled' end,
                   'orderId', new.order_id::text),
      headers := v_headers
    );
    -- Restaurant staff (stop cooking a dead order).
    select restaurant_id into v_rest from public.orders where id = new.order_id;
    if v_rest is not null then
      select coalesce(jsonb_agg(distinct ms.profile_id::text), '[]'::jsonb)
        into v_recipients
        from public.merchant_staff ms
       where ms.restaurant_id = v_rest;
      if v_recipients is not null and v_recipients <> '[]'::jsonb then
        perform net.http_post(
          url     := v_base || '/expo-push',
          body    := jsonb_build_object('event', 'order_cancelled_merchant',
                       'orderId', new.order_id::text, 'recipientUserIds', v_recipients),
          headers := v_headers
        );
      end if;
    end if;
    return new;
  end if;

  -- ── Customer-facing forward status pushes (unchanged from 040). ───────────
  v_event := case new.status
    when 'accepted'         then 'order_accepted'
    when 'ready'            then 'order_ready'
    when 'picked_up'        then 'order_picked_up'
    when 'out_for_delivery' then 'order_out_for_delivery'
    when 'delivered'        then 'order_delivered'
    else null
  end;
  if v_event is null then return new; end if;

  perform net.http_post(
    url     := v_base || '/expo-push',
    body    := jsonb_build_object('event', v_event, 'orderId', new.order_id::text),
    headers := v_headers
  );
  return new;
exception when others then
  return new;  -- best-effort; never block the order flow
end;
$$;

comment on function public.notify_order_status_event is
  'AFTER INSERT on order_status_events: fans status changes to the right surface via pg_net -> expo-push. placed -> restaurant; cancelled/rejected -> BOTH customer and restaurant (mig 071); forward statuses -> customer. Best-effort; never blocks.';

-- ============================================================================
-- issue_credit — now pushes a credit_issued notification to the customer so a
-- granted wallet balance (SLA late-credit, refund, goodwill) is never silent.
-- Body identical to mig 062 + the push at the end. Fail-open.
-- ============================================================================
create or replace function public.issue_credit(
  p_user_id uuid, p_amount_egp int, p_reason text,
  p_order_id uuid default null, p_note text default null
)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_base   text;
  v_secret text;
  v_headers jsonb;
begin
  if p_amount_egp is null or p_amount_egp <= 0 then
    raise exception 'INVALID_AMOUNT' using errcode = 'check_violation';
  end if;
  if p_reason not in ('refund','goodwill','sla_late','redeem','adjustment') then
    raise exception 'INVALID_REASON' using errcode = 'check_violation';
  end if;
  if p_reason <> 'sla_late' and public.auth_role() <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;

  insert into public.credit_ledger (user_id, delta_egp, reason, ref_order_id, note, actor_id)
  values (p_user_id, p_amount_egp, p_reason, p_order_id, p_note, v_actor);

  insert into public.customer_credit_balance (user_id, balance_egp)
  values (p_user_id, p_amount_egp)
  on conflict (user_id) do update
    set balance_egp = public.customer_credit_balance.balance_egp + p_amount_egp,
        updated_at = now();

  -- [071] Tell the customer a credit landed (SLA late-credit / refund / goodwill).
  -- redeem is a debit-side accounting reason, not a grant — never notify on it.
  if p_reason <> 'redeem' then
    begin
      select value #>> '{}' into v_base from public.platform_settings where key = 'functions_base_url';
      if v_base is not null and v_base <> '' then
        begin
          select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_internal_secret';
        exception when others then v_secret := null;
        end;
        v_headers := '{"Content-Type": "application/json"}'::jsonb;
        if v_secret is not null and v_secret <> '' then
          v_headers := v_headers || jsonb_build_object('x-internal-secret', v_secret);
        end if;
        perform net.http_post(
          url     := v_base || '/expo-push',
          body    := jsonb_build_object(
                       'event', 'credit_issued',
                       'orderId', coalesce(p_order_id::text, p_user_id::text),
                       'recipientUserIds', jsonb_build_array(p_user_id::text)),
          headers := v_headers
        );
      end if;
    exception when others then
      null;  -- notification is best-effort; never fail the credit grant
    end;
  end if;
end;
$$;
revoke all on function public.issue_credit(uuid, int, text, uuid, text) from public, anon;
grant execute on function public.issue_credit(uuid, int, text, uuid, text) to authenticated;

comment on function public.issue_credit is
  'Grants customer credit (admin-only except the internal sla_late path). Writes credit_ledger + bumps customer_credit_balance, then pushes a credit_issued notification to the customer (mig 071) for all grant reasons (not redeem). Best-effort push; never fails the grant.';
