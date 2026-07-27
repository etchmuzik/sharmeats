-- 139_favorite_menu_items.sql
--
-- Favourites currently cover restaurants only. This adds the dish.
--
-- ================= WHY A SECOND TABLE =================
-- public.favorites (mig 021) is `primary key (user_id, restaurant_id)` with
-- restaurant_id NOT NULL. Widening it to hold either kind of favourite would
-- mean making restaurant_id nullable, replacing the primary key, and rewriting
-- the RLS policy and every read path -- on a table that already holds live
-- rows, to gain nothing. A dish favourite is a different thing with a
-- different lifecycle (an item can be deleted, renamed, or go unavailable
-- while its restaurant stays), so it gets its own table.
--
-- ================= LIFECYCLE, THE PART THAT BITES =================
-- A saved dish can stop existing in three distinct ways, and they are NOT the
-- same to a customer:
--   1. The item row is deleted        -> the favourite is meaningless. FK
--                                        cascade removes it. Nothing to show.
--   2. The item is unavailable        -> still real, just not orderable now.
--      (menu_items.is_available=false)   MUST still be listed, greyed out --
--                                        "back in stock" is exactly the signal
--                                        a saved-items list is for.
--   3. The restaurant closes/deactivates -> same as 2: keep it, show it closed.
-- So the read path filters NOTHING on availability; the UI decides how to
-- render it. A query that silently hides unavailable saves would make the
-- feature look broken every evening.
--
-- restaurant_id is denormalised onto the row so the Saved screen can group by
-- restaurant without a join back through menu_items, and so a stale favourite
-- still knows where it came from. It is kept honest by a composite FK to
-- (id, restaurant_id) -- see the unique index this migration adds on
-- menu_items -- so it can never disagree with the item's real restaurant.

-- menu_items.id is already the primary key, but a composite FK needs a unique
-- constraint on exactly (id, restaurant_id). This index is that target; it is
-- also a covering index for "items of this restaurant" lookups.
create unique index if not exists menu_items_id_restaurant_uidx
  on public.menu_items (id, restaurant_id);

create table if not exists public.favorite_items (
  user_id       uuid not null references public.users(id) on delete cascade,
  menu_item_id  uuid not null,
  restaurant_id uuid not null,
  created_at    timestamptz not null default now(),
  primary key (user_id, menu_item_id),
  -- Composite FK: deleting the item removes the favourite (case 1 above), and
  -- restaurant_id cannot drift from the item's actual restaurant.
  constraint favorite_items_item_fk
    foreign key (menu_item_id, restaurant_id)
    references public.menu_items (id, restaurant_id)
    on delete cascade
);

comment on table public.favorite_items is
  'Customer-saved individual dishes. Separate from public.favorites (which is restaurant-level) because a dish has its own lifecycle: it can be deleted, or go unavailable while its restaurant stays open. Deleting the item cascades the favourite away; an UNAVAILABLE item is deliberately still returned so the Saved screen can show it greyed out — "back in stock" is the signal this list exists for. Cascades on user delete, so account deletion (mig 022/112) covers it with no extra code. Mig 139.';
comment on column public.favorite_items.restaurant_id is
  'Denormalised so the Saved screen can group by restaurant without joining back through menu_items. Held honest by the composite FK to menu_items(id, restaurant_id) — it cannot disagree with the item''s real restaurant. Mig 139.';

-- Fast "my saved dishes" and "who saved this item" (the latter for a future
-- back-in-stock notification, which is why the item index exists now).
create index if not exists favorite_items_user_idx on public.favorite_items (user_id, created_at desc);
create index if not exists favorite_items_item_idx on public.favorite_items (menu_item_id);
create index if not exists favorite_items_restaurant_idx on public.favorite_items (restaurant_id);

alter table public.favorite_items enable row level security;

-- Same owner-only shape as favorites_owner_all (mig 021, rewritten by 089 to
-- use the (select auth.uid()) initplan form — matched here so this table does
-- not regress the same performance advisor).
drop policy if exists favorite_items_owner_all on public.favorite_items;
create policy favorite_items_owner_all on public.favorite_items
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- REVOKE FIRST. This database has ALTER DEFAULT PRIVILEGES granting the full
-- `arwdDxtm` set on every new public table to anon and authenticated (verified
-- 2026-07-27 against pg_default_acl, from both the postgres and supabase_admin
-- grantors). So a new table arrives with UPDATE, TRUNCATE and REFERENCES
-- already granted, and simply *not* granting them is a no-op — the same trap
-- house rule 3 documents for SECURITY DEFINER functions, applied to tables.
-- Caught here by an assert that expected UPDATE to fail and found it allowed.
revoke all on public.favorite_items from public, anon, authenticated;

-- Clients write their own rows directly, with RLS as the guard. There is no
-- authority column here — a favourite is entirely the user's own data.
grant select, insert, delete on public.favorite_items to anon, authenticated;
-- No UPDATE and no TRUNCATE, deliberately: a favourite is created or removed,
-- never edited, and TRUNCATE ignores RLS entirely (it would let any client wipe
-- every user's saved dishes in one statement).

-- ---------------------------------------------------------------------------
-- Collateral fix: two existing tables carry the same default-privilege hole
-- ---------------------------------------------------------------------------
-- Found while asserting the grants above. Because of the ALTER DEFAULT
-- PRIVILEGES noted earlier, these two tables were created with the full
-- arwdDxtm set granted to anon and authenticated, and nothing later revoked it.
-- TRUNCATE is the dangerous one: it IGNORES row-level security, so
-- "RLS enabled with no policies" does not protect a table from being emptied.
--
-- Verified exploitable against production on 2026-07-27 with the anon role:
-- `truncate public.order_financials_failures` and `truncate
-- public.push_campaigns` both SUCCEEDED (in a rolled-back transaction).
--
--   * order_financials_failures (mig 135) is the unbilled-revenue repair
--     queue -- an unresolved row means an order was delivered but never
--     billed. Anyone with the anon key could erase that evidence.
--   * push_campaigns (mig 078) is the marketing send history, including the
--     new delivery outcomes from migs 137/138.
-- Neither table should be client-reachable at all: both are written by
-- SECURITY DEFINER code and read by admins through definer RPCs.
revoke all on public.order_financials_failures from public, anon, authenticated;
revoke all on public.push_campaigns from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Read path
-- ---------------------------------------------------------------------------
-- Returns the caller's saved dishes with everything the Saved screen renders,
-- so the client needs one round trip and no client-side join. SECURITY INVOKER
-- (the default): RLS on favorite_items already scopes rows to the caller, and
-- an invoker function cannot become an accidental data-leak surface the way a
-- definer one can (the mig 110 nearest_drivers lesson).
create or replace function public.my_favorite_items()
returns table (
  menu_item_id    uuid,
  restaurant_id   uuid,
  item_name       text,
  item_description text,
  price_egp       integer,
  image           text,
  is_available    boolean,
  restaurant_name text,
  restaurant_is_open boolean,
  restaurant_is_active boolean,
  created_at      timestamptz
)
language sql
stable
set search_path to 'public','pg_temp'
as $function$
  select f.menu_item_id, f.restaurant_id,
         m.name, m.description, m.price_egp, m.image, m.is_available,
         r.name, r.is_open, r.is_active,
         f.created_at
    from public.favorite_items f
    join public.menu_items m on m.id = f.menu_item_id
    join public.restaurants r on r.id = f.restaurant_id
   where f.user_id = (select auth.uid())
   -- Deliberately NO availability/open filter: an unavailable dish is still a
   -- real saved dish and the UI shows it greyed out.
   order by f.created_at desc;
$function$;

revoke all on function public.my_favorite_items() from public;
grant execute on function public.my_favorite_items() to anon, authenticated;

comment on function public.my_favorite_items() is
  'The caller''s saved dishes joined to item + restaurant display fields, newest first. Returns UNAVAILABLE and closed-restaurant items too — the Saved screen greys them out rather than hiding them, because a disappearing save reads as a bug and "back in stock" is the point of the list. SECURITY INVOKER: favorite_items RLS already scopes to the caller. Mig 139.';
