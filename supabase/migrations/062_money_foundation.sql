-- 062_money_foundation.sql
-- The money foundation: per-order commission snapshot + a customer credit
-- primitive that unblocks five P0 gaps at once (2026-07-03 gap-analysis):
--   1. Commission settlement — platform revenue is now recorded per order.
--   2. Per-order commission snapshot — the rate in force is frozen at delivery,
--      immune to the nightly loyalty sweep that rewrites restaurants.commission_pct.
--   3. Refund / goodwill-credit — issue_credit() gives support a real tool.
--   4. SLA late-credit engine — the advertised "auto 10% if 15+ min late"
--      promise finally has a granting mechanism (idempotent, per order).
--   5. Restaurant payout / revenue reporting — order_financials is the source
--      of truth for what each restaurant owes and the platform earned.
--
-- Design notes
-- - Credits are stored-value in credit_ledger (append-only) with a materialized
--   customer_credit_balance for O(1) reads — same ledger shape as loyalty.
-- - Redeeming credit mints a one-time owner-bound fixed promo code (the exact
--   proven pattern from referrals/loyalty: mig 026/049/058), so credit flows
--   through the existing checkout discount path with zero client changes.
-- - order_financials is written on the delivered transition by a trigger that
--   runs alongside the existing accrue_loyalty trigger (044). It snapshots the
--   commission RATE at delivery time and computes commission_egp from subtotal.
-- - The SLA credit fires in the same trigger: if delivered_at > eta_at + grace,
--   issue the promised percentage of subtotal as credit, once per order.
-- Non-destructive: only new tables/functions/triggers. Idempotent.

-- ============================================================================
-- platform_settings: SLA credit knobs (keep the promise's numbers configurable)
-- ============================================================================
insert into public.platform_settings (key, value) values
  ('sla_credit_grace_minutes', to_jsonb(15)),   -- lateness threshold before a credit is owed
  ('sla_credit_pct',           to_jsonb(10)),    -- % of subtotal credited when late
  ('sla_credit_max_egp',       to_jsonb(100))    -- cap per order (abuse / runaway guard)
on conflict (key) do nothing;

-- ============================================================================
-- order_financials — immutable per-order platform economics snapshot.
-- One row per order, written once when the order is delivered.
-- ============================================================================
create table if not exists public.order_financials (
  order_id          uuid primary key references public.orders(id) on delete cascade,
  restaurant_id     uuid not null references public.restaurants(id),
  subtotal_egp      int not null check (subtotal_egp >= 0),
  commission_pct    numeric(5,2) not null check (commission_pct >= 0),  -- rate FROZEN at delivery
  commission_egp    int not null check (commission_egp >= 0),           -- platform revenue on this order
  delivery_fee_egp  int not null default 0,                             -- passed through to driver
  payment_method    text not null,
  delivered_at      timestamptz not null,
  created_at        timestamptz not null default now()
);
create index if not exists order_financials_restaurant_idx
  on public.order_financials (restaurant_id, delivered_at desc);

comment on table public.order_financials is
  'Immutable per-order platform economics, written once on delivery by snapshot_order_financials. commission_pct is frozen here so the nightly loyalty sweep rewriting restaurants.commission_pct can never alter historic billing. Source of truth for restaurant settlement + platform revenue reporting.';

alter table public.order_financials enable row level security;
-- Restaurants read their own financials; admins read all. No client writes.
create policy order_financials_restaurant_select on public.order_financials
  for select using (
    public.auth_role() = 'admin'
    or exists (
      select 1 from public.restaurants r
      join public.merchant_staff ms on ms.restaurant_id = r.id
      where r.id = order_financials.restaurant_id and ms.profile_id = auth.uid()
    )
  );

-- ============================================================================
-- credit_ledger — append-only stored-value ("sharmeats wallet") for customers.
-- Positive delta = credit granted (refund, goodwill, SLA); negative = redeemed.
-- ============================================================================
create table if not exists public.credit_ledger (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.users(id) on delete cascade,
  delta_egp     int not null check (delta_egp <> 0),
  reason        text not null check (reason in ('refund','goodwill','sla_late','redeem','adjustment')),
  ref_order_id  uuid references public.orders(id) on delete set null,
  note          text,
  actor_id      uuid,                          -- admin/support who issued it (null = system)
  created_at    timestamptz not null default now()
);
create index if not exists credit_ledger_user_idx on public.credit_ledger (user_id, created_at desc);
-- One automatic SLA credit per order, enforced at the DB level.
create unique index if not exists credit_ledger_one_sla_per_order
  on public.credit_ledger (ref_order_id) where reason = 'sla_late';

comment on table public.credit_ledger is
  'Append-only customer credit (the "sharmeats wallet" the app has always promised). Granted via issue_credit (refund/goodwill/SLA), spent via redeem_credit which mints a one-time promo code. Balance materialized in customer_credit_balance.';

create table if not exists public.customer_credit_balance (
  user_id      uuid primary key references public.users(id) on delete cascade,
  balance_egp  int not null default 0 check (balance_egp >= 0),
  updated_at   timestamptz not null default now()
);

alter table public.credit_ledger          enable row level security;
alter table public.customer_credit_balance enable row level security;
create policy credit_ledger_self_select on public.credit_ledger
  for select using (auth.uid() = user_id or public.auth_role() = 'admin');
create policy credit_balance_self_select on public.customer_credit_balance
  for select using (auth.uid() = user_id or public.auth_role() = 'admin');
-- No client INSERT/UPDATE policies: all writes go through SECURITY DEFINER RPCs.

-- ============================================================================
-- issue_credit — grant credit to a customer (refund / goodwill / SLA / adjust).
-- SECURITY DEFINER. Admin-only for manual reasons; the SLA path calls it
-- internally with p_actor = null. Idempotent for SLA via the unique index.
-- ============================================================================
create or replace function public.issue_credit(
  p_user_id uuid, p_amount_egp int, p_reason text,
  p_order_id uuid default null, p_note text default null
)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare v_actor uuid := auth.uid();
begin
  if p_amount_egp is null or p_amount_egp <= 0 then
    raise exception 'INVALID_AMOUNT' using errcode = 'check_violation';
  end if;
  if p_reason not in ('refund','goodwill','sla_late','redeem','adjustment') then
    raise exception 'INVALID_REASON' using errcode = 'check_violation';
  end if;
  -- Manual grants (everything except the system SLA path) require admin.
  if p_reason <> 'sla_late' and public.auth_role() <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;

  insert into public.credit_ledger (user_id, delta_egp, reason, ref_order_id, note, actor_id)
  values (p_user_id, p_amount_egp, p_reason, p_order_id, p_note, v_actor);

  insert into public.customer_credit_balance (user_id, balance_egp)
  values (p_user_id, p_amount_egp)
  on conflict (user_id) do update
    set balance_egp = public.customer_credit_balance.balance_egp + p_amount_egp,
        updated_at = now();
end;
$$;
revoke all on function public.issue_credit(uuid, int, text, uuid, text) from public, anon;
grant execute on function public.issue_credit(uuid, int, text, uuid, text) to authenticated;

comment on function public.issue_credit is
  'Grants customer credit. Admin-only for refund/goodwill/adjustment; the sla_late reason is used internally by the delivery trigger (p_actor null). Writes credit_ledger + bumps customer_credit_balance atomically.';

-- ============================================================================
-- redeem_credit — spend credit balance; mint a one-time owner-bound promo code
-- the customer applies at checkout (reuses the referral/loyalty mint pattern).
-- ============================================================================
create or replace function public.redeem_credit(p_amount_egp int)
returns text
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_balance int;
  v_code text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;
  if p_amount_egp is null or p_amount_egp <= 0 then raise exception 'INVALID_AMOUNT' using errcode = 'check_violation'; end if;

  perform 1 from public.customer_credit_balance where user_id = v_user for update;
  select balance_egp into v_balance from public.customer_credit_balance where user_id = v_user;
  if v_balance is null or v_balance < p_amount_egp then
    raise exception 'INSUFFICIENT_CREDIT' using errcode = 'check_violation';
  end if;

  v_code := 'CR-' || upper(encode(gen_random_bytes(16), 'hex'));
  insert into public.promo_codes (code, kind, value, per_user_limit, is_active, owner_user_id)
  values (upper(v_code), 'fixed', p_amount_egp, 1, true, v_user);

  update public.customer_credit_balance
     set balance_egp = balance_egp - p_amount_egp, updated_at = now()
   where user_id = v_user;
  insert into public.credit_ledger (user_id, delta_egp, reason, note)
  values (v_user, -p_amount_egp, 'redeem', 'Minted promo ' || upper(v_code));

  return upper(v_code);
end;
$$;
grant execute on function public.redeem_credit(int) to authenticated;

comment on function public.redeem_credit is
  'Debits customer_credit_balance and mints a one-time owner-bound CR-<hex> fixed promo code (same instrument as loyalty/referral redemption) that the customer applies at checkout. Raises INSUFFICIENT_CREDIT if the balance is too low.';

-- ============================================================================
-- my_credit_balance — customer reads their own wallet (0 if no row yet).
-- ============================================================================
create or replace function public.my_credit_balance()
returns int
language sql
security definer set search_path = public, pg_temp
as $$
  select coalesce((select balance_egp from public.customer_credit_balance where user_id = auth.uid()), 0);
$$;
grant execute on function public.my_credit_balance() to authenticated;

-- ============================================================================
-- snapshot_order_financials — on the delivered transition, freeze commission
-- economics AND grant the SLA late-credit if the order missed its ETA.
-- Runs after the existing accrue_loyalty trigger; never blocks delivery.
-- ============================================================================
create or replace function public.snapshot_order_financials()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_rate      numeric(5,2);
  v_grace     int;
  v_pct       int;
  v_max       int;
  v_late_min  numeric;
  v_credit    int;
begin
  if new.status <> 'delivered' or old.status = 'delivered' then return new; end if;

  -- 1. Commission snapshot (rate frozen at delivery; immune to later sweeps).
  select commission_pct into v_rate from public.restaurants where id = new.restaurant_id;
  v_rate := coalesce(v_rate, 12.0);
  insert into public.order_financials (
    order_id, restaurant_id, subtotal_egp, commission_pct, commission_egp,
    delivery_fee_egp, payment_method, delivered_at
  ) values (
    new.id, new.restaurant_id, coalesce(new.subtotal_egp, 0), v_rate,
    floor(coalesce(new.subtotal_egp, 0) * v_rate / 100.0)::int,
    coalesce(new.delivery_fee_egp, 0), new.payment_method,
    coalesce(new.delivered_at, now())
  ) on conflict (order_id) do nothing;

  -- 2. SLA late-credit: honor the advertised "auto 10% if 15+ min late".
  select coalesce((value #>> '{}')::int, 15)  into v_grace from public.platform_settings where key = 'sla_credit_grace_minutes';
  select coalesce((value #>> '{}')::int, 10)  into v_pct   from public.platform_settings where key = 'sla_credit_pct';
  select coalesce((value #>> '{}')::int, 100) into v_max   from public.platform_settings where key = 'sla_credit_max_egp';

  v_late_min := extract(epoch from (coalesce(new.delivered_at, now()) - new.eta_at)) / 60.0;
  if v_late_min > v_grace then
    v_credit := least(v_max, floor(coalesce(new.subtotal_egp, 0) * v_pct / 100.0)::int);
    if v_credit > 0 then
      -- issue_credit enforces one sla_late per order via the partial unique index.
      begin
        perform public.issue_credit(
          new.user_id, v_credit, 'sla_late', new.id,
          'Auto late credit: ' || round(v_late_min)::text || ' min late'
        );
      exception when unique_violation then
        null;  -- already credited this order
      end;
    end if;
  end if;

  return new;
exception when others then
  return new;  -- never block the delivery transition on financial bookkeeping
end;
$$;
revoke all on function public.snapshot_order_financials() from public, anon, authenticated;

drop trigger if exists orders_snapshot_financials on public.orders;
create trigger orders_snapshot_financials
  after update of status on public.orders
  for each row execute function public.snapshot_order_financials();

comment on function public.snapshot_order_financials is
  'On orders.status -> delivered: (1) writes the immutable order_financials commission snapshot, (2) grants the advertised SLA late-credit (10% of subtotal, capped) when delivered_at exceeds eta_at by the grace window, once per order. Fail-open: bookkeeping errors never block delivery.';
