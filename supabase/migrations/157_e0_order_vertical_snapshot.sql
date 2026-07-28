-- 157_e0_order_vertical_snapshot.sql
--
-- Package 07 Program A0 (session E0) — finding #7, database half: the immutable
-- order vertical snapshot and its reporting dimension.
--
-- WHY A SNAPSHOT AND NOT A JOIN. Today "which vertical was this order?" is only
-- answerable by joining orders -> restaurants -> vertical_id, which reads the
-- merchant's vertical AS IT IS NOW. A merchant can be reassigned (the spec has
-- an explicit admin reassignment flow), and a vertical can be renamed or
-- retired. Either rewrites the apparent history of every past order: last
-- quarter's food GMV silently becomes grocery GMV.
--
-- Every other money-adjacent fact on an order is already snapshotted for this
-- exact reason -- commission_pct_snapshot (mig 135), address_snapshot,
-- items, payment_label. The vertical is the dimension that settlement,
-- reporting and support all slice by, and it was the one still live-joined.
--
-- IMMUTABLE. Stamped once at insert by a trigger and then frozen: a later
-- UPDATE cannot change it, so reassigning a merchant cannot retroactively move
-- historical orders between verticals.

alter table public.orders
  add column if not exists vertical_id text;

-- Backfill from the merchant's CURRENT vertical. This is exact today: all 43
-- merchants are 'food' and no merchant has ever been reassigned (there is no
-- reassignment RPC yet), so the current value IS the historical one. That will
-- stop being true the moment reassignment ships, which is precisely why the
-- snapshot must exist before it does.
--
-- THE BACKFILL IS A WRITE TO EVERY HISTORICAL ORDER, and `orders` is not an
-- ordinary table. Verified against production:
--   * it IS in the supabase_realtime publication, so each updated row is
--     published to every subscribed client; and
--   * it carries 13 triggers, 9 of which fire on UPDATE -- including
--     orders_touch_updated_at, which would rewrite updated_at on every order
--     ever placed and destroy the "when did this order last actually change"
--     signal that ops and dispute handling read.
--
-- The money paths are inert here (orders_accrue_loyalty, orders_reward_referrer
-- and orders_snapshot_financials all open with
--     if new.status <> 'delivered' or old.status = 'delivered' then return new;
-- so a vertical-only UPDATE returns immediately) -- but "inert today" is not a
-- property to depend on, and updated_at plus the Realtime burst are real
-- regardless.
--
-- session_replication_role = 'replica' makes ordinary triggers not fire for this
-- session, so updated_at keeps its true value. Realtime reads the WAL and is not
-- suppressed by that, so the burst is bounded instead: this is a ONE-TIME write
-- of rows that genuinely have no value yet (23 orders today), inside the same
-- transaction as the DDL, and it never re-runs -- the `is null` predicate makes
-- every later replay match zero rows.
do $$
declare v_n int; v_orphan int;
begin
  set local session_replication_role = 'replica';

  update public.orders o
     set vertical_id = r.vertical_id
    from public.restaurants r
   where r.id = o.restaurant_id and o.vertical_id is null;
  get diagnostics v_n = row_count;

  -- Any order whose merchant row is gone: default to food rather than NULL, so
  -- reporting has no unclassifiable bucket. All existing orders predate any
  -- non-food vertical, so this is factually correct rather than a guess.
  update public.orders set vertical_id = 'food' where vertical_id is null;
  get diagnostics v_orphan = row_count;

  set local session_replication_role = 'origin';

  raise notice 'mig157: backfilled % order(s) (+% orphaned) with updated_at preserved', v_n, v_orphan;
end $$;

alter table public.orders alter column vertical_id set default 'food';

-- ---------------------------------------------------------------------------
-- Stamp at insert, freeze thereafter.
-- ---------------------------------------------------------------------------
create or replace function public.stamp_order_vertical()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if tg_op = 'INSERT' then
    -- Always derive from the merchant; never trust a client-supplied value.
    -- (INSERT is revoked from client roles by mig 155, but a definer writer
    --  could still pass one, and the snapshot must be the server's answer.)
    select coalesce(r.vertical_id, 'food') into new.vertical_id
      from public.restaurants r where r.id = new.restaurant_id;
    new.vertical_id := coalesce(new.vertical_id, 'food');
    return new;
  end if;

  -- UPDATE: freeze. Reassigning a merchant must not rewrite the vertical of
  -- orders already placed -- that is the whole point of a snapshot.
  if new.vertical_id is distinct from old.vertical_id then
    raise exception 'ORDER_VERTICAL_IS_IMMUTABLE'
      using errcode = 'check_violation',
            hint = 'The vertical is snapshotted at placement and cannot be changed.';
  end if;
  return new;
end;
$function$;

drop trigger if exists orders_stamp_vertical on public.orders;
create trigger orders_stamp_vertical
  before insert or update of vertical_id on public.orders
  for each row execute function public.stamp_order_vertical();

comment on column public.orders.vertical_id is
  'The commerce vertical this order was placed in, SNAPSHOTTED at placement (mig 157). Not a live join to restaurants.vertical_id: reassigning a merchant, or renaming/retiring a vertical, would otherwise rewrite the apparent history of every past order and move settled GMV between verticals. Stamped by trigger from the merchant at INSERT, then immutable -- an UPDATE that changes it raises ORDER_VERTICAL_IS_IMMUTABLE. Backfilled exactly: all 43 merchants are food and none has ever been reassigned.';

-- ---------------------------------------------------------------------------
-- Reporting dimension. Read-only, admin-scoped, counts and money only.
-- ---------------------------------------------------------------------------
create or replace function public.vertical_order_dimensions(
  p_from timestamptz default now() - interval '30 days',
  p_to   timestamptz default now()
)
returns table (
  vertical_id text, order_count bigint, delivered_count bigint,
  gross_egp bigint, commission_egp bigint
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select
    o.vertical_id,
    count(*)::bigint,
    count(*) filter (where o.status = 'delivered')::bigint,
    coalesce(sum(o.total_egp) filter (where o.status = 'delivered'), 0)::bigint,
    coalesce(sum(f.commission_egp), 0)::bigint
  from public.orders o
  left join public.order_financials f on f.order_id = o.id
  where o.placed_at >= p_from and o.placed_at < p_to
    -- Admin only, checked INSIDE the function: this is definer, so it would
    -- otherwise report every merchant's revenue to any caller.
    and coalesce(public.auth_role()::text, '') = 'admin'
  group by o.vertical_id
  order by o.vertical_id;
$function$;

revoke all on function public.vertical_order_dimensions(timestamptz, timestamptz) from public, anon;
grant execute on function public.vertical_order_dimensions(timestamptz, timestamptz) to authenticated;

comment on function public.vertical_order_dimensions(timestamptz, timestamptz) is
  'Per-vertical order/GMV/commission dimension for admin reporting (Package 07 A0). Slices on the SNAPSHOTTED orders.vertical_id, so historical figures do not move when a merchant is reassigned. Admin-gated inside the body because it is SECURITY DEFINER; returns aggregates only -- no merchant, customer or catalog detail.';
