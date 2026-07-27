-- 140_saved_items_read_unavailable.sql
--
-- Fixes my_favorite_items (mig 139): a saved dish DISAPPEARED from the Saved
-- screen the moment the restaurant marked it unavailable.
--
-- ================= THE DEFECT =================
-- 139 made my_favorite_items SECURITY INVOKER on the reasoning that RLS on
-- favorite_items already scopes rows to the caller. True, but the function also
-- JOINS menu_items and restaurants, and those carry their own RLS:
--
--   menu_items_read:  (is_available = true OR is_merchant_staff(restaurant_id) OR admin)
--   restaurants_read: (is_active    = true OR is_merchant_staff(id)            OR admin)
--
-- Under the caller's RLS an unavailable dish is invisible, so the inner join
-- drops it and the saved row vanishes entirely — not merely un-orderable, GONE
-- from the list. A deactivated restaurant does the same. That is precisely the
-- behaviour 139's header promised would never happen ("an UNAVAILABLE item is
-- deliberately still returned so the Saved screen can show it greyed out").
--
-- Verified against production 2026-07-27 (rolled back): save a dish, set
-- is_available=false, and my_favorite_items returned 0 rows. The favorite_items
-- row itself was intact — this was purely the read path.
--
-- ================= THE FIX, AND WHY IT IS SAFE =================
-- SECURITY DEFINER so the joins are not subject to the caller's RLS, with the
-- scope pinned INSIDE the body: `where f.user_id = auth.uid()`. The function
-- takes no arguments, so a caller cannot ask for anyone else's saves — the only
-- rows it can ever return are ones the caller already saved, and the columns
-- are the same public catalogue fields any customer sees while browsing.
--
-- The one genuinely new disclosure is that a dish the caller SAVED EARLIER is
-- now unavailable, or its restaurant is inactive. That is information about
-- their own saved list, and showing it is the entire point of the feature.
--
-- house rule 3: a definer function needs its default PUBLIC EXECUTE revoked.

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
security definer
set search_path to 'public','pg_temp'
as $function$
  select f.menu_item_id, f.restaurant_id,
         m.name, m.description, m.price_egp, m.image, m.is_available,
         r.name, r.is_open, r.is_active,
         f.created_at
    from public.favorite_items f
    join public.menu_items m on m.id = f.menu_item_id
    join public.restaurants r on r.id = f.restaurant_id
   -- The ONLY scope: the caller's own saves. Because the function takes no
   -- arguments, this cannot be widened by anything a client sends.
   where f.user_id = (select auth.uid())
   -- No availability/open filter, and now it actually holds: as definer the
   -- joins are not filtered by menu_items_read / restaurants_read either.
   order by f.created_at desc;
$function$;

revoke all on function public.my_favorite_items() from public, anon, authenticated;
grant execute on function public.my_favorite_items() to anon, authenticated;

comment on function public.my_favorite_items() is
  'The caller''s saved dishes joined to item + restaurant display fields, newest first. SECURITY DEFINER *by necessity*: menu_items_read and restaurants_read hide unavailable items and inactive restaurants from customers, so an invoker version silently dropped a saved dish the moment it went out of stock (the mig 139 defect). Scope is pinned to auth.uid() inside the body and the function takes no arguments, so it cannot return another user''s saves. Migs 139, 140.';
