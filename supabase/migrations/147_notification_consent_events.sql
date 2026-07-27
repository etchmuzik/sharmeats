-- 147_notification_consent_events.sql
--
-- Package 03 A3 — append-only consent provenance.
--
-- WHAT EXISTS. notification_prefs holds the EFFECTIVE current state, and
-- set_notification_prefs already stamps marketing_consent_at/_source on an
-- OFF -> ON transition and clears both on opt-out. That is correct, and it is
-- deliberately not changed here.
--
-- WHAT IT CANNOT ANSWER. A single mutable row is a snapshot, not a record:
--
--   * "when did they opt out?" -- unanswerable, because opting out CLEARS the
--     stamp (rightly: a stale timestamp beside marketing=false would look like
--     live consent);
--   * "who flipped this?" -- unanswerable. p_source records a channel
--     ('settings' / 'support' / 'import'), never an actor, so a support agent
--     enabling marketing on someone's behalf leaves a trace indistinguishable
--     from the customer doing it themselves. That is exactly the case the spec
--     names: support/import must not be able to silently manufacture consent;
--   * "did they consent under the current policy?" -- unanswerable, because no
--     policy version is recorded anywhere.
--
-- Those are the questions a regulator, a complaint, or a dispute actually asks,
-- and they are asked about the PAST. So this adds the second layer the spec
-- specifies: an append-only event log beside the effective-state row.
--
-- APPEND-ONLY IS ENFORCED, NOT DOCUMENTED. There is no UPDATE or DELETE grant
-- for any client role, and a trigger refuses both even from a definer context,
-- so an audit trail cannot be rewritten by the code that writes it. An audit
-- log that its own writer can edit is not evidence.
--
-- The customer can READ their own history (a subject-access request answers
-- itself) but cannot write it: only the owner-bound RPC records provenance.

create table if not exists public.notification_consent_events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  channel      text not null,
  granted      boolean not null,
  -- WHO acted. Distinct from user_id: equal for a self-service change, and a
  -- different id when an admin or support agent acted on the customer's
  -- behalf. NULL only for a system/automated action.
  actor_id     uuid references public.users(id) on delete set null,
  source       text not null,
  -- The consent text/policy in force when this was recorded. Without it,
  -- "they agreed" cannot be tied to what they agreed TO.
  policy_version text not null default 'v1',
  created_at   timestamptz not null default now(),

  constraint notification_consent_events_channel_chk
    check (channel in ('marketing')),
  constraint notification_consent_events_source_chk
    check (source in ('settings','onboarding','support','import','system'))
);

-- The only query this table serves: one customer's history, newest first.
create index if not exists notification_consent_events_user_idx
  on public.notification_consent_events (user_id, created_at desc);

-- HOUSE RULE 5b. ALTER DEFAULT PRIVILEGES on this database grants arwdDxtm to
-- anon/authenticated on every new table, so NOT granting is not enough --
-- and TRUNCATE ignores RLS entirely (the mig 141 exposure). Revoke first.
revoke all on table public.notification_consent_events from public, anon, authenticated;

alter table public.notification_consent_events enable row level security;

-- Read-only, and only your own. No INSERT/UPDATE/DELETE policy exists at all,
-- so the definer RPC below is the only writer.
grant select on table public.notification_consent_events to authenticated;

drop policy if exists notification_consent_events_own_select on public.notification_consent_events;
create policy notification_consent_events_own_select
  on public.notification_consent_events
  for select to authenticated
  using (user_id = auth.uid());

-- Immutability, enforced. BEFORE UPDATE OR DELETE fires regardless of the
-- caller's role -- including the definer function that inserts these rows, and
-- including postgres. Correcting a mistaken row means appending the correction,
-- which is the whole point of an append-only log.
create or replace function public.notification_consent_events_immutable()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  raise exception 'CONSENT_EVENTS_ARE_APPEND_ONLY'
    using errcode = 'check_violation',
          hint = 'Record a new event instead of editing or deleting history.';
end;
$function$;

drop trigger if exists notification_consent_events_no_mutate on public.notification_consent_events;
create trigger notification_consent_events_no_mutate
  before update or delete on public.notification_consent_events
  for each row execute function public.notification_consent_events_immutable();

comment on table public.notification_consent_events is
  'Append-only marketing-consent audit trail (Package 03 A3). notification_prefs holds the EFFECTIVE state; this holds the HISTORY, including opt-OUTs, which the prefs row cannot represent because opting out clears its stamp. Written only by record_consent_event() (owner-bound, definer). Clients hold SELECT on their own rows and nothing else; UPDATE/DELETE are refused by trigger even for definer callers, because an audit log its own writer can edit is not evidence. Mig 147.';

comment on column public.notification_consent_events.actor_id is
  'WHO performed the change, as distinct from whose consent it is. Equal to user_id for a self-service change; a different id when support/admin acted on the customer''s behalf; NULL for a system action. This is the column that makes "support cannot silently manufacture consent" auditable rather than merely stated.';


-- ---------------------------------------------------------------------------
-- Writer. Owner-bound: the caller can only ever record an event about
-- THEMSELVES, so there is no p_user_id to forge. A staff-acting-on-behalf flow
-- would need its own explicitly-authorized RPC; it is deliberately not added
-- here, because the safest version of that feature is the one nobody built by
-- accident.
-- ---------------------------------------------------------------------------
create or replace function public.record_consent_event(
  p_channel text,
  p_granted boolean,
  p_source text default 'settings',
  p_policy_version text default 'v1'
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;
  if p_channel is null or p_channel <> 'marketing' then
    raise exception 'INVALID_CHANNEL' using errcode = 'check_violation';
  end if;
  if p_granted is null then
    raise exception 'INVALID_GRANT' using errcode = 'check_violation';
  end if;
  -- 'system' is refused from a client call: a human action must not be able to
  -- disguise itself as an automated one in the audit trail.
  if coalesce(p_source, '') not in ('settings','onboarding','support','import') then
    raise exception 'INVALID_SOURCE' using errcode = 'check_violation';
  end if;

  insert into public.notification_consent_events
    (user_id, channel, granted, actor_id, source, policy_version)
  values
    (v_uid, p_channel, p_granted, v_uid, p_source, coalesce(nullif(btrim(p_policy_version), ''), 'v1'))
  returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function public.record_consent_event(text, boolean, text, text) from public, anon;
grant execute on function public.record_consent_event(text, boolean, text, text) to authenticated;

comment on function public.record_consent_event(text, boolean, text, text) is
  'Append one marketing-consent event for the CALLER (Package 03 A3). Owner-bound: there is no user id parameter, so a caller cannot record consent about anyone else. Refuses source=''system'' so a human action cannot disguise itself as automated. Does not change notification_prefs -- set_notification_prefs owns effective state and calls this to record provenance. Mig 147.';


-- ---------------------------------------------------------------------------
-- Wire provenance into the existing writer.
--
-- Body derived from the DEPLOYED set_notification_prefs (pg_get_functiondef,
-- 2026-07-28). Everything above the new block is re-stated verbatim; the only
-- addition is the event append, and it happens ONLY on a real transition.
-- ---------------------------------------------------------------------------
create or replace function public.set_notification_prefs(
  p_transactional boolean default null,
  p_marketing boolean default null,
  p_quiet_hours_start smallint default null,
  p_quiet_hours_end smallint default null,
  p_timezone text default null,
  p_clear_quiet_hours boolean default false,
  p_source text default 'settings'
)
returns notification_prefs
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_row public.notification_prefs;
  v_was_marketing boolean;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;
  if p_source is not null and p_source not in ('settings','onboarding','support','import') then
    raise exception 'INVALID_SOURCE' using errcode = 'check_violation';
  end if;

  insert into public.notification_prefs (user_id) values (v_uid)
  on conflict (user_id) do nothing;

  -- Read the PRIOR value before the update, so the transition can be detected
  -- afterwards. An absent row means the mig-138 default: marketing OFF.
  select coalesce(p.marketing, false) into v_was_marketing
    from public.notification_prefs p where p.user_id = v_uid;
  v_was_marketing := coalesce(v_was_marketing, false);

  update public.notification_prefs p
     set transactional = coalesce(p_transactional, p.transactional),
         marketing     = coalesce(p_marketing, p.marketing),
         -- Consent stamp moves only on an OFF -> ON transition, and is cleared
         -- on opt-out so a stale timestamp can never look like live consent.
         marketing_consent_at = case
           when p_marketing is true  and not p.marketing then now()
           when p_marketing is false then null
           else p.marketing_consent_at end,
         marketing_consent_source = case
           when p_marketing is true  and not p.marketing then coalesce(p_source, 'settings')
           when p_marketing is false then null
           else p.marketing_consent_source end,
         quiet_hours_start = case when p_clear_quiet_hours then null
                                  else coalesce(p_quiet_hours_start, p.quiet_hours_start) end,
         quiet_hours_end   = case when p_clear_quiet_hours then null
                                  else coalesce(p_quiet_hours_end, p.quiet_hours_end) end,
         timezone   = coalesce(p_timezone, p.timezone),
         updated_at = now()
   where p.user_id = v_uid
  returning * into v_row;

  -- Append provenance on a REAL transition only. Re-saving settings with
  -- marketing unchanged, or changing locale/timezone/quiet hours, must not
  -- manufacture consent events -- the spec is explicit that a locale change is
  -- not a consent change, and a log full of no-ops is a log nobody reads.
  if p_marketing is not null and p_marketing is distinct from v_was_marketing then
    insert into public.notification_consent_events
      (user_id, channel, granted, actor_id, source, policy_version)
    values
      (v_uid, 'marketing', p_marketing, v_uid, coalesce(p_source, 'settings'), 'v1');
  end if;

  return v_row;
end;
$function$;

-- Re-assert the existing ACL. create or replace preserves grants, but stating
-- them keeps this migration self-contained if it is ever replayed onto a
-- database where the function is new.
revoke all on function public.set_notification_prefs(boolean, boolean, smallint, smallint, text, boolean, text) from public, anon;
grant execute on function public.set_notification_prefs(boolean, boolean, smallint, smallint, text, boolean, text) to authenticated;

comment on function public.set_notification_prefs(boolean, boolean, smallint, smallint, text, boolean, text) is
  'Owner-bound writer for notification_prefs (effective state). Since mig 147 it also appends to notification_consent_events on a real marketing OFF<->ON transition, so opt-OUTs are recorded -- the prefs row cannot represent them because opting out clears its consent stamp. A no-op re-save, or a locale/timezone/quiet-hours change, records nothing. Migs 138, 143, 147.';
