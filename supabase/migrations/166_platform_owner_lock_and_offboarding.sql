-- 166_platform_owner_lock_and_offboarding.sql
--
-- Close the root-authority race, and give owner offboarding a sanctioned path.
--
-- THE RACE, measured before writing this:
--   * is_platform_owner() reads private.platform_owners with NO lock (it is a
--     plain STABLE `select exists`);
--   * grant_platform_capability / revoke_platform_capability / the combined
--     gate all lock public.users -- a DIFFERENT row -- and re-check ownership
--     by calling is_platform_owner() again, still unlocked;
--   * verified: `prosrc ~* 'platform_owners.*for update'` is FALSE for all four
--     authority functions.
--
-- So an owner revocation can commit in the window between the final ownership
-- read and the capability mutation, and the mutation proceeds under authority
-- that no longer exists. Locking public.users does not help: revoking OWNERSHIP
-- does not touch public.users at all.
--
-- THE SECOND FINDING. private.platform_owners has NO WRITER: no grant, no
-- revoke, no offboarding. Ownership could only ever be established by direct
-- SQL, and could only be withdrawn the same way -- with no audit, no locking,
-- and no way for the race above to even be tested. A lock on a row nothing can
-- write is untestable theatre, so this migration supplies the writer too.
--
-- WHAT THIS DOES NOT DO. It does NOT create an owner. private.platform_owners
-- stays EMPTY: bootstrapping root authority is an owner decision that must be
-- made deliberately with a known UUID, and inventing one here is exactly the
-- inference the program forbids. offboard_platform_owner() can only revoke an
-- owner that someone else deliberately created.

-- ---------------------------------------------------------------------------
-- 1. Audit trail for ownership changes.
-- ---------------------------------------------------------------------------
-- Ownership is the highest authority in the system; changing it must outlive
-- the row it changed, exactly as capability changes already do.
create table if not exists private.platform_owner_events (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null,
  action         text not null,
  -- No FK on either actor or subject: the record must survive the deletion of
  -- the account it describes. A uuid that no longer resolves is still the
  -- historical fact (same reasoning as mig 155's event tables).
  actor_user_id  uuid,
  reason         text not null,
  occurred_at    timestamptz not null default now(),
  constraint platform_owner_events_action_chk
    check (action in ('granted','revoked'))
);

create index if not exists platform_owner_events_owner_idx
  on private.platform_owner_events (owner_user_id, occurred_at desc);

-- House rule 5b: revoke before granting. `private` is unreachable by client
-- roles, but the default-privilege grant would still apply to the new table.
revoke all on table private.platform_owner_events from public, anon, authenticated;
alter table private.platform_owner_events enable row level security;

drop trigger if exists platform_owner_events_no_mutate on private.platform_owner_events;
create trigger platform_owner_events_no_mutate
  before update or delete on private.platform_owner_events
  for each row execute function public.vertical_access_events_immutable();

comment on table private.platform_owner_events is
  'Append-only audit of platform-owner grants and revocations (mig 166). Immutable by trigger; no FKs on the actor or subject so the record survives their account deletion. Ownership is the system''s highest authority — a change to it must be explicable after the fact.';

-- ---------------------------------------------------------------------------
-- 2. The lock helper: the ONE place that establishes ownership under a lock.
-- ---------------------------------------------------------------------------
-- is_platform_owner() stays as it is -- it is STABLE and used in read paths
-- where a lock would be wrong (and where a lock could not be taken anyway).
-- This is its locking counterpart, for the mutating paths.
--
-- FOR UPDATE on the OWNER row is the whole point: a concurrent
-- offboard_platform_owner() must wait for the in-flight privileged operation
-- rather than committing alongside it. Whichever runs second observes the
-- other's committed result.
create or replace function public.assert_platform_owner_locked(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
declare v_status text;
begin
  -- Lock the ownership row itself. A row that does not exist cannot be locked,
  -- which is correct: a non-owner has nothing to serialise against and is
  -- refused below.
  select o.status into v_status
    from private.platform_owners o
   where o.user_id = p_user_id
   for update;

  if not found or v_status is distinct from 'active' then
    raise exception 'NOT_PLATFORM_OWNER' using errcode = 'check_violation';
  end if;

  -- The live-identity requirement mig 159 added to is_platform_owner still
  -- applies: a deleted or blocked account must not retain root authority even
  -- while its ownership row says 'active'.
  if not exists (
    select 1 from public.users u
     where u.id = p_user_id and coalesce(u.is_blocked, false) = false
  ) then
    raise exception 'NOT_PLATFORM_OWNER' using errcode = 'check_violation';
  end if;
end;
$function$;

revoke all on function public.assert_platform_owner_locked(uuid) from public, anon, authenticated;

comment on function public.assert_platform_owner_locked(uuid) is
  'Establish platform ownership UNDER A ROW LOCK (mig 166). is_platform_owner() reads private.platform_owners unlocked, so an owner revocation could commit between the final ownership check and the privileged mutation it authorised — locking public.users did not help, because revoking ownership does not touch public.users. Mutating paths call this instead; offboard_platform_owner() contends on the same row and therefore waits.';

-- ---------------------------------------------------------------------------
-- 3. Owner offboarding -- the sanctioned writer.
-- ---------------------------------------------------------------------------
-- CANONICAL LOCK ORDER, matching the grant/revoke paths so no pair of
-- operations can deadlock:
--     1. owner row (private.platform_owners)   <- taken here, first
--     2. users rows, in UUID order             <- taken by the callers
-- The grant/revoke functions acquire (1) via assert_platform_owner_locked()
-- BEFORE their users-row lock, so both paths agree on the sequence.
create or replace function public.offboard_platform_owner(
  p_user_id uuid, p_reason text
)
returns void
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
declare
  v_actor uuid := auth.uid();
  v_n     int;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'REASON_REQUIRED' using errcode = 'check_violation';
  end if;

  -- Only an owner may offboard an owner -- and the CALLER's own ownership is
  -- established under a lock too, so two owners offboarding each other
  -- serialise instead of both succeeding.
  --
  -- Lock in UUID order regardless of which is the actor: a fixed order over the
  -- pair is what makes A-offboards-B and B-offboards-A converge rather than
  -- deadlock. Self-offboarding locks a single row.
  perform 1 from private.platform_owners
   where user_id in (v_actor, p_user_id)
   order by user_id
   for update;

  perform public.assert_platform_owner_locked(v_actor);

  update private.platform_owners
     set status = 'revoked', revoked_at = now()
   where user_id = p_user_id and status = 'active';
  get diagnostics v_n = row_count;

  if v_n = 0 then
    -- Already revoked, or never an owner. One generic refusal either way: an
    -- unauthorised caller never reaches here, and an authorised one can read
    -- the table directly, so distinguishing the two buys nothing.
    raise exception 'NOT_PLATFORM_OWNER' using errcode = 'check_violation';
  end if;

  insert into private.platform_owner_events (owner_user_id, action, actor_user_id, reason)
  values (p_user_id, 'revoked', v_actor, btrim(p_reason));
end;
$function$;

revoke all on function public.offboard_platform_owner(uuid, text) from public, anon;
grant execute on function public.offboard_platform_owner(uuid, text) to authenticated;

comment on function public.offboard_platform_owner(uuid, text) is
  'Withdraw platform ownership. The ONLY sanctioned writer of private.platform_owners (mig 166) — before this, ownership could only be changed by direct SQL, unaudited and unlockable, which also made the revocation race untestable. Owner-only, requires a reason, appends an immutable audit row, and takes the owner rows in UUID order so two owners offboarding each other serialise rather than deadlock. Does NOT create owners: bootstrapping root authority stays a deliberate, out-of-band act.';

-- ---------------------------------------------------------------------------
-- 4. Route the mutating paths through the locking check.
-- ---------------------------------------------------------------------------
-- Rebuilt programmatically from the DEPLOYED bodies, with each substitution
-- asserted, so a drifted body fails loudly rather than silently shipping a
-- partial fix (CLAUDE.md rule 2).
--
-- The owner lock is inserted BEFORE the users-row lock in both functions,
-- establishing the canonical order: owner row -> users rows.
do $mig166$
declare
  v_src text; v_new text; v_fn text; v_n int;
begin
  foreach v_fn in array array['grant_platform_capability','revoke_platform_capability'] loop
    select count(*) into v_n
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    if v_n <> 1 then
      raise exception 'mig166: expected exactly 1 %() overload, found %', v_fn, v_n;
    end if;

    select pg_get_functiondef(p.oid) into v_src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;

    -- Insert the locking assertion immediately before the users-row lock. The
    -- cheap unlocked precheck mig 162 added stays where it is, ahead of this,
    -- so an unauthorised caller is still rejected before taking ANY lock.
    --
    -- The two functions format that lock differently -- grant_platform_capability
    -- wraps it across two lines, revoke_platform_capability keeps it on one --
    -- so anchor on the common prefix `perform 1 from public.users` rather than
    -- on a whole statement, and assert exactly one occurrence was rewritten.
    if (length(v_src) - length(replace(v_src, 'perform 1 from public.users', ''))) 
         / length('perform 1 from public.users') <> 1 then
      raise exception
        'mig166: expected exactly 1 users-row lock in %(), body differs from expectation', v_fn;
    end if;

    v_new := replace(v_src,
      'perform 1 from public.users',
      '-- OWNER ROW FIRST (mig 166): is_platform_owner() reads unlocked, so a
  -- concurrent offboard could commit between that read and this mutation.
  -- Locking the ownership row makes offboarding wait. Canonical order is
  -- owner row -> users rows, matching offboard_platform_owner().
  perform public.assert_platform_owner_locked(v_actor);
  perform 1 from public.users');
    if v_new = v_src then
      raise exception 'mig166: users-row lock not found in %() -- body differs from expectation', v_fn;
    end if;

    execute v_new;
  end loop;
end;
$mig166$;

do $mig166_grants$
declare v_sig text; v_fn text;
begin
  foreach v_fn in array array['grant_platform_capability','revoke_platform_capability'] loop
    select p.oid::regprocedure::text into v_sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end;
$mig166_grants$;

-- ---------------------------------------------------------------------------
-- 5. Bootstrap remains CLOSED.
-- ---------------------------------------------------------------------------
do $mig166_verify$
declare v_n int;
begin
  select count(*) into v_n from private.platform_owners;
  if v_n <> 0 then
    raise notice 'mig166: platform_owners has % row(s) -- ownership was established out of band', v_n;
  else
    raise notice 'mig166: platform_owners is still EMPTY (bootstrap deliberately not performed)';
  end if;
end;
$mig166_verify$;
