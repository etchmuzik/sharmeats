-- 168_customer_carts.sql
--
-- Package 02 Slice D — server-backed active cart.
--
-- THE PROBLEM. Carts live only in AsyncStorage (apps/customer/src/store/cart.ts,
-- key `@sharmeats:cart:v1`). A customer who builds a basket on their phone and
-- opens the app on a tablet sees an empty cart; reinstalling loses the basket
-- entirely. This table is the durable, cross-device copy.
--
-- ================= WHAT IS STORED, AND WHAT IS DELIBERATELY NOT =================
-- items holds IDENTITY ONLY, the same shape prepare_cart (mig 145) and
-- place_order accept:
--     [{ "item_id": uuid, "quantity": int, "modifier_option_ids": [uuid], "notes": text }]
--
-- NO PRICES. Not base price, not modifier deltas, not a subtotal. This is the
-- single most important property of this table. If a client could persist a
-- price into its own cart row and have that price trusted when the cart is
-- restored, it would be a self-service discount: write `price_egp: 1`, restore,
-- check out. Restoring therefore goes back through prepare_cart, which reads
-- live prices from menu_items, and placement revalidates everything again in
-- place_order. A price in this table would have no reader — so it has no column.
--
-- (The spec permits an optional display snapshot for offline UX. It is omitted
-- here rather than added-and-ignored: an unread price column is an invitation
-- for a later change to start reading it. Offline display already works from
-- AsyncStorage, which is where a device-local snapshot belongs.)
--
-- restaurant_id is nullable because an empty cart has no restaurant, matching
-- the client store where `restaurantId` is null until the first line is added.
--
-- ================= WHY CLIENTS GET NO DIRECT WRITE =================
-- Unlike favorite_items (mig 139), which clients INSERT/DELETE directly under
-- RLS, every write here goes through upsert_my_cart() (below). The reason is
-- `version`: optimistic concurrency only works if the client cannot choose the
-- version it writes. With a direct UPDATE grant, a client could send any
-- version and clobber another device's newer cart, which is precisely the
-- conflict this column exists to detect. So:
--     * no INSERT/UPDATE/DELETE grant to anon or authenticated;
--     * SELECT is granted, guarded by owner-only RLS, so a restore is one
--       cheap read with no function call;
--     * the definer RPC owns every mutation and every version bump.
--
-- ================= TTL =================
-- expires_at exists so an abandoned cart does not sit in the table forever.
-- Cleanup is a scheduled job (pg_cron), NOT a delete-on-read: a read path that
-- mutates cannot be run from a STABLE function or a replica, and a customer
-- returning one minute after expiry should still be offered their basket rather
-- than silently losing it. The reader treats `expires_at < now()` as "offer to
-- restore, but say it is stale"; the job reclaims the row later.

create table if not exists public.customer_carts (
  user_id       uuid primary key references public.users(id) on delete cascade,
  restaurant_id uuid null references public.restaurants(id) on delete set null,
  items         jsonb not null default '[]'::jsonb,
  kitchen_notes text null,
  -- Monotonic per row, bumped by upsert_my_cart on every accepted write. A
  -- client sends the version it believes it is editing; a mismatch means
  -- another device wrote first and the client must resolve it.
  version       bigint not null default 1,
  updated_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '30 days',

  -- items must be an array. A jsonb object or scalar here would break every
  -- reader; the RPC validates shape too, but the table refuses to hold a
  -- malformed value regardless of how it got written.
  constraint customer_carts_items_is_array
    check (jsonb_typeof(items) = 'array'),
  -- Same bound prepare_cart enforces (mig 145): an unbounded array is a cheap
  -- way to make the server do arbitrary work.
  constraint customer_carts_items_bounded
    check (jsonb_array_length(items) <= 100),
  -- A cart with lines must know its restaurant; the single-restaurant rule is
  -- enforced in the RPC, but this catches a lines-without-restaurant row.
  constraint customer_carts_restaurant_present_when_filled
    check (jsonb_array_length(items) = 0 or restaurant_id is not null),
  constraint customer_carts_kitchen_notes_len
    check (kitchen_notes is null or length(kitchen_notes) <= 500)
);

comment on table public.customer_carts is
  'One durable active cart per customer, for cross-device restore. Stores item IDENTITY ONLY (item_id/quantity/modifier_option_ids/notes) and never prices — a client-persisted price would be a self-service discount, so restore goes back through prepare_cart (mig 145) and placement revalidates in place_order. Clients get SELECT only under owner-only RLS; every write goes through upsert_my_cart() because optimistic concurrency requires that the client not choose its own version. Mig 168.';
comment on column public.customer_carts.items is
  'Identity-only cart lines: [{item_id, quantity, modifier_option_ids, notes}]. Deliberately holds NO price of any kind. Mig 168.';
comment on column public.customer_carts.version is
  'Optimistic-concurrency token, bumped by upsert_my_cart on every accepted write. A client write carrying a stale version is refused with CART_VERSION_CONFLICT so the app can ask the customer which cart to keep. Mig 168.';
comment on column public.customer_carts.expires_at is
  'TTL horizon for a scheduled cleanup job. NOT enforced on read: a customer returning just after expiry is still offered their basket (flagged stale) rather than silently losing it. Mig 168.';

-- "Which carts are reclaimable" for the cleanup job.
create index if not exists customer_carts_expires_idx
  on public.customer_carts (expires_at);

alter table public.customer_carts enable row level security;

-- Owner-only, in the (select auth.uid()) initplan form used since mig 089 —
-- the bare auth.uid() form re-evaluates per row and trips the
-- auth_rls_initplan performance advisor.
drop policy if exists customer_carts_owner_select on public.customer_carts;
create policy customer_carts_owner_select on public.customer_carts
  for select using ((select auth.uid()) = user_id);

-- REVOKE FIRST. This database has ALTER DEFAULT PRIVILEGES granting the full
-- `arwdDxtm` set on every new public table to anon and authenticated (verified
-- 2026-07-27 against pg_default_acl from both the postgres and supabase_admin
-- grantors, and re-confirmed by mig 139's assert). A new table therefore
-- arrives with UPDATE, DELETE and TRUNCATE already granted, so simply *not*
-- granting them is a no-op. TRUNCATE is the sharp edge: it IGNORES row-level
-- security, so "RLS enabled" would not stop any anon-key holder from emptying
-- every customer's cart in one statement.
revoke all on public.customer_carts from public, anon, authenticated;

-- SELECT only. RLS scopes it to the caller's own row. No INSERT/UPDATE/DELETE
-- (the RPC owns writes, see the version rationale above) and no TRUNCATE.
grant select on public.customer_carts to anon, authenticated;
