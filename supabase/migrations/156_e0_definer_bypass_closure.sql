-- 156_e0_definer_bypass_closure.sql
--
-- Package 07 Program A0 (session E0) — finding #5: close the SECURITY DEFINER
-- bypass surface.
--
-- Migration 153 gated the RLS read paths and the two order RPCs, but a
-- SECURITY DEFINER function does NOT run under RLS. Every definer function that
-- reads `restaurants` or `menu_items` therefore reads them unfiltered, which
-- means the vertical gate can be walked around by calling an RPC instead of
-- selecting a table.
--
-- Measured on production 2026-07-28 (anon-callable, definer, no vertical check):
--
--   get_restaurant_reviews(uuid,int)          anon=true   -> merchant content
--   my_favorite_items()                       anon=true   -> catalog content
--   delivery_feasibility(uuid,geography)      anon=true   -> fee/ETA
--   quote_delivery_fee(uuid,geography,int)    anon=true   -> fee
--   nearest_drivers(...)                      anon=false  -> already locked (mig 110)
--   validate_promo(text,int)                  anon=true   -> no merchant read
--
-- THEY ARE NOT ALL THE SAME LEAK, so they do not get the same treatment.
--
-- CONTENT functions return merchant/catalog material and are gated on the
-- CALLER:
--   * get_restaurant_reviews  -- reviews, reviewer first names and comments for
--     an arbitrary merchant id. On a private grocery this discloses the
--     storefront's existence, its customers' words and its trading history.
--   * my_favorite_items -- already scoped to the caller's own saves, but its
--     comment explicitly notes the joins are NOT filtered as definer, so a save
--     made while a vertical was public keeps rendering the live catalog after
--     it is closed. The gate here is per-ROW, not whole-function: a customer
--     must keep seeing their own saved food while a grocery save drops out.
--
-- FEE functions are deliberately LEFT ALONE, and that is a decision, not an
-- omission:
--   * place_order and prepare_cart call them internally as definer, AFTER their
--     own vertical gate has already passed. Adding a caller-scoped check inside
--     them would evaluate the DEFINER's access during legitimate placement and
--     break every order.
--   * What they return is a fee integer and an in-range boolean for a merchant
--     id the caller already had to know. There is no name, catalog, price or
--     customer content, and the same numbers are derivable from the public
--     delivery_fee_rules + zone tables.
--   * The order path is already closed, so the fee cannot be acted on.
-- Revoking them from anon would additionally break the pre-auth fee preview on
-- the customer checkout screen for FOOD, which is a live regression for zero
-- confidentiality gain. Revisit if a vertical ever needs its fee structure kept
-- secret; that is an E1 decision with a real requirement behind it.

-- ---------------------------------------------------------------------------
-- 1. get_restaurant_reviews — gate the whole function on the caller.
--
-- Body derived from the DEPLOYED definition (pg_get_functiondef, 2026-07-28).
-- It is a LANGUAGE SQL function, so the gate is expressed as a join predicate
-- rather than an IF: adding `can_view_vertical` to the WHERE clause returns
-- zero rows for a vertical the caller may not see, which is the correct
-- "does not exist" answer rather than a distinguishable error.
-- ---------------------------------------------------------------------------
create or replace function public.get_restaurant_reviews(p_restaurant_id uuid, p_limit integer default 20)
returns table(rating_food integer, rating_delivery integer, comment text,
              reviewer text, reviewed_at timestamp with time zone)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select
    o.rating_food,
    o.rating_delivery,
    nullif(btrim(coalesce(o.rating_comment, '')), '') as comment,
    case
      when u.display_name is null
        or btrim(u.display_name) = ''
        or lower(btrim(u.display_name)) = 'guest'
      then 'Guest'
      else split_part(btrim(u.display_name), ' ', 1)
        || case
             when split_part(btrim(u.display_name), ' ', 2) <> ''
             then ' ' || left(split_part(btrim(u.display_name), ' ', 2), 1) || '.'
             else ''
           end
    end as reviewer,
    coalesce(o.delivered_at, o.placed_at) as reviewed_at
  from public.orders o
  left join public.users u on u.id = o.user_id
  where o.restaurant_id = p_restaurant_id
    and o.rating_food is not null
    -- [156] VERTICAL GATE. This function is SECURITY DEFINER, so restaurants_read
    -- does not apply to it: without this it returns reviews, reviewer names and
    -- comments for a merchant in a disabled or private vertical to anyone who
    -- guesses the id. Returning zero rows (rather than raising) keeps a hidden
    -- merchant indistinguishable from one with no reviews.
    and exists (
      select 1 from public.restaurants r
       where r.id = p_restaurant_id
         and public.can_view_vertical(r.vertical_id)
    )
  order by coalesce(o.delivered_at, o.placed_at) desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$function$;

comment on function public.get_restaurant_reviews(uuid, integer) is
  'Public review feed for a merchant. Since mig 156 it is gated on the caller''s vertical eligibility: as SECURITY DEFINER it bypasses restaurants_read, so without the gate it disclosed reviews, reviewer first names and comments for a disabled/private merchant to any anon caller with a guessed id. Returns zero rows rather than raising, so a hidden merchant is indistinguishable from one with no reviews.';

-- ---------------------------------------------------------------------------
-- 2. my_favorite_items — gate PER ROW, not per function.
--
-- The caller keeps seeing their own saved FOOD items; only saves belonging to a
-- vertical they may no longer see drop out. A whole-function gate would empty
-- the screen the moment any one vertical closed.
-- ---------------------------------------------------------------------------
create or replace function public.my_favorite_items()
returns table(menu_item_id uuid, restaurant_id uuid, item_name text,
              item_description text, price_egp integer, image text,
              is_available boolean, restaurant_name text, restaurant_is_open boolean,
              restaurant_is_active boolean, created_at timestamp with time zone)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
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
     -- [156] VERTICAL GATE, per row. As definer the joins above are not filtered
     -- by menu_items_read/restaurants_read, so a dish saved while a vertical was
     -- public would keep rendering its live name, price and availability after
     -- that vertical was closed. Per-row (not whole-function) so a customer's
     -- saved FOOD is unaffected when an unrelated vertical closes.
     and public.can_view_vertical(r.vertical_id)
   order by f.created_at desc;
$function$;

comment on function public.my_favorite_items() is
  'The caller''s saved dishes. Owner-bound (no arguments, scoped to auth.uid()). Since mig 156 each row is additionally gated on the caller''s vertical eligibility: as SECURITY DEFINER the joins bypass menu_items_read/restaurants_read, so a save made while a vertical was public would otherwise keep rendering live catalog data after it closed. Gated per ROW so saved food survives an unrelated vertical closing.';

-- ---------------------------------------------------------------------------
-- 3. Record the deliberate non-change on the fee functions, so the next
--    reviewer does not read their absence as an oversight.
-- ---------------------------------------------------------------------------
comment on function public.quote_delivery_fee(uuid, geography, integer) is
  'Delivery fee for a merchant + dropoff. DELIBERATELY NOT vertical-gated (mig 156 review): place_order and prepare_cart call it internally as definer AFTER their own gate, so a caller-scoped check here would evaluate the definer''s access and break legitimate placement. It returns only a fee integer for a merchant id the caller already knew -- no name, catalog or customer content -- and the order path that could act on it is closed. Revoking it from anon would break the pre-auth food fee preview for no confidentiality gain.';

comment on function public.delivery_feasibility(uuid, geography) is
  'Distance/in-range/ETA for a merchant + dropoff. DELIBERATELY NOT vertical-gated for the same reason as quote_delivery_fee: place_order calls it internally as definer after its own gate. Returns geometry-derived numbers, no merchant or catalog content.';
