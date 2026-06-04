-- 008_fleet.sql
-- The fleet: drivers, live status/location, assignments, earnings.
--
-- Design choice: KEEP the existing `riders` table (orders.rider JSONB snapshots
-- reference its shape and must not break) and ADD a richer operational `drivers`
-- table for live fleet management (availability, GPS, dispatch). They reconcile
-- via drivers.legacy_rider_id. `drivers` is the source of truth for dispatch.
--
-- Manual dispatch now (admin assigns via order_assignments); the same model is
-- auto-ready: nearest_drivers (mig 011) reads drivers.current_geo.
--
-- Non-destructive: new tables + new columns on orders.

-- ============================================================================
-- DRIVERS (operational fleet record)
-- ============================================================================
create table if not exists public.drivers (
  id               uuid primary key default gen_random_uuid(),
  profile_id       uuid unique references public.users(id) on delete set null,
  legacy_rider_id  uuid references public.riders(id) on delete set null,
  name             text not null,
  photo            text not null default '',
  phone            text not null default '',
  vehicle          vehicle_type not null default 'scooter',
  plate            text not null default '',
  status           text not null default 'offline',          -- 'offline' | 'online' | 'on_job'
  is_verified      boolean not null default false,
  is_active        boolean not null default true,
  rating           numeric(2,1) not null default 5.0 check (rating >= 0 and rating <= 5),
  current_geo      geography(Point, 4326),                    -- last known position (hot column)
  last_ping_at     timestamptz,
  home_zone        zone_type references public.zones(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint drivers_status_chk check (status in ('offline','online','on_job'))
);

create index if not exists drivers_status_idx on public.drivers (status) where status <> 'offline';
create index if not exists drivers_geo_gix on public.drivers using gist (current_geo);
create index if not exists drivers_home_zone_idx on public.drivers (home_zone);

create trigger drivers_touch_updated_at before update on public.drivers
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- ORDER ASSIGNMENTS (the dispatch record; manual now, auto later)
-- ============================================================================
create table if not exists public.order_assignments (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.orders(id) on delete cascade,
  driver_id      uuid not null references public.drivers(id) on delete cascade,
  status         text not null default 'offered',            -- offered|accepted|rejected|completed|reassigned
  assigned_by    text not null default 'dispatcher',         -- 'dispatcher' | 'auto' | 'self_accept'
  assigned_by_id uuid references public.users(id) on delete set null,
  assigned_at    timestamptz not null default now(),
  responded_at   timestamptz,
  constraint order_assignments_status_chk
    check (status in ('offered','accepted','rejected','completed','reassigned')),
  constraint order_assignments_assigned_by_chk
    check (assigned_by in ('dispatcher','auto','self_accept'))
);

create index if not exists order_assignments_order_idx on public.order_assignments (order_id);
create index if not exists order_assignments_driver_idx on public.order_assignments (driver_id, status);
-- At most one ACTIVE (offered/accepted) assignment per order.
create unique index if not exists order_assignments_one_active_per_order
  on public.order_assignments (order_id)
  where status in ('offered','accepted');

-- ============================================================================
-- DRIVER EARNINGS (one row per completed delivery; feeds COD reconciliation)
-- ============================================================================
create table if not exists public.driver_earnings (
  id                  uuid primary key default gen_random_uuid(),
  driver_id           uuid not null references public.drivers(id) on delete restrict,
  order_id            uuid not null references public.orders(id) on delete restrict,
  delivery_fee_share  int not null default 0,    -- EGP the driver earns from the delivery fee
  tip                 int not null default 0,
  bonus               int not null default 0,
  cod_collected       int not null default 0,    -- cash the driver took from the customer (owed to platform)
  total               int not null default 0,    -- delivery_fee_share + tip + bonus
  payout_batch_id     uuid,                       -- nullable; weekly settlement grouping (later)
  created_at          timestamptz not null default now(),
  unique (order_id)
);

create index if not exists driver_earnings_driver_idx on public.driver_earnings (driver_id, created_at desc);

-- ============================================================================
-- ORDERS: dispatch fields
-- ============================================================================
alter table public.orders
  add column if not exists assigned_driver_id uuid references public.drivers(id) on delete set null,
  add column if not exists dispatch_mode      text;  -- 'manual' | 'auto' (how it was/should be dispatched)

create index if not exists orders_assigned_driver_idx on public.orders (assigned_driver_id)
  where assigned_driver_id is not null;

alter table public.drivers       enable row level security;
alter table public.order_assignments enable row level security;
alter table public.driver_earnings   enable row level security;

comment on table public.drivers is
  'Operational fleet record (live status, GPS, dispatch). Source of truth for dispatch. orders.rider keeps a JSONB snapshot for the customer card; legacy_rider_id reconciles to the old riders table.';
comment on column public.drivers.current_geo is
  'Last known driver position (WGS84). Updated by a throttled RPC (~20-30s) so nearest_drivers + the admin board stay fresh WITHOUT per-GPS-ping writes (live tracking uses Realtime Broadcast instead).';
comment on table public.order_assignments is
  'Dispatch record. Manual: a dispatcher creates an ''offered'' row (assign_driver). Driver accepts/rejects (driver_respond). Auto later: assigned_by=''auto''.';
comment on column public.driver_earnings.cod_collected is
  'Cash the driver collected on a COD order — owed back to the platform. Admin reconciliation nets (cod_collected - earnings) per driver.';
