-- 169_menu_search.sql
--
-- One-query cross-restaurant dish search, replacing an N+1 in the customer app.
--
-- WHAT IT REPLACED: browse.tsx searched dishes by listing every restaurant and
-- then calling the menu repository once per restaurant. In the Supabase adapter
-- each of those calls is FOUR round trips (sections, items, modifiers, modifier
-- options), and the effect was keyed on the raw `query` state rather than a
-- debounced value — so every keystroke past two characters cost roughly 1 + 4N
-- requests, about 81 at twenty merchants, and it hydrated modifier trees the
-- search results never render. A query that matched nothing (every intermediate
-- prefix while typing) scanned all of them.
--
-- WHY AN RPC RATHER THAN A POSTGREST FILTER: the obvious client-side fix is one
-- `.or('name.ilike.%q%,description.ilike.%q%')` call, but that builds PostgREST
-- filter SYNTAX out of user input. A comma or a closing paren in the search box
-- changes how the filter parses, and `%` / `_` silently widen the match. Here the
-- query is a bound parameter and the LIKE metacharacters are escaped below, so
-- neither is reachable.
--
-- SECURITY INVOKER (the default for a plain SQL function — deliberately NOT
-- security definer). RLS on menu_items and restaurants therefore applies to the
-- caller exactly as it does for the queries this replaces, so a restaurant the
-- caller cannot see stays invisible in search. The `r.is_active` predicate
-- mirrors what restaurantsRepo.list() applies, so search and browse agree on
-- what exists.

-- Trigram index. A contains-match (`ilike '%q%'`) cannot use a btree index, so
-- without this the single query below is a sequential scan over menu_items —
-- fine at twenty merchants, which is exactly the trap the N+1 was in. GIN
-- trigram is what makes the leading wildcard indexable.
create extension if not exists pg_trgm;

create index if not exists menu_items_name_trgm_idx
  on public.menu_items using gin (name gin_trgm_ops);
create index if not exists menu_items_description_trgm_idx
  on public.menu_items using gin (description gin_trgm_ops);

drop function if exists public.search_menu_items(text, int);
create or replace function public.search_menu_items(p_query text, p_limit int default 12)
returns table (
  item_id         uuid,
  item_name       text,
  item_image      text,
  price_egp       int,
  restaurant_id   uuid,
  restaurant_name text
)
language sql
stable
set search_path = public, pg_temp
as $$
  with q as (
    select
      -- Escape LIKE metacharacters so a '%' in the search box matches a literal
      -- percent instead of everything. Backslash first, or it would double-escape
      -- the escapes added after it.
      '%' || replace(replace(replace(btrim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%'
        as pattern,
      length(btrim(coalesce(p_query, ''))) as query_length
  )
  select mi.id, mi.name, mi.image, mi.price_egp, r.id, r.name
    from q
    join public.menu_items mi
      on mi.is_available
     and (mi.name ilike q.pattern or mi.description ilike q.pattern)
    join public.restaurants r
      on r.id = mi.restaurant_id
     and r.is_active
   -- Two characters is the app's own floor; enforcing it here too means a
   -- one-character query can never turn into a full-table trigram scan.
   where q.query_length >= 2
   order by
     -- Name matches rank above description-only matches, then alphabetical. A
     -- stable order matters: without it the list reshuffles between keystrokes.
     case when mi.name ilike q.pattern then 0 else 1 end,
     mi.name,
     mi.id
   limit greatest(1, least(coalesce(p_limit, 12), 50));
$$;

revoke all on function public.search_menu_items(text, int) from public;
grant execute on function public.search_menu_items(text, int) to authenticated, anon;

comment on function public.search_menu_items(text, int) is
  'Cross-restaurant dish search in one round trip. SECURITY INVOKER, so RLS decides visibility. Replaces an N+1 that cost ~1+4N requests per keystroke.';
