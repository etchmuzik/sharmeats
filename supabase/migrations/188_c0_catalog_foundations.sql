-- 188_c0_catalog_foundations.sql
--
-- Package 07 Program C0 prerequisites — the catalog foundations the fixed-pack
-- grocery pilot needs, buildable now without any pilot claim (recon 2026-07-30:
-- none existed):
--   1. merchant-scoped SKU/barcode uniqueness (the C1 contract, safe today:
--      zero duplicates in prod, 20 items already carry SKUs);
--   2. menu_item_availability_events — the append-only 86-audit the C0 spec
--      details, capturing EVERY change including raw Data API writes;
--   3. server-side paginated catalog search, replacing client-side filtering
--      of the full menu download.

-- ============ 1. Merchant-scoped identity ============
-- Same barcode may exist at DIFFERENT merchants (the spec's rule); duplicates
-- inside one merchant fail import.
create unique index if not exists menu_items_restaurant_sku_uniq
  on public.menu_items (restaurant_id, sku) where sku is not null;
create unique index if not exists menu_items_restaurant_barcode_uniq
  on public.menu_items (restaurant_id, barcode) where barcode is not null;

-- ============ 2. Availability audit ============
create table if not exists public.menu_item_availability_events (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null,
  menu_item_id       uuid not null references public.menu_items(id) on delete cascade,
  previous_available boolean,
  new_available      boolean not null,
  -- Derived from the transaction, never trusted from a client payload.
  actor_user_id      uuid,
  source             text not null default 'data_api'
                       check (source in ('merchant_app','restaurant_app','admin','import','system','data_api')),
  reason_code        text check (length(reason_code) <= 40),
  idempotency_key    text check (length(idempotency_key) <= 80),
  changed_at         timestamptz not null default clock_timestamp()
);

create unique index if not exists menu_item_availability_events_idem_uniq
  on public.menu_item_availability_events (menu_item_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists menu_item_availability_events_item_idx
  on public.menu_item_availability_events (menu_item_id, changed_at desc);

alter table public.menu_item_availability_events enable row level security;
revoke all on table public.menu_item_availability_events from public, anon, authenticated;
grant select, insert on table public.menu_item_availability_events to service_role;

-- Merchant staff and admin may READ their own audit trail; nobody client-side
-- writes it — the trigger does.
grant select on table public.menu_item_availability_events to authenticated;
create policy menu_item_availability_events_read on public.menu_item_availability_events
  for select using (
    coalesce(public.auth_role()::text, '') = 'admin'
    or public.is_merchant_staff(restaurant_id)
  );

comment on table public.menu_item_availability_events is
  'Append-only 86 audit (Package 07 C0): every menu_item.is_available change, INCLUDING raw Data API writes, recorded by trigger with server-derived actor/time. App RPCs may declare an allow-listed source + idempotency key via private transaction context; a raw PostgREST update gets source=data_api and no key. No-op changes emit nothing. Mig 188.';

create or replace function public.menu_item_availability_audit()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_source text;
  v_idem   text;
begin
  -- A no-op availability update emits no event (the spec's rule).
  if new.is_available is not distinct from old.is_available then
    return new;
  end if;
  -- Allow-listed source via transaction-local context, settable only by definer
  -- RPCs that run before their UPDATE. Junk degrades to data_api.
  v_source := nullif(current_setting('sharmeats.availability_source', true), '');
  if v_source is null or v_source not in
     ('merchant_app','restaurant_app','admin','import','system') then
    v_source := 'data_api';
  end if;
  -- The idempotency key is honored ONLY with an allow-listed source: the spec
  -- says a raw Data API write gets no client key. Without this, a stale key
  -- left in the transaction context by an earlier RPC call silently suppressed
  -- a later unrelated event via the dedup index (caught by the dry run).
  v_idem := case when v_source = 'data_api' then null
                 else nullif(left(current_setting('sharmeats.availability_idem', true), 80), '') end;

  insert into public.menu_item_availability_events
    (restaurant_id, menu_item_id, previous_available, new_available,
     actor_user_id, source, reason_code, idempotency_key)
  values
    (new.restaurant_id, new.id, old.is_available, new.is_available,
     auth.uid(), v_source,
     nullif(left(current_setting('sharmeats.availability_reason', true), 40), ''),
     v_idem)
  on conflict (menu_item_id, idempotency_key) where idempotency_key is not null
  do nothing;
  return new;
end;
$$;
revoke all on function public.menu_item_availability_audit() from public, anon, authenticated;

drop trigger if exists menu_items_availability_audit on public.menu_items;
create trigger menu_items_availability_audit
  after update of is_available on public.menu_items
  for each row execute function public.menu_item_availability_audit();

-- Append-only: no UPDATE/DELETE policy exists, no client write grant exists,
-- and even service-plane deletes are refused by trigger.
create or replace function public.availability_events_immutable()
returns trigger
language plpgsql as $$
begin
  raise exception 'AVAILABILITY_AUDIT_IMMUTABLE' using errcode = 'check_violation';
end;
$$;
revoke all on function public.availability_events_immutable() from public, anon, authenticated;
drop trigger if exists menu_item_availability_events_immutable on public.menu_item_availability_events;
create trigger menu_item_availability_events_immutable
  before update or delete on public.menu_item_availability_events
  for each row execute function public.availability_events_immutable();

-- ============ 3. Server-side catalog search ============
-- SECURITY INVOKER on purpose: the mig-153 RLS policies on menu_items and
-- restaurants ARE the visibility authority (vertical gate included), so the
-- search cannot leak what a direct read could not. Keyset pagination — an
-- offset walks progressively more dead rows and repeats under insertion.
create or replace function public.search_catalog(
  p_query text,
  p_vertical text default null,
  p_restaurant_id uuid default null,
  p_limit int default 30,
  p_after_name text default null,
  p_after_id uuid default null
)
returns table (
  item_id       uuid,
  restaurant_id uuid,
  name          text,
  price_egp     int,
  is_available  boolean,
  sku           text,
  unit          text,
  vertical_id   text
)
language sql
stable
as $$
  select m.id, m.restaurant_id, m.name, m.price_egp, m.is_available,
         m.sku, m.unit, r.vertical_id
    from public.menu_items m
    join public.restaurants r on r.id = m.restaurant_id
   where (p_query is null or length(btrim(p_query)) < 2
          or m.name ilike '%' || btrim(p_query) || '%')
     and (p_vertical is null or r.vertical_id = p_vertical)
     and (p_restaurant_id is null or m.restaurant_id = p_restaurant_id)
     and (p_after_name is null
          or (m.name, m.id) > (p_after_name, coalesce(p_after_id, '00000000-0000-0000-0000-000000000000'::uuid)))
   order by m.name, m.id
   limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;

revoke all on function public.search_catalog(text, text, uuid, int, text, uuid) from public;
grant execute on function public.search_catalog(text, text, uuid, int, text, uuid)
  to anon, authenticated;

comment on function public.search_catalog(text, text, uuid, int, text, uuid) is
  'Server-side paginated catalog search (Package 07 C0). SECURITY INVOKER: mig-153 RLS (including the vertical launch gate) is the visibility authority, so this cannot return what a direct read could not. Keyset pagination on (name,id); limit clamped 1..100. Replaces client-side filtering of full menu downloads. Mig 188.';

create index if not exists menu_items_name_keyset_idx
  on public.menu_items (name, id);
