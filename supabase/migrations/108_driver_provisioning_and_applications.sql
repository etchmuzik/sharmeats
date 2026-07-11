-- 108 — driver onboarding backend (P0 #8 buildable half, 2026-07-11 gap analysis).
--
-- GAP: driver accounts are provisioned entirely by hand (ops creates a raw auth user
-- in the Supabase dashboard, then hand-inserts a drivers row and flips users.role).
-- There is no "apply to drive" intake and no one-call provisioning. This migration
-- builds the buildable backend:
--   (A) driver_applications — a public intake table an "apply to drive" form writes to.
--   (B) provision_driver(...) — an ADMIN RPC that, given an EXISTING auth user id,
--       creates their drivers row + flips users.role to 'driver' in one atomic call.
-- Creating the auth user itself still needs the Auth admin API (owner/edge, service
-- role) — that half stays owner-gated — but everything after "an account exists" is
-- now one admin action instead of manual multi-table editing.
-- Non-destructive: new table + RPC + RLS.

-- ============================================================================
-- driver_applications — intake for the "apply to drive" funnel.
-- ============================================================================
create table if not exists public.driver_applications (
  id            uuid primary key default gen_random_uuid(),
  full_name     text not null,
  phone         text not null,
  city          text,
  vehicle       vehicle_type not null default 'scooter',
  note          text,
  status        text not null default 'new'
                  check (status in ('new','contacted','approved','rejected')),
  provisioned_driver_id uuid references public.drivers(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists driver_applications_status_idx on public.driver_applications (status, created_at desc);

comment on table public.driver_applications is
  'Apply-to-drive intake. Anyone may submit (constrained insert); only admin reads/manages. Approved apps are linked to the provisioned driver.';

alter table public.driver_applications enable row level security;

-- Public may INSERT an application (constrained: non-empty name+phone, no status
-- injection — status defaults to 'new' and is not settable here since the policy
-- CHECK pins it). Mirrors the waitlist_anon_insert hardening (mig 063).
create policy driver_applications_public_insert on public.driver_applications
  for insert to anon, authenticated
  with check (
    full_name is not null and length(btrim(full_name)) between 2 and 120
    and phone is not null and length(btrim(phone)) between 6 and 20
    and status = 'new'
    and provisioned_driver_id is null
  );

-- Only admin reads/manages applications.
create policy driver_applications_admin_select on public.driver_applications
  for select using ((select public.auth_role()) = 'admin');
create policy driver_applications_admin_update on public.driver_applications
  for update using ((select public.auth_role()) = 'admin')
  with check ((select public.auth_role()) = 'admin');

grant insert on public.driver_applications to anon, authenticated;
grant select, update on public.driver_applications to authenticated;

-- ============================================================================
-- provision_driver — ADMIN turns an existing auth user into a driver in one call.
-- p_profile_id must be an existing public.users id (the auth user must already
-- exist — creating it needs the Auth admin API, out of SQL scope). Creates the
-- drivers row (unverified by default — KYC review flips is_verified) and sets the
-- user's role to 'driver'. Idempotent: re-running for an already-provisioned
-- profile returns the existing driver id.
-- ============================================================================
create or replace function public.provision_driver(
  p_profile_id uuid,
  p_name text,
  p_phone text,
  p_vehicle vehicle_type default 'scooter',
  p_plate text default ''
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_driver_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;
  if coalesce(public.auth_role()::text,'') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  if p_name is null or length(btrim(p_name)) < 2 then
    raise exception 'INVALID_NAME' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.users where id = p_profile_id) then
    raise exception 'PROFILE_NOT_FOUND: create the auth user first' using errcode = 'check_violation';
  end if;

  -- Idempotent: reuse an existing driver row for this profile.
  select id into v_driver_id from public.drivers where profile_id = p_profile_id;
  if v_driver_id is not null then
    return v_driver_id;
  end if;

  insert into public.drivers (profile_id, name, phone, vehicle, plate, status, is_verified, is_active)
  values (p_profile_id, btrim(p_name), coalesce(nullif(btrim(p_phone),''),''), p_vehicle,
          coalesce(nullif(btrim(p_plate),''),''), 'offline', false, true)
  returning id into v_driver_id;

  -- Flip the user's role so RLS/dispatch treat them as a driver.
  update public.users set role = 'driver', updated_at = now() where id = p_profile_id;

  return v_driver_id;
end;
$function$;
revoke all on function public.provision_driver(uuid, text, text, vehicle_type, text) from public, anon;
grant execute on function public.provision_driver(uuid, text, text, vehicle_type, text) to authenticated;

comment on function public.provision_driver is
  'ADMIN: turn an existing auth user (p_profile_id) into a driver — creates the drivers row (unverified) and sets users.role=driver. Idempotent per profile. Returns the driver id.';
