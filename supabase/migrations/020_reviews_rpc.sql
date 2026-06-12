-- 020_reviews_rpc.sql
-- Public restaurant reviews, read path.
--
-- Customers already rate orders (orders.rating_food / rating_delivery /
-- rating_comment, written via the review screen), but orders_owner_select RLS
-- means no other customer can see them. This RPC exposes an ANONYMIZED
-- projection of those ratings so the restaurant page can show social proof
-- without leaking who ordered, where they live, or what they bought.
--
-- Returned fields only: ratings, trimmed comment, masked reviewer name
-- ("Ahmed K." / "Guest"), and when. NEVER user_id, address, items or totals.
--
-- Non-destructive: one SECURITY DEFINER function, executable by anon too
-- (logged-out browsing shows reviews).

create or replace function public.get_restaurant_reviews(
  p_restaurant_id uuid,
  p_limit int default 20
)
returns table (
  rating_food     int,
  rating_delivery int,
  comment         text,
  reviewer        text,
  reviewed_at     timestamptz
)
language sql
stable
security definer set search_path = public, pg_temp
as $$
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
  order by coalesce(o.delivered_at, o.placed_at) desc
  -- Server-side cap regardless of what the client asks for.
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

grant execute on function public.get_restaurant_reviews(uuid, int) to authenticated, anon;

comment on function public.get_restaurant_reviews is
  'Anonymized recent reviews for a restaurant (masked reviewer name, ratings, comment). SECURITY DEFINER so customers can see each other''s ratings without any orders RLS exposure.';
