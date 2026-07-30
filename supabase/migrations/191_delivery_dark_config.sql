-- 191_delivery_dark_config.sql
--
-- Package 08 Slice A: the dark product configuration. Everything here defaults
-- to disabled + closed — no requester of any kind can create work, nothing is
-- visible, and the spec's rule holds: "default every new environment to
-- disabled + closed." Capability authority reuses Package 07's E0 tables (the
-- delivery_* capabilities have been in the CHECK since mig 152; the platform
-- owner exists since mig 187) — no delivery-specific duplicates.

create table if not exists public.delivery_service_configs (
  service_area_id uuid primary key references public.service_areas(id) on delete restrict,
  launch_stage text not null default 'disabled'
    check (launch_stage in ('disabled','internal','merchant_private','customer_private','public')),
  intake_state text not null default 'closed'
    check (intake_state in ('closed','open','draining')),
  -- FKs to pricing/policy versions arrive with mig 192; nullable until then —
  -- and the quote RPC fails closed on NULL, so a config without an approved
  -- pricing version cannot quote.
  pricing_version_id uuid,
  parcel_policy_version_id uuid,
  scheduling_enabled boolean not null default false,
  max_active_jobs_per_driver int not null default 1 check (max_active_jobs_per_driver = 1), -- v1 contract
  quote_ttl_seconds int not null default 300 check (quote_ttl_seconds between 60 and 3600),
  offer_ttl_seconds int not null default 60 check (offer_ttl_seconds between 15 and 600),
  otp_ttl_seconds int not null default 600 check (otp_ttl_seconds between 120 and 3600),
  otp_max_attempts int not null default 5 check (otp_max_attempts between 3 and 10),
  payment_recovery_window_seconds int not null default 1800,
  driver_location_max_age_seconds int not null default 120,
  -- Owner-provisional exposure limits (EXPANSION-OWNER-DECISIONS): EGP 5000 or
  -- 20 unsettled jobs.
  default_merchant_exposure_limit_egp int not null default 5000 check (default_merchant_exposure_limit_egp > 0),
  default_merchant_unsettled_job_limit int not null default 20 check (default_merchant_unsettled_job_limit > 0),
  minimum_customer_build int,
  minimum_driver_build int,
  minimum_merchant_build int,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

alter table public.delivery_service_configs enable row level security;
revoke all on table public.delivery_service_configs from public, anon, authenticated;
grant select on table public.delivery_service_configs to authenticated;
grant select, insert, update on table public.delivery_service_configs to service_role;
-- Read policy: operators with any delivery capability; the stage itself is not
-- customer-facing metadata in v1 (clients learn eligibility through RPC
-- refusals, not by reading the roadmap).
create policy delivery_service_configs_operator_read on public.delivery_service_configs
  for select using (
    public.i_have_platform_capability('delivery_access')
    or public.i_have_platform_capability('delivery_config')
    or public.i_have_platform_capability('delivery_dispatch')
  );

comment on table public.delivery_service_configs is
  'One row per service area (PK = FK), disabled+closed by default. is/holds every v1 operating knob: TTLs, OTP caps, exposure defaults, minimum builds. Stage/intake change only through set_delivery_service_config (delivery_config capability). Mig 191.';

-- ---------------------------------------------------------------------------
-- Pilot access cohorts: one shape, three subjects
-- ---------------------------------------------------------------------------
create table if not exists public.delivery_customer_pilot_access (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  service_area_id uuid not null references public.service_areas(id) on delete cascade,
  status text not null default 'active' check (status in ('active','expired','revoked')),
  granted_by uuid, granted_at timestamptz not null default now(),
  expires_at timestamptz, revoked_at timestamptz, reason text
);
create unique index if not exists delivery_customer_pilot_one_active
  on public.delivery_customer_pilot_access (user_id, service_area_id) where status = 'active';

create table if not exists public.delivery_merchant_pilot_access (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  service_area_id uuid not null references public.service_areas(id) on delete cascade,
  status text not null default 'active' check (status in ('active','expired','revoked')),
  granted_by uuid, granted_at timestamptz not null default now(),
  expires_at timestamptz, revoked_at timestamptz, reason text
);
create unique index if not exists delivery_merchant_pilot_one_active
  on public.delivery_merchant_pilot_access (restaurant_id, service_area_id) where status = 'active';

create table if not exists public.delivery_driver_pilot_access (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  service_area_id uuid not null references public.service_areas(id) on delete cascade,
  status text not null default 'active' check (status in ('active','expired','revoked')),
  granted_by uuid, granted_at timestamptz not null default now(),
  expires_at timestamptz, revoked_at timestamptz, reason text
);
create unique index if not exists delivery_driver_pilot_one_active
  on public.delivery_driver_pilot_access (driver_id, service_area_id) where status = 'active';

alter table public.delivery_customer_pilot_access enable row level security;
alter table public.delivery_merchant_pilot_access enable row level security;
alter table public.delivery_driver_pilot_access enable row level security;
revoke all on table public.delivery_customer_pilot_access from public, anon, authenticated;
revoke all on table public.delivery_merchant_pilot_access from public, anon, authenticated;
revoke all on table public.delivery_driver_pilot_access from public, anon, authenticated;
grant select, insert, update on table public.delivery_customer_pilot_access to service_role;
grant select, insert, update on table public.delivery_merchant_pilot_access to service_role;
grant select, insert, update on table public.delivery_driver_pilot_access to service_role;

-- Access events, append-only, in the unexposed private schema.
create table if not exists private.delivery_access_events (
  id uuid primary key default gen_random_uuid(),
  subject_kind text not null check (subject_kind in ('customer','restaurant','driver','operator','config')),
  subject_id uuid,
  capability_or_stage text not null,
  action text not null check (action in ('granted','expired','revoked','config_changed')),
  actor_user_id uuid,
  reason text,
  occurred_at timestamptz not null default now()
);
create or replace function private.delivery_access_events_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'DELIVERY_ACCESS_EVENTS_IMMUTABLE' using errcode = 'check_violation';
end; $$;
drop trigger if exists delivery_access_events_immutable on private.delivery_access_events;
create trigger delivery_access_events_immutable
  before update or delete on private.delivery_access_events
  for each row execute function private.delivery_access_events_immutable();

-- ---------------------------------------------------------------------------
-- Config authority
-- ---------------------------------------------------------------------------
create or replace function public.set_delivery_service_config(
  p_service_area_id uuid,
  p_launch_stage text default null,
  p_intake_state text default null,
  p_reason text default null
)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare v_prev public.delivery_service_configs;
begin
  if auth.uid() is null or not public.i_have_platform_capability('delivery_config') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'REASON_REQUIRED' using errcode = 'check_violation';
  end if;
  select * into v_prev from public.delivery_service_configs
   where service_area_id = p_service_area_id for update;
  if not found then
    raise exception 'CONFIG_NOT_FOUND' using errcode = 'check_violation';
  end if;

  update public.delivery_service_configs
     set launch_stage = coalesce(p_launch_stage, launch_stage),
         intake_state = coalesce(p_intake_state, intake_state),
         updated_by = auth.uid(), updated_at = now()
   where service_area_id = p_service_area_id;

  insert into private.delivery_access_events
    (subject_kind, subject_id, capability_or_stage, action, actor_user_id, reason)
  values ('config', p_service_area_id,
          coalesce(p_launch_stage, v_prev.launch_stage) || '/' || coalesce(p_intake_state, v_prev.intake_state),
          'config_changed', auth.uid(), btrim(p_reason));
end;
$$;
revoke all on function public.set_delivery_service_config(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.set_delivery_service_config(uuid, text, text, text) to authenticated;

comment on function public.set_delivery_service_config(uuid, text, text, text) is
  'delivery_config capability only (fail-closed; capability granted by the platform owner via E0). Stage/intake changes with mandatory reason, appended to private.delivery_access_events. CHECK constraints bound the values. Mig 191.';

-- ---------------------------------------------------------------------------
-- Cohort authority: one RPC pattern x three subjects (grant + revoke)
-- ---------------------------------------------------------------------------
create or replace function public.grant_delivery_pilot_access(
  p_subject_kind text,
  p_subject_id uuid,
  p_service_area_id uuid,
  p_reason text,
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if auth.uid() is null or not public.i_have_platform_capability('delivery_access') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'REASON_REQUIRED' using errcode = 'check_violation';
  end if;

  if p_subject_kind = 'customer' then
    update public.delivery_customer_pilot_access
       set status = 'revoked', revoked_at = now(), reason = 'superseded by regrant'
     where user_id = p_subject_id and service_area_id = p_service_area_id and status = 'active';
    insert into public.delivery_customer_pilot_access
      (user_id, service_area_id, granted_by, expires_at, reason)
    values (p_subject_id, p_service_area_id, auth.uid(), p_expires_at, btrim(p_reason))
    returning id into v_id;
  elsif p_subject_kind = 'restaurant' then
    update public.delivery_merchant_pilot_access
       set status = 'revoked', revoked_at = now(), reason = 'superseded by regrant'
     where restaurant_id = p_subject_id and service_area_id = p_service_area_id and status = 'active';
    insert into public.delivery_merchant_pilot_access
      (restaurant_id, service_area_id, granted_by, expires_at, reason)
    values (p_subject_id, p_service_area_id, auth.uid(), p_expires_at, btrim(p_reason))
    returning id into v_id;
  elsif p_subject_kind = 'driver' then
    update public.delivery_driver_pilot_access
       set status = 'revoked', revoked_at = now(), reason = 'superseded by regrant'
     where driver_id = p_subject_id and service_area_id = p_service_area_id and status = 'active';
    insert into public.delivery_driver_pilot_access
      (driver_id, service_area_id, granted_by, expires_at, reason)
    values (p_subject_id, p_service_area_id, auth.uid(), p_expires_at, btrim(p_reason))
    returning id into v_id;
  else
    raise exception 'INVALID_SUBJECT_KIND' using errcode = 'check_violation';
  end if;

  insert into private.delivery_access_events
    (subject_kind, subject_id, capability_or_stage, action, actor_user_id, reason)
  values (p_subject_kind, p_subject_id, 'pilot_access', 'granted', auth.uid(), btrim(p_reason));
  return v_id;
end;
$$;
revoke all on function public.grant_delivery_pilot_access(text, uuid, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.grant_delivery_pilot_access(text, uuid, uuid, text, timestamptz)
  to authenticated;

create or replace function public.revoke_delivery_pilot_access(
  p_subject_kind text,
  p_subject_id uuid,
  p_service_area_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.i_have_platform_capability('delivery_access') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'REASON_REQUIRED' using errcode = 'check_violation';
  end if;
  if p_subject_kind = 'customer' then
    update public.delivery_customer_pilot_access
       set status = 'revoked', revoked_at = now(), reason = btrim(p_reason)
     where user_id = p_subject_id and service_area_id = p_service_area_id and status = 'active';
  elsif p_subject_kind = 'restaurant' then
    update public.delivery_merchant_pilot_access
       set status = 'revoked', revoked_at = now(), reason = btrim(p_reason)
     where restaurant_id = p_subject_id and service_area_id = p_service_area_id and status = 'active';
  elsif p_subject_kind = 'driver' then
    update public.delivery_driver_pilot_access
       set status = 'revoked', revoked_at = now(), reason = btrim(p_reason)
     where driver_id = p_subject_id and service_area_id = p_service_area_id and status = 'active';
  else
    raise exception 'INVALID_SUBJECT_KIND' using errcode = 'check_violation';
  end if;
  insert into private.delivery_access_events
    (subject_kind, subject_id, capability_or_stage, action, actor_user_id, reason)
  values (p_subject_kind, p_subject_id, 'pilot_access', 'revoked', auth.uid(), btrim(p_reason));
end;
$$;
revoke all on function public.revoke_delivery_pilot_access(text, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.revoke_delivery_pilot_access(text, uuid, uuid, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Seed: Sharm config, disabled + closed
-- ---------------------------------------------------------------------------
insert into public.delivery_service_configs (service_area_id)
select sa.id from public.service_areas sa
  join public.cities c on c.id = sa.city_id
 where c.slug = 'sharm-el-sheikh' and sa.slug = 'sharm-core'
on conflict (service_area_id) do nothing;
