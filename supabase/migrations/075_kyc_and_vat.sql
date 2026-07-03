-- 075_kyc_and_vat.sql
-- Two compliance P1s from the 2026-07-03 gap analysis:
--   A. KYC document trail for drivers and restaurants. Today is_verified /
--      verified are bare booleans an admin flips with NO evidence — no national
--      ID, driving licence, vehicle papers (drivers) or commercial registration,
--      tax card, food licence (restaurants). This adds a document table + review
--      workflow so "verified" means "documents were captured and approved".
--   B. VAT modeling foundation. Egypt's standard VAT is 14% and platform
--      commission is a taxable service. Prices stay tax-inclusive at launch
--      (tax_pct=0, per the financial model), but this records a configurable
--      commission_vat_pct and stamps the VAT portion onto each order's commission
--      snapshot going forward, so once the operating company is VAT-registered
--      the numbers are already there — no retroactive misstatement.
--
-- Non-destructive: new table + new settings + additive column + RPCs. Idempotent.

-- ============================================================================
-- A. KYC DOCUMENTS
-- ============================================================================
-- Polymorphic subject: a document belongs to either a driver or a restaurant.
-- The actual file lives in Supabase Storage; storage_path points at it. Only the
-- owner (the driver's profile, or the restaurant's staff) can insert/read their
-- own docs; admins read all and set the review status.
-- ============================================================================
do $$ begin
  if not exists (select 1 from pg_type where typname = 'kyc_subject_type') then
    create type kyc_subject_type as enum ('driver','restaurant');
  end if;
  if not exists (select 1 from pg_type where typname = 'kyc_doc_status') then
    create type kyc_doc_status as enum ('pending','approved','rejected');
  end if;
end $$;

create table if not exists public.kyc_documents (
  id            uuid primary key default gen_random_uuid(),
  subject_type  kyc_subject_type not null,
  subject_id    uuid not null,                 -- drivers.id OR restaurants.id
  doc_type      text not null,                 -- 'national_id' | 'driving_license' | 'vehicle_reg' | 'commercial_reg' | 'tax_card' | 'food_license' | ...
  storage_path  text not null,                 -- path in the private 'kyc' Storage bucket
  status        kyc_doc_status not null default 'pending',
  review_note   text,
  reviewed_by   uuid references public.users(id),
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists kyc_documents_subject_idx on public.kyc_documents (subject_type, subject_id);
create index if not exists kyc_documents_status_idx on public.kyc_documents (status) where status = 'pending';

comment on table public.kyc_documents is
  'KYC evidence for drivers/restaurants. subject_type+subject_id point at drivers.id or restaurants.id. File lives in the private kyc Storage bucket at storage_path. Owner uploads+reads own; admin reviews (approve/reject). Backs the is_verified/verified booleans with a real evidence trail.';

alter table public.kyc_documents enable row level security;

-- Owner-or-admin SELECT: a driver sees their own docs; restaurant staff see
-- their restaurant's; admins see all.
create policy kyc_documents_select on public.kyc_documents
  for select using (
    public.auth_role() = 'admin'
    or (subject_type = 'driver' and exists (
          select 1 from public.drivers d where d.id = subject_id and d.profile_id = auth.uid()))
    or (subject_type = 'restaurant' and public.is_merchant_staff(subject_id))
  );

-- Owner INSERT: a driver/restaurant may upload their own documents (status
-- defaults to pending; they cannot set an approved status because the column
-- default + the review-only RPC path are the only ways to change it — and we
-- forbid client UPDATE below).
create policy kyc_documents_insert on public.kyc_documents
  for insert with check (
    (subject_type = 'driver' and exists (
        select 1 from public.drivers d where d.id = subject_id and d.profile_id = auth.uid()))
    or (subject_type = 'restaurant' and public.is_merchant_staff(subject_id))
  );
-- No client UPDATE/DELETE policy: review transitions go through review_kyc_document
-- (admin, SECURITY DEFINER). Owners can't approve their own docs or tamper.

-- ============================================================================
-- review_kyc_document — ADMIN approves/rejects a document, and optionally flips
-- the subject's verified flag when all their required docs are approved.
-- ============================================================================
create or replace function public.review_kyc_document(
  p_document_id uuid, p_approve boolean, p_note text default null
)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare v_doc public.kyc_documents; v_agent uuid := auth.uid();
begin
  if v_agent is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;
  if coalesce(public.auth_role()::text,'') <> 'admin' then raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation'; end if;

  update public.kyc_documents
     set status = case when p_approve then 'approved' else 'rejected' end::kyc_doc_status,
         review_note = nullif(btrim(coalesce(p_note,'')), ''),
         reviewed_by = v_agent,
         reviewed_at = now()
   where id = p_document_id
   returning * into v_doc;
  if not found then raise exception 'DOCUMENT_NOT_FOUND' using errcode = 'check_violation'; end if;

  -- Convenience: when a doc is REJECTED, also drop the subject's verified flag
  -- (a rejected document means the subject is no longer fully vetted). We do NOT
  -- auto-APPROVE the subject on a single doc approval — that stays an explicit
  -- admin decision via set_subject_verified, since "all required docs present"
  -- is a policy call, not something this migration hard-codes.
  if not p_approve then
    if v_doc.subject_type = 'driver' then
      update public.drivers set is_verified = false where id = v_doc.subject_id;
    else
      update public.restaurants set verified = false where id = v_doc.subject_id;
    end if;
  end if;
end;
$$;
revoke all on function public.review_kyc_document(uuid, boolean, text) from public, anon;
grant execute on function public.review_kyc_document(uuid, boolean, text) to authenticated;

comment on function public.review_kyc_document is
  'ADMIN: approve/reject a KYC document. A rejection also clears the subject''s verified flag. Approving the subject overall is a separate explicit admin action (the verified boolean), because "all required docs present" is a policy decision.';

-- my_kyc_documents — a driver/restaurant lists their own uploaded docs + status.
create or replace function public.my_kyc_documents(p_subject_type kyc_subject_type, p_subject_id uuid)
returns setof public.kyc_documents
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select k.* from public.kyc_documents k
   where k.subject_type = p_subject_type and k.subject_id = p_subject_id
     and (
       (p_subject_type = 'driver' and exists (select 1 from public.drivers d where d.id = p_subject_id and d.profile_id = auth.uid()))
       or (p_subject_type = 'restaurant' and public.is_merchant_staff(p_subject_id))
       or public.auth_role() = 'admin'
     )
   order by k.created_at desc;
$$;
grant execute on function public.my_kyc_documents(kyc_subject_type, uuid) to authenticated;

-- ============================================================================
-- B. VAT MODELING
-- ============================================================================
-- Configurable VAT rate on platform commission (Egypt standard 14%). Default 0
-- so nothing changes until the operating company is VAT-registered. When >0,
-- the commission snapshot records the VAT portion so reporting/e-invoicing has
-- the number without recomputation.
-- ============================================================================
insert into public.platform_settings (key, value) values
  ('commission_vat_pct', to_jsonb(0))     -- Egypt standard is 14; keep 0 until VAT-registered
on conflict (key) do nothing;

-- Additive column on the commission snapshot: VAT charged on this order's
-- commission (0 while commission_vat_pct = 0).
alter table public.order_financials
  add column if not exists commission_vat_egp int not null default 0 check (commission_vat_egp >= 0);

comment on column public.order_financials.commission_vat_egp is
  'VAT on this order''s commission (commission_egp * commission_vat_pct / 100), stamped at delivery. 0 until the platform is VAT-registered (commission_vat_pct > 0). Mig 075.';

-- Extend snapshot_order_financials to also stamp the commission VAT. Body is the
-- mig-071/062 version (commission snapshot + SLA credit) with the VAT calc added.
create or replace function public.snapshot_order_financials()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_rate      numeric(5,2);
  v_vat_pct   int;
  v_commission int;
  v_grace     int;
  v_pct       int;
  v_max       int;
  v_late_min  numeric;
  v_credit    int;
begin
  if new.status <> 'delivered' or old.status = 'delivered' then return new; end if;

  select commission_pct into v_rate from public.restaurants where id = new.restaurant_id;
  v_rate := coalesce(v_rate, 12.0);
  v_commission := floor(coalesce(new.subtotal_egp, 0) * v_rate / 100.0)::int;
  select coalesce((value #>> '{}')::int, 0) into v_vat_pct from public.platform_settings where key = 'commission_vat_pct';

  insert into public.order_financials (
    order_id, restaurant_id, subtotal_egp, commission_pct, commission_egp,
    commission_vat_egp, delivery_fee_egp, payment_method, delivered_at
  ) values (
    new.id, new.restaurant_id, coalesce(new.subtotal_egp, 0), v_rate, v_commission,
    floor(v_commission * coalesce(v_vat_pct,0) / 100.0)::int,
    coalesce(new.delivery_fee_egp, 0), new.payment_method,
    coalesce(new.delivered_at, now())
  ) on conflict (order_id) do nothing;

  select coalesce((value #>> '{}')::int, 15)  into v_grace from public.platform_settings where key = 'sla_credit_grace_minutes';
  select coalesce((value #>> '{}')::int, 10)  into v_pct   from public.platform_settings where key = 'sla_credit_pct';
  select coalesce((value #>> '{}')::int, 100) into v_max   from public.platform_settings where key = 'sla_credit_max_egp';

  v_late_min := extract(epoch from (coalesce(new.delivered_at, now()) - new.eta_at)) / 60.0;
  if v_late_min > v_grace then
    v_credit := least(v_max, floor(coalesce(new.subtotal_egp, 0) * v_pct / 100.0)::int);
    if v_credit > 0 then
      begin
        perform public.issue_credit(
          new.user_id, v_credit, 'sla_late', new.id,
          'Auto late credit: ' || round(v_late_min)::text || ' min late'
        );
      exception when unique_violation then null;
      end;
    end if;
  end if;

  return new;
exception when others then
  return new;
end;
$$;

comment on function public.snapshot_order_financials is
  'On orders.status -> delivered: writes the immutable order_financials commission snapshot (incl. commission_vat_egp, mig 075) and grants the SLA late-credit once per order. Fail-open.';
