-- 149_driver_cod_ceiling.sql
--
-- Package 04 Slice E — driver COD exposure ceiling.
--
-- THE RISK. A driver's cash custody is visible (my_cash_balance) but nothing
-- stops it growing. Every COD delivery adds the full order total to what that
-- person is physically carrying, and the only thing that reduces it is a
-- hand-in. There is no ceiling, so exposure is bounded by how many orders
-- dispatch happens to send them — which is not a control, it is an accident.
--
-- On the current numbers this is small (2 ledger rows, 4 active drivers). That
-- is exactly why it should be built now: the limit can be chosen from real
-- hand-in behaviour before there is enough cash in circulation for a mistake to
-- matter.
--
-- OBSERVE FIRST. Ships in `observe` mode, as the spec requires: the check runs
-- and records what it WOULD have blocked, but blocks nothing. Choosing a
-- number before watching real behaviour would either strand drivers mid-shift
-- or set a ceiling so high it never fires.
--
-- BOTH ASSIGNMENT PATHS. There are two: assign_driver (dispatcher, raises) and
-- auto_assign_order (cron, swallows errors into a warning and returns null).
-- A ceiling enforced in only one is trivially bypassed by the other, so both
-- call the SAME function — and the auto path treats a block as "this driver is
-- not eligible, try the next one" rather than an error, which is what its
-- existing contract already means.
--
-- NEVER STRANDS AN ORDER IN PROGRESS. The ceiling gates NEW assignments only.
-- An order the driver has already accepted, picked up or is delivering is
-- untouched: refusing to let someone finish a delivery they are holding food
-- for would create the exact problem this is meant to prevent.

-- ---------------------------------------------------------------------------
-- 1. Settings. Deliberately conservative defaults, and observe mode, so
--    applying this migration changes NO behaviour until an operator opts in.
-- ---------------------------------------------------------------------------
insert into public.platform_settings (key, value) values
  ('driver_cod_soft_limit_egp', to_jsonb(3000)),
  ('driver_cod_hard_limit_egp', to_jsonb(5000)),
  ('driver_cod_limit_mode',     to_jsonb('observe'::text))
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Audited overrides. An override is a deliberate, expiring, attributable
--    act -- not a settings flip that outlives the reason for it.
-- ---------------------------------------------------------------------------
create table if not exists public.driver_cod_overrides (
  id          uuid primary key default gen_random_uuid(),
  driver_id   uuid not null references public.drivers(id) on delete cascade,
  granted_by  uuid not null references public.users(id),
  reason      text not null,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),
  constraint driver_cod_overrides_reason_chk check (length(btrim(reason)) >= 3)
);

create index if not exists driver_cod_overrides_active_idx
  on public.driver_cod_overrides (driver_id, expires_at desc);

-- House rule 5b: ALTER DEFAULT PRIVILEGES grants arwdDxtm to anon/authenticated
-- on every new table, and TRUNCATE ignores RLS. Revoke before granting.
revoke all on table public.driver_cod_overrides from public, anon, authenticated;
alter table public.driver_cod_overrides enable row level security;

-- A driver may see an override that applies to THEM (it explains why they can
-- keep working); nobody else reads it without going through admin RPCs.
grant select on table public.driver_cod_overrides to authenticated;

drop policy if exists driver_cod_overrides_own_select on public.driver_cod_overrides;
create policy driver_cod_overrides_own_select
  on public.driver_cod_overrides for select to authenticated
  using (exists (select 1 from public.drivers d
                  where d.id = driver_id and d.profile_id = auth.uid()));

comment on table public.driver_cod_overrides is
  'Time-boxed, attributed exemptions from the COD exposure ceiling (Package 04 Slice E). An override always EXPIRES -- a permanent one is just a higher limit with no audit trail. Written only by admin_grant_cod_override(). Mig 149.';

-- ---------------------------------------------------------------------------
-- 3. Observability. Records what the ceiling did (or would have done in
--    observe mode), which is the evidence the limit is later chosen from.
-- ---------------------------------------------------------------------------
create table if not exists public.driver_cod_limit_events (
  id            uuid primary key default gen_random_uuid(),
  driver_id     uuid not null references public.drivers(id) on delete cascade,
  order_id      uuid references public.orders(id) on delete set null,
  outcome       text not null,
  held_egp      int not null,
  prospective_egp int not null,
  soft_limit_egp  int not null,
  hard_limit_egp  int not null,
  mode          text not null,
  created_at    timestamptz not null default now(),
  constraint driver_cod_limit_events_outcome_chk
    check (outcome in ('allowed','warned','blocked','would_block','overridden'))
);

create index if not exists driver_cod_limit_events_driver_idx
  on public.driver_cod_limit_events (driver_id, created_at desc);

revoke all on table public.driver_cod_limit_events from public, anon, authenticated;
alter table public.driver_cod_limit_events enable row level security;
-- No client policy at all: this is operator telemetry, read via admin surfaces.

comment on table public.driver_cod_limit_events is
  'What the COD ceiling decided, per assignment attempt. ''would_block'' is the observe-mode record of a block that did NOT happen -- comparing those against real hand-in behaviour is how the limits get chosen from evidence instead of guessed. Mig 149.';

-- ---------------------------------------------------------------------------
-- 3b. Telemetry writer.
--
-- Exists as its own function for one reason, found by the assertion pack: a
-- plain INSERT inside assign_driver is ROLLED BACK when that function raises
-- COD_LIMIT_EXCEEDED, so the BLOCKED attempts -- exactly the events an operator
-- needs -- would be the only ones never recorded.
--
-- There is no dblink on this database, so a true autonomous transaction is not
-- available. The caller therefore logs and then RAISES LAST, and this function
-- is kept separate so that ordering requirement is explicit and testable rather
-- than an accident of statement order. It never throws: telemetry must not be
-- able to fail an assignment.
-- ---------------------------------------------------------------------------
create or replace function public.log_cod_limit_event(
  p_driver_id uuid, p_order_id uuid, p_outcome text,
  p_held int, p_prospective int, p_soft int, p_hard int, p_mode text
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  insert into public.driver_cod_limit_events
    (driver_id, order_id, outcome, held_egp, prospective_egp, soft_limit_egp, hard_limit_egp, mode)
  values (p_driver_id, p_order_id, p_outcome, p_held, p_prospective, p_soft, p_hard, p_mode);
exception when others then
  -- Never let telemetry break an assignment.
  raise warning 'log_cod_limit_event failed: % (%)', sqlerrm, sqlstate;
end;
$function$;

revoke all on function public.log_cod_limit_event(uuid, uuid, text, int, int, int, int, text) from public, anon, authenticated;
grant execute on function public.log_cod_limit_event(uuid, uuid, text, int, int, int, int, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. The shared check. ONE function, called by both assignment paths.
-- ---------------------------------------------------------------------------
create or replace function public.driver_cod_capacity(
  p_driver_id uuid,
  p_order_id  uuid default null
)
returns table (
  outcome        text,   -- allowed | warned | blocked | would_block | overridden
  held_egp       int,
  prospective_egp int,
  soft_limit_egp int,
  hard_limit_egp int,
  mode           text
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_held  int;
  v_amount int := 0;
  v_soft  int;
  v_hard  int;
  v_mode  text;
  v_override boolean;
begin
  select coalesce((value #>> '{}')::int, 3000) into v_soft
    from public.platform_settings where key = 'driver_cod_soft_limit_egp';
  select coalesce((value #>> '{}')::int, 5000) into v_hard
    from public.platform_settings where key = 'driver_cod_hard_limit_egp';
  select coalesce(value #>> '{}', 'observe') into v_mode
    from public.platform_settings where key = 'driver_cod_limit_mode';

  v_soft := coalesce(v_soft, 3000);
  v_hard := coalesce(v_hard, 5000);
  v_mode := coalesce(v_mode, 'observe');

  -- Cash custody from the IMMUTABLE ledger, never a cached column: the ledger
  -- is the accounting truth and a denormalised balance is one bug away from
  -- authorising work against money that was already handed in.
  select coalesce(sum(l.delta_egp), 0)::int into v_held
    from public.driver_cash_ledger l where l.driver_id = p_driver_id;

  -- Only a COD order adds exposure. A card order (or none) is weightless here,
  -- so non-COD work stays eligible no matter how much cash is held.
  if p_order_id is not null then
    select coalesce(o.total_egp, 0) into v_amount
      from public.orders o
     where o.id = p_order_id and o.payment_method = 'cash_on_delivery';
    v_amount := coalesce(v_amount, 0);
  end if;

  select exists (
    select 1 from public.driver_cod_overrides ov
     where ov.driver_id = p_driver_id and ov.expires_at > now()
  ) into v_override;

  outcome := case
    when v_amount = 0 then 'allowed'                       -- not a COD order
    when v_override then 'overridden'
    when v_held + v_amount > v_hard then
      case when v_mode = 'enforce' then 'blocked' else 'would_block' end
    when v_held + v_amount > v_soft then 'warned'
    else 'allowed'
  end;

  held_egp := v_held;
  prospective_egp := v_amount;
  soft_limit_egp := v_soft;
  hard_limit_egp := v_hard;
  mode := v_mode;
  return next;
end;
$function$;

revoke all on function public.driver_cod_capacity(uuid, uuid) from public, anon, authenticated;
grant execute on function public.driver_cod_capacity(uuid, uuid) to service_role;

comment on function public.driver_cod_capacity(uuid, uuid) is
  'Shared COD exposure decision for BOTH assignment paths (Package 04 Slice E). Custody is summed from the immutable driver_cash_ledger, never a cached column. Returns ''allowed'' for a non-COD order regardless of cash held, so non-COD work is never blocked. ''would_block'' is observe mode recording what enforce mode WOULD have refused. Not granted to clients: another driver''s cash position is not a client''s business. Mig 149.';


-- ---------------------------------------------------------------------------
-- 5. A driver's own view of their limit, for the driver app.
-- ---------------------------------------------------------------------------
create or replace function public.my_cod_capacity()
returns table (
  held_egp int, soft_limit_egp int, hard_limit_egp int, mode text, over_soft boolean, over_hard boolean
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_driver uuid;
begin
  select d.id into v_driver from public.drivers d where d.profile_id = auth.uid();
  if v_driver is null then
    raise exception 'NOT_A_DRIVER' using errcode = 'check_violation';
  end if;

  select c.held_egp, c.soft_limit_egp, c.hard_limit_egp, c.mode,
         c.held_egp > c.soft_limit_egp, c.held_egp > c.hard_limit_egp
    into held_egp, soft_limit_egp, hard_limit_egp, mode, over_soft, over_hard
    from public.driver_cod_capacity(v_driver, null) c;
  return next;
end;
$function$;

revoke all on function public.my_cod_capacity() from public, anon;
grant execute on function public.my_cod_capacity() to authenticated;

comment on function public.my_cod_capacity() is
  'The calling driver''s own cash custody and limits, for the driver app. Owner-bound: resolves the driver from auth.uid(), so it cannot report anyone else. Mig 149.';


-- ---------------------------------------------------------------------------
-- 6. Admin override grant.
-- ---------------------------------------------------------------------------
create or replace function public.admin_grant_cod_override(
  p_driver_id uuid,
  p_reason text,
  p_hours int default 12
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;
  if coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'REASON_REQUIRED' using errcode = 'check_violation';
  end if;
  -- Bounded: an override that outlives the shift it was granted for is a
  -- silently raised limit. 72h is already generous.
  if p_hours is null or p_hours < 1 or p_hours > 72 then
    raise exception 'INVALID_DURATION' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.drivers where id = p_driver_id) then
    raise exception 'DRIVER_NOT_FOUND' using errcode = 'check_violation';
  end if;

  insert into public.driver_cod_overrides (driver_id, granted_by, reason, expires_at)
  values (p_driver_id, auth.uid(), btrim(p_reason), now() + make_interval(hours => p_hours))
  returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function public.admin_grant_cod_override(uuid, text, int) from public, anon;
grant execute on function public.admin_grant_cod_override(uuid, text, int) to authenticated;

comment on function public.admin_grant_cod_override(uuid, text, int) is
  'Grant a driver a time-boxed exemption from the COD ceiling (Package 04 Slice E). Admin-only, fails closed, requires a reason and expires within 72 hours -- an override that outlives its shift is a silently raised limit with no audit trail. Mig 149.';
