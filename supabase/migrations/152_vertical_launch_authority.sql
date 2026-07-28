-- 152_vertical_launch_authority.sql
--
-- Package 07 Program A0 (session E0) — fail-closed vertical launch authority.
--
-- THE HOLE THIS CLOSES. `verticals.is_active` is presentation metadata today.
-- Nothing reads it on any customer path. Measured against production:
--
--   restaurants_read           USING (is_active OR is_merchant_staff OR admin)
--   menu_items_read            USING (is_available OR is_merchant_staff OR admin)
--   menu_sections_public_read  USING (true)
--   modifiers_public_read      USING (true)
--   modifier_options_public_read USING (true)
--
-- So a grocery or pharmacy merchant created today would be publicly readable --
-- storefront, menu, modifiers and all -- while verticals.is_active = false said
-- otherwise. The three catalog tables are readable by anyone regardless of ANY
-- state. Nothing is leaking right now only because no non-food merchant exists
-- (verified: 43 merchants, all vertical_id='food'), which is luck, not a
-- control. E1 would create the first grocery merchant and the leak with it.
--
-- EFFECTIVE STATE, exactly as the spec defines it:
--
--   if is_active = false            -> disabled     (emergency override)
--   else if launch_stage = disabled -> disabled
--   else                               launch_stage
--
-- is_active=false wins even over a stale 'public' row; is_active=true never
-- promotes a 'disabled' stage. Both directions are tested.
--
-- ADDITIVE AND FOOD-PRESERVING. Food is backfilled to launch_stage='public',
-- which reproduces its current behaviour exactly: every existing policy gains a
-- clause that is unconditionally true for food. Grocery and pharmacy are
-- backfilled 'disabled'. No existing food read, order, quote or job changes.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO. It does not bootstrap a
-- platform owner. The spec requires the initial platform-owner UUID to be an
-- explicit release input, "never inferred from the first admin", and no such
-- UUID is recorded anywhere in this repository (checked 2026-07-28:
-- EXPANSION-OWNER-DECISIONS.md lists it as a required input with no value).
-- private.platform_owners is therefore created EMPTY, and with it empty no
-- capability can be granted and no launch stage can be changed by RPC. That is
-- the intended fail-closed posture, not an oversight.

-- ---------------------------------------------------------------------------
-- 1. Launch stage on verticals.
-- ---------------------------------------------------------------------------
alter table public.verticals
  add column if not exists launch_stage text not null default 'disabled',
  add column if not exists display_order int not null default 100,
  add column if not exists copy_namespace text,
  add column if not exists capabilities jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'verticals_launch_stage_chk') then
    alter table public.verticals
      add constraint verticals_launch_stage_chk
      check (launch_stage in ('disabled','private','public'));
  end if;
end $$;

comment on column public.verticals.launch_stage is
  'Server-authoritative launch stage: disabled | private | public. Combined with is_active by vertical_effective_stage(): is_active=false forces disabled even if this says public (emergency override); is_active=true never promotes a disabled stage. Changed only by set_vertical_launch_stage(), which requires an active expansion_launch_manager capability. Mig 152.';

-- ---------------------------------------------------------------------------
-- 2. Vertical categories (taxonomy inside a vertical).
-- ---------------------------------------------------------------------------
create table if not exists public.vertical_categories (
  id            uuid primary key default gen_random_uuid(),
  vertical_id   text not null references public.verticals(id) on delete cascade,
  slug          text not null,
  is_active     boolean not null default true,
  display_order int not null default 100,
  created_at    timestamptz not null default now(),
  unique (vertical_id, slug)
);

revoke all on table public.vertical_categories from public, anon, authenticated;
alter table public.vertical_categories enable row level security;
grant select on table public.vertical_categories to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. Private access grants (user-scoped, revocable, expiring).
-- ---------------------------------------------------------------------------
create table if not exists public.vertical_private_access (
  id          uuid primary key default gen_random_uuid(),
  vertical_id text not null references public.verticals(id) on delete cascade,
  -- SET NULL, not CASCADE: deleting a user must remove their personal linkage
  -- but must NOT delete the grant history, or the audit trail disappears
  -- exactly for the accounts most likely to be disputed. The row survives with
  -- user_id null and its events intact; RLS then matches nobody, which is the
  -- correct post-deletion visibility.
  user_id     uuid references public.users(id) on delete set null,
  generation  int  not null default 1,
  status      text not null default 'active',
  cohort      text,
  reason      text,
  granted_at  timestamptz not null default now(),
  expires_at  timestamptz,
  granted_by  uuid references public.users(id) on delete set null,
  revoked_at  timestamptz,
  revoked_by  uuid references public.users(id) on delete set null,
  constraint vertical_private_access_status_chk
    check (status in ('active','revoked','expired'))
);

-- ONE active generation per (vertical, user). Expiry/revocation closes a
-- generation; a regrant opens a new one. History is never deleted.
-- `user_id is not null` keeps the invariant meaningful after an account
-- deletion: several anonymised historical rows must not collide with each other.
create unique index if not exists vertical_private_access_one_active_uidx
  on public.vertical_private_access (vertical_id, user_id)
  where status = 'active' and user_id is not null;

create index if not exists vertical_private_access_user_idx
  on public.vertical_private_access (user_id, vertical_id, status);

create table if not exists public.vertical_private_access_events (
  id            uuid primary key default gen_random_uuid(),
  grant_id      uuid not null references public.vertical_private_access(id) on delete cascade,
  action        text not null,
  actor_user_id uuid references public.users(id) on delete set null,
  reason        text,
  occurred_at   timestamptz not null default now(),
  constraint vertical_private_access_events_action_chk
    check (action in ('granted','used','expired','revoked'))
);

create index if not exists vertical_private_access_events_grant_idx
  on public.vertical_private_access_events (grant_id, occurred_at);

-- ---------------------------------------------------------------------------
-- 4. Launch state audit.
-- ---------------------------------------------------------------------------
create table if not exists public.vertical_launch_events (
  id                 uuid primary key default gen_random_uuid(),
  vertical_id        text not null references public.verticals(id) on delete cascade,
  previous_stage     text,
  new_stage          text not null,
  previous_is_active boolean,
  new_is_active      boolean not null,
  reason             text not null,
  evidence_reference text,
  actor_user_id      uuid references public.users(id) on delete set null,
  occurred_at        timestamptz not null default now()
);

create index if not exists vertical_launch_events_vertical_idx
  on public.vertical_launch_events (vertical_id, occurred_at desc);

-- HOUSE RULE 5b: ALTER DEFAULT PRIVILEGES grants arwdDxtm to anon/authenticated
-- on every new table, and TRUNCATE ignores RLS entirely. Revoke, then grant.
revoke all on table public.vertical_private_access from public, anon, authenticated;
revoke all on table public.vertical_private_access_events from public, anon, authenticated;
revoke all on table public.vertical_launch_events from public, anon, authenticated;

alter table public.vertical_private_access enable row level security;
alter table public.vertical_private_access_events enable row level security;
alter table public.vertical_launch_events enable row level security;

-- A customer may see their OWN grant (it explains why they can see a private
-- vertical). Events and launch history are operator-only; no client policy.
grant select on table public.vertical_private_access to authenticated;

drop policy if exists vertical_private_access_own_select on public.vertical_private_access;
create policy vertical_private_access_own_select
  on public.vertical_private_access for select to authenticated
  using (user_id = auth.uid() or coalesce(public.auth_role()::text,'') = 'admin');

-- Append-only history: correcting a grant means a new event, never an edit.
create or replace function public.vertical_access_events_immutable()
returns trigger language plpgsql set search_path to 'public','pg_temp' as $function$
begin
  raise exception 'VERTICAL_ACCESS_EVENTS_ARE_APPEND_ONLY'
    using errcode = 'check_violation';
end;
$function$;

drop trigger if exists vertical_private_access_events_no_mutate on public.vertical_private_access_events;
create trigger vertical_private_access_events_no_mutate
  before update or delete on public.vertical_private_access_events
  for each row execute function public.vertical_access_events_immutable();

drop trigger if exists vertical_launch_events_no_mutate on public.vertical_launch_events;
create trigger vertical_launch_events_no_mutate
  before update or delete on public.vertical_launch_events
  for each row execute function public.vertical_access_events_immutable();

-- ---------------------------------------------------------------------------
-- 5. Platform owners and operator capabilities, in a PRIVATE schema.
--
-- `private` is not exposed by PostgREST, so these are unreachable over the Data
-- API regardless of grants -- a second layer under the revokes below.
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.platform_owners (
  user_id                  uuid primary key references public.users(id) on delete restrict,
  status                   text not null default 'active',
  granted_by_database_owner boolean not null default true,
  granted_at               timestamptz not null default now(),
  revoked_at               timestamptz,
  constraint platform_owners_status_chk check (status in ('active','revoked'))
);

create table if not exists private.platform_operator_capabilities (
  id          uuid primary key default gen_random_uuid(),
  -- SET NULL for the same reason: who held expansion authority, and when, must
  -- outlive the account. A revoked operator's history is the whole point.
  user_id     uuid references public.users(id) on delete set null,
  capability  text not null,
  status      text not null default 'active',
  granted_by  uuid references public.users(id) on delete set null,
  granted_at  timestamptz not null default now(),
  expires_at  timestamptz,
  revoked_at  timestamptz,
  reason      text,
  constraint platform_operator_capabilities_status_chk
    check (status in ('active','expired','revoked')),
  constraint platform_operator_capabilities_capability_chk
    check (capability in ('expansion_launch_manager','compliance_evidence_manager',
                          'product_compliance_reviewer','pharmacy_support',
                          'delivery_access','delivery_compliance','delivery_config',
                          'delivery_dispatch','delivery_support','delivery_finance'))
);

create unique index if not exists platform_operator_capabilities_one_active_uidx
  on private.platform_operator_capabilities (user_id, capability)
  where status = 'active' and user_id is not null;

create table if not exists private.platform_operator_capability_events (
  id                  uuid primary key default gen_random_uuid(),
  capability_grant_id uuid not null references private.platform_operator_capabilities(id) on delete cascade,
  action              text not null,
  actor_user_id       uuid references public.users(id) on delete set null,
  reason              text,
  occurred_at         timestamptz not null default now(),
  constraint platform_operator_capability_events_action_chk
    check (action in ('granted','expired','revoked'))
);

revoke all on all tables in schema private from public, anon, authenticated;

comment on table private.platform_owners is
  'Root expansion authority (Package 07 A0). Deliberately EMPTY at migration time: the initial platform-owner UUID is an explicit release input and must never be inferred from the first admin. While empty, no capability can be granted and no launch stage can be changed by RPC -- the intended fail-closed posture. In schema `private`, which PostgREST does not expose. Mig 152.';

-- ---------------------------------------------------------------------------
-- 4b. Backfill, now that vertical_launch_events exists to hold the marker.
-- ---------------------------------------------------------------------------
-- BACKFILL ONLY ON FIRST INTRODUCTION.
--
-- A first draft ran:
--     update ... set launch_stage='public'   where id='food' and launch_stage='disabled';
--     update ... set launch_stage='disabled' where id<>'food';
-- which is NOT semantically idempotent. Reapplying it after a real stage change
-- would (a) forcibly slam every non-food vertical back to 'disabled', undoing an
-- audited private launch, and (b) reopen food to 'public' if it had been
-- deliberately demoted to 'private' -- turning a re-run of a migration into an
-- unaudited launch-state change. The reapply test passed only because it ran
-- before any stage had been changed.
--
-- The column default is already 'disabled', so a NEW row needs nothing. The
-- only thing that must happen once is lifting FOOD to the behaviour it has
-- today, and that is gated on the marker below rather than on the value itself.
do $$
begin
  -- Marker: has this backfill ever run on this database?
  if not exists (select 1 from public.vertical_launch_events
                  where reason = 'mig152:initial-backfill') then

    update public.verticals set launch_stage = 'public' where id = 'food';

    insert into public.vertical_launch_events
      (vertical_id, previous_stage, new_stage, previous_is_active, new_is_active,
       reason, actor_user_id)
    select v.id, 'disabled', v.launch_stage, v.is_active, v.is_active,
           'mig152:initial-backfill', null
      from public.verticals v;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5b. THE effective-stage functions. ONE definition, used by every path.
--
--     Placed AFTER the tables and BEFORE the policies: the bodies read
--     vertical_private_access, and the policies call the functions, so this is
--     the only ordering that resolves without a forward declaration.
-- ---------------------------------------------------------------------------
create or replace function public.vertical_effective_stage(p_vertical_id text)
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  -- An unknown vertical is 'disabled', not NULL: a missing row must fail
  -- closed rather than make every comparison NULL (and therefore not-true).
  select coalesce((
    select case
      when not v.is_active then 'disabled'
      when v.launch_stage = 'disabled' then 'disabled'
      else v.launch_stage
    end
    from public.verticals v where v.id = p_vertical_id
  ), 'disabled');
$function$;

-- Readable by clients: it returns a stage string, not anyone's data, and the
-- policies below call it as the anon/authenticated role.
revoke all on function public.vertical_effective_stage(text) from public;
grant execute on function public.vertical_effective_stage(text) to anon, authenticated, service_role;

comment on function public.vertical_effective_stage(text) is
  'THE single definition of a vertical''s effective launch stage. is_active=false forces ''disabled'' even over a stale ''public'' row; is_active=true never promotes a ''disabled'' stage; an unknown vertical is ''disabled'' so a missing row fails closed. Every read policy, RPC and job must use this rather than reading the columns directly. Mig 152.';

-- Whether the CALLER may see a vertical at all. This is the customer-facing
-- predicate: public to everyone, private only to a live grant holder.
create or replace function public.can_view_vertical(p_vertical_id text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select case public.vertical_effective_stage(p_vertical_id)
    when 'public' then true
    when 'private' then exists (
      select 1 from public.vertical_private_access a
       where a.vertical_id = p_vertical_id
         and a.user_id = auth.uid()
         and a.status = 'active'
         -- An expiry that has passed is not access, even before the sweeper
         -- has flipped the row: time must not wait on a cron.
         and (a.expires_at is null or a.expires_at > now())
    )
    else false   -- disabled: nobody, including a grant holder
  end;
$function$;

revoke all on function public.can_view_vertical(text) from public;
grant execute on function public.can_view_vertical(text) to anon, authenticated, service_role;

comment on function public.can_view_vertical(text) is
  'May the CALLER see this vertical? public = everyone; private = only a live, unexpired, unrevoked grant for auth.uid(); disabled = nobody, including grant holders. An expires_at in the past is treated as no access immediately, so access does not depend on a sweeper having run. Mig 152.';

-- Whether a SPECIFIC user may -- for definer functions and jobs, which run as
-- service_role and therefore bypass RLS. The spec is explicit that service_role
-- must not be treated as customer eligibility.
create or replace function public.user_can_view_vertical(p_user_id uuid, p_vertical_id text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select case public.vertical_effective_stage(p_vertical_id)
    when 'public' then true
    when 'private' then exists (
      select 1 from public.vertical_private_access a
       where a.vertical_id = p_vertical_id
         and a.user_id = p_user_id
         and a.status = 'active'
         and (a.expires_at is null or a.expires_at > now())
    )
    else false
  end;
$function$;

revoke all on function public.user_can_view_vertical(uuid, text) from public, anon, authenticated;
grant execute on function public.user_can_view_vertical(uuid, text) to service_role;

comment on function public.user_can_view_vertical(uuid, text) is
  'Subject-scoped variant for definer functions and background jobs. Those run as service_role and bypass RLS, so they must ask this about the ORDER''S customer rather than assume service_role means eligible (Package 07 A0). Not granted to clients: whether another user holds a private grant is not a client''s business. Mig 152.';

-- ---------------------------------------------------------------------------
-- 7. Deferred policy: needs vertical_effective_stage(), defined above.
-- ---------------------------------------------------------------------------
drop policy if exists vertical_categories_read on public.vertical_categories;
create policy vertical_categories_read on public.vertical_categories
  for select to anon, authenticated
  using (is_active and public.can_view_vertical(vertical_id));

-- ---------------------------------------------------------------------------
-- 8. Replace the vertical list policy itself (mig 006).
--
-- The deployed policy is:
--     verticals_public_read  SELECT  TO public  USING (is_active = true)
--
-- `is_active` is the emergency kill switch, NOT visibility. A vertical set to
-- launch_stage='private' with is_active=true -- exactly what a private cohort
-- launch looks like -- is therefore listed to EVERYONE, including anonymous
-- callers. The merchants inside it are hidden by mig 153, but the vertical's
-- existence, name and icon are not, which is the leak this program exists to
-- prevent.
--
-- NO RECURSION: can_view_vertical() reads public.verticals, and this policy is
-- ON public.verticals. The function is SECURITY DEFINER and owned by the table
-- owner, so its internal read is not re-filtered by this policy -- there is no
-- infinite recursion, and equally no fail-open, because the function's own
-- default is 'disabled'.
-- ---------------------------------------------------------------------------
drop policy if exists verticals_public_read on public.verticals;
create policy verticals_public_read on public.verticals
  for select
  using (
    public.can_view_vertical(id)
    or (( select public.auth_role() ) = 'admin'::app_role)
  );
