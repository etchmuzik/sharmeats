-- 183_acquisition_touches.sql
--
-- Package 05 Slice D: first-touch acquisition attribution.
--
-- Green field verified 2026-07-30: no acquisition table, no orders source
-- column, no install id, no QR/UTM reader anywhere. The referral system (migs
-- 026/122) is promo-box based and stays fully distinct — its SHARM- namespace
-- never crosses this model, and nothing here carries a commission value.
--
-- ================= MODEL =================
-- Append-only touches per client-minted install id:
--   * ONE 'first' touch per install (partial unique index). Recorded on first
--     launch as 'organic' when no link brought the user; a REAL source arriving
--     within 72h may UPGRADE an organic/unknown first touch — deferred deep
--     linking cannot beat the store redirect, and an organic default is the
--     absence of knowledge, not a "known earlier source" the spec protects.
--   * ONE bounded 'campaign' touch per install (latest wins) — the spec's
--     "record a bounded last campaign/order touch separately".
-- Sign-in claims the install's touches for the user (first claim wins; a
-- claimed touch never re-binds). Orders are stamped by TRIGGER from the
-- customer's first touch — the column has no client grant, place_order is
-- untouched, and no client-supplied value participates.
--
-- Partner codes are allow-listed in acquisition_partners (admin-managed);
-- an unknown code is DROPPED, not trusted. No payout model exists — the spec
-- forbids one until attribution accuracy is proven.

create table if not exists public.acquisition_partners (
  code       text primary key check (code ~ '^[A-Z0-9_-]{3,32}$'),
  label      text not null check (length(btrim(label)) between 3 and 80),
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.acquisition_partners enable row level security;
revoke all on table public.acquisition_partners from public, anon, authenticated;
grant select, insert, update, delete on table public.acquisition_partners to service_role;

create table if not exists public.acquisition_touches (
  id           uuid primary key default gen_random_uuid(),
  install_id   uuid not null,
  user_id      uuid references public.users(id) on delete set null,
  kind         text not null check (kind in ('first', 'campaign')),
  source       text not null check (source in
                 ('hotel_qr','airport_card','taxi_card','merchant_insert',
                  'referral','paid_social','paid_search','organic','unknown')),
  medium       text check (length(medium) <= 40),
  campaign     text check (length(campaign) <= 64),
  partner_code text references public.acquisition_partners(code),
  deep_link    text check (length(deep_link) <= 200),
  occurred_at  timestamptz not null default clock_timestamp(),
  claimed_at   timestamptz
);

create unique index if not exists acquisition_touches_one_first_per_install
  on public.acquisition_touches (install_id) where kind = 'first';
create unique index if not exists acquisition_touches_one_campaign_per_install
  on public.acquisition_touches (install_id) where kind = 'campaign';
create index if not exists acquisition_touches_user_first_idx
  on public.acquisition_touches (user_id) where kind = 'first';

alter table public.acquisition_touches enable row level security;
revoke all on table public.acquisition_touches from public, anon, authenticated;
grant select, insert, update, delete on table public.acquisition_touches to service_role;

comment on table public.acquisition_touches is
  'First-touch + bounded last-campaign attribution per client install id. Writes only through record_acquisition_touch / claim_acquisition_touches; orders are stamped by trigger from the FIRST touch. Partner codes must exist in acquisition_partners — arbitrary codes are dropped. Distinct from the referral system by design. Mig 183.';

-- orders link: written by trigger only. Column-level: no client grant of any
-- kind (orders' broad grants were locked down long ago; this new column gets
-- nothing to begin with).
alter table public.orders
  add column if not exists acquisition_touch_id uuid references public.acquisition_touches(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Touch recording (anon-callable: the first launch precedes sign-in)
-- ---------------------------------------------------------------------------
create or replace function public.record_acquisition_touch(
  p_install_id uuid,
  p_source text,
  p_medium text default null,
  p_campaign text default null,
  p_partner_code text default null,
  p_deep_link text default null
)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_source text;
  v_partner text;
  v_first public.acquisition_touches;
begin
  if p_install_id is null then return; end if;

  -- Attribution must never break the app: junk degrades to 'unknown', it
  -- does not raise.
  v_source := case when p_source in
      ('hotel_qr','airport_card','taxi_card','merchant_insert',
       'referral','paid_social','paid_search','organic','unknown')
    then p_source else 'unknown' end;

  -- Allow-listed partner codes only; an arbitrary code is dropped silently.
  select code into v_partner from public.acquisition_partners
   where code = upper(btrim(coalesce(p_partner_code, ''))) and is_active;

  select * into v_first from public.acquisition_touches
   where install_id = p_install_id and kind = 'first';

  if v_first.id is null then
    insert into public.acquisition_touches
      (install_id, user_id, kind, source, medium, campaign, partner_code, deep_link)
    values
      (p_install_id, auth.uid(), 'first', v_source,
       left(p_medium, 40), left(p_campaign, 64), v_partner, left(p_deep_link, 200))
    on conflict do nothing;  -- racing first launches: one wins, both fine
  elsif v_first.source in ('organic', 'unknown')
        and v_source not in ('organic', 'unknown')
        and v_first.occurred_at > now() - interval '72 hours' then
    -- The upgrade window: a store-redirect install opens organic, then the
    -- customer follows the QR/link that actually brought them. A KNOWN source
    -- is never overwritten, and after 72h even organic is settled history.
    update public.acquisition_touches
       set source = v_source,
           medium = coalesce(left(p_medium, 40), medium),
           campaign = coalesce(left(p_campaign, 64), campaign),
           partner_code = coalesce(v_partner, partner_code),
           deep_link = coalesce(left(p_deep_link, 200), deep_link)
     where id = v_first.id;
  end if;

  -- Bounded last-campaign touch: only for real campaign-ish arrivals, latest
  -- wins, one row per install — never more.
  if v_source not in ('organic', 'unknown') then
    insert into public.acquisition_touches
      (install_id, user_id, kind, source, medium, campaign, partner_code, deep_link)
    values
      (p_install_id, auth.uid(), 'campaign', v_source,
       left(p_medium, 40), left(p_campaign, 64), v_partner, left(p_deep_link, 200))
    on conflict (install_id) where kind = 'campaign'
    do update set source = excluded.source, medium = excluded.medium,
                  campaign = excluded.campaign, partner_code = excluded.partner_code,
                  deep_link = excluded.deep_link, occurred_at = clock_timestamp();
  end if;
end;
$$;

revoke all on function public.record_acquisition_touch(uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_acquisition_touch(uuid, text, text, text, text, text)
  to anon, authenticated;

comment on function public.record_acquisition_touch(uuid, text, text, text, text, text) is
  'Records the FIRST touch per install (organic/unknown upgradeable to a real source within 72h — deferred deep links cannot beat the store redirect) and a bounded latest-campaign touch. Unknown sources degrade to unknown, arbitrary partner codes are dropped: attribution never errors the app and never trusts client-invented values. Mig 183.';

-- ---------------------------------------------------------------------------
-- Claim on sign-in: attribution survives registration
-- ---------------------------------------------------------------------------
create or replace function public.claim_acquisition_touches(p_install_id uuid)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or p_install_id is null then return; end if;
  -- First claim wins: a touch already bound to ANOTHER user never re-binds
  -- (a shared device's second account does not steal the first's attribution).
  update public.acquisition_touches
     set user_id = auth.uid(), claimed_at = now()
   where install_id = p_install_id
     and (user_id is null or user_id = auth.uid());
end;
$$;

revoke all on function public.claim_acquisition_touches(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_acquisition_touches(uuid) to authenticated;

comment on function public.claim_acquisition_touches(uuid) is
  'Binds an install''s anonymous touches to the signed-in user. First claim wins; a claimed touch never re-binds to a different account. Mig 183.';

-- ---------------------------------------------------------------------------
-- Orders stamped by trigger — zero client authority over attribution
-- ---------------------------------------------------------------------------
create or replace function public.stamp_order_acquisition()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  select id into new.acquisition_touch_id
    from public.acquisition_touches
   where user_id = new.user_id and kind = 'first'
   limit 1;
  return new;
end;
$$;

revoke all on function public.stamp_order_acquisition() from public, anon, authenticated;

drop trigger if exists orders_stamp_acquisition on public.orders;
create trigger orders_stamp_acquisition
  before insert on public.orders
  for each row execute function public.stamp_order_acquisition();

-- ---------------------------------------------------------------------------
-- Admin report: aggregates only, no install ids, no customers
-- ---------------------------------------------------------------------------
create or replace function public.acquisition_report(p_days int default 30)
returns table (
  source        text,
  campaign      text,
  partner_code  text,
  installs      bigint,
  signed_up     bigint,
  first_orders  bigint,
  repeat_orders bigint
)
language plpgsql
stable
security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  return query
  select t.source, t.campaign, t.partner_code,
         count(distinct t.install_id),
         count(distinct t.user_id) filter (where t.user_id is not null),
         count(distinct o.user_id) filter (where o.n >= 1),
         count(distinct o.user_id) filter (where o.n >= 2)
    from public.acquisition_touches t
    left join lateral (
      select od.user_id, count(*) as n
        from public.orders od
       where od.user_id = t.user_id and od.status = 'delivered'
       group by od.user_id
    ) o on true
   where t.kind = 'first'
     and t.occurred_at >= now() - make_interval(days => least(greatest(coalesce(p_days,30),1),365))
   group by t.source, t.campaign, t.partner_code
   order by count(distinct t.install_id) desc;
end;
$$;

revoke all on function public.acquisition_report(int) from public, anon, authenticated;
grant execute on function public.acquisition_report(int) to authenticated;

comment on function public.acquisition_report(int) is
  'ADMIN ONLY: first-touch acquisition rollup — installs, signups, first and repeat delivered orders per source/campaign/partner. Aggregates only; no install ids or customer identifiers leave the function. Mig 183.';
