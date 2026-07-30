-- 182_fx_rates.sql
--
-- Package 05 Slice B: server-tracked display FX with honest freshness.
--
-- ================= WHY =================
-- The customer app converts EGP totals for display using a STATIC table whose
-- values have never changed since the Phase-0 baseline commit (verified via git
-- history 2026-07-30: EUR 52.85 et al. are planning numbers, not rates). The
-- checkout labels the conversion "indicative", which is honest wording around a
-- number with no freshness at all. This migration gives rates a server home
-- with real metadata — WHAT the rate is, WHERE it came from, WHEN it was
-- effective and when it goes stale — so the client can label conversions
-- truthfully and an operator can see rate health.
--
-- Charging is untouched: every order is priced, charged and settled in EGP
-- (place_order recomputes; paymob-create-intention sends currency EGP).
-- Conversion remains presentation only, and no client-supplied rate is
-- accepted anywhere.
--
-- ================= WHAT IS DEFERRED, DELIBERATELY =================
-- The live feed edge function. The spec's step 1 is an OWNER decision — a
-- primary and backup rate source with licence and cadence — that has not been
-- made. Building a fetcher against an unapproved source would put an unlicensed
-- dependency in the money-adjacent path. Until then the only writer is the
-- audited admin override; the feed function, when approved, gets
-- record_fx_observation as its ready-made contract (service_role only, same
-- validation as the manual path).
--
-- ================= SHAPE =================
--   fx_rates              immutable observations, INSERT-only even for writers.
--                         Exactly one 'active' row per quote currency (partial
--                         unique index); choosing a new rate = demote + insert
--                         in one transaction inside fx_apply_observation.
--   current_fx_rates()    the public read: active rate + computed staleness.
--                         Readable by anon too — a tourist picks a currency
--                         before signing in.
--   admin_set_fx_rate()   the audited manual override: reason, bounded expiry,
--                         actor recorded on the immutable row, jump guard.
--   record_fx_observation() service-role writer for the future feed.
--   fx_rates_health_sweep() daily cron: ONE aggregated alert for missing or
--                         stale actives; silent when healthy.

create table if not exists public.fx_rates (
  id             uuid primary key default gen_random_uuid(),
  base_currency  text not null default 'EGP' check (base_currency = 'EGP'),
  quote_currency text not null check (quote_currency in ('EUR', 'USD', 'GBP', 'RUB')),
  -- EGP per 1 unit of quote currency, matching the client's RATES_PER_UNIT
  -- orientation so a swapped-orientation bug is visually obvious (a EUR rate
  -- of 0.019 instead of ~52 fails the bounds check below).
  rate           numeric(12, 6) not null check (rate > 0),
  source         text not null check (length(btrim(source)) >= 3),
  -- clock_timestamp, not now(): now() is frozen per transaction, so two
  -- observations written in one transaction (the seed + an override, or two
  -- feed currencies in one batch... the dry run hit this in its first minute)
  -- would collide on the (base, quote, effective_at) unique key. An
  -- observation's effective time is wall-clock reality, not transaction start.
  effective_at   timestamptz not null default clock_timestamp(),
  fetched_at     timestamptz not null default clock_timestamp(),
  stale_after    timestamptz not null,
  status         text not null default 'active' check (status in ('active', 'superseded', 'disabled')),
  -- The audit trail IS the row: who (null = feed), why (manual overrides).
  actor_id       uuid references public.users(id) on delete set null,
  note           text,
  created_at     timestamptz not null default now(),
  unique (base_currency, quote_currency, effective_at)
);

-- Exactly one live rate per currency — the atomic-choice invariant.
create unique index if not exists fx_rates_one_active_per_quote
  on public.fx_rates (quote_currency)
  where status = 'active';

create index if not exists fx_rates_quote_effective_idx
  on public.fx_rates (quote_currency, effective_at desc);

alter table public.fx_rates enable row level security;

-- Rates are public data BY DESIGN (they render in an unauthenticated app), but
-- writes are not: revoke-first (house rule 5b), then SELECT back to both client
-- roles, with a read-everything policy. No write policy exists, and no write
-- grant either — belt and braces in the same direction for once.
revoke all on table public.fx_rates from public, anon, authenticated;
grant select on table public.fx_rates to anon, authenticated;
grant select, insert, update on table public.fx_rates to service_role;

create policy fx_rates_public_read on public.fx_rates
  for select using (true);

comment on table public.fx_rates is
  'Display-FX observations, EGP base, INSERT-only (supersede, never update a rate in place). One active row per quote currency enforced by fx_rates_one_active_per_quote. Writers: admin_set_fx_rate (audited manual) and record_fx_observation (service_role, for the owner-approved feed when it exists). Conversion is presentation only — charging is EGP everywhere. Mig 182.';

-- ---------------------------------------------------------------------------
-- Internal: validate + atomically choose the new active rate.
-- ---------------------------------------------------------------------------
create or replace function public.fx_apply_observation(
  p_quote text,
  p_rate numeric,
  p_source text,
  p_stale_hours int,
  p_actor uuid,
  p_note text,
  p_allow_jump boolean
)
returns uuid
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_prev public.fx_rates;
  v_jump_pct numeric;
  v_id uuid;
begin
  if p_quote not in ('EUR', 'USD', 'GBP', 'RUB') then
    raise exception 'UNSUPPORTED_QUOTE_CURRENCY' using errcode = 'check_violation';
  end if;
  -- Sanity bounds, not market knowledge: all four supported quotes trade
  -- between ~0.4 (RUB) and ~70 (GBP) EGP per unit. An order-of-magnitude
  -- escape (fat-fingered 5285 for 52.85, or an inverted 0.019) dies here.
  if p_rate is null or p_rate < 0.05 or p_rate > 500 then
    raise exception 'RATE_OUT_OF_BOUNDS: % EGP per unit fails the 0.05..500 sanity range', p_rate
      using errcode = 'check_violation';
  end if;
  if p_stale_hours is null or p_stale_hours < 1 or p_stale_hours > 720 then
    raise exception 'STALE_WINDOW_OUT_OF_BOUNDS' using errcode = 'check_violation';
  end if;

  select * into v_prev
    from public.fx_rates
   where quote_currency = p_quote and status = 'active'
   for update;

  -- Jump guard: a big move is either a market event or a mistake, and the
  -- caller must SAY which by passing p_allow_jump. Either way ops hears about
  -- it — an alert on a legitimate jump costs a glance; a silent wrong rate
  -- misprices every conversion a tourist sees.
  if v_prev.id is not null then
    v_jump_pct := abs(p_rate - v_prev.rate) / v_prev.rate * 100;
    if v_jump_pct > 10 then
      if not coalesce(p_allow_jump, false) then
        raise exception 'RATE_JUMP_REJECTED: % -> % is %.1f%% — re-run with allow_jump if intended',
          v_prev.rate, p_rate, v_jump_pct using errcode = 'check_violation';
      end if;
      perform public.ops_alert(
        'FX rate jump accepted: ' || p_quote || ' ' || v_prev.rate || ' -> ' || p_rate
        || ' (' || round(v_jump_pct, 1) || '%), source ' || p_source);
    end if;
    update public.fx_rates set status = 'superseded' where id = v_prev.id;
  end if;

  insert into public.fx_rates
    (quote_currency, rate, source, effective_at, fetched_at, stale_after,
     status, actor_id, note)
  values
    (p_quote, p_rate, btrim(p_source), clock_timestamp(), clock_timestamp(),
     clock_timestamp() + make_interval(hours => p_stale_hours), 'active', p_actor, p_note)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.fx_apply_observation(text, numeric, text, int, uuid, text, boolean)
  from public, anon, authenticated;

comment on function public.fx_apply_observation(text, numeric, text, int, uuid, text, boolean) is
  'Internal FX writer: validates (supported quote, 0.05..500 sanity bounds, 1..720h stale window), enforces the >10% jump guard with a mandatory ops_alert on accepted jumps, and atomically supersedes the previous active row. No client grant of any kind — reached definer-to-definer by admin_set_fx_rate and record_fx_observation. Mig 182.';

-- ---------------------------------------------------------------------------
-- Public read
-- ---------------------------------------------------------------------------
create or replace function public.current_fx_rates()
returns table (
  quote_currency text,
  rate           numeric,
  source         text,
  effective_at   timestamptz,
  stale_after    timestamptz,
  stale          boolean
)
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select r.quote_currency, r.rate, r.source, r.effective_at, r.stale_after,
         now() > r.stale_after as stale
    from public.fx_rates r
   where r.status = 'active'
   order by r.quote_currency;
$$;

revoke all on function public.current_fx_rates() from public, anon;
grant execute on function public.current_fx_rates() to anon, authenticated;

comment on function public.current_fx_rates() is
  'The one client-facing FX read: active rate per quote currency with a computed stale flag. Readable by anon (currency choice precedes sign-in). The client must render a stale rate as "approximate, last updated ..." or fall back to EGP-only — never as current. Mig 182.';

-- ---------------------------------------------------------------------------
-- Audited manual override — the ONLY writer until a feed source is approved
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_fx_rate(
  p_quote text,
  p_rate numeric,
  p_reason text,
  p_stale_hours int default 168,   -- manual rates default to a 7-day shelf life
  p_allow_jump boolean default false
)
returns uuid
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'REASON_REQUIRED' using errcode = 'check_violation';
  end if;
  return public.fx_apply_observation(
    p_quote, p_rate, 'manual', p_stale_hours, auth.uid(), btrim(p_reason), p_allow_jump);
end;
$$;

revoke all on function public.admin_set_fx_rate(text, numeric, text, int, boolean)
  from public, anon, authenticated;
grant execute on function public.admin_set_fx_rate(text, numeric, text, int, boolean)
  to authenticated;

comment on function public.admin_set_fx_rate(text, numeric, text, int, boolean) is
  'ADMIN ONLY (fail-closed): manual FX override with mandatory reason, bounded expiry (default 7 days) and the actor stamped on the immutable observation row — the row IS the audit. Inherits the jump guard. Mig 182.';

-- ---------------------------------------------------------------------------
-- Feed writer (contract for the future edge function; unused until the owner
-- approves a rate source and licence)
-- ---------------------------------------------------------------------------
create or replace function public.record_fx_observation(
  p_quote text,
  p_rate numeric,
  p_source text,
  p_stale_hours int default 36,    -- a daily feed that misses one fetch goes stale
  p_allow_jump boolean default false
)
returns uuid
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if coalesce((select auth.jwt()->>'role'), '') <> 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  if p_source is null or length(btrim(p_source)) < 3 or btrim(p_source) = 'manual' then
    raise exception 'FEED_SOURCE_REQUIRED' using errcode = 'check_violation';
  end if;
  return public.fx_apply_observation(
    p_quote, p_rate, p_source, p_stale_hours, null, null, p_allow_jump);
end;
$$;

revoke all on function public.record_fx_observation(text, numeric, text, int, boolean)
  from public, anon, authenticated;
grant execute on function public.record_fx_observation(text, numeric, text, int, boolean)
  to service_role;

comment on function public.record_fx_observation(text, numeric, text, int, boolean) is
  'SERVICE ROLE ONLY: the rate-feed contract for the future edge function (owner has not yet approved a source/licence — Package 05 Slice B step 1). Source must name the feed; ''manual'' is reserved for the admin path. Mig 182.';

-- ---------------------------------------------------------------------------
-- Daily health sweep
-- ---------------------------------------------------------------------------
create or replace function public.fx_rates_health_sweep()
returns integer
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_problems text;
  v_count int;
begin
  -- One aggregated line, silent when healthy — same alert contract as the
  -- payment reconciliation sweep.
  select count(*)::int,
         string_agg(q.currency || ': ' || coalesce(
           case when r.id is null then 'NO ACTIVE RATE'
                when now() > r.stale_after then 'stale since ' || r.stale_after::date
           end, ''), ', ')
    into v_count, v_problems
    from (values ('EUR'), ('USD'), ('GBP'), ('RUB')) as q(currency)
    left join public.fx_rates r
      on r.quote_currency = q.currency and r.status = 'active'
   where r.id is null or now() > r.stale_after;

  if coalesce(v_count, 0) > 0 then
    perform public.ops_alert(
      'FX RATE HEALTH: ' || v_count || ' currency(ies) need attention — ' || v_problems
      || '. Fix: admin_set_fx_rate(quote, rate, reason). The app labels these approximate/EGP-only meanwhile.');
  end if;
  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.fx_rates_health_sweep()
  from public, anon, authenticated;

comment on function public.fx_rates_health_sweep() is
  'Daily FX freshness check (cron sharmeats-fx-health): one aggregated ops_alert when any supported quote currency has no active rate or an expired one; silent when healthy. Returns the problem count for cron.job_run_details. Mig 182.';

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule(
      'sharmeats-fx-health',
      '15 4 * * *',
      $job$select public.fx_rates_health_sweep();$job$);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Seed: the static client table's values become the first observations, marked
-- for what they are — the Phase-0 planning numbers, already past their shelf
-- life conceptually, so they get a short window and the health sweep starts
-- nagging until an operator sets real rates.
-- ---------------------------------------------------------------------------
insert into public.fx_rates
  (quote_currency, rate, source, effective_at, fetched_at, stale_after, status, note)
select v.quote, v.rate, 'baseline:static-table', clock_timestamp(), clock_timestamp(),
       clock_timestamp() + interval '7 days', 'active',
       'Seeded from the client''s static RATES_PER_UNIT at mig 182 — Phase-0 planning values, never updated in repo history. Replace via admin_set_fx_rate.'
  from (values ('EUR', 52.85), ('USD', 48.40), ('GBP', 61.50), ('RUB', 0.51))
       as v(quote, rate)
 where not exists (
   select 1 from public.fx_rates r
    where r.quote_currency = v.quote and r.status = 'active');
