-- 104 — driver COD cash reconciliation (P0 #3 from the 2026-07-11 gap analysis).
--
-- PROBLEM: mark_cod_collected stamps cod_collected per order and the driver home
-- shows a client-summed "COD owed" that ONLY EVER GROWS. There is no cash-in flow,
-- no per-driver cash-on-hand ledger that decrements on hand-in, and no shift
-- close-out. Since COD is the launch payment method, essentially ALL cash flows
-- through drivers with zero custody controls — the #1 operational/theft risk.
--
-- DESIGN: a double-entry-ish cash ledger per driver.
--   +delta on COD collection  (driver now holds this cash — a liability to the platform)
--   −delta on hand-in         (driver deposited cash to ops/bank)
--   −delta on adjustment/write-off (admin correction, e.g. short/over)
-- driver_cash_balance = sum(delta) = cash the driver currently holds and owes.
-- The COD collection credit is wired into mark_cod_collected (recreated below,
-- body preserved verbatim + one ledger insert). Hand-ins/adjustments are recorded
-- by admin/dispatcher via record_cash_handin. Everything is idempotent by source ref.
-- Non-destructive: new table + view + RPCs + RLS.

-- ============================================================================
-- driver_cash_ledger — every cash movement for a driver.
-- ============================================================================
create table if not exists public.driver_cash_ledger (
  id            uuid primary key default gen_random_uuid(),
  driver_id     uuid not null references public.drivers(id) on delete cascade,
  delta_egp     int  not null,                              -- +collected, −handed_in/−adjust
  reason        text not null check (reason in ('cod_collected','hand_in','adjustment','write_off')),
  ref_order_id  uuid references public.orders(id) on delete set null,   -- set for cod_collected
  note          text,
  actor_id      uuid,                                       -- who recorded it (auth.uid())
  created_at    timestamptz not null default now()
);
create index if not exists driver_cash_ledger_driver_idx
  on public.driver_cash_ledger (driver_id, created_at desc);
-- One collection row per order (idempotency for the mark_cod_collected credit).
create unique index if not exists driver_cash_ledger_one_collection_per_order
  on public.driver_cash_ledger (ref_order_id) where reason = 'cod_collected';

comment on table public.driver_cash_ledger is
  'Per-driver cash custody ledger. +cod_collected when a driver takes COD cash, −hand_in on deposit, ±adjustment/write_off by admin. Sum(delta) = cash the driver currently holds and owes the platform.';

alter table public.driver_cash_ledger enable row level security;
-- Driver reads their own rows; admin/dispatcher read all. No client writes (RPC only).
create policy driver_cash_ledger_select on public.driver_cash_ledger
  for select using (
    (select public.auth_role()) = any (array['admin'::app_role,'dispatcher'::app_role])
    or exists (select 1 from public.drivers d
                where d.id = driver_cash_ledger.driver_id and d.profile_id = (select auth.uid()))
  );

-- ============================================================================
-- driver_cash_balance — current cash-on-hand per driver (owed to platform).
-- ============================================================================
create or replace view public.driver_cash_balance
with (security_invoker = true) as
  select
    d.id                                   as driver_id,
    d.name                                 as driver_name,
    coalesce(sum(l.delta_egp), 0)::int     as balance_egp,          -- cash currently held
    coalesce(sum(l.delta_egp) filter (where l.reason='cod_collected'), 0)::int as lifetime_collected_egp,
    coalesce(-sum(l.delta_egp) filter (where l.reason in ('hand_in','write_off')), 0)::int as lifetime_handed_in_egp,
    max(l.created_at) filter (where l.reason='hand_in')             as last_handin_at
  from public.drivers d
  left join public.driver_cash_ledger l on l.driver_id = d.id
  group by d.id, d.name;

comment on view public.driver_cash_balance is
  'Per-driver cash-on-hand (sum of ledger deltas). security_invoker=true so the driver_cash_ledger RLS above governs visibility: drivers see only their own row, admin/dispatcher see all.';

grant select on public.driver_cash_balance to authenticated;

-- ============================================================================
-- record_cash_handin — ADMIN/DISPATCHER records a driver depositing cash.
-- Records a −delta hand_in (or ±adjustment / −write_off) against the driver's
-- balance. Returns the driver's new balance.
-- ============================================================================
create or replace function public.record_cash_handin(
  p_driver_id uuid,
  p_amount_egp int,
  p_reason text default 'hand_in',
  p_note text default null
)
returns int
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_actor uuid := auth.uid();
  v_balance int;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;
  if (select public.auth_role()) not in ('admin','dispatcher') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  if p_reason not in ('hand_in','adjustment','write_off') then
    raise exception 'INVALID_REASON' using errcode = 'check_violation';
  end if;
  if p_amount_egp is null or p_amount_egp = 0 then
    raise exception 'INVALID_AMOUNT' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.drivers where id = p_driver_id) then
    raise exception 'DRIVER_NOT_FOUND' using errcode = 'check_violation';
  end if;

  -- hand_in and write_off DECREASE the driver's held cash (store as negative);
  -- adjustment is signed as passed (admin can correct up or down).
  insert into public.driver_cash_ledger (driver_id, delta_egp, reason, note, actor_id)
  values (
    p_driver_id,
    case when p_reason = 'adjustment' then p_amount_egp else -abs(p_amount_egp) end,
    p_reason, nullif(btrim(coalesce(p_note,'')), ''), v_actor
  );

  select coalesce(sum(delta_egp),0)::int into v_balance
    from public.driver_cash_ledger where driver_id = p_driver_id;
  return v_balance;
end;
$function$;
revoke all on function public.record_cash_handin(uuid, int, text, text) from public, anon;
grant execute on function public.record_cash_handin(uuid, int, text, text) to authenticated;

comment on function public.record_cash_handin is
  'ADMIN/DISPATCHER: record a driver cash hand-in (−), adjustment (±), or write-off (−). Returns the driver''s new cash-on-hand balance.';

-- ============================================================================
-- my_cash_balance — a driver reads their own current cash-on-hand.
-- ============================================================================
create or replace function public.my_cash_balance()
returns int
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(sum(l.delta_egp), 0)::int
    from public.driver_cash_ledger l
    join public.drivers d on d.id = l.driver_id
   where d.profile_id = auth.uid();
$function$;
revoke all on function public.my_cash_balance() from public, anon;
grant execute on function public.my_cash_balance() to authenticated;

comment on function public.my_cash_balance is
  'A driver reads their own cash-on-hand (sum of their cash-ledger deltas).';

-- ============================================================================
-- Wire the COD-collection credit into mark_cod_collected. Body preserved verbatim
-- from the live version (verified) + one ledger insert when cash is collected.
-- ============================================================================
create or replace function public.mark_cod_collected(p_order_id uuid, p_amount integer)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user   uuid := auth.uid();
  v_order  public.orders;
  v_drv    public.drivers;
  v_role   app_role := public.auth_role();
  v_is_self boolean;
  v_bonus  int;
  v_cash   int;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'check_violation'; end if;
  if v_order.payment_method <> 'cash_on_delivery' then
    raise exception 'NOT_A_COD_ORDER' using errcode = 'check_violation';
  end if;

  if p_amount is not null and p_amount <> v_order.total_egp then
    raise exception 'COD_AMOUNT_MISMATCH: expected % got %', v_order.total_egp, p_amount
      using errcode = 'check_violation';
  end if;

  v_is_self := (v_order.fulfillment_type = 'self_delivery');

  select * into v_drv from public.drivers where id = v_order.assigned_driver_id;

  if v_role = 'admin' then
    null;
  elsif v_drv.id is not null and v_drv.profile_id is not distinct from v_user then
    null;
  elsif v_is_self and public.is_merchant_staff(v_order.restaurant_id) then
    null;
  else
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;

  update public.orders set payment_status = 'paid' where id = p_order_id;

  v_cash := coalesce(p_amount, v_order.total_egp);

  if v_order.assigned_driver_id is not null then
    select coalesce(bonus_per_delivery_egp, 0) into v_bonus
      from public.driver_loyalty
     where driver_id = v_order.assigned_driver_id;

    insert into public.driver_earnings (driver_id, order_id, delivery_fee_share, tip, bonus, cod_collected, total)
    values (
      v_order.assigned_driver_id, p_order_id,
      v_order.delivery_fee_egp, v_order.tip_egp,
      coalesce(v_bonus, 0),
      v_cash,
      v_order.delivery_fee_egp + v_order.tip_egp + coalesce(v_bonus, 0)
    )
    on conflict (order_id) do update set cod_collected = excluded.cod_collected;

    -- [104] Credit the driver's cash-custody ledger: they now physically hold this
    -- cash and owe it to the platform. Idempotent per order (partial unique index).
    -- A courier-delivered COD only — for self_delivery the restaurant holds the cash,
    -- not a driver, so skip when there is no assigned driver (already guarded above).
    insert into public.driver_cash_ledger (driver_id, delta_egp, reason, ref_order_id, actor_id)
    values (v_order.assigned_driver_id, v_cash, 'cod_collected', p_order_id, v_user)
    on conflict (ref_order_id) where reason = 'cod_collected' do nothing;
  end if;
end;
$function$;
