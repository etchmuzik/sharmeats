-- 162_e0_concurrency_and_oracles.sql
--
-- Package 07 Program A0 (session E0) — concurrency-audit closure.
--
-- Five items, each verified against the current 152-161 drafts before change.
-- Items already closed are recorded as such rather than "fixed" again.

-- ===========================================================================
-- 1. EXPIRY SWEEPERS: bounded, ordered batches.
-- ===========================================================================
-- The lock ORDER in 159 is already canonical (advisory 'vertical:<id>' first,
-- then the row) -- that was fixed earlier and is not re-litigated here.
--
-- What remains: the sweeper loops over every due row in ONE transaction, and
-- advisory locks taken with pg_advisory_xact_lock are held until COMMIT. So a
-- sweep spanning N verticals accumulates N advisory locks, acquired in whatever
-- order the planner returned rows. Two sweepers (the cron job and a manual run)
-- can therefore take 'vertical:grocery' and 'vertical:pharmacy' in opposite
-- orders and deadlock -- and while holding them, every place_order for those
-- verticals waits.
--
-- FIX: deterministic ORDER BY vertical_id (so any two concurrent sweepers
-- acquire the same keys in the same sequence -- a total order cannot deadlock),
-- and a bounded batch so one run cannot hold an unbounded number of locks or
-- block checkout for long. Returns the count so the caller can loop until zero.

-- HOUSE RULE 1: 159 created this with a ZERO-ARG signature. A create-or-replace
-- with a different arg list makes a SECOND overload -- the old unbounded sweeper
-- would survive, keep its service_role grant, and still be callable, so the
-- "bounded" fix would be bypassable by simply calling the old one. Drop it
-- explicitly first, then create the single replacement.
drop function if exists public.expire_vertical_private_access();

create or replace function public.expire_vertical_private_access(p_limit int default 200)
returns int
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  r      record;
  v_done int := 0;
begin
  -- Deterministic acquisition order. Sorting by the LOCK KEY (not by id or
  -- expires_at) is what makes two concurrent sweepers deadlock-free: they walk
  -- the same keys in the same sequence, so one simply waits for the other.
  for r in
    select id, vertical_id
      from public.vertical_private_access
     where status = 'active' and expires_at is not null and expires_at <= now()
     order by vertical_id, id
     limit greatest(1, least(coalesce(p_limit, 200), 1000))
  loop
    -- CANONICAL ORDER: advisory first (same key as place_order and the launch
    -- RPCs), then the row.
    perform pg_advisory_xact_lock(hashtextextended('vertical:' || r.vertical_id, 0));

    -- SKIP LOCKED: a concurrent grant/revoke already holds this row and will
    -- leave it in a correct state; re-reading the status under the lock means we
    -- never expire a seat that was re-granted while we queued.
    update public.vertical_private_access
       set status = 'expired'
     where id = r.id
       and status = 'active'
       and expires_at is not null
       and expires_at <= now()
       and id in (select id from public.vertical_private_access
                   where id = r.id for update skip locked);
    if found then
      insert into public.vertical_private_access_events (grant_id, action, actor_user_id, reason)
      values (r.id, 'expired', null, 'expired by scheduled sweep (mig 162)');
      v_done := v_done + 1;
    end if;
  end loop;
  return v_done;
end;
$function$;

revoke all on function public.expire_vertical_private_access(int) from public, anon, authenticated;
-- The scheduled sweep runs as service_role (as the zero-arg version did).
grant execute on function public.expire_vertical_private_access(int) to service_role;

comment on function public.expire_vertical_private_access(int) is
  'Expire due private-vertical seats in BOUNDED, ORDERED batches (mig 162). Ordering by the advisory lock key gives concurrent sweepers a total acquisition order, which is what makes deadlock impossible; the bound stops one run holding an unbounded number of xact-scoped advisory locks while place_order waits on them. Returns the number expired -- call until it returns 0. No client grant: scheduled/operator use only.';

-- ===========================================================================
-- 2. GRANTS REQUIRE A LIVE, UNBLOCKED, LOCKED TARGET.
-- ===========================================================================
-- Measured: grant_platform_capability never consulted public.users at all, and
-- grant_vertical_private_access checked mere EXISTENCE without is_blocked and
-- without locking the row.
--
-- Two distinct defects:
--   (a) a capability or seat could be written for a BLOCKED user -- 159 makes the
--       predicates ignore it at read time, but the row still sits there and
--       silently becomes live again the moment the block is lifted; and
--   (b) with no row lock, "target is live" is checked and then acted on across a
--       window in which a concurrent block/delete can land -- so the grant is
--       written against a user who is, by commit time, blocked.
--
-- FIX: one shared gate that requires a live, unblocked user AND holds FOR UPDATE
-- on that row for the rest of the transaction, so a concurrent block or delete
-- must wait and then observes a consistent outcome. This is also what stops
-- "dormant rows that reactivate if a UUID later exists" -- the row cannot be
-- written for a non-existent user in the first place.

create or replace function public.assert_live_grant_target(
  p_user_id uuid, p_capability text default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_blocked boolean;
begin
  -- CANONICAL ORDER -- cap advisory BEFORE the target's users row.
  --
  -- A privileged action by user B takes cap:<B>:<capability> (advisory) and then
  -- B's users row. If a grant TO B took B's users row first and only then the
  -- cap advisory, the two would hold the same pair in opposite orders and
  -- deadlock. Taking the same advisory first here puts both paths in one total
  -- order, so a grant to B and B's own privileged action serialise instead.
  if p_capability is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('cap:' || p_user_id::text || ':' || p_capability, 0));
  end if;

  -- FOR UPDATE, deliberately: the lock is the point, not the read. It serialises
  -- this grant against a concurrent block/delete of the same user.
  select is_blocked into v_blocked
    from public.users where id = p_user_id for update;
  if not found then
    raise exception 'TARGET_NOT_ELIGIBLE' using errcode = 'check_violation';
  end if;
  if coalesce(v_blocked, false) then
    -- Same error as "no such user" ON PURPOSE: an authorized operator can read
    -- the users table directly, so no legitimate workflow needs these
    -- distinguished, and collapsing them keeps this from becoming an oracle.
    raise exception 'TARGET_NOT_ELIGIBLE' using errcode = 'check_violation';
  end if;
end;
$function$;

revoke all on function public.assert_live_grant_target(uuid, text) from public, anon, authenticated;

comment on function public.assert_live_grant_target(uuid, text) is
  'Shared gate for authority grants (mig 162): the target must be a LIVE, UNBLOCKED public.users row, and its row is held FOR UPDATE so a concurrent block or account deletion serialises against the grant instead of racing it. Prevents dormant grant rows that would silently activate later, and returns one generic TARGET_NOT_ELIGIBLE so the RPC cannot be used to probe user existence or blocked state.';

-- --- 2a. WIRE THE GATE IN. -------------------------------------------------
-- Defining assert_live_grant_target is not the fix; CALLING it is. Both grant
-- RPCs are rebuilt here to invoke it, programmatically from their DEPLOYED
-- bodies so no later hardening is retyped away, with each substitution asserted.
do $mig162_wire$
declare v_src text; v_new text; v_n int;
begin
  -- grant_vertical_private_access: insert the target gate immediately after the
  -- caller's capability check, so authorization still comes FIRST (mig 160) and
  -- the target row is then locked before anything is written.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='grant_vertical_private_access';
  if v_n <> 1 then
    raise exception 'mig162: expected 1 grant_vertical_private_access, found %', v_n;
  end if;
  select pg_get_functiondef(p.oid) into v_src from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='grant_vertical_private_access';

  v_new := replace(v_src,
    'if not exists (select 1 from public.users where id = p_user_id) then
    raise exception ''USER_NOT_FOUND'' using errcode=''check_violation'';
  end if;',
    '-- Live, unblocked AND row-locked (mig 162): a bare existence check let a
  -- seat be written for a blocked user, and left a window for a concurrent
  -- block/delete to land between the check and the insert.
  perform public.assert_live_grant_target(p_user_id);');
  if v_new = v_src then
    raise exception 'mig162: could not wire assert_live_grant_target into grant_vertical_private_access';
  end if;
  execute v_new;

  -- grant_platform_capability: never consulted public.users at all.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='grant_platform_capability';
  if v_n <> 1 then
    raise exception 'mig162: expected 1 grant_platform_capability, found %', v_n;
  end if;
  select pg_get_functiondef(p.oid) into v_src from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='grant_platform_capability';

  -- The owner check is the authorization step here (grant_platform_capability
  -- gates on is_platform_owner, not on a capability). Insert the TARGET gate
  -- immediately after it, so authorization still precedes any target probe.
  v_new := replace(v_src,
    'if not public.is_platform_owner(v_actor) then
    raise exception ''NOT_PLATFORM_OWNER'' using errcode=''check_violation'';
  end if;',
    'if not public.is_platform_owner(v_actor) then
    raise exception ''NOT_PLATFORM_OWNER'' using errcode=''check_violation'';
  end if;
  -- CANONICAL LOCK ORDER (mig 162), and the order matters more than it looks.
  --
  -- A privileged action by user B takes cap:<B>:<cap> and THEN B''s users row.
  -- So every path must take the cap advisory before ANY users row -- including
  -- the actor''s. An owner SELF-granting (actor == target) is the case that
  -- exposes it: locking the owner row first and only then the cap advisory
  -- inverts the pair against B''s own privileged action and deadlocks.
  --
  -- 1. TARGET cap advisory first, always.
  perform pg_advisory_xact_lock(
    hashtextextended(''cap:'' || p_user_id::text || '':'' || p_capability, 0));

  -- 2. Then the users rows, in a stable id order so two concurrent grants
  --    involving the same two identities cannot deadlock either.
  perform 1 from public.users
   where id in (v_actor, p_user_id) order by id for update;

  -- 3. Re-check BOTH identities under the locks. platform_owner is not a
  --    capability, so the owner is verified by re-reading ownership here rather
  --    than via a cap advisory.
  if not exists (select 1 from public.users
                  where id = v_actor and not coalesce(is_blocked,false))
     or not public.is_platform_owner(v_actor) then
    raise exception ''NOT_PLATFORM_OWNER'' using errcode=''check_violation'';
  end if;
  -- The TARGET must be a live, unblocked identity: granting operator authority
  -- to a blocked or non-existent uuid created a dormant row that would activate
  -- the moment that uuid became real. Locks are already held, so the helper is
  -- called WITHOUT a capability (it must not re-take the advisory out of order).
  perform public.assert_live_grant_target(p_user_id);');
  if v_new = v_src then
    raise exception 'mig162: could not wire assert_live_grant_target into grant_platform_capability';
  end if;
  execute v_new;
end;
$mig162_wire$;

-- Re-assert grants (signatures derived, never hand-typed).
do $mig162_grant_acls$
declare v_sig text; v_fn text;
begin
  foreach v_fn in array array['grant_vertical_private_access','grant_platform_capability'] loop
    select p.oid::regprocedure::text into v_sig from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname=v_fn;
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end;
$mig162_grant_acls$;

-- --- 2a-bis. REVOKE NEEDS THE SAME ACTOR GUARANTEE. -----------------------
-- grant_platform_capability now re-checks a LOCKED owner row, but
-- revoke_platform_capability was left as the mig-155 body, gated by an UNLOCKED
-- is_platform_owner(). So a block or deletion of the owner could commit while
-- their revoke was in flight -- the mirror of the grant race, and arguably worse
-- (a revoke half-applying under authority that has been withdrawn).
--
-- Same canonical order: TARGET cap advisory, then both users rows by id.
do $mig162_revoke$
declare v_src text; v_new text; v_n int; v_lock text;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='revoke_platform_capability';
  if v_n <> 1 then
    raise exception 'mig162: expected 1 revoke_platform_capability, found %', v_n;
  end if;
  select pg_get_functiondef(p.oid) into v_src from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='revoke_platform_capability';

  -- Assembled with quote_literal-free concatenation so the doubled quotes this
  -- needs inside a function body cannot be mis-escaped by hand.
  -- CHEAP REJECTION FIRST, then locks. An unauthorized caller must never be
  -- able to choose a target and make this function take that target's cap
  -- advisory and users row before refusing -- that is a lock-DoS: any
  -- authenticated user could stall an owner's real revoke, or an operator's own
  -- privileged action, simply by naming them. The early is_platform_owner check
  -- is unlocked and therefore only advisory; the authoritative re-check happens
  -- under the locks below, so this adds a fast exit without weakening anything.
  v_lock := concat(
    '  if not public.is_platform_owner(v_actor) then', chr(10),
    '    raise exception ', chr(39), 'NOT_PLATFORM_OWNER', chr(39),
    ' using errcode = ', chr(39), 'check_violation', chr(39), ';', chr(10),
    '  end if;', chr(10),
    '  perform pg_advisory_xact_lock(hashtextextended(', chr(39), 'cap:', chr(39),
    ' || p_user_id::text || ', chr(39), ':', chr(39), ' || p_capability, 0));', chr(10),
    '  perform 1 from public.users where id in (v_actor, p_user_id) order by id for update;', chr(10),
    '  if not exists (select 1 from public.users where id = v_actor', chr(10),
    '                  and not coalesce(is_blocked,false))', chr(10),
    '     or not public.is_platform_owner(v_actor) then', chr(10),
    '    raise exception ', chr(39), 'NOT_PLATFORM_OWNER', chr(39),
    ' using errcode = ', chr(39), 'check_violation', chr(39), ';', chr(10),
    '  end if;');

  v_new := replace(v_src,
    concat('if not public.is_platform_owner(v_actor) then', chr(10),
           '    raise exception ', chr(39), 'NOT_PLATFORM_OWNER', chr(39),
           ' using errcode=', chr(39), 'check_violation', chr(39), ';', chr(10),
           '  end if;'),
    v_lock);
  if v_new = v_src then
    raise exception 'mig162: could not wire the live-owner lock into revoke_platform_capability';
  end if;
  execute v_new;
end;
$mig162_revoke$;

do $mig162_revoke_acl$
declare v_sig text;
begin
  select p.oid::regprocedure::text into v_sig from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='revoke_platform_capability';
  execute format('revoke all on function %s from public, anon', v_sig);
  execute format('grant execute on function %s to authenticated', v_sig);
end;
$mig162_revoke_acl$;

-- --- 2a-ter. ONE COMBINED GATE (actor + target locked together, in order). --
-- The two-helper composition still had a deadlock: grant_vertical_private_access
-- calls assert_platform_capability (which locks the ACTOR's row) and then
-- assert_live_grant_target (which locks the TARGET's). Two authorized operators
-- granting to each other -- A->B while B->A -- take {A,B} in opposite orders and
-- deadlock. Splitting the lock acquisition across two helpers is what made the
-- ordering unenforceable: neither helper can see the other's row.
--
-- One gate acquires the whole set, sorted, so every caller uses one total order:
--   1. capability advisory for the TARGET (matches the target's own privileged
--      action path, which takes cap:<target>:<cap> before any users row);
--   2. BOTH users rows in UUID order (a total order over any pair, so A->B and
--      B->A converge on the same sequence);
--   3. re-check actor authority AND target eligibility under those locks.
create or replace function public.assert_grant_preconditions(
  p_actor uuid, p_target uuid, p_capability text
)
returns void
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
begin
  -- STEP 1: the ACTOR's capability advisory.
  --
  -- An earlier draft locked cap:<TARGET>:<capability>, which was the wrong key
  -- twice over: this function authorizes the ACTOR, so serialising on the
  -- target's key gave no protection against a concurrent revoke or expiry of
  -- the ACTOR's own capability -- and it let any caller take a lock named after
  -- an arbitrary target before being rejected, which is a cross-target DoS.
  perform pg_advisory_xact_lock(
    hashtextextended('cap:' || p_actor::text || ':' || p_capability, 0));

  -- STEP 2: reject unauthorized callers CHEAPLY, before touching the target.
  -- Nothing about the target -- not even a lock on its row -- may be reachable
  -- by someone who is not allowed to make this grant.
  if not public.has_platform_capability(p_actor, p_capability) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;

  -- STEP 3: both identity rows, in UUID order. `order by id` is a total order
  -- over any pair, so A->B and B->A converge on the same sequence instead of
  -- deadlocking; IN handles actor = target (a self-grant) without locking the
  -- same row twice.
  perform 1 from public.users
   where id in (p_actor, p_target) order by id for update;

  -- STEP 4: re-check EVERYTHING under the locks. A revoke, block or deletion
  -- that committed while we queued is now visible, and this is the read that
  -- decides.
  if not exists (select 1 from public.users
                  where id = p_actor and not coalesce(is_blocked, false)) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  if not public.has_platform_capability(p_actor, p_capability) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  -- One generic refusal for the target: blocked and non-existent are
  -- deliberately indistinguishable so this cannot be used to probe identities.
  if not exists (select 1 from public.users
                  where id = p_target and not coalesce(is_blocked, false)) then
    raise exception 'TARGET_NOT_ELIGIBLE' using errcode = 'check_violation';
  end if;
end;
$function$;

revoke all on function public.assert_grant_preconditions(uuid, uuid, text) from public, anon, authenticated;

comment on function public.assert_grant_preconditions(uuid, uuid, text) is
  'Single combined gate for capability-authorized grants (mig 162). Replaces the assert_platform_capability + assert_live_grant_target composition, which locked the actor row in one helper and the target row in the other -- unsorted, so A->B and B->A grants deadlocked. Order is ACTOR capability advisory (not the target''s: this authorizes the actor, and a target-keyed lock both missed concurrent actor-capability revocation and let an unauthorized caller lock arbitrary targets), then a cheap authority rejection BEFORE the target is touched at all, then both users rows in UUID order, then a re-check of actor authority and target eligibility under the locks.';

-- Rebuild grant_vertical_private_access to use it, from the deployed body.
do $mig162_combined$
declare v_src text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'grant_vertical_private_access';

  v_new := replace(v_src,
    concat('perform public.assert_platform_capability(v_actor, ', chr(39),
           'expansion_launch_manager', chr(39), ');'),
    concat('perform public.assert_grant_preconditions(v_actor, p_user_id, ', chr(39),
           'expansion_launch_manager', chr(39), ');'));
  if v_new = v_src then
    raise exception 'mig162: could not install the combined gate in grant_vertical_private_access';
  end if;

  -- The separate target gate is now redundant: the combined gate already holds
  -- and re-checks that row. Leaving it would re-lock in a second position.
  v_new := replace(v_new, concat(chr(10), '  perform public.assert_live_grant_target(p_user_id);'), '');
  execute v_new;
end;
$mig162_combined$;

do $mig162_combined_acl$
declare v_sig text;
begin
  select p.oid::regprocedure::text into v_sig from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'grant_vertical_private_access';
  execute format('revoke all on function %s from public, anon', v_sig);
  execute format('grant execute on function %s to authenticated', v_sig);
end;
$mig162_combined_acl$;

-- --- 2b. BOUND AND ORDER THE CAPABILITY SWEEPER. ---------------------------
-- Same defect as the private-access sweeper: unbounded, unordered, holding one
-- xact advisory lock per row until commit. Dropped explicitly (house rule 1)
-- rather than replaced with a different arg list.
drop function if exists public.expire_platform_capabilities();

create or replace function public.expire_platform_capabilities(p_limit int default 200)
returns int
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
declare r record; v_done int := 0;
begin
  for r in
    select id, user_id, capability
      from private.platform_operator_capabilities
     where status = 'active' and expires_at is not null and expires_at <= now()
     -- Ordered by the LOCK KEY so concurrent sweepers acquire in one total
     -- order and cannot deadlock.
     order by user_id, capability, id
     limit greatest(1, least(coalesce(p_limit, 200), 1000))
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('cap:' || r.user_id::text || ':' || r.capability, 0));

    update private.platform_operator_capabilities
       set status = 'expired'
     where id = r.id
       and status = 'active'
       and expires_at is not null
       and expires_at <= now()
       and id in (select id from private.platform_operator_capabilities
                   where id = r.id for update skip locked);
    if found then
      insert into private.platform_operator_capability_events
        (capability_grant_id, action, actor_user_id, reason)
      values (r.id, 'expired', null, 'expired by scheduled sweep (mig 162)');
      v_done := v_done + 1;
    end if;
  end loop;
  return v_done;
end;
$function$;

revoke all on function public.expire_platform_capabilities(int) from public, anon, authenticated;
grant execute on function public.expire_platform_capabilities(int) to service_role;

comment on function public.expire_platform_capabilities(int) is
  'Expire due operator capabilities in BOUNDED, ORDERED batches (mig 162). Ordered by the advisory lock key so concurrent sweepers share one total acquisition order; bounded so a single run cannot hold an unbounded number of xact-scoped locks. Returns the number expired -- call until 0.';

-- --- 2c. THE AUTHORITY GATE LOCKS THE ACTOR. -------------------------------
-- assert_platform_capability took the capability advisory lock and re-read the
-- capability, but never locked the ACTOR's users row. So blocking or deleting an
-- operator could interleave with a privileged mutation they had already started:
-- the capability read passes, the block commits, and the mutation proceeds under
-- authority that no longer exists. Locking the actor row makes block/delete wait
-- for the in-flight mutation instead of racing it.
create or replace function public.assert_platform_capability(p_user_id uuid, p_capability text)
returns void
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
declare v_blocked boolean;
begin
  -- 1. Serialise against revocation of THIS capability for THIS user.
  perform pg_advisory_xact_lock(
    hashtextextended('cap:' || p_user_id::text || ':' || p_capability, 0));

  -- 2. Lock the ACTOR's identity row (mig 162), so a concurrent block or account
  --    deletion serialises against this privileged operation rather than
  --    committing alongside it.
  select is_blocked into v_blocked
    from public.users where id = p_user_id for update;
  if not found or coalesce(v_blocked, false) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;

  -- 3. Re-check AFTER both locks: anything that committed while we waited is now
  --    visible, and this is the read that decides.
  if not public.has_platform_capability(p_user_id, p_capability) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
end;
$function$;

revoke all on function public.assert_platform_capability(uuid, text) from public, anon, authenticated;

comment on function public.assert_platform_capability(uuid, text) is
  'Authority gate for platform operations. Takes the capability advisory lock, LOCKS THE ACTOR''S users ROW (mig 162) so a concurrent block/delete cannot commit alongside an in-flight privileged mutation, then re-reads the capability under both locks. Fails closed on a missing or blocked actor.';

-- ===========================================================================
-- 3. BLOCK/DELETE SERIALISES WITH IN-FLIGHT AUTHORITY MUTATIONS.
-- ===========================================================================
-- The other half of item 2: taking FOR UPDATE in the grant path only helps if
-- the block path contends on the SAME row. It does -- a block is an UPDATE of
-- public.users, and a delete is a DELETE of it, both of which take a row lock on
-- exactly the row assert_live_grant_target holds. So ordering is established by
-- the users row itself and no extra lock is required.
--
-- What was missing is the READ-side guarantee for capabilities: 159 made
-- is_platform_owner / has_platform_capability join public.users and require
-- is_blocked = false, so a blocked operator's JWT is already inert. Recording
-- that here as verified rather than re-implementing it.

-- ===========================================================================
-- 4. MISSING AND HIDDEN MUST LOOK IDENTICAL.
-- ===========================================================================
-- Measured in 153: place_order raises MERCHANT_NOT_FOUND for an unknown uuid but
-- VERTICAL_NOT_AVAILABLE for a real merchant in a vertical the customer may not
-- see (lines 221/245 and 391/398). The difference is an existence oracle: guess
-- UUIDs, and the error tells you which ones are real hidden merchants. Same
-- class of bug as the grant-RPC ordering fixed in mig 160.
--
-- FIX: collapse both to MERCHANT_NOT_FOUND for a caller who may not see the
-- vertical. A customer legitimately cannot tell the two apart -- from their
-- position the merchant genuinely does not exist. Built programmatically from
-- the DEPLOYED bodies, with the substitution asserted, so a drifted body fails
-- loudly instead of silently shipping a partial change.
--
-- NOTE this runs AFTER 153 in the ordered replay, so it rewrites 153's guard.
do $mig162$
declare
  v_src text;
  v_new text;
  v_fn  text;
  v_n   int;
begin
  foreach v_fn in array array['place_order', 'prepare_cart'] loop
    select count(*) into v_n
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    if v_n <> 1 then
      raise exception 'mig162: expected exactly 1 %() overload, found %', v_fn, v_n;
    end if;

    select pg_get_functiondef(p.oid) into v_src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;

    v_new := replace(v_src,
      'raise exception ''VERTICAL_NOT_AVAILABLE'' using errcode = ''check_violation''',
      'raise exception ''MERCHANT_NOT_FOUND'' using errcode = ''check_violation''');
    if v_new = v_src then
      raise exception 'mig162: no VERTICAL_NOT_AVAILABLE guard found in %() -- apply 153 first', v_fn;
    end if;
    execute v_new;
  end loop;
end;
$mig162$;

-- Re-assert grants on both, deriving each signature from pg_proc (a hand-typed
-- place_order signature in an earlier draft of mig 160 did not exist and would
-- have aborted the whole run under ON_ERROR_STOP).
do $mig162_grants$
declare v_sig text; v_fn text;
begin
  foreach v_fn in array array['place_order', 'prepare_cart'] loop
    select p.oid::regprocedure::text into v_sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end;
$mig162_grants$;

comment on function public.place_order(uuid, uuid, jsonb, text, integer, text, text, timestamptz, text, uuid, dropoff_preference, text) is
  'Server-authoritative order placement. Re-reads the merchant''s vertical launch stage inside the transaction under the merchant lock (mig 153), and since mig 162 answers MERCHANT_NOT_FOUND -- not VERTICAL_NOT_AVAILABLE -- when the customer may not see that vertical: a distinct error was an existence oracle that let UUID guessing confirm real hidden merchants. Subject-scoped (the customer, not the caller) because this is SECURITY DEFINER.';

-- ===========================================================================
-- 5. ORDERED FULL REPLAY IS THE ONLY SUPPORTED PATH.
-- ===========================================================================
-- Targeted replay of an EARLIER file in this slice is unsafe by construction,
-- and pretending otherwise is the trap this project has hit before (re-pasting
-- an old function body silently reverts later hardening -- see CLAUDE.md rule 2).
-- Concretely, within 152-162:
--
--   * replaying 152 restores verticals_public_read before 152's own §8 gate and
--     before 159's live-identity requirement;
--   * replaying 154 restores grant_vertical_private_access with the
--     validate-before-authorize order that mig 160 fixed, and without mig 162's
--     assert_live_grant_target;
--   * replaying 155 restores the is_platform_owner body that 159 replaced with
--     the live-unblocked-identity JOIN;
--   * replaying 158 restores admin_assign_merchant_vertical with the pre-159
--     lock order and the pre-160 null-as-not-found check;
--   * replaying 153 restores the distinguishable VERTICAL_NOT_AVAILABLE guard
--     that this migration just collapsed.
--
-- Rather than make each file independently idempotent-and-latest (which would
-- mean every file carrying every later fix -- unmaintainable, and exactly the
-- duplication that caused the original reverts), the contract is CODIFIED:
-- 152-162 apply in order, as one transaction, or not at all.
--
-- This marker makes a violation loud instead of silent. It is asserted by the
-- test pack, so an out-of-order or partial replay fails a test rather than
-- shipping a quietly-reverted predicate.
create table if not exists public.e0_slice_provenance (
  slice        text primary key,
  applied_thru int  not null,
  applied_at   timestamptz not null default now()
);

revoke all on table public.e0_slice_provenance from public, anon, authenticated;
alter table public.e0_slice_provenance enable row level security;

insert into public.e0_slice_provenance (slice, applied_thru)
values ('package07-A0-vertical-authority', 162)
on conflict (slice) do update set applied_thru = 162, applied_at = now();

comment on table public.e0_slice_provenance is
  'Records how far the E0 vertical-authority slice has been applied (mig 162). Migrations 152-162 are NOT independently replayable -- each later file supersedes bodies, predicates and ACLs from earlier ones, so replaying an earlier file alone silently reverts later hardening (CLAUDE.md rule 2). The supported operation is the full ordered replay; this row is what lets a test detect a partial one.';
