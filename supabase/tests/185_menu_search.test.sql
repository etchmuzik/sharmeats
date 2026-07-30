\set ON_ERROR_STOP on

-- Transaction-wrapped so nothing persists (migration house rule 6).
begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end;
$$;

-- Faithful enough for this function: the columns it reads, with the same types.
create table public.restaurants (
  id        uuid primary key,
  name      text not null,
  is_active boolean not null default true
);

create table public.menu_items (
  id            uuid primary key,
  restaurant_id uuid not null references public.restaurants(id),
  name          text not null,
  description   text not null default '',
  price_egp     int  not null default 0,
  image         text not null default '',
  is_available  boolean not null default true
);

\ir ../migrations/185_menu_search.sql

insert into public.restaurants (id, name, is_active) values
  ('60000000-0000-0000-0000-000000000001', 'Koshary House', true),
  ('60000000-0000-0000-0000-000000000002', 'Closed Kitchen', false);

insert into public.menu_items (id, restaurant_id, name, description, price_egp, is_available) values
  -- name match
  ('61000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001',
   'Koshary', 'Lentils, rice and pasta', 45, true),
  -- description-only match, must rank BELOW the name match
  ('61000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000001',
   'Side salad', 'Served with koshary', 20, true),
  -- unavailable: must never surface
  ('61000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-000000000001',
   'Koshary XL', 'Sold out', 70, false),
  -- belongs to an inactive restaurant: must never surface
  ('61000000-0000-0000-0000-000000000004', '60000000-0000-0000-0000-000000000002',
   'Koshary Deluxe', 'From a closed kitchen', 90, true),
  -- rows used by the metacharacter tests
  ('61000000-0000-0000-0000-000000000005', '60000000-0000-0000-0000-000000000001',
   '100% Beef Burger', 'All beef', 120, true),
  ('61000000-0000-0000-0000-000000000006', '60000000-0000-0000-0000-000000000001',
   'Chicken_Wrap', 'Underscore in the name', 60, true);

do $$
declare
  v_names text[];
  v_n     int;
begin
  -- Availability + active-restaurant filtering, and name-before-description order.
  select array_agg(item_name order by ord) into v_names
    from (
      select item_name, row_number() over () as ord
        from public.search_menu_items('koshary', 12)
    ) s;
  if v_names is distinct from array['Koshary', 'Side salad'] then
    raise exception 'expected [Koshary, Side salad], got %', coalesce(v_names::text, 'null');
  end if;

  -- Case-insensitive.
  select count(*) into v_n from public.search_menu_items('KOSHARY', 12);
  if v_n <> 2 then raise exception 'search should be case-insensitive, got %', v_n; end if;

  -- The two-character floor: a single character returns nothing rather than
  -- trigram-scanning the whole table.
  select count(*) into v_n from public.search_menu_items('k', 12);
  if v_n <> 0 then raise exception 'a 1-char query must return nothing, got %', v_n; end if;
  select count(*) into v_n from public.search_menu_items('', 12);
  if v_n <> 0 then raise exception 'an empty query must return nothing, got %', v_n; end if;
  select count(*) into v_n from public.search_menu_items(null, 12);
  if v_n <> 0 then raise exception 'a null query must return nothing, got %', v_n; end if;
  -- Whitespace-only, and padding must not defeat the floor either way.
  select count(*) into v_n from public.search_menu_items('   ', 12);
  if v_n <> 0 then raise exception 'a whitespace query must return nothing, got %', v_n; end if;
  select count(*) into v_n from public.search_menu_items('  koshary  ', 12);
  if v_n <> 2 then raise exception 'a padded query should still match, got %', v_n; end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- LIKE metacharacters are escaped, not honoured. This is the behaviour that
-- makes a bound parameter safer than a hand-built PostgREST filter: '%' must
-- match a literal percent sign rather than every row in the table.
-- ---------------------------------------------------------------------------
do $$
declare
  v_names text[];
  v_n     int;
begin
  select array_agg(item_name) into v_names from public.search_menu_items('100%', 12);
  if v_names is distinct from array['100% Beef Burger'] then
    raise exception '%% should match a literal percent, got %', coalesce(v_names::text, 'null');
  end if;

  -- Escaped, '%%' searches for a LITERAL double percent, which nothing contains.
  -- Unescaped it would be two wildcards and match every available row in the
  -- active restaurant (5 of them), so zero here is the proof it was escaped.
  select count(*) into v_n from public.search_menu_items('%%', 12);
  if v_n <> 0 then
    raise exception 'a double percent leaked as a wildcard (got % rows)', v_n;
  end if;

  -- '_' is the single-character wildcard; escaped, it matches only the literal.
  select array_agg(item_name) into v_names from public.search_menu_items('n_W', 12);
  if v_names is distinct from array['Chicken_Wrap'] then
    raise exception '_ should match a literal underscore, got %', coalesce(v_names::text, 'null');
  end if;

  -- Unescaped, 'n_W' as a wildcard would also match "n" + any char + "W"; there
  -- is no such other row here, so also prove the wildcard form finds nothing
  -- extra when the literal is absent.
  select count(*) into v_n from public.search_menu_items('e_W', 12);
  if v_n <> 0 then
    raise exception '_ leaked as a wildcard (got % rows)', v_n;
  end if;

  -- A trailing backslash is the classic way to produce "invalid escape sequence"
  -- from LIKE. Two characters so it clears the length floor and actually reaches
  -- the pattern; the assertion is that it returns cleanly rather than raising.
  select count(*) into v_n from public.search_menu_items('a\', 12);
  if v_n <> 0 then
    raise exception 'a trailing backslash matched unexpectedly, got %', v_n;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Limit is clamped, so a client cannot ask for the whole catalogue.
-- ---------------------------------------------------------------------------
do $$
declare
  v_n int;
begin
  select count(*) into v_n from public.search_menu_items('koshary', 1);
  if v_n <> 1 then raise exception 'limit 1 should return 1 row, got %', v_n; end if;

  select count(*) into v_n from public.search_menu_items('koshary', 0);
  if v_n <> 1 then raise exception 'limit 0 should clamp up to 1, got %', v_n; end if;

  select count(*) into v_n from public.search_menu_items('koshary', -5);
  if v_n <> 1 then raise exception 'a negative limit should clamp up to 1, got %', v_n; end if;

  select count(*) into v_n from public.search_menu_items('koshary', null);
  if v_n <> 2 then raise exception 'a null limit should use the default, got %', v_n; end if;

  -- 10000 is clamped to 50; only 2 rows match, so this asserts it does not error
  -- and does not somehow return more than exists.
  select count(*) into v_n from public.search_menu_items('koshary', 10000);
  if v_n <> 2 then raise exception 'an oversized limit should clamp, got %', v_n; end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants and the trigram indexes the single query depends on.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.role_routine_grants
     where routine_schema = 'public' and routine_name = 'search_menu_items'
       and grantee = 'anon' and privilege_type = 'EXECUTE'
  ) then
    raise exception 'anon must be able to search (browse works for guests)';
  end if;

  if not exists (
    select 1 from information_schema.role_routine_grants
     where routine_schema = 'public' and routine_name = 'search_menu_items'
       and grantee = 'authenticated' and privilege_type = 'EXECUTE'
  ) then
    raise exception 'authenticated must be able to search';
  end if;

  -- SECURITY INVOKER, so RLS keeps deciding visibility. A definer here would
  -- silently bypass the row policies this function relies on.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'search_menu_items' and p.prosecdef
  ) then
    raise exception 'search_menu_items must NOT be security definer';
  end if;

  -- House rule 1: exactly one overload, or PostgREST answers PGRST202.
  if (
    select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'search_menu_items'
  ) <> 1 then
    raise exception 'search_menu_items must have exactly one overload';
  end if;

  if not exists (select 1 from pg_indexes where indexname = 'menu_items_name_trgm_idx')
     or not exists (select 1 from pg_indexes where indexname = 'menu_items_description_trgm_idx')
  then
    raise exception 'trigram indexes are missing — the contains-match would seq-scan';
  end if;
end;
$$;

rollback;

\echo '185_menu_search.test.sql: PASS'
