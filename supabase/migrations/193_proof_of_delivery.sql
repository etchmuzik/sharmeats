-- 193_proof_of_delivery.sql
--
-- Proof of delivery: a driver-captured photo at handoff, stored as private
-- evidence and readable only by ops.
--
-- WHY: nothing recorded what happened at the door. With cash-on-delivery in the
-- mix, a "never arrived" claim was unfalsifiable in both directions — the
-- customer could not prove absence and the driver could not prove delivery. The
-- driver app had no camera path at all (expo-image-picker appeared only in KYC).
--
-- ENFORCEMENT MODEL — deliberately NOT a database gate. `advance_order_status`
-- is untouched and never rejects a delivery for missing proof. The driver app
-- requires a photo before enabling Delivered for the dropoff preferences where
-- nobody is present to receive (leave_at_door, no_bell), but the status
-- transition does not depend on the bytes landing. A hard DB gate plus patchy
-- mobile data would strand a driver on an order they had physically completed,
-- and the dispatcher-override recovery is worse than the fraud it prevents.
-- `ops_deliveries_missing_proof` below is how that gap is policed instead.
--
-- Shape mirrors the hardened KYC evidence path (mig 076 +
-- 20260724120946_kyc_upload_hardening): private bucket with a size/mime ceiling,
-- path-scoped storage RLS, immutable objects, and the table row as the index.

-- ============================================================================
-- WHAT COUNTS AS "PROOF REQUIRED"
-- One definition, shared by the ops report below and mirrored in the driver app
-- (apps/driver/src/proofOfDelivery.ts). These are the preferences where the
-- customer is NOT at the door, so nothing else evidences the handoff.
-- ============================================================================
create or replace function public.delivery_proof_required(p_dropoff_preference text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(p_dropoff_preference, '') in ('leave_at_door', 'no_bell');
$$;

revoke all on function public.delivery_proof_required(text) from public, anon;
grant execute on function public.delivery_proof_required(text) to authenticated;

comment on function public.delivery_proof_required(text) is
  'True when a dropoff preference leaves nobody at the door, so a photo is the only handoff evidence. Mirrored in apps/driver/src/proofOfDelivery.ts.';

-- ============================================================================
-- EVIDENCE INDEX
-- Multiple rows per order are allowed on purpose: a driver may capture a second
-- angle, and a retry after a failed metadata insert produces a new object
-- rather than overwriting reviewed bytes.
-- ============================================================================
create table if not exists public.delivery_proofs (
  id                 uuid primary key default gen_random_uuid(),
  -- `restrict`, matching driver_earnings (008_fleet): evidence must never be
  -- silently orphaned from the order or driver it attributes to.
  order_id           uuid not null references public.orders(id) on delete restrict,
  driver_id          uuid not null references public.drivers(id) on delete restrict,
  -- Unique so one object indexes exactly once; also the fast path for the
  -- storage delete policy's "is this indexed yet" check.
  storage_path       text not null unique,
  -- Snapshot of the order's preference AT capture time, written server-side so a
  -- client cannot claim proof was optional after the fact. Ops needs to know
  -- which rule applied, and the order row can change later.
  dropoff_preference text,
  captured_at        timestamptz not null default now(),
  created_at         timestamptz not null default now()
);

create index if not exists delivery_proofs_order_idx
  on public.delivery_proofs (order_id, captured_at desc);
create index if not exists delivery_proofs_driver_idx
  on public.delivery_proofs (driver_id, captured_at desc);

-- House rule 5b: ALTER DEFAULT PRIVILEGES on this database grants arwdDxtm to
-- anon/authenticated on every new table, so simply not granting is not enough —
-- and TRUNCATE ignores RLS, so "RLS on with no policies" would not protect it.
revoke all on table public.delivery_proofs from public, anon, authenticated;

alter table public.delivery_proofs enable row level security;

-- Read: ops only. Per the visibility decision, neither the customer nor the
-- capturing driver reads this table; upload success is signalled by the RPC's
-- return, so a driver never needs to read back. No INSERT policy either —
-- writes go exclusively through record_delivery_proof below, which is what
-- enforces assignment. No UPDATE or DELETE policy at all: evidence is immutable.
grant select on table public.delivery_proofs to authenticated;

drop policy if exists delivery_proofs_ops_select on public.delivery_proofs;
create policy delivery_proofs_ops_select
  on public.delivery_proofs for select to authenticated
  using (public.auth_role() in ('admin', 'dispatcher'));

comment on table public.delivery_proofs is
  'Handoff photos. Written only by record_delivery_proof; readable only by admin/dispatcher; never updatable or deletable.';

-- ============================================================================
-- PRIVATE BUCKET
-- Ceilings live on the bucket as well as in the policy: a 5 MiB image cap and a
-- mime allowlist stop a large or non-image upload before any policy runs.
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'delivery-proof',
  'delivery-proof',
  false,
  5 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Upload: only under the caller's own uid prefix, and only a name shaped
-- <uid>/<order-uuid>-<epoch-ms>.<ext>. Constraining the name in the policy means
-- a compromised client cannot scatter arbitrary objects through the bucket.
-- `(select auth.uid())` is the subselect form used elsewhere (mig 089) so the
-- planner evaluates it once per statement rather than per row.
drop policy if exists "delivery_proof_upload_own" on storage.objects;
create policy "delivery_proof_upload_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'delivery-proof'
    and name ~ (
      '^' || (select auth.uid())::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9]+\.(jpg|jpeg|png|webp)$'
    )
  );

-- Read: ops for review, plus the uploader for their OWN prefix only.
--
-- The own-prefix clause is not a widening of the visibility decision, it is what
-- makes the cleanup delete below reachable at all: PostgreSQL applies SELECT
-- policies to an UPDATE/DELETE that carries a WHERE clause, so without it the
-- storage API's delete matches zero rows and orphans accumulate forever. It
-- grants a driver nothing they do not already hold — they took the photo on
-- their own phone seconds earlier — and it cannot be used to browse, because the
-- prefix is their own auth uid.
--
-- Cross-order REVIEW remains ops-only, and the delivery_proofs index table
-- itself is readable by admin/dispatcher alone.
drop policy if exists "delivery_proof_read_ops" on storage.objects;
drop policy if exists "delivery_proof_read_own_or_ops" on storage.objects;
create policy "delivery_proof_read_own_or_ops"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'delivery-proof'
    and (
      public.auth_role() in ('admin', 'dispatcher')
      or (storage.foldername(name))[1] = (select auth.uid())::text
    )
  );

-- No UPDATE policy: uploaded bytes are immutable.

-- Cleanup only. If the object uploads but record_delivery_proof then fails, the
-- app deletes the orphan; once indexed it can never be removed by a client.
--
-- The indexed-check must bypass the caller's RLS on delivery_proofs (the driver
-- has no read policy there at all, so a plain NOT EXISTS would always see zero
-- rows and happily authorise deleting indexed evidence). Same reasoning as
-- kyc_storage_path_indexed in the KYC hardening migration.
create or replace function public.delivery_proof_path_indexed(p_name text)
returns boolean
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.delivery_proofs where storage_path = p_name
  );
$$;

revoke all on function public.delivery_proof_path_indexed(text) from public, anon;
grant execute on function public.delivery_proof_path_indexed(text) to authenticated;

drop policy if exists "delivery_proof_delete_unindexed_own" on storage.objects;
create policy "delivery_proof_delete_unindexed_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'delivery-proof'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not public.delivery_proof_path_indexed(name)
  );

-- ============================================================================
-- RECORD PROOF
-- An RPC rather than an INSERT policy, because the authority here is a join
-- (this driver is the assigned driver on this order) and because the dropoff
-- snapshot must be read from the order server-side rather than trusted from the
-- client.
-- ============================================================================
drop function if exists public.record_delivery_proof(uuid, text);
create or replace function public.record_delivery_proof(p_order_id uuid, p_storage_path text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user      uuid := auth.uid();
  v_role      app_role := public.auth_role();
  v_driver_id uuid;
  v_order     public.orders;
  v_id        uuid;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;

  -- House rule 4: fail CLOSED. `v_role <> 'driver'` is NULL when the role is
  -- NULL, and a NULL guard passes, which would let a role-less caller through.
  if coalesce(v_role::text, '') <> 'driver' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'check_violation';
  end if;

  select d.id into v_driver_id
    from public.drivers d
   where d.profile_id = v_user
     and d.id = v_order.assigned_driver_id;
  if v_driver_id is null then
    raise exception 'NOT_ASSIGNED_DRIVER' using errcode = 'check_violation';
  end if;

  -- Proof belongs to the handoff. `delivered` is allowed because the app records
  -- the row immediately AFTER advancing status (so a slow upload can never block
  -- the transition); anything earlier than out_for_delivery is not a handoff.
  if v_order.status not in ('out_for_delivery', 'delivered') then
    raise exception 'ORDER_NOT_AT_HANDOFF: status is %', v_order.status
      using errcode = 'check_violation';
  end if;

  -- Re-assert the path shape the storage policy enforces. The bytes and the
  -- index are written by two different statements; without this a driver could
  -- index a path pointing at somebody else's prefix.
  if p_storage_path is null
     or p_storage_path <> v_user::text || '/' || p_order_id::text ||
        substring(p_storage_path from '-[0-9]+\.(?:jpg|jpeg|png|webp)$')
  then
    raise exception 'INVALID_PROOF_PATH' using errcode = 'check_violation';
  end if;

  -- ::text explicitly — orders.dropoff_preference is the public.dropoff_preference
  -- ENUM, and storing it as text keeps this evidence row readable even if the
  -- enum gains or loses a label later.
  insert into public.delivery_proofs (order_id, driver_id, storage_path, dropoff_preference)
  values (p_order_id, v_driver_id, p_storage_path, v_order.dropoff_preference::text)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_delivery_proof(uuid, text) from public, anon;
grant execute on function public.record_delivery_proof(uuid, text) to authenticated;

comment on function public.record_delivery_proof(uuid, text) is
  'Index a delivery-proof object. Caller must be the order''s assigned driver and the order at handoff. Snapshots dropoff_preference server-side.';

-- ============================================================================
-- OPS REPORT
-- The counterweight to not gating the transition: deliveries that SHOULD have
-- carried a photo and did not. SECURITY DEFINER because it deliberately reads
-- across all orders, so it is restricted to ops explicitly.
-- ============================================================================
drop function if exists public.ops_deliveries_missing_proof(timestamptz);
create or replace function public.ops_deliveries_missing_proof(p_since timestamptz default now() - interval '7 days')
returns table (
  order_id           uuid,
  short_code         text,
  assigned_driver_id uuid,
  dropoff_preference text,
  payment_method     text,
  total_egp          int,
  delivered_at       timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $$
  -- ::text on dropoff_preference is required, not cosmetic: it is the
  -- public.dropoff_preference ENUM, and function resolution does not apply an
  -- I/O conversion cast, so passing it to a text parameter fails outright.
  select o.id, o.short_code, o.assigned_driver_id, o.dropoff_preference::text,
         o.payment_method, o.total_egp, o.delivered_at
    from public.orders o
   where public.auth_role() in ('admin', 'dispatcher')
     and o.status = 'delivered'
     and o.delivered_at >= p_since
     and o.assigned_driver_id is not null
     and public.delivery_proof_required(o.dropoff_preference::text)
     and not exists (
       select 1 from public.delivery_proofs dp where dp.order_id = o.id
     )
   order by o.delivered_at desc;
$$;

revoke all on function public.ops_deliveries_missing_proof(timestamptz) from public, anon;
grant execute on function public.ops_deliveries_missing_proof(timestamptz) to authenticated;

comment on function public.ops_deliveries_missing_proof(timestamptz) is
  'Delivered orders whose dropoff preference required a photo but have none. Returns nothing unless the caller is admin/dispatcher.';
