-- 093_n7_notification_coverage_gaps.sql
-- N7 (2026-07-05 audit): close the notification-coverage holes found in the
-- event × recipient matrix:
--   1. order cancelled while a driver is assigned -> push THAT DRIVER
--      (previously: customer + merchant were told, driver kept riding).
--   2. restaurant settlement finalized / paid -> push the restaurant's staff.
--   3. KYC document approved / rejected -> push the document owner
--      (driver or restaurant staff); newly submitted -> push admins.
--
-- Design: ADDITIVE ONLY. New trigger functions + new triggers; no existing
-- function body is replaced (a CREATE OR REPLACE of an old body has previously
-- reverted later hardening in this project — see mig 081's fix log).
-- Pattern is the house standard from mig 073: functions_base_url +
-- push_headers() (Vault secret), async pg_net POST, SECURITY DEFINER with
-- pinned search_path, EXECUTE revoked from clients, and a catch-all EXCEPTION
-- block so a push failure can never abort the enclosing transaction.
--
-- expo-push contract note: the edge function REQUIRES an `orderId` field and
-- uses it only for tap-routing metadata + as a customer fallback when
-- recipientUserIds is absent. All senders here always pass explicit
-- recipientUserIds; for settlement/KYC events the entity id rides in the
-- orderId slot (documented in the edge function's N4 localization PR, which
-- also adds the 6 copy keys: order_cancelled_driver, settlement_finalized,
-- settlement_paid, kyc_approved, kyc_rejected, kyc_submitted — until that
-- deploys, expo-push falls back to its generic title/body, which is safe).
--
-- Idempotent: create or replace of NEW names + drop trigger if exists.
-- Rollback: drop trigger + drop function for each of the three below.

-- 1 ─ driver push when an assigned order is cancelled --------------------------------
create or replace function public.notify_order_cancelled_driver()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_base    text;
  v_driver  uuid;
  v_drv_uid uuid;
begin
  if new.status <> 'cancelled' or old.status = 'cancelled' then return new; end if;
  -- the cancel path may or may not have detached the driver already
  v_driver := coalesce(new.assigned_driver_id, old.assigned_driver_id);
  if v_driver is null then return new; end if;

  select value #>> '{}' into v_base from public.platform_settings where key = 'functions_base_url';
  if v_base is null or v_base = '' then return new; end if;

  select d.profile_id into v_drv_uid from public.drivers d where d.id = v_driver;
  if v_drv_uid is null then return new; end if;

  perform net.http_post(
    url     := v_base || '/expo-push',
    body    := jsonb_build_object(
                 'event', 'order_cancelled_driver',
                 'orderId', new.id::text,
                 'recipientUserIds', jsonb_build_array(v_drv_uid::text)),
    headers := public.push_headers()
  );
  return new;
exception when others then
  return new;  -- best-effort; never block the cancel
end;
$$;
revoke all on function public.notify_order_cancelled_driver() from public, anon, authenticated;

drop trigger if exists orders_notify_cancelled_driver on public.orders;
create trigger orders_notify_cancelled_driver
  after update of status on public.orders
  for each row execute function public.notify_order_cancelled_driver();

comment on function public.notify_order_cancelled_driver is
  'AFTER UPDATE OF status on orders: order cancelled with a driver attached -> push that driver so they stop the trip. Best-effort.';

-- 2 ─ merchant push on settlement finalized / paid -----------------------------------
create or replace function public.notify_settlement_change()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_base  text;
  v_staff jsonb;
  v_event text;
begin
  if new.status = 'finalized' and old.status is distinct from 'finalized' then
    v_event := 'settlement_finalized';
  elsif new.status = 'paid' and old.status is distinct from 'paid' then
    v_event := 'settlement_paid';
  else
    return new;
  end if;

  select value #>> '{}' into v_base from public.platform_settings where key = 'functions_base_url';
  if v_base is null or v_base = '' then return new; end if;

  select coalesce(jsonb_agg(distinct ms.profile_id::text), '[]'::jsonb) into v_staff
    from public.merchant_staff ms where ms.restaurant_id = new.restaurant_id;
  if v_staff is null or v_staff = '[]'::jsonb then return new; end if;

  perform net.http_post(
    url     := v_base || '/expo-push',
    body    := jsonb_build_object(
                 'event', v_event,
                 'orderId', new.id::text,          -- settlement id; expo-push requires the field
                 'recipientUserIds', v_staff),
    headers := public.push_headers()
  );
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function public.notify_settlement_change() from public, anon, authenticated;

drop trigger if exists restaurant_settlements_notify_change on public.restaurant_settlements;
create trigger restaurant_settlements_notify_change
  after update of status on public.restaurant_settlements
  for each row execute function public.notify_settlement_change();

comment on function public.notify_settlement_change is
  'AFTER UPDATE OF status on restaurant_settlements: finalized/paid -> push the restaurant''s staff. Best-effort.';

-- 3 ─ KYC review + submission pushes ---------------------------------------------------
create or replace function public.notify_kyc_review()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_base       text;
  v_recipients jsonb;
  v_event      text;
begin
  if new.status = old.status then return new; end if;
  if new.status = 'approved' then v_event := 'kyc_approved';
  elsif new.status = 'rejected' then v_event := 'kyc_rejected';
  else return new;
  end if;

  select value #>> '{}' into v_base from public.platform_settings where key = 'functions_base_url';
  if v_base is null or v_base = '' then return new; end if;

  if new.subject_type = 'driver' then
    select coalesce(jsonb_agg(d.profile_id::text), '[]'::jsonb) into v_recipients
      from public.drivers d where d.id = new.subject_id and d.profile_id is not null;
  else
    select coalesce(jsonb_agg(distinct ms.profile_id::text), '[]'::jsonb) into v_recipients
      from public.merchant_staff ms where ms.restaurant_id = new.subject_id;
  end if;
  if v_recipients is null or v_recipients = '[]'::jsonb then return new; end if;

  perform net.http_post(
    url     := v_base || '/expo-push',
    body    := jsonb_build_object(
                 'event', v_event,
                 'orderId', new.id::text,          -- kyc document id; expo-push requires the field
                 'recipientUserIds', v_recipients),
    headers := public.push_headers()
  );
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function public.notify_kyc_review() from public, anon, authenticated;

drop trigger if exists kyc_documents_notify_review on public.kyc_documents;
create trigger kyc_documents_notify_review
  after update of status on public.kyc_documents
  for each row execute function public.notify_kyc_review();

create or replace function public.notify_kyc_submitted()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_base   text;
  v_admins jsonb;
begin
  if new.status <> 'pending' then return new; end if;

  select value #>> '{}' into v_base from public.platform_settings where key = 'functions_base_url';
  if v_base is null or v_base = '' then return new; end if;

  select coalesce(jsonb_agg(u.id::text), '[]'::jsonb) into v_admins
    from public.users u where u.role = 'admin';
  if v_admins is null or v_admins = '[]'::jsonb then return new; end if;

  perform net.http_post(
    url     := v_base || '/expo-push',
    body    := jsonb_build_object(
                 'event', 'kyc_submitted',
                 'orderId', new.id::text,          -- kyc document id; expo-push requires the field
                 'recipientUserIds', v_admins),
    headers := public.push_headers()
  );
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function public.notify_kyc_submitted() from public, anon, authenticated;

drop trigger if exists kyc_documents_notify_submitted on public.kyc_documents;
create trigger kyc_documents_notify_submitted
  after insert on public.kyc_documents
  for each row execute function public.notify_kyc_submitted();

comment on function public.notify_kyc_review is
  'AFTER UPDATE OF status on kyc_documents: approved/rejected -> push the document owner (driver or restaurant staff). Best-effort.';
comment on function public.notify_kyc_submitted is
  'AFTER INSERT on kyc_documents: pending doc -> push all admins to review. Best-effort.';
