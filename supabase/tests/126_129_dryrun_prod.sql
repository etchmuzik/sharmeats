-- 126_129_dryrun_prod.sql  (GENERATED -- do not hand-edit)
--
-- Transaction-wrapped dry run of the ENTIRE pending migration stack
-- (126 cloud kitchen, 127 vertical fee, 128 zone guard, 129 service-area
-- single source) against the REAL production schema, with asserts that call
-- the actual functions. All four migrations are idempotent, so this file is
-- safe to run whether none, some, or all of them are already applied.
--
-- HOW TO RUN (owner, Supabase Dashboard -> SQL editor): paste this entire
-- file, Run once. It BEGINs, applies 126-129, runs every assert, ROLLBACKs --
-- nothing persists. Success = the final "DRY RUN COMPLETE" row. Any error =
-- do not apply until fixed.
--
-- REGENERATE after editing any of the four migrations (cat them + the assert
-- blocks in order, wrapped in begin/rollback -- see git history of this file).
--
begin;

-- 126_cloud_kitchen_foundation.sql
--
-- Company-owned cloud kitchen: physical kitchens + merchant ownership type.
--
-- BUSINESS FACT: one leased kitchen at Mercato (EGP 40,000/mo), founder-operated,
-- running FIVE virtual brands (First Light, Sukkar, Corallo, Sinai Smash,
-- Shawrimp) as five separate customer-facing storefronts. One pickup point, one
-- staff team, one rent line -- five slugs, five menus, five logos.
--
-- TWO INDEPENDENT AXES, deliberately two columns:
--   restaurants.kitchen_id    -> WHERE is this picked up from (physical; batching)
--   restaurants.merchant_type -> WHOSE P&L is this        (commercial; money+ranking)
-- A third party could one day rent a stall in our kitchen (kitchen_id set,
-- merchant_type third_party); we could run an own brand out of a partner's
-- kitchen (kitchen_id null, merchant_type own_brand). Collapsing these into one
-- column forces a schema change the first time reality diverges.
--
-- WHY AN ENUM, NOT A BOOLEAN: a nullable `is_own_brand` boolean is the exact
-- shape of restaurants.featured, whose NULL semantics already forced
-- coalesce(featured,false) in migration 046. `where not is_own_brand` would
-- silently drop NULL rows out of a settlement run. A NOT NULL enum cannot fail
-- open under `<> 'own_brand'` (house rule 4).
--   Caveat for FUTURE migrations: ALTER TYPE ... ADD VALUE cannot run inside a
--   transaction block, so a migration adding a third value cannot use the
--   BEGIN/ROLLBACK dry run. This migration creates the type complete.
--
-- ================= THE MONEY TRAP, STATED PLAINLY =================
-- Settlement computes  net_payable = card_sales - commission + cod_discount.
-- For a company-owned brand there is nobody to pay, so we want net_payable = 0.
--   commission_pct = 15  -> payable of 85% of card sales TO OURSELVES.
--   commission_pct = 0   -> payable of 100% of card sales. WORSE.
-- "Own brands pay no commission" is the intuitive answer and it is EXACTLY
-- BACKWARDS. No rate produces zero: the rate is the wrong lever. Own brands are
-- therefore EXCLUDED from the settlement path entirely (both writers -- see
-- below), and commission_pct is parked at 100.00 purely so that any unpatched
-- code computing "the platform's take" reads "we keep all of it" (economically
-- true) rather than "we owe them 85%".
--
-- BOTH SETTLEMENT WRITERS ARE PATCHED. settlement_sweep() does NOT call
-- generate_settlements(); it carries its own duplicated aggregation (verified
-- against the deployed body). Patching only one would leave the Monday cron
-- (0 3 * * 1, active) still drafting a self-payout.
--
-- ================= RANKING INTEGRITY =================
-- The investor commitment is "we never rank own brands above third parties".
-- `featured` is the only above-the-fold ranking lever (listFeatured() ->
-- .eq('featured', true) drives the customer home rail; the main list orders by
-- rating). It is written by loyalty_tier_sweep() -- a NIGHTLY CRON (0 2 * * *,
-- active) that sets featured = (tier = 'gold') on every restaurant. An own
-- brand hitting gold would be auto-promoted with no human involved: the promise
-- would be broken by a job nobody remembers exists.
-- Fixed at the source (the sweep skips own brands) AND backstopped by a CHECK
-- constraint, so no RPC, cron, or manual UPDATE can violate it.
--
-- BODIES TAKEN FROM PRODUCTION, NOT FROM THE REPO (house rule 2). The repo and
-- the prod ledger share zero aligned migrations, and prod's
-- generate_settlements already contains an [083] cod_discount term that
-- migration 074's file does not. Every CREATE OR REPLACE below was written from
-- a fresh pg_get_functiondef() dump.
--
-- BACKFILL: none. All 43 restaurants in prod are seed/demo data, not real
-- merchants (same reasoning as migration 125). Existing rows keep
-- merchant_type = 'third_party' (the default) and kitchen_id = NULL, which is
-- already correct for every one of them.
--
-- Forward-only, idempotent, standalone: applies independently via the
-- migration-122 exception route (docs/DATABASE-RELEASE-RUNBOOK.md), NOT db push.
-- Rollback: drop the added functions/view/trigger/constraint, then
--   alter table public.restaurants drop column kitchen_id, drop column merchant_type;
--   drop table public.kitchens; drop type public.merchant_type;

-- ---------------------------------------------------------------------------
-- 1) merchant_type enum
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.merchant_type as enum ('third_party', 'own_brand');
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 2) kitchens -- a PHYSICAL production facility we hold a lease on.
--    One row per lease. NOT one row per brand.
-- ---------------------------------------------------------------------------
create table if not exists public.kitchens (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  slug              text not null unique,
  address           text,
  zone              zone_type not null references public.zones(id),
  geo               geography(Point, 4326),
  -- Whole EGP to match every other *_egp column in this schema.
  monthly_rent_egp  int not null default 0 check (monthly_rent_egp >= 0),
  lease_start       date,
  lease_end         date,
  is_active         boolean not null default true,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint kitchens_lease_order_chk
    check (lease_end is null or lease_start is null or lease_end >= lease_start)
);

create index if not exists kitchens_geo_gix    on public.kitchens using gist (geo);
create index if not exists kitchens_active_idx on public.kitchens (is_active) where is_active = true;

comment on table public.kitchens is
  'A physical production facility the company leases. One row per lease, NOT per brand -- five virtual brands share one kitchen row. Drives batching (one pickup point) and fixed-cost reporting. Mig 126.';
comment on column public.kitchens.monthly_rent_egp is
  'Whole EGP/month. REPORTING ONLY -- deliberately never allocated per order. Per-order cost allocation is an accounting-policy decision, not a schema one. See docs/FINANCIALS.md.';

alter table public.kitchens enable row level security;

-- A kitchen row exposes our cost base, so it is not public. Admins read all;
-- staff of a brand produced in the kitchen read their own kitchen (they need
-- the pickup address).
drop policy if exists kitchens_read on public.kitchens;
create policy kitchens_read on public.kitchens for select using (
  coalesce((select public.auth_role())::text, '') = 'admin'
  or exists (
    select 1
      from public.restaurants r
      join public.merchant_staff ms on ms.restaurant_id = r.id
     where r.kitchen_id = kitchens.id
       and ms.profile_id = (select auth.uid())
  )
);
-- No INSERT/UPDATE/DELETE policy and no write grants: admin RPCs only.
revoke all on public.kitchens from anon, authenticated;
grant select on public.kitchens to authenticated;

-- ---------------------------------------------------------------------------
-- 3) restaurants -- the two new columns
-- ---------------------------------------------------------------------------
alter table public.restaurants
  add column if not exists kitchen_id    uuid references public.kitchens(id) on delete set null,
  add column if not exists merchant_type public.merchant_type not null default 'third_party';

create index if not exists restaurants_kitchen_idx
  on public.restaurants (kitchen_id) where kitchen_id is not null;
-- Partial: own brands are a tiny minority and every money/ranking query filters here.
create index if not exists restaurants_own_brand_idx
  on public.restaurants (merchant_type) where merchant_type = 'own_brand';

comment on column public.restaurants.kitchen_id is
  'Physical kitchen this storefront is produced in. NULL = merchant''s own premises (every third party today). The five own brands share ONE kitchen_id. Mig 126.';
comment on column public.restaurants.merchant_type is
  'Ownership / P&L axis. own_brand = company-owned virtual brand: revenue is 100% ours, "commission" is an internal transfer, NO settlement row may exist, and it can never be featured. Written only by admin_set_merchant_type. Mig 126.';

-- ---------------------------------------------------------------------------
-- 4) Column-grant restatement (house rule 5 -- RLS cannot restrict columns).
-- Migration 081 already narrowed UPDATE on restaurants to a column list; ADD
-- COLUMN does not widen an existing column-level grant, so kitchen_id and
-- merchant_type are already unwritable by clients. Restated here so the
-- invariant is visible at this migration and survives anyone re-running an
-- older broad grant. Verified against prod: authenticated may update exactly
-- is_open + the five payout_* columns.
-- ---------------------------------------------------------------------------
revoke update on public.restaurants from anon, authenticated;
grant update (is_open, payout_method, payout_bank_name, payout_iban, payout_wallet, payout_holder)
  on public.restaurants to authenticated;

-- ---------------------------------------------------------------------------
-- 5) RANKING INTEGRITY -- the structural promise.
-- A CHECK makes it impossible rather than merely disallowed: every writer,
-- present and future, including a manual psql UPDATE, hits it.
-- coalesce() because featured is nullable (mig 002): without it the expression
-- evaluates to NULL for featured IS NULL rows, and a NULL CHECK passes.
-- ---------------------------------------------------------------------------
alter table public.restaurants
  drop constraint if exists restaurants_own_brand_never_featured_chk;
alter table public.restaurants
  add constraint restaurants_own_brand_never_featured_chk
    check (merchant_type <> 'own_brand' or coalesce(featured, false) = false) not valid;
alter table public.restaurants
  validate constraint restaurants_own_brand_never_featured_chk;

comment on constraint restaurants_own_brand_never_featured_chk on public.restaurants is
  'RANKING INTEGRITY (mig 126): a company-owned brand can never be featured. Enforces the investor commitment "we never rank own brands above third parties" at the storage layer, so no RPC, cron or manual UPDATE can violate it.';

-- ---------------------------------------------------------------------------
-- 6) generate_settlements -- own brands excluded.
-- Body is prod's verbatim (includes the [083] cod_discount term absent from
-- migration 074's file) with ONE change: join restaurants, exclude own brands.
-- Arg list UNCHANGED (date, date) -> no second overload (house rule 1).
-- ---------------------------------------------------------------------------
create or replace function public.generate_settlements(p_period_start date, p_period_end date)
returns int
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_count int := 0;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='check_violation'; end if;
  if coalesce(public.auth_role()::text,'') <> 'admin' then raise exception 'NOT_AUTHORIZED' using errcode='check_violation'; end if;
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'INVALID_PERIOD' using errcode='check_violation';
  end if;

  with agg as (
    select
      f.restaurant_id,
      count(*) as order_count,
      sum(f.subtotal_egp) as gross_sales,
      sum(f.subtotal_egp) filter (where f.payment_method='cash_on_delivery') as cod_sales,
      sum(f.subtotal_egp) filter (where f.payment_method<>'cash_on_delivery') as card_sales,
      sum(f.commission_egp) as commission,
      -- [083] platform-funded discount on COD orders that the restaurant did not
      -- receive in cash; the platform reimburses it.
      coalesce(sum(f.discount_egp) filter (where f.payment_method='cash_on_delivery'),0) as cod_discount
    from public.order_financials f
    join public.restaurants r on r.id = f.restaurant_id
    where f.delivered_at::date between p_period_start and p_period_end
      -- [126] Own brands are us. A settlement row would be a payable to
      -- ourselves. NOT NULL enum -> this cannot fail open (house rule 4).
      and r.merchant_type <> 'own_brand'
    group by f.restaurant_id
  )
  insert into public.restaurant_settlements (
    restaurant_id, period_start, period_end, order_count,
    gross_sales_egp, cod_sales_egp, card_sales_egp, commission_egp, net_payable_egp, status
  )
  select
    a.restaurant_id, p_period_start, p_period_end, a.order_count,
    a.gross_sales, coalesce(a.cod_sales,0), coalesce(a.card_sales,0), a.commission,
    coalesce(a.card_sales,0) - a.commission + a.cod_discount,  -- [083] + reimbursed COD discount
    'draft'
  from agg a
  on conflict (restaurant_id, period_start, period_end) do update set
    order_count     = excluded.order_count,
    gross_sales_egp = excluded.gross_sales_egp,
    cod_sales_egp   = excluded.cod_sales_egp,
    card_sales_egp  = excluded.card_sales_egp,
    commission_egp  = excluded.commission_egp,
    net_payable_egp = excluded.net_payable_egp,
    updated_at      = now()
  where public.restaurant_settlements.status <> 'paid';

  get diagnostics v_count = row_count;
  return v_count;
end; $function$;

revoke all on function public.generate_settlements(date, date) from public, anon;
grant execute on function public.generate_settlements(date, date) to authenticated;

comment on function public.generate_settlements(date, date) is
  'ADMIN: (re)build draft settlement rows for a period from order_financials. Idempotent; skips paid rows. EXCLUDES merchant_type = own_brand -- an own-brand settlement would be a payable to ourselves (mig 126).';

-- ---------------------------------------------------------------------------
-- 7) settlement_sweep -- the WEEKLY CRON (0 3 * * 1, active).
-- It does NOT call generate_settlements; it duplicates the aggregation. Both
-- writers must be patched or the cron keeps drafting the self-payout.
-- Arg list UNCHANGED () -> no second overload.
-- ---------------------------------------------------------------------------
create or replace function public.settlement_sweep()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_start date;
  v_end   date;
  v_count int := 0;
begin
  -- Just-ended week: previous Monday .. previous Sunday (ISO week, dow: Mon=1).
  v_start := (date_trunc('week', now()) - interval '7 days')::date;   -- previous Monday
  v_end   := (date_trunc('week', now()) - interval '1 day')::date;    -- previous Sunday

  -- Same aggregation as generate_settlements, minus the interactive admin gate
  -- (cron has no auth.uid()). Owner-privileged; identical, idempotent upsert.
  with agg as (
    select
      f.restaurant_id,
      count(*) as order_count,
      sum(f.subtotal_egp) as gross_sales,
      sum(f.subtotal_egp) filter (where f.payment_method='cash_on_delivery') as cod_sales,
      sum(f.subtotal_egp) filter (where f.payment_method<>'cash_on_delivery') as card_sales,
      sum(f.commission_egp) as commission,
      coalesce(sum(f.discount_egp) filter (where f.payment_method='cash_on_delivery'),0) as cod_discount
    from public.order_financials f
    join public.restaurants r on r.id = f.restaurant_id
    where f.delivered_at::date between v_start and v_end
      -- [126] Never draft a payout to ourselves. See the migration header.
      and r.merchant_type <> 'own_brand'
    group by f.restaurant_id
  )
  insert into public.restaurant_settlements (
    restaurant_id, period_start, period_end, order_count,
    gross_sales_egp, cod_sales_egp, card_sales_egp, commission_egp, net_payable_egp, status
  )
  select
    a.restaurant_id, v_start, v_end, a.order_count,
    a.gross_sales, coalesce(a.cod_sales,0), coalesce(a.card_sales,0), a.commission,
    coalesce(a.card_sales,0) - a.commission + a.cod_discount,
    'draft'
  from agg a
  on conflict (restaurant_id, period_start, period_end) do update set
    order_count     = excluded.order_count,
    gross_sales_egp = excluded.gross_sales_egp,
    cod_sales_egp   = excluded.cod_sales_egp,
    card_sales_egp  = excluded.card_sales_egp,
    commission_egp  = excluded.commission_egp,
    net_payable_egp = excluded.net_payable_egp,
    updated_at      = now()
  where public.restaurant_settlements.status <> 'paid';

  get diagnostics v_count = row_count;
  return v_count;
end; $function$;

revoke all on function public.settlement_sweep() from public, anon, authenticated;

comment on function public.settlement_sweep() is
  'CRON (Mon 03:00): build draft settlements for the just-ended week. EXCLUDES merchant_type = own_brand (mig 126). Owner-privileged; no client grant.';

-- ---------------------------------------------------------------------------
-- 8) Structural guard: no settlement row may EVER exist for an own brand,
-- whichever code path tries to write it. The exclusions above are policy;
-- this is the invariant. Someone will eventually write a backfill INSERT.
-- ---------------------------------------------------------------------------
create or replace function public.reject_own_brand_settlement()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if exists (
    select 1 from public.restaurants
     where id = new.restaurant_id and merchant_type = 'own_brand'
  ) then
    raise exception 'OWN_BRAND_HAS_NO_SETTLEMENT' using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

-- INSERT-only, deliberately. A restaurant converted to own_brand mid-lifecycle
-- may hold legitimate settlement rows earned during its third-party period --
-- the Monday sweep guarantees at least the just-ended week's draft. Those rows
-- must remain finalize-able and payable (finalize_settlement /
-- mark_settlement_paid are UPDATEs); an INSERT OR UPDATE trigger froze that
-- money unrecoverably. INSERT-only still holds the invariant: both settlement
-- writers exclude own brands from their aggregation, so no NEW row (and hence
-- no ON CONFLICT UPDATE branch) can ever be attempted for one.
-- (Found by adversarial review, 2026-07-27.)
drop trigger if exists trg_reject_own_brand_settlement on public.restaurant_settlements;
create trigger trg_reject_own_brand_settlement
  before insert on public.restaurant_settlements
  for each row execute function public.reject_own_brand_settlement();

comment on function public.reject_own_brand_settlement() is
  'Invariant (mig 126): no NEW settlement row may be created for a merchant_type = own_brand restaurant. INSERT-only: rows earned during a merchant''s third-party period stay payable after conversion.';

-- ---------------------------------------------------------------------------
-- 9) loyalty_tier_sweep -- own brands excluded from the RESTAURANT loop.
-- Body is prod's verbatim with ONE change: the restaurant cursor filters out
-- own brands. Excluded at the SOURCE, not just on the UPDATE, because the loop
-- would otherwise also create a pointless restaurant_loyalty row and rewrite
-- commission_pct (gold tier would drift 100.00 -> 98.00).
-- Each iteration is wrapped in `exception when others then raise warning`, so a
-- CHECK violation would be SWALLOWED as a warning and leave that restaurant's
-- tier desynced -- which is exactly why the fix belongs at the source and the
-- constraint is only a backstop.
-- Arg list UNCHANGED () -> no second overload.
-- ---------------------------------------------------------------------------
create or replace function public.loyalty_tier_sweep()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_count int := 0;
  v_rec   record;
  v_silver_pts int; v_gold_pts int;
  v_drv_silver int; v_drv_gold int; v_min_accept numeric; v_min_rating numeric;
  v_drv_bonus_s int; v_drv_bonus_g int; v_drv_first_look_g int;
  v_rest_silver int; v_rest_gold int; v_rest_disc_s numeric; v_rest_disc_g numeric;
  v_new_tier text;
begin
  select coalesce((value #>> '{}')::int, 500)  into v_silver_pts from public.platform_settings where key = 'loyalty_customer_silver_threshold';
  select coalesce((value #>> '{}')::int, 2000) into v_gold_pts   from public.platform_settings where key = 'loyalty_customer_gold_threshold';
  select coalesce((value #>> '{}')::int, 60)   into v_drv_silver from public.platform_settings where key = 'loyalty_driver_silver_threshold';
  select coalesce((value #>> '{}')::int, 200)  into v_drv_gold   from public.platform_settings where key = 'loyalty_driver_gold_threshold';
  select coalesce((value #>> '{}')::numeric, 80)  into v_min_accept from public.platform_settings where key = 'loyalty_driver_min_acceptance_pct';
  select coalesce((value #>> '{}')::numeric, 450) into v_min_rating from public.platform_settings where key = 'loyalty_driver_min_rating';
  select coalesce((value #>> '{}')::int, 5)  into v_drv_bonus_s from public.platform_settings where key = 'loyalty_driver_bonus_silver_egp';
  select coalesce((value #>> '{}')::int, 10) into v_drv_bonus_g from public.platform_settings where key = 'loyalty_driver_bonus_gold_egp';
  select coalesce((value #>> '{}')::int, 8)  into v_drv_first_look_g from public.platform_settings where key = 'loyalty_driver_first_look_gold_seconds';
  select coalesce((value #>> '{}')::int, 50)  into v_rest_silver from public.platform_settings where key = 'loyalty_restaurant_silver_threshold';
  select coalesce((value #>> '{}')::int, 200) into v_rest_gold   from public.platform_settings where key = 'loyalty_restaurant_gold_threshold';
  select coalesce((value #>> '{}')::numeric, 100) / 100.0 into v_rest_disc_s from public.platform_settings where key = 'loyalty_restaurant_silver_discount_pct';
  select coalesce((value #>> '{}')::numeric, 200) / 100.0 into v_rest_disc_g from public.platform_settings where key = 'loyalty_restaurant_gold_discount_pct';

  for v_rec in
    select cl.user_id,
           coalesce(sum(l.delta_points) filter (where l.created_at > now() - interval '12 months'), 0) as pts
      from public.customer_loyalty cl
      left join public.loyalty_points_ledger l
        on l.subject_type = 'customer' and l.subject_id = cl.user_id
     group by cl.user_id
  loop
    begin
      v_new_tier := case when v_rec.pts >= v_gold_pts then 'gold'
                          when v_rec.pts >= v_silver_pts then 'silver'
                          else 'bronze' end;
      update public.customer_loyalty
         set tier = v_new_tier,
             points_rolling_12mo = v_rec.pts,
             points_balance = greatest(0, (
               select coalesce(sum(delta_points), 0) from public.loyalty_points_ledger
                where subject_type = 'customer' and subject_id = v_rec.user_id
             )),
             updated_at = now()
       where user_id = v_rec.user_id
         and (tier <> v_new_tier or points_rolling_12mo <> v_rec.pts or points_balance <> greatest(0, (
               select coalesce(sum(delta_points), 0) from public.loyalty_points_ledger
                where subject_type = 'customer' and subject_id = v_rec.user_id
             )));
      if found then v_count := v_count + 1; end if;
    exception when others then
      raise warning 'loyalty_tier_sweep customer(%) failed: %', v_rec.user_id, sqlerrm;
    end;
  end loop;

  for v_rec in
    select d.id as driver_id,
           coalesce((
             select count(*) from public.orders o
              where o.assigned_driver_id = d.id and o.status = 'delivered'
                and o.placed_at > now() - interval '90 days'
           ), 0) as deliveries,
           coalesce(
             100.0 * count(*) filter (where oa.status = 'accepted' and oa.assigned_at > now() - interval '90 days')
             / nullif(count(*) filter (where oa.status in ('accepted','rejected') and oa.assigned_at > now() - interval '90 days'), 0),
             100.0
           ) as acceptance_pct,
           coalesce((
             select avg(o.rating_delivery)::numeric from public.orders o
              where o.assigned_driver_id = d.id and o.rating_delivery is not null
                and o.placed_at > now() - interval '90 days'
           ), 5.0) as avg_rating
      from public.drivers d
      left join public.order_assignments oa on oa.driver_id = d.id
     group by d.id
  loop
    begin
      insert into public.driver_loyalty (driver_id) values (v_rec.driver_id)
        on conflict (driver_id) do nothing;

      v_new_tier := 'bronze';
      if v_rec.deliveries >= v_drv_gold
         and v_rec.acceptance_pct >= v_min_accept
         and v_rec.avg_rating * 100 >= v_min_rating then
        v_new_tier := 'gold';
      elsif v_rec.deliveries >= v_drv_silver
         and v_rec.acceptance_pct >= v_min_accept
         and v_rec.avg_rating * 100 >= v_min_rating then
        v_new_tier := 'silver';
      end if;

      update public.driver_loyalty
         set tier = v_new_tier,
             deliveries_rolling_90d = v_rec.deliveries,
             acceptance_rate_snapshot = v_rec.acceptance_pct,
             rating_snapshot = v_rec.avg_rating,
             bonus_per_delivery_egp = case v_new_tier when 'gold' then v_drv_bonus_g when 'silver' then v_drv_bonus_s else 0 end,
             first_look_seconds = case v_new_tier when 'gold' then v_drv_first_look_g else 0 end,
             updated_at = now()
       where driver_id = v_rec.driver_id;
      v_count := v_count + 1;
    exception when others then
      raise warning 'loyalty_tier_sweep driver(%) failed: %', v_rec.driver_id, sqlerrm;
    end;
  end loop;

  for v_rec in
    select r.id as restaurant_id,
           coalesce(count(o.id) filter (
             where o.status = 'delivered' and o.placed_at > now() - interval '90 days'
           ), 0) as delivered_count,
           r.commission_pct as base_commission
      from public.restaurants r
      left join public.orders o on o.restaurant_id = r.id
      -- [126] Own brands are excluded from the restaurant loyalty programme
      -- entirely. A loyalty tier on a brand we own is meaningless, and the
      -- UPDATE below would (a) rewrite commission_pct away from the 100.00
      -- sentinel and (b) set featured = true at gold, violating
      -- restaurants_own_brand_never_featured_chk. Because each iteration
      -- swallows exceptions as warnings, that violation would silently desync
      -- the tier rather than fail loudly -- so filter at the source.
     where r.merchant_type <> 'own_brand'
     group by r.id, r.commission_pct
  loop
    begin
      insert into public.restaurant_loyalty (restaurant_id) values (v_rec.restaurant_id)
        on conflict (restaurant_id) do nothing;

      v_new_tier := 'bronze';
      if v_rec.delivered_count >= v_rest_gold then
        v_new_tier := 'gold';
      elsif v_rec.delivered_count >= v_rest_silver then
        v_new_tier := 'silver';
      end if;

      declare
        v_prev_discount numeric;
        v_next_discount numeric;
      begin
        select commission_discount_pct into v_prev_discount
          from public.restaurant_loyalty where restaurant_id = v_rec.restaurant_id;
        v_prev_discount := coalesce(v_prev_discount, 0);
        v_next_discount := case v_new_tier when 'gold' then v_rest_disc_g when 'silver' then v_rest_disc_s else 0 end;

        update public.restaurant_loyalty
           set tier = v_new_tier,
               orders_rolling_90d = v_rec.delivered_count,
               commission_discount_pct = v_next_discount,
               updated_at = now()
         where restaurant_id = v_rec.restaurant_id;

        update public.restaurants
           set commission_pct = greatest(0, v_rec.base_commission + v_prev_discount - v_next_discount),
               featured = (v_new_tier = 'gold')
         where id = v_rec.restaurant_id
           -- [126] Belt and braces: the cursor already excludes own brands.
           and merchant_type <> 'own_brand';
      end;

      v_count := v_count + 1;
    exception when others then
      raise warning 'loyalty_tier_sweep restaurant(%) failed: %', v_rec.restaurant_id, sqlerrm;
    end;
  end loop;

  return v_count;
end;
$function$;

revoke all on function public.loyalty_tier_sweep() from public, anon, authenticated;

comment on function public.loyalty_tier_sweep() is
  'CRON (daily 02:00): recompute customer/driver/restaurant loyalty tiers. Own-brand restaurants are excluded from the restaurant loop -- they have no loyalty tier, keep their commission sentinel, and can never be featured (mig 126). Owner-privileged; no client grant.';

-- ---------------------------------------------------------------------------
-- 10) admin_update_restaurant -- reject featuring an own brand.
-- 18-ARGUMENT SIGNATURE, reproduced exactly from prod. Getting one type wrong
-- creates a second overload and PGRST202 on every admin edit (house rule 1).
-- The guard raises a named error so the admin UI shows something meaningful
-- instead of a raw constraint violation.
-- ---------------------------------------------------------------------------
create or replace function public.admin_update_restaurant(
  p_id uuid, p_name text, p_description text, p_cuisines cuisine_type[],
  p_cuisine_label text, p_cover_image text, p_logo text, p_zone zone_type,
  p_prep_time_low integer, p_prep_time_high integer, p_delivery_fee_egp integer,
  p_min_order_egp integer, p_tourist_safe boolean, p_is_open boolean,
  p_is_open_24h boolean, p_featured boolean, p_promo text, p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'NAME_REQUIRED' using errcode = 'check_violation';
  end if;

  -- [126] Ranking integrity: refuse before the CHECK fires so the admin UI can
  -- show a meaningful error.
  if coalesce(p_featured, false) and exists (
    select 1 from public.restaurants
     where id = p_id and merchant_type = 'own_brand'
  ) then
    raise exception 'OWN_BRAND_CANNOT_BE_FEATURED' using errcode = 'check_violation';
  end if;

  update public.restaurants set
    name            = btrim(p_name),
    description      = p_description,
    cuisines        = p_cuisines,
    cuisine_label   = p_cuisine_label,
    cover_image     = p_cover_image,
    logo            = p_logo,
    zone            = p_zone,
    prep_time_low   = p_prep_time_low,
    prep_time_high  = p_prep_time_high,
    delivery_fee_egp= p_delivery_fee_egp,
    min_order_egp   = p_min_order_egp,
    tourist_safe    = p_tourist_safe,
    is_open         = p_is_open,
    is_open_24h     = p_is_open_24h,
    featured        = p_featured,
    promo           = p_promo,
    is_active       = p_is_active
  where id = p_id;

  if not found then
    raise exception 'RESTAURANT_NOT_FOUND' using errcode = 'check_violation';
  end if;
end;
$function$;

revoke all on function public.admin_update_restaurant(
  uuid, text, text, cuisine_type[], text, text, text, zone_type,
  integer, integer, integer, integer, boolean, boolean, boolean, boolean, text, boolean
) from public, anon;
grant execute on function public.admin_update_restaurant(
  uuid, text, text, cuisine_type[], text, text, text, zone_type,
  integer, integer, integer, integer, boolean, boolean, boolean, boolean, text, boolean
) to authenticated;

-- ---------------------------------------------------------------------------
-- 11) admin_set_commission -- refuse own brands.
-- An own brand's rate is not a commercial term; it is a sentinel that keeps
-- unpatched "platform take" arithmetic honest. It also caps at 50, so it could
-- not set 100.00 anyway -- fail with a clear reason rather than INVALID_COMMISSION.
-- Arg list UNCHANGED (uuid, numeric).
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_commission(p_restaurant_id uuid, p_pct numeric)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;
  if coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  if p_pct is null or p_pct < 0 or p_pct > 50 then
    raise exception 'INVALID_COMMISSION' using errcode = 'check_violation';
  end if;
  -- [126] Own-brand "commission" is an internal transfer, not a rate anyone
  -- pays. Settlement excludes own brands entirely; changing the rate here
  -- would only corrupt the sentinel.
  if exists (
    select 1 from public.restaurants
     where id = p_restaurant_id and merchant_type = 'own_brand'
  ) then
    raise exception 'OWN_BRAND_COMMISSION_IS_INTERNAL' using errcode = 'check_violation';
  end if;
  update public.restaurants
     set commission_pct = p_pct, updated_at = now()
   where id = p_restaurant_id;
  if not found then
    raise exception 'RESTAURANT_NOT_FOUND' using errcode = 'check_violation';
  end if;
end;
$function$;

revoke all on function public.admin_set_commission(uuid, numeric) from public, anon;
grant execute on function public.admin_set_commission(uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 12) admin_upsert_kitchen -- the only writer of public.kitchens.
-- ---------------------------------------------------------------------------
create or replace function public.admin_upsert_kitchen(
  p_slug             text,
  p_name             text,
  p_zone             zone_type,
  p_address          text    default null,
  p_lat              numeric default null,
  p_lng              numeric default null,
  -- All optionals default NULL, and NULL means "keep the stored value" on an
  -- existing kitchen (first insert falls back to 0 / true). The previous
  -- excluded.*-based upsert silently wiped rent, lease dates, address and
  -- notes on any follow-up call that omitted them.
  -- (Found by adversarial review, 2026-07-27.)
  p_monthly_rent_egp int     default null,
  p_lease_start      date    default null,
  p_lease_end        date    default null,
  p_is_active        boolean default null,
  p_notes            text    default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_id  uuid;
  v_geo geography(Point, 4326);
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;
  if coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  if p_slug is null or btrim(p_slug) = '' or p_name is null or btrim(p_name) = '' then
    raise exception 'SLUG_AND_NAME_REQUIRED' using errcode = 'check_violation';
  end if;
  if coalesce(p_monthly_rent_egp, 0) < 0 then
    raise exception 'INVALID_RENT' using errcode = 'check_violation';
  end if;

  -- Sharm geo box, same guard as apply_as_restaurant (mig 123).
  if p_lat is not null and p_lng is not null then
    if p_lat < 27.70 or p_lat > 28.35 or p_lng < 34.20 or p_lng > 34.70 then
      raise exception 'GEO_OUT_OF_AREA' using errcode = 'check_violation';
    end if;
    v_geo := st_setsrid(st_makepoint(p_lng::float8, p_lat::float8), 4326)::geography;
  end if;

  insert into public.kitchens (slug, name, zone, address, geo, monthly_rent_egp,
                               lease_start, lease_end, is_active, notes)
  values (btrim(p_slug), btrim(p_name), p_zone, p_address, v_geo,
          coalesce(p_monthly_rent_egp, 0), p_lease_start, p_lease_end,
          coalesce(p_is_active, true), p_notes)
  on conflict (slug) do update set
    name             = excluded.name,
    zone             = excluded.zone,
    -- NULL param = keep the stored value (referencing the raw p_* params, not
    -- excluded.*, because the VALUES row already coalesced the NOT NULL
    -- columns and would masquerade as a real value). To CLEAR an optional
    -- field, update the row directly -- this RPC only sets or keeps.
    address          = coalesce(p_address, public.kitchens.address),
    geo              = coalesce(v_geo, public.kitchens.geo),
    monthly_rent_egp = coalesce(p_monthly_rent_egp, public.kitchens.monthly_rent_egp),
    lease_start      = coalesce(p_lease_start, public.kitchens.lease_start),
    lease_end        = coalesce(p_lease_end, public.kitchens.lease_end),
    is_active        = coalesce(p_is_active, public.kitchens.is_active),
    notes            = coalesce(p_notes, public.kitchens.notes),
    updated_at       = now()
  returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function public.admin_upsert_kitchen(text, text, zone_type, text, numeric, numeric, int, date, date, boolean, text) from public, anon;
grant execute on function public.admin_upsert_kitchen(text, text, zone_type, text, numeric, numeric, int, date, date, boolean, text) to authenticated;

comment on function public.admin_upsert_kitchen(text, text, zone_type, text, numeric, numeric, int, date, date, boolean, text) is
  'ADMIN: create or update a physical kitchen, keyed on slug. Only writer of public.kitchens. Mig 126.';

-- ---------------------------------------------------------------------------
-- 13) admin_set_merchant_type -- the only writer of restaurants.merchant_type.
-- Sets ownership, kitchen, and the commission sentinel ATOMICALLY, and clears
-- `featured` when converting to an own brand (otherwise the CHECK would reject
-- a currently-featured restaurant and the caller could not fix it here).
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_merchant_type(
  p_restaurant_id uuid,
  p_type          public.merchant_type,
  p_kitchen_id    uuid default null,
  p_inherit_geo   boolean default true
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  -- SCALARS, deliberately not a `record`: an unassigned record's fields raise
  -- 55000 ('record "v_kitchen" is not assigned yet') the moment the UPDATE
  -- binds them -- even inside a CASE branch that would not be taken. With
  -- p_kitchen_id NULL (its default) that crashed every conversion and the only
  -- revert path. Scalars are NULL-safe. (Found by adversarial review,
  -- reproduced on live Postgres, 2026-07-27.)
  v_kitchen_geo     geography(Point, 4326);
  v_kitchen_address text;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;
  if coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  if p_type is null then
    raise exception 'TYPE_REQUIRED' using errcode = 'check_violation';
  end if;

  if p_kitchen_id is not null then
    select k.geo, k.address into v_kitchen_geo, v_kitchen_address
      from public.kitchens k where k.id = p_kitchen_id;
    if not found then
      raise exception 'KITCHEN_NOT_FOUND' using errcode = 'check_violation';
    end if;
  end if;

  update public.restaurants r set
    merchant_type = p_type,
    kitchen_id    = coalesce(p_kitchen_id, r.kitchen_id),
    -- Own brand: park the rate at the 100.00 sentinel and force-clear featured
    -- so the CHECK cannot reject the conversion. Third party: leave the rate
    -- alone -- it is a real commercial term.
    commission_pct = case when p_type = 'own_brand' then 100.00 else r.commission_pct end,
    featured       = case when p_type = 'own_brand' then false  else r.featured end,
    -- Dispatch, auto_assign_order and the driver app all read restaurants.geo,
    -- so an own brand must carry the kitchen's point, not NULL.
    geo     = coalesce(case when p_inherit_geo then v_kitchen_geo end, r.geo),
    address = coalesce(case when p_inherit_geo then v_kitchen_address end, r.address),
    updated_at = now()
  where r.id = p_restaurant_id;

  if not found then
    raise exception 'RESTAURANT_NOT_FOUND' using errcode = 'check_violation';
  end if;
end;
$function$;

revoke all on function public.admin_set_merchant_type(uuid, public.merchant_type, uuid, boolean) from public, anon;
grant execute on function public.admin_set_merchant_type(uuid, public.merchant_type, uuid, boolean) to authenticated;

comment on function public.admin_set_merchant_type(uuid, public.merchant_type, uuid, boolean) is
  'ADMIN: set a restaurant''s ownership type and kitchen atomically. own_brand parks commission_pct at the 100.00 sentinel, clears featured, and inherits the kitchen''s geo/address. Only writer of merchant_type. Mig 126.';

-- ---------------------------------------------------------------------------
-- 14) platform_revenue_report -- the ONE correct blended-take-rate calculation.
--
-- DOUBLE-COUNT TRAP: for a third party OUR revenue is commission_egp and
-- subtotal_egp belongs to the merchant. For an own brand OUR revenue is
-- subtotal_egp and commission_egp is an INTERNAL TRANSFER that must be counted
-- exactly once. Summing commission_egp across everything AND adding own-brand
-- food revenue counts own-brand commission twice.
--   (At the 100.00 sentinel the two are numerically equal, so a careless global
--   sum happens to look right. That is a coincidence of the rate, not a
--   correctness property. The split below is explicit on purpose.)
--
-- Returns BOTH rates: blended jumps sharply once own brands trade, which is
-- arithmetically right but misleading alone. The investor-facing "marketplace
-- take rate" is the third-party number. The dashboard must show both.
--
-- This is REVENUE, not profit -- there is no COGS in this schema. Do not label
-- any of it margin or profit in any UI.
-- ---------------------------------------------------------------------------
create or replace function public.platform_revenue_report(
  p_period_start date,
  p_period_end   date
)
returns table (
  gmv_egp                    bigint,
  third_party_gmv_egp        bigint,
  own_brand_gmv_egp          bigint,
  third_party_commission_egp bigint,
  own_brand_revenue_egp      bigint,
  net_revenue_egp            bigint,
  blended_take_rate_pct      numeric,
  marketplace_take_rate_pct  numeric,
  third_party_orders         bigint,
  own_brand_orders           bigint
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;
  if coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'INVALID_PERIOD' using errcode = 'check_violation';
  end if;

  return query
  with f as (
    select fin.subtotal_egp,
           fin.commission_egp,
           (r.merchant_type = 'own_brand') as is_own
      from public.order_financials fin
      join public.restaurants r on r.id = fin.restaurant_id
     where fin.delivered_at::date between p_period_start and p_period_end
  ),
  t as (
    select
      coalesce(sum(fx.subtotal_egp), 0)::bigint                             as gmv,
      coalesce(sum(fx.subtotal_egp) filter (where not fx.is_own), 0)::bigint as tp_gmv,
      coalesce(sum(fx.subtotal_egp) filter (where fx.is_own), 0)::bigint     as ob_gmv,
      -- Third-party commission ONLY. Own-brand commission_egp is an internal
      -- transfer and is intentionally never read here.
      coalesce(sum(fx.commission_egp) filter (where not fx.is_own), 0)::bigint as tp_comm,
      count(*) filter (where not fx.is_own)::bigint                          as tp_orders,
      count(*) filter (where fx.is_own)::bigint                              as ob_orders
    from f fx
  )
  select
    t.gmv, t.tp_gmv, t.ob_gmv, t.tp_comm,
    t.ob_gmv               as own_brand_revenue_egp,
    (t.tp_comm + t.ob_gmv) as net_revenue_egp,
    case when t.gmv    > 0 then round(100.0 * (t.tp_comm + t.ob_gmv) / t.gmv, 2) else null end,
    case when t.tp_gmv > 0 then round(100.0 * t.tp_comm / t.tp_gmv, 2)           else null end,
    t.tp_orders, t.ob_orders
  from t;
end;
$function$;

revoke all on function public.platform_revenue_report(date, date) from public, anon;
grant execute on function public.platform_revenue_report(date, date) to authenticated;

comment on function public.platform_revenue_report(date, date) is
  'ADMIN: blended take rate without double-counting own-brand revenue. net_revenue = third-party commission + own-brand food revenue; own-brand commission_egp is an internal transfer and is never summed. REVENUE, not profit -- no COGS in this schema. Mig 126.';

-- ---------------------------------------------------------------------------
-- 15) ranking_integrity_audit -- the due-diligence artefact.
-- A constraint proves the CURRENT state; this is the thing you show someone.
-- A VIEW (not an RPC) so it can be read straight from a psql session.
-- security_invoker = on: without it the view runs as owner and becomes a
-- restaurants RLS bypass, which the Supabase security advisor flags.
-- ---------------------------------------------------------------------------
create or replace view public.ranking_integrity_audit as
  select
    r.id                        as restaurant_id,
    r.name,
    r.merchant_type,
    coalesce(r.featured, false) as featured,
    r.is_active,
    k.name                      as kitchen_name,
    (r.merchant_type <> 'own_brand' or coalesce(r.featured, false) = false) as ranking_promise_held
  from public.restaurants r
  left join public.kitchens k on k.id = r.kitchen_id;

alter view public.ranking_integrity_audit set (security_invoker = on);

comment on view public.ranking_integrity_audit is
  'DD artefact (mig 126): one row per merchant asserting "own brands are never featured". ranking_promise_held must be true for every row; restaurants_own_brand_never_featured_chk makes it impossible for it to be false. security_invoker so the caller''s RLS applies.';

revoke all on public.ranking_integrity_audit from anon;
grant select on public.ranking_integrity_audit to authenticated;

-- ---------------------------------------------------------------------------
-- 16) BATCHING -- five brands, ONE pickup point.
--
-- batch_candidates() keys on same_restaurant = (a.restaurant_id = b.restaurant_id).
-- Two orders from Corallo and Sinai Smash are the same physical counter and the
-- same bag pickup, but evaluate false. The pair is still logged (both carry the
-- kitchen's geo, so st_distance = 0 <= 400m) -- but same_restaurant is the exact
-- field the Phase 0 experiment exists to measure. Logging our single best
-- batching opportunity as a different-restaurant pair systematically
-- understates the case for building Phase 1. It also depends on float-equal
-- geo, which breaks the moment someone nudges one brand's map pin.
--
-- Fix: resolve a PICKUP IDENTITY = coalesce(kitchen_id, restaurant_id) and
-- compare that. This is precisely why kitchen_id is a real FK rather than a
-- derived geo comparison.
--
-- RETURN TYPE CHANGES -> DROP FIRST. CREATE OR REPLACE cannot change a
-- function's return type. The arg list stays () so there is exactly one
-- overload afterwards, but a dropped-and-recreated function gets FRESH default
-- PUBLIC EXECUTE -- hence the explicit revoke below (house rule 3).
-- ---------------------------------------------------------------------------
alter table public.batch_candidate_log
  add column if not exists same_pickup boolean;

comment on column public.batch_candidate_log.same_pickup is
  'Both orders share one physical pickup point (kitchen-aware). NULL = logged before mig 126; deliberately not backfilled.';

drop function if exists public.batch_candidates();

create function public.batch_candidates()
returns table (
  order_a uuid,
  order_b uuid,
  same_restaurant boolean,
  same_pickup boolean,
  pickup_gap_m integer,
  dropoff_gap_m integer,
  ready_gap_min numeric,
  zone text
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with cfg as (
    select
      coalesce((select (value #>> '{}')::int from public.platform_settings where key='batch_max_pickup_gap_m'), 400)  as max_pickup_gap,
      coalesce((select (value #>> '{}')::int from public.platform_settings where key='batch_max_dropoff_gap_m'), 1500) as max_dropoff_gap,
      coalesce((select (value #>> '{}')::int from public.platform_settings where key='batch_ready_window_min'), 6)     as ready_window
  ),
  cand as (
    select o.id, o.restaurant_id, o.zone::text as zone, o.dropoff_geo,
           coalesce(o.ready_at, o.placed_at) as ready_ts,
           -- [126] Prefer the kitchen's own point over the storefront's copy.
           coalesce(k.geo, r.geo) as pickup_geo,
           -- [126] Pickup identity: the kitchen if there is one, else the
           -- restaurant itself. Five brands in one kitchen collapse to one id.
           coalesce(r.kitchen_id, r.id) as pickup_id
    from public.orders o
    join public.restaurants r on r.id = o.restaurant_id
    left join public.kitchens k on k.id = r.kitchen_id
    where o.status in ('ready','preparing')
      and o.assigned_driver_id is null
      and o.scheduled_for is null
      and o.dropoff_geo is not null
      and coalesce(k.geo, r.geo) is not null
  )
  select
    a.id, b.id,
    (a.restaurant_id = b.restaurant_id),
    (a.pickup_id = b.pickup_id),
    st_distance(a.pickup_geo, b.pickup_geo)::int,
    st_distance(a.dropoff_geo, b.dropoff_geo)::int,
    round((abs(extract(epoch from (a.ready_ts - b.ready_ts))) / 60.0)::numeric, 1),
    a.zone
  from cand a
  join cand b on a.id < b.id and a.zone = b.zone
  cross join cfg
  where (
      -- [126] Same physical counter: distance is irrelevant, it is one stop.
      -- Also removes the dependency on float-equal geo between brand rows.
      a.pickup_id = b.pickup_id
      or st_distance(a.pickup_geo, b.pickup_geo) <= cfg.max_pickup_gap
    )
    and st_distance(a.dropoff_geo, b.dropoff_geo) <= cfg.max_dropoff_gap
    and abs(extract(epoch from (a.ready_ts - b.ready_ts))) / 60.0 <= cfg.ready_window;
$function$;

revoke all on function public.batch_candidates() from public, anon;
grant execute on function public.batch_candidates() to authenticated;

comment on function public.batch_candidates() is
  'PHASE 0, read-only: order pairs currently eligible to batch (does NOT batch them). same_pickup is kitchen-aware -- five virtual brands in one cloud kitchen are ONE pickup point. Thresholds from platform_settings. Migs 085, 126.';

-- batch_shadow_sweep must carry the new column through. Arg list unchanged ().
create or replace function public.batch_shadow_sweep()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_n int := 0;
begin
  if not coalesce((select (value #>> '{}')::boolean from public.platform_settings where key='batch_shadow_logging'), false) then
    return 0;
  end if;
  insert into public.batch_candidate_log
    (order_a, order_b, same_restaurant, same_pickup, pickup_gap_m, dropoff_gap_m, ready_gap_min, zone)
  select c.order_a, c.order_b, c.same_restaurant, c.same_pickup, c.pickup_gap_m, c.dropoff_gap_m, c.ready_gap_min, c.zone
  from public.batch_candidates() c
  on conflict (order_a, order_b) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

revoke all on function public.batch_shadow_sweep() from public, anon, authenticated;

comment on function public.batch_shadow_sweep() is
  'CRON (every 2 min): log currently-eligible batch pairs when batch_shadow_logging is on. Records same_pickup (kitchen-aware) alongside same_restaurant. Migs 085, 126.';

-- 127_quote_fee_vertical.sql
--
-- Fix: quote_delivery_fee hardcoded vertical_id = 'food', so a fee rule for
-- any other vertical could never fire (docs/VERTICALS-ROADMAP.md Phase 0 item
-- 1 — a live bug, not a feature). Resolve the merchant's actual vertical_id
-- and prefer a (zone, that-vertical) rule, falling back to the zone's
-- NULL-vertical rule, exactly as the delivery_fee_rules unique index
-- (zone_id, coalesce(vertical_id,'')) was designed for (mig 010).
--
-- Body taken from PRODUCTION via pg_get_functiondef (house rule 2 — the repo
-- is not the source of truth for bodies), one change: the vertical
-- resolution. Signature UNCHANGED (uuid, geography, integer default 0) ->
-- CREATE OR REPLACE cannot create a second overload (house rule 1), and the
-- existing ACL is preserved untouched — this function is on the guest
-- checkout quoting path, so grants are deliberately not restated here.
--
-- Standalone, additive, idempotent. No binary coupling. Rollback: re-apply
-- the previous body (prod dump archived in this file's git history).

create or replace function public.quote_delivery_fee(p_restaurant_id uuid, p_dropoff geography, p_subtotal integer default 0)
returns integer
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_zone     zone_type;
  v_vertical text;
  v_rule     public.delivery_fee_rules;
  v_fee      int;
begin
  v_zone := public.resolve_zone_nearest(p_dropoff);

  -- [127] The merchant's actual vertical, not a hardcoded 'food'. coalesce is
  -- belt-and-braces: restaurants.vertical_id defaults 'food' and was
  -- backfilled in mig 006, but a NULL must not turn the preference filter off.
  select coalesce(r.vertical_id, 'food') into v_vertical
    from public.restaurants r where r.id = p_restaurant_id;
  v_vertical := coalesce(v_vertical, 'food');  -- merchant not found -> behave as before

  -- Prefer a (zone, merchant-vertical) rule; fall back to (zone, null vertical).
  select * into v_rule from public.delivery_fee_rules
   where zone_id = v_zone and (vertical_id = v_vertical or vertical_id is null)
   order by vertical_id nulls last
   limit 1;

  if not found then
    return 30;  -- safe default if no rule configured
  end if;

  -- MVP: flat base (per_km_fee defaults 0). Free over threshold honored.
  if v_rule.free_over is not null and p_subtotal >= v_rule.free_over then
    return 0;
  end if;
  v_fee := greatest(v_rule.base_fee, v_rule.min_fee);
  return v_fee;
end;
$function$;

comment on function public.quote_delivery_fee(uuid, geography, integer) is
  'Delivery fee quote for a merchant + dropoff. Vertical-aware since mig 127: prefers the (zone, merchant vertical) rule, falls back to the zone''s NULL-vertical rule, then a 30 EGP default. Called by place_order and checkout preview.';

-- 128_zone_distance_guard.sql
--
-- Fix: resolve_zone_nearest silently assigned ANY point on Earth to the
-- nearest Sharm zone — there was no "out of service area" answer. Today the
-- blast radius is bounded (place_order independently rejects out-of-radius
-- dropoffs via delivery_feasibility, mig 079), so the exposure was quoting
-- previews and address/zone resolution — plus the latent city-#2 bug where a
-- Hurghada pin would resolve to a Sharm zone.
--
-- Fix shape (the pragmatic option): beyond a max distance from the nearest
-- active centroid, return NULL and let callers reject/fallback. Zone polygon
-- boundaries (the "correct" fix) need real geometry for 11 zones that does
-- not exist — boundary is populated in 0 of 11 prod rows, so the ST_Contains
-- branch is retained but currently dead; if boundaries are ever drawn it
-- starts working with no further change.
--
-- The threshold is a platform_settings knob (house config pattern, cf.
-- batch_max_pickup_gap_m) so city #2 is a data change: 15 km default is
-- generous for Sharm's ~25 km corridor of 11 zone centroids.
--
-- Caller behaviour on NULL, verified: quote_delivery_fee finds no rule for a
-- NULL zone and returns its 30 EGP default (harmless preview); place_order
-- writes orders.zone (nullable) but its delivery_feasibility gate rejects the
-- order first with OUT_OF_RANGE.
--
-- Body taken from PRODUCTION via pg_get_functiondef (house rule 2).
-- Signature UNCHANGED (geography) -> no second overload (house rule 1); ACL
-- preserved untouched.
--
-- Standalone, additive, idempotent.

insert into public.platform_settings (key, value)
values ('service_zone_max_distance_m', to_jsonb(15000))
on conflict (key) do nothing;

create or replace function public.resolve_zone_nearest(p_geo geography)
returns zone_type
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(
    (select id from public.zones
       where boundary is not null and st_contains(boundary::geometry, p_geo::geometry)
       limit 1),
    (select id from public.zones
       where centroid is not null and is_active
         -- [128] Beyond the service radius there is NO zone: return NULL and
         -- let callers reject, instead of assigning a Cairo pin to Naama.
         and st_distance(centroid, p_geo) <= coalesce(
               (select (value #>> '{}')::int from public.platform_settings
                 where key = 'service_zone_max_distance_m'), 15000)
       order by st_distance(centroid, p_geo) asc
       limit 1)
  );
$function$;

comment on function public.resolve_zone_nearest(geography) is
  'Zone for a point: containing boundary if one is drawn (none are today), else the nearest active centroid WITHIN service_zone_max_distance_m (platform_settings, default 15 km) — NULL beyond that. NULL means "not in the service area"; callers must handle it. Migs 005, 128.';

-- 129_service_area_single_source.sql
--
-- Consolidate the Sharm service-area bounding box into ONE source of truth.
--
-- The box (lat 27.70-28.35, lng 34.20-34.70) existed as three independent
-- copies: apply_as_restaurant (mig 123), admin_upsert_kitchen (mig 126), and
-- a client-side advisory copy in apps/merchant-web/src/lib/wizardDraft.ts.
-- Three copies drift, and expanding to city #2 (Hurghada: docs/FINANCIALS.md
-- §5's growth path) would mean hunting hardcoded geography. After this
-- migration the box is a platform_settings row read by one helper; city #2
-- becomes a data change. The client copy remains, marked advisory-only --
-- the server is authoritative.
--
-- SQL bodies: apply_as_restaurant taken from PRODUCTION via
-- pg_get_functiondef (house rule 2); admin_upsert_kitchen from migration 126
-- (not yet in prod -- 129 applies after 126 in sequence). One change each:
-- the inline box test becomes a call to is_within_service_area(). Signatures
-- UNCHANGED (17 args / 11 args) -> no second overload (house rule 1); ACLs
-- preserved by CREATE OR REPLACE except where explicitly restated.
--
-- Standalone, additive, idempotent.

-- ---------------------------------------------------------------------------
-- 1) The box as data.
-- ---------------------------------------------------------------------------
insert into public.platform_settings (key, value)
values ('service_area_bbox',
        jsonb_build_object('lat_min', 27.70, 'lat_max', 28.35,
                           'lng_min', 34.20, 'lng_max', 34.70))
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2) The one reader. SECURITY INVOKER on purpose: it holds no privilege --
-- inside a SECURITY DEFINER caller it runs as that definer and reads the
-- settings row; the hardcoded fallback keeps it fail-safe if the row is ever
-- deleted or unreadable. A NULL input is OUT of area (fail closed).
-- ---------------------------------------------------------------------------
create or replace function public.is_within_service_area(p_lat double precision, p_lng double precision)
returns boolean
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select p_lat is not null and p_lng is not null
     and p_lat between coalesce((select (value ->> 'lat_min')::float8 from public.platform_settings where key = 'service_area_bbox'), 27.70)
                   and coalesce((select (value ->> 'lat_max')::float8 from public.platform_settings where key = 'service_area_bbox'), 28.35)
     and p_lng between coalesce((select (value ->> 'lng_min')::float8 from public.platform_settings where key = 'service_area_bbox'), 34.20)
                   and coalesce((select (value ->> 'lng_max')::float8 from public.platform_settings where key = 'service_area_bbox'), 34.70);
$function$;

revoke all on function public.is_within_service_area(double precision, double precision) from public, anon;
grant execute on function public.is_within_service_area(double precision, double precision) to authenticated;

comment on function public.is_within_service_area(double precision, double precision) is
  'THE service-area gate: point inside the service_area_bbox platform_settings row (hardcoded Sharm fallback). NULL input = false (fail closed). City #2 = update the settings row. Single source of truth since mig 129 -- do not re-inline the box anywhere.';

-- ---------------------------------------------------------------------------
-- 3) apply_as_restaurant -- prod body verbatim, box check swapped.
-- ---------------------------------------------------------------------------
create or replace function public.apply_as_restaurant(
  p_name text, p_description text, p_cuisines cuisine_type[], p_phone text,
  p_address text, p_zone zone_type, p_lat double precision, p_lng double precision,
  p_is_open_24h boolean, p_prep_low integer, p_prep_high integer,
  p_payout_method text, p_payout_bank_name text, p_payout_iban text,
  p_payout_wallet text, p_payout_holder text, p_terms_version text
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_existing uuid;
  v_slug text;
  v_base_slug text;
  v_restaurant_id uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;

  -- Idempotent: an account already linked to a restaurant returns that id.
  select restaurant_id into v_existing
    from public.merchant_staff where profile_id = v_uid limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  -- Fail closed on role: only plain customers may apply (admin/driver/dispatcher
  -- accounts are operational identities, not merchant prospects).
  select coalesce(role::text, '') into v_role from public.users where id = v_uid;
  if v_role is distinct from 'customer' then
    raise exception 'NOT_ELIGIBLE' using errcode = 'check_violation';
  end if;

  -- Input validation (fail fast, typed codes the web maps to copy).
  if p_name is null or length(btrim(p_name)) not between 2 and 120 then
    raise exception 'INVALID_NAME' using errcode = 'check_violation';
  end if;
  if p_phone is null or length(btrim(p_phone)) not between 6 and 20 then
    raise exception 'INVALID_PHONE' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.zones where id = p_zone and is_active) then
    raise exception 'ZONE_NOT_SERVED' using errcode = 'check_violation';
  end if;
  -- Service-area plausibility gate, not a service-radius proof (admin verifies
  -- on review). [129] Single source: is_within_service_area().
  if not public.is_within_service_area(p_lat, p_lng) then
    raise exception 'GEO_OUT_OF_AREA' using errcode = 'check_violation';
  end if;
  if p_terms_version is null or btrim(p_terms_version) = '' then
    raise exception 'TERMS_REQUIRED' using errcode = 'check_violation';
  end if;

  -- Unique slug from the name; collision gets a short random suffix.
  v_base_slug := btrim(regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g'), '-');
  if v_base_slug = '' then v_base_slug := 'restaurant'; end if;
  v_slug := v_base_slug;
  while exists (select 1 from public.restaurants where slug = v_slug) loop
    v_slug := v_base_slug || '-' || substr(md5(clock_timestamp()::text || random()::text), 1, 4);
  end loop;

  insert into public.restaurants (
    slug, name, description, cuisines, cuisine_label, cover_image, zone, geo,
    phone, address, is_open_24h, prep_time_low, prep_time_high,
    payout_method, payout_bank_name, payout_iban, payout_wallet, payout_holder,
    is_active, is_open, onboarding_status, commission_pct, tourist_safe,
    terms_version, terms_accepted_at
  ) values (
    v_slug, btrim(p_name), coalesce(btrim(p_description), ''), coalesce(p_cuisines, '{}'), '',
    '',  -- cover_image seeded by admin during menu review (RestaurantEditor)
    p_zone,
    st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
    btrim(p_phone), nullif(btrim(coalesce(p_address, '')), ''),
    coalesce(p_is_open_24h, false),
    coalesce(nullif(p_prep_low, 0), 10), coalesce(nullif(p_prep_high, 0), 30),
    nullif(btrim(coalesce(p_payout_method, '')), ''),
    nullif(btrim(coalesce(p_payout_bank_name, '')), ''),
    nullif(btrim(coalesce(p_payout_iban, '')), ''),
    nullif(btrim(coalesce(p_payout_wallet, '')), ''),
    nullif(btrim(coalesce(p_payout_holder, '')), ''),
    false,  -- is_active: invisible to customers until approve_restaurant
    false,  -- is_open: merchant flips Open from the dashboard once actually ready
    'submitted',
    15.0,
    false,
    btrim(p_terms_version),
    now()
  )
  returning id into v_restaurant_id;

  insert into public.merchant_staff (profile_id, restaurant_id, staff_role)
  values (v_uid, v_restaurant_id, 'owner');

  update public.users set role = 'merchant_staff', updated_at = now()
   where id = v_uid;

  -- Ops heads-up (Telegram via ops_alert). Best-effort: never block the apply.
  begin
    perform public.ops_alert(
      '🍽️ New restaurant application: ' || btrim(p_name) || ' (' || p_zone::text || ')'
    );
  exception when others then null;
  end;

  return v_restaurant_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4) admin_upsert_kitchen -- mig-126 body, box check swapped.
-- ---------------------------------------------------------------------------
create or replace function public.admin_upsert_kitchen(
  p_slug             text,
  p_name             text,
  p_zone             zone_type,
  p_address          text    default null,
  p_lat              numeric default null,
  p_lng              numeric default null,
  p_monthly_rent_egp int     default null,
  p_lease_start      date    default null,
  p_lease_end        date    default null,
  p_is_active        boolean default null,
  p_notes            text    default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_id  uuid;
  v_geo geography(Point, 4326);
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;
  if coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  if p_slug is null or btrim(p_slug) = '' or p_name is null or btrim(p_name) = '' then
    raise exception 'SLUG_AND_NAME_REQUIRED' using errcode = 'check_violation';
  end if;
  if coalesce(p_monthly_rent_egp, 0) < 0 then
    raise exception 'INVALID_RENT' using errcode = 'check_violation';
  end if;

  -- Service-area gate. [129] Single source: is_within_service_area().
  if p_lat is not null and p_lng is not null then
    if not public.is_within_service_area(p_lat::float8, p_lng::float8) then
      raise exception 'GEO_OUT_OF_AREA' using errcode = 'check_violation';
    end if;
    v_geo := st_setsrid(st_makepoint(p_lng::float8, p_lat::float8), 4326)::geography;
  end if;

  insert into public.kitchens (slug, name, zone, address, geo, monthly_rent_egp,
                               lease_start, lease_end, is_active, notes)
  values (btrim(p_slug), btrim(p_name), p_zone, p_address, v_geo,
          coalesce(p_monthly_rent_egp, 0), p_lease_start, p_lease_end,
          coalesce(p_is_active, true), p_notes)
  on conflict (slug) do update set
    name             = excluded.name,
    zone             = excluded.zone,
    -- NULL param = keep the stored value (referencing the raw p_* params, not
    -- excluded.*, because the VALUES row already coalesced the NOT NULL
    -- columns and would masquerade as a real value). To CLEAR an optional
    -- field, update the row directly -- this RPC only sets or keeps.
    address          = coalesce(p_address, public.kitchens.address),
    geo              = coalesce(v_geo, public.kitchens.geo),
    monthly_rent_egp = coalesce(p_monthly_rent_egp, public.kitchens.monthly_rent_egp),
    lease_start      = coalesce(p_lease_start, public.kitchens.lease_start),
    lease_end        = coalesce(p_lease_end, public.kitchens.lease_end),
    is_active        = coalesce(p_is_active, public.kitchens.is_active),
    notes            = coalesce(p_notes, public.kitchens.notes),
    updated_at       = now()
  returning id into v_id;

  return v_id;
end;
$function$;

comment on function public.admin_upsert_kitchen(text, text, zone_type, text, numeric, numeric, int, date, date, boolean, text) is
  'ADMIN: create or update a physical kitchen, keyed on slug. NULL optionals preserve stored values. Service area via is_within_service_area (mig 129). Only writer of public.kitchens. Migs 126, 129.';

-- =========================================================================
-- DRY-RUN ASSERTS (run inside the same transaction, after the migration).
-- These call the REAL functions against the REAL schema -- the validation
-- the shim suite cannot provide. Everything rolls back.
-- =========================================================================
do $assert$
declare
  v_admin uuid;
  v_kid   uuid;
  v_rid   uuid;
  v_rent  int;
  v_mt    public.merchant_type;
  v_geo_before geography;
  v_geo_after  geography;
  v_cnt   int;
  r       record;
begin
  -- Impersonate a real admin so auth.uid()/auth_role() gates pass.
  -- set_config(..., true) is transaction-local: gone at ROLLBACK.
  select u.id into v_admin from public.users u where u.role = 'admin' limit 1;
  if v_admin is null then
    raise exception 'DRYRUN: no admin user found to impersonate';
  end if;
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_admin, 'role', 'authenticated')::text,
                     true);
  if auth.uid() is distinct from v_admin then
    raise exception 'DRYRUN: jwt impersonation did not take (auth.uid()=%)', auth.uid();
  end if;

  -- 1) Overload check: exactly one definition per replaced function.
  select count(*) into v_cnt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('generate_settlements','settlement_sweep','loyalty_tier_sweep',
                       'admin_update_restaurant','admin_set_commission',
                       'admin_upsert_kitchen','admin_set_merchant_type',
                       'platform_revenue_report','batch_candidates','batch_shadow_sweep');
  if v_cnt <> 10 then
    raise exception 'DRYRUN FAIL: expected 10 single-overload functions, found % definitions', v_cnt;
  end if;
  raise notice 'assert 1 OK: 10 functions, no duplicate overloads';

  -- 2) admin_upsert_kitchen: create, then partial re-call must PRESERVE rent.
  v_kid := public.admin_upsert_kitchen(
    'dryrun-mercato', 'Dry Run Kitchen', 'hadaba',
    p_address => 'Mercato, Hadaba', p_lat => 27.85, p_lng => 34.30,
    p_monthly_rent_egp => 40000);
  v_kid := public.admin_upsert_kitchen('dryrun-mercato', 'Dry Run Kitchen', 'hadaba');
  select monthly_rent_egp into v_rent from public.kitchens where id = v_kid;
  if v_rent <> 40000 then
    raise exception 'DRYRUN FAIL: partial upsert wiped rent (now %)', v_rent;
  end if;
  raise notice 'assert 2 OK: admin_upsert_kitchen preserves omitted fields (rent=%)', v_rent;

  -- 3) THE CRASH CASE: admin_set_merchant_type with NULL kitchen (its default).
  select id, geo into v_rid, v_geo_before from public.restaurants
   where is_active limit 1;
  perform public.admin_set_merchant_type(v_rid, 'own_brand');
  select merchant_type, geo into v_mt, v_geo_after from public.restaurants where id = v_rid;
  if v_mt <> 'own_brand' then
    raise exception 'DRYRUN FAIL: NULL-kitchen conversion did not set own_brand';
  end if;
  if v_geo_after is distinct from v_geo_before then
    raise exception 'DRYRUN FAIL: NULL-kitchen conversion must not touch geo';
  end if;
  raise notice 'assert 3 OK: admin_set_merchant_type(id, own_brand) with NULL kitchen works, geo untouched';

  -- 4) With a kitchen: geo/address inherit.
  perform public.admin_set_merchant_type(v_rid, 'own_brand', v_kid);
  select geo into v_geo_after from public.restaurants where id = v_rid;
  if v_geo_after is null or st_distance(v_geo_after, (select geo from public.kitchens where id = v_kid)) > 1 then
    raise exception 'DRYRUN FAIL: kitchen geo was not inherited';
  end if;
  raise notice 'assert 4 OK: kitchen geo/address inherited on conversion';

  -- 5) Revert path (previously crashed).
  perform public.admin_set_merchant_type(v_rid, 'third_party');
  select merchant_type into v_mt from public.restaurants where id = v_rid;
  if v_mt <> 'third_party' then
    raise exception 'DRYRUN FAIL: revert to third_party failed';
  end if;
  raise notice 'assert 5 OK: revert to third_party works';

  -- 6) Ranking integrity bites on the REAL table.
  perform public.admin_set_merchant_type(v_rid, 'own_brand', v_kid);
  begin
    update public.restaurants set featured = true where id = v_rid;
    raise exception 'DRYRUN FAIL: featured=true was allowed on an own brand';
  exception when check_violation then
    raise notice 'assert 6 OK: own brand cannot be featured (real constraint)';
  end;

  -- 7) The REAL sweeps run clean end to end with an own brand present.
  perform public.loyalty_tier_sweep();
  select coalesce(featured, false), commission_pct into r from public.restaurants where id = v_rid;
  if r.coalesce then
    raise exception 'DRYRUN FAIL: loyalty sweep featured an own brand';
  end if;
  perform public.settlement_sweep();
  select count(*) into v_cnt from public.restaurant_settlements
   where restaurant_id = v_rid
     and period_start = (date_trunc('week', now()) - interval '7 days')::date;
  if v_cnt <> 0 then
    raise exception 'DRYRUN FAIL: settlement_sweep drafted a row for an own brand';
  end if;
  raise notice 'assert 7 OK: real loyalty_tier_sweep + settlement_sweep leave own brands alone';

  -- 8) Reports + batching execute against the real schema.
  select * into r from public.platform_revenue_report(current_date - 7, current_date);
  raise notice 'assert 8a OK: platform_revenue_report ran (gmv=% net=%)', r.gmv_egp, r.net_revenue_egp;
  select count(*) into v_cnt from public.batch_candidates();
  raise notice 'assert 8b OK: kitchen-aware batch_candidates ran (% pairs)', v_cnt;
  select count(*) into v_cnt from public.ranking_integrity_audit where not ranking_promise_held;
  if v_cnt <> 0 then
    raise exception 'DRYRUN FAIL: ranking_integrity_audit shows % violations', v_cnt;
  end if;
  raise notice 'assert 9 OK: ranking_integrity_audit holds for every row';

  raise notice 'ALL DRY-RUN ASSERTS PASSED (everything rolls back next)';
end;
$assert$;

-- =========================================================================
-- 127-129 ASSERTS (same transaction; jwt is still the admin from above).
-- =========================================================================
do $assert2$
declare
  v_zone      zone_type;
  v_centroid  geography;
  v_rid       uuid;
  v_fee       int;
  v_customer  uuid;
  v_new       uuid;
begin
  -- 10) Zone guard: Cairo resolves to NO zone; a real centroid resolves.
  if public.resolve_zone_nearest(st_setsrid(st_makepoint(31.24, 30.04), 4326)::geography) is not null then
    raise exception 'DRYRUN FAIL: Cairo still resolves to a Sharm zone';
  end if;
  select centroid into v_centroid from public.zones
   where centroid is not null and is_active limit 1;
  if v_centroid is null or public.resolve_zone_nearest(v_centroid) is null then
    raise exception 'DRYRUN FAIL: a real zone centroid no longer resolves';
  end if;
  raise notice 'assert 10 OK: zone guard -- Cairo NULL, real centroid resolves';

  -- 11) Vertical-aware fee against the REAL tables.
  select r.id into v_rid from public.restaurants r
   where r.geo is not null and r.is_active limit 1;
  v_zone := public.resolve_zone_nearest((select geo from public.restaurants where id = v_rid));
  if v_zone is null then
    raise exception 'DRYRUN FAIL: test restaurant does not resolve to a zone';
  end if;
  delete from public.delivery_fee_rules where zone_id = v_zone;  -- tx-local
  insert into public.delivery_fee_rules (zone_id, vertical_id, base_fee) values
    (v_zone, null, 25), (v_zone, 'grocery', 40);
  update public.restaurants set vertical_id = 'grocery' where id = v_rid;
  select public.quote_delivery_fee(v_rid, (select geo from public.restaurants where id = v_rid), 0) into v_fee;
  if v_fee <> 40 then
    raise exception 'DRYRUN FAIL: grocery merchant quoted % not the grocery rule 40', v_fee;
  end if;
  update public.restaurants set vertical_id = 'food' where id = v_rid;
  select public.quote_delivery_fee(v_rid, (select geo from public.restaurants where id = v_rid), 0) into v_fee;
  if v_fee <> 25 then
    raise exception 'DRYRUN FAIL: food merchant quoted % not the fallback 25', v_fee;
  end if;
  raise notice 'assert 11 OK: vertical-aware fee (grocery 40, food fallback 25) on real tables';

  -- 12) Service-area helper on real settings.
  if not public.is_within_service_area(27.9, 34.4) or public.is_within_service_area(30.04, 31.24) then
    raise exception 'DRYRUN FAIL: is_within_service_area truth table wrong';
  end if;
  raise notice 'assert 12 OK: is_within_service_area (Sharm yes, Cairo no)';

  -- 13) admin_upsert_kitchen rejects out-of-area through the helper.
  begin
    perform public.admin_upsert_kitchen('dryrun-cairo', 'Cairo Kitchen', 'hadaba',
                                        p_lat => 30.04, p_lng => 31.24);
    raise exception 'DRYRUN FAIL: out-of-area kitchen was accepted';
  exception when check_violation then
    raise notice 'assert 13 OK: admin_upsert_kitchen raises GEO_OUT_OF_AREA via the helper';
  end;

  -- 14) apply_as_restaurant wired to the helper (impersonate a real customer;
  -- skipped with a notice if none exists).
  select u.id into v_customer
    from public.users u
   where u.role = 'customer'
     and not exists (select 1 from public.merchant_staff ms where ms.profile_id = u.id)
   limit 1;
  if v_customer is null then
    raise notice 'assert 14 SKIPPED: no unlinked customer user to impersonate';
  else
    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_customer, 'role', 'authenticated')::text,
                       true);
    begin
      perform public.apply_as_restaurant('Dry Run Diner', '', '{}'::cuisine_type[],
        '0123456789', null, 'hadaba', 30.04, 31.24, false, 10, 30,
        null, null, null, null, null, 'v1');
      raise exception 'DRYRUN FAIL: out-of-area application was accepted';
    exception when check_violation then
      raise notice 'assert 14a OK: out-of-area application raises GEO_OUT_OF_AREA';
    end;
    v_new := public.apply_as_restaurant('Dry Run Diner', '', '{}'::cuisine_type[],
      '0123456789', null, 'hadaba', 27.9, 34.4, false, 10, 30,
      null, null, null, null, null, 'v1');
    if v_new is null then
      raise exception 'DRYRUN FAIL: in-area application did not return an id';
    end if;
    raise notice 'assert 14b OK: in-area application accepted (rolled back)';
  end if;

  raise notice 'ALL 127-129 DRY-RUN ASSERTS PASSED';
end;
$assert2$;

rollback;
select 'DRY RUN COMPLETE - everything rolled back' as result;
