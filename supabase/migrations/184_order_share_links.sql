-- 184_order_share_links.sql
--
-- "Follow my order": a customer mints an unguessable link, and whoever holds it
-- watches the delivery without an account.
--
-- THE WHOLE DESIGN PROBLEM IS THAT THE LINK IS FORWARDABLE. It goes into a
-- WhatsApp group and from there anywhere, so the projection below is not "the
-- tracking screen minus auth" — it is a deliberately impoverished view built by
-- asking, for each field, what a stranger holding a forwarded link may know.
--
-- NEVER LEAVES THE SERVER:
--   * the delivery address, in any form. This is a tourist app; address_snapshot
--     carries hotel names and ROOM NUMBERS. There is no destination pin on the
--     shared map, by design (see the note on driver position below, which is the
--     non-obvious way that same secret can escape).
--   * customer name, phone, items, prices, totals, order id, driver id, driver
--     phone. A share reveals that a delivery is happening, not what was ordered
--     or by whom.
--
-- WHY AN RPC READS current_geo AT ALL: mig 012's `public_drivers` view is
-- explicit that clients must never select `drivers` directly and deliberately
-- excludes current_geo — the customer's own app gets the driver dot over an
-- ephemeral Realtime broadcast, never from the table. This function is therefore
-- the only path by which that column reaches a client, which is exactly why it
-- is narrow, masked, expiring and revocable rather than a policy on the table.

-- ============================================================================
-- SHARES
-- One row per order: re-sharing returns the SAME token so that tapping Share
-- twice does not silently kill a link already sent to someone. Revoking and
-- sharing again mints a new one, so the revoked link stays dead forever.
-- ============================================================================
create table if not exists public.order_shares (
  order_id   uuid primary key references public.orders(id) on delete cascade,
  token      text not null unique,
  created_by uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists order_shares_created_by_idx
  on public.order_shares (created_by, created_at desc);

-- House rule 5b: ALTER DEFAULT PRIVILEGES on this database grants arwdDxtm to
-- anon/authenticated on every new table, and TRUNCATE ignores RLS, so "RLS on
-- with no policies" would not protect this.
revoke all on table public.order_shares from public, anon, authenticated;

alter table public.order_shares enable row level security;

-- The owner may see their own share so the app can render "Sharing / Stop
-- sharing" without a round trip through an RPC. Anon gets nothing here at all —
-- a link-holder never touches this table, only get_shared_order below.
grant select on table public.order_shares to authenticated;

drop policy if exists order_shares_owner_select on public.order_shares;
create policy order_shares_owner_select
  on public.order_shares for select to authenticated
  using (created_by = (select auth.uid()));

-- No INSERT/UPDATE/DELETE policy: writes go only through the two RPCs below,
-- which is what enforces "you may only share an order you placed".

comment on table public.order_shares is
  'Follow-my-order links. Written only by create_order_share/revoke_order_share; read by the owner; resolved for anon exclusively through get_shared_order.';

-- ============================================================================
-- MINT
-- ============================================================================
drop function if exists public.create_order_share(uuid);
create or replace function public.create_order_share(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user  uuid := auth.uid();
  v_order public.orders;
  v_token text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'check_violation';
  end if;

  -- Only the person who placed it. Not the driver, not the merchant: sharing is
  -- the customer's call because it is their delivery being broadcast.
  if v_order.user_id is distinct from v_user then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;

  -- Nothing to follow once it is over. This also stops a finished order being
  -- turned into a durable "this address received a delivery" beacon.
  if v_order.status in ('delivered', 'cancelled', 'rejected') then
    raise exception 'ORDER_NOT_LIVE: status is %', v_order.status
      using errcode = 'check_violation';
  end if;

  select token into v_token
    from public.order_shares
   where order_id = p_order_id and revoked_at is null;

  if v_token is not null then
    return v_token; -- idempotent: the link already in someone's chat keeps working
  end if;

  -- 16 bytes of pgcrypto randomness, hex so it is URL-safe without escaping.
  -- 128 bits is not guessable, which is the only thing standing between a
  -- stranger and this order.
  v_token := encode(gen_random_bytes(16), 'hex');

  insert into public.order_shares (order_id, token, created_by)
  values (p_order_id, v_token, v_user)
  on conflict (order_id) do update
    set token = excluded.token,      -- previously revoked → new token, old link dead
        created_by = excluded.created_by,
        created_at = now(),
        revoked_at = null;

  return v_token;
end;
$$;

revoke all on function public.create_order_share(uuid) from public, anon;
grant execute on function public.create_order_share(uuid) to authenticated;

comment on function public.create_order_share(uuid) is
  'Mint (or return) a follow-my-order token. Customer-only, live orders only. Idempotent while unrevoked.';

-- ============================================================================
-- REVOKE
-- ============================================================================
drop function if exists public.revoke_order_share(uuid);
create or replace function public.revoke_order_share(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;

  update public.order_shares
     set revoked_at = now()
   where order_id = p_order_id
     and created_by = v_user
     and revoked_at is null;

  -- Deliberately silent when it matches nothing: "stop sharing" should be safe
  -- to tap twice, and an owner must never be told whether some OTHER order has
  -- a share by probing this.
end;
$$;

revoke all on function public.revoke_order_share(uuid) from public, anon;
grant execute on function public.revoke_order_share(uuid) to authenticated;

-- ============================================================================
-- RESOLVE — the anonymous view
-- ============================================================================
drop function if exists public.get_shared_order(text);
create or replace function public.get_shared_order(p_token text)
returns table (
  short_code       text,
  status           text,
  eta_at           timestamptz,
  restaurant_name  text,
  restaurant_lat   double precision,
  restaurant_lng   double precision,
  driver_name      text,
  driver_vehicle   text,
  driver_rating    numeric,
  driver_lat       double precision,
  driver_lng       double precision,
  driver_pinged_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    o.short_code,
    o.status::text,
    o.eta_at,
    r.name,
    st_y(r.geo::geometry),
    st_x(r.geo::geometry),
    -- First name only, matching how get_restaurant_reviews masks a reviewer.
    -- A courier's full name does not belong in a forwardable link.
    nullif(split_part(btrim(coalesce(d.name, '')), ' ', 1), ''),
    d.vehicle::text,
    d.rating,
    -- POSITION IS GATED ON STATUS, and this is the subtle part. Before pickup
    -- the driver is sitting at the restaurant, which says nothing; AFTER
    -- delivery their last known position IS THE CUSTOMER'S DOORSTEP. Emitting
    -- the dot on a delivered order would hand over the exact address that the
    -- rest of this function goes out of its way never to expose. So the dot
    -- exists only while the order is genuinely in motion.
    case when o.status in ('picked_up', 'out_for_delivery')
         then st_y(d.current_geo::geometry) end,
    case when o.status in ('picked_up', 'out_for_delivery')
         then st_x(d.current_geo::geometry) end,
    case when o.status in ('picked_up', 'out_for_delivery')
         then d.last_ping_at end
  from public.order_shares s
  join public.orders o on o.id = s.order_id
  left join public.restaurants r on r.id = o.restaurant_id
  left join public.drivers d on d.id = o.assigned_driver_id
  where s.token = p_token
    and s.revoked_at is null
    -- Live, or delivered within the last two hours. The grace window exists so
    -- somebody opening the link a few minutes late reads "Delivered" instead of
    -- a broken page; after that the link stops answering entirely rather than
    -- standing as a permanent record that this order happened.
    and (
      o.status not in ('delivered', 'cancelled', 'rejected')
      or coalesce(o.delivered_at, o.placed_at) > now() - interval '2 hours'
    );
$$;

revoke all on function public.get_shared_order(text) from public;
grant execute on function public.get_shared_order(text) to anon, authenticated;

comment on function public.get_shared_order(text) is
  'Resolve a follow-my-order token to a deliberately minimal public view. No address, items, prices, phones or names beyond a courier first name. Driver position only while in motion — after delivery it would BE the address.';
