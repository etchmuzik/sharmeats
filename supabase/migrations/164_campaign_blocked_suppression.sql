-- 164_campaign_blocked_suppression.sql
--
-- Marketing campaigns must not reach BLOCKED accounts.
--
-- MEASURED against production before writing this:
--   * marketing_suppression_reason() tests consent and quiet hours only --
--     `position('is_blocked' in prosrc) = false`;
--   * all four send_push_campaign segments select `where u.role = 'customer'`
--     with no is_blocked predicate;
--   * so a blocked, opted-in, token-bearing customer is a VALID RECIPIENT.
--
-- Today's exposure is zero (0 blocked customers), which is exactly why this is
-- the right moment to close it: the fix is verifiable against a clean dataset
-- rather than during an incident. Blocking an account is how the platform
-- responds to fraud and abuse; continuing to market to that person afterwards
-- is both a trust failure and, for a fraud case, an active nuisance.
--
-- TWO PLACES, TWO DIFFERENT MEANINGS -- and the distinction is the whole point:
--
--   1. SEGMENT MEMBERSHIP. A blocked account is not part of the audience at
--      all. It is excluded from _campaign_segment, so `segment_size` shrinks.
--      Counting them as "audience we chose not to reach" would overstate the
--      reachable market in every operator report.
--
--   2. SUPPRESSION. A blocked account that somehow reaches classification is
--      still refused by the shared predicate, so any FUTURE caller of
--      marketing_suppression_reason() inherits the gate without having to
--      remember it. Defence in depth: the segment filter is the fast path, the
--      predicate is the guarantee.
--
-- COUNTER TRUTHFULNESS. `suppressed_blocked` is a NEW column rather than being
-- folded into suppressed_no_consent. Blocked and no-consent are different
-- operational facts: one is a platform decision, the other a customer choice,
-- and an operator reading "500 no_consent" must not be silently seeing 400
-- fraud blocks. The legacy `suppressed_count` remains the sum of all reasons.

-- ---------------------------------------------------------------------------
-- 1. The new counter column.
-- ---------------------------------------------------------------------------
alter table public.push_campaigns
  add column if not exists suppressed_blocked int not null default 0;

comment on column public.push_campaigns.suppressed_blocked is
  'Recipients withheld because the account is blocked (mig 164). Kept separate from suppressed_no_consent on purpose: a platform block and a customer opt-out are different facts, and merging them would let fraud blocks hide inside an opt-out statistic. Normally 0, because blocked users are also excluded from the segment -- a non-zero value means someone was blocked between segment resolution and classification.';

-- ---------------------------------------------------------------------------
-- 2. The shared predicate gains the block check, ordered by permanence.
-- ---------------------------------------------------------------------------
-- Order matters, as the original body already argued for no_consent vs
-- quiet_hours: report the STRONGEST, most permanent reason, so an operator is
-- never told "retry after quiet hours" for someone who must never be contacted.
-- 'blocked' is the strongest of all -- it outranks even no_consent, because the
-- platform's own decision supersedes the customer's preference state.
create or replace function public.marketing_suppression_reason(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  -- NULL means "may be sent to". Any non-null value is the reason it must not.
  -- Order matters: a customer who never consented is 'no_consent' even if they
  -- also happen to be inside quiet hours -- the stronger, permanent reason wins,
  -- so an operator is never told to "retry later" for someone who will never
  -- be eligible. 'blocked' (mig 164) outranks everything: it is a platform
  -- decision about the account, not a preference expressed by its owner.
  select case
    when u.id is null      then 'no_consent'      -- unknown user: fail closed
    when u.is_blocked      then 'blocked'
    when p.user_id is null then 'no_consent'      -- absent row = opt-in default OFF
    when not p.marketing   then 'no_consent'
    when public.in_quiet_hours(p.quiet_hours_start, p.quiet_hours_end, p.timezone)
                           then 'quiet_hours'
    else null
  end
  from (select 1) dummy
  left join public.users u on u.id = p_user_id
  left join public.notification_prefs p on p.user_id = p_user_id;
$function$;

revoke all on function public.marketing_suppression_reason(uuid) from public, anon;

comment on function public.marketing_suppression_reason(uuid) is
  'Why a user must NOT receive marketing, or NULL if they may. Since mig 164 a BLOCKED account returns ''blocked'', which outranks consent and quiet hours -- a platform decision supersedes the account owner''s preference state. Also fails closed on an unknown user id. Shared by send_push_campaign''s classifier and its eligibility query, so any future caller inherits the gate.';

-- ---------------------------------------------------------------------------
-- 3. Rebuild send_push_campaign from the DEPLOYED body.
-- ---------------------------------------------------------------------------
-- Built programmatically via pg_get_functiondef, never retyped: this function
-- carries idempotency replay, dry-run, segment resolution and delivery
-- bookkeeping, and hand-copying it is precisely how earlier hardening in this
-- codebase got silently reverted (CLAUDE.md rule 2). Every substitution is
-- asserted, so a drifted body fails loudly instead of shipping a partial fix.
do $mig164$
declare
  v_src text;
  v_new text;
  v_n   int;
begin
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'send_push_campaign';
  if v_n <> 1 then
    raise exception 'mig164: expected exactly 1 send_push_campaign overload, found %', v_n;
  end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'send_push_campaign';

  -- (a) Exclude blocked accounts from EVERY segment. All four segments share
  --     the same `u.role = 'customer'` predicate, so one replace_all covers
  --     them and any future segment that copies the idiom.
  v_new := replace(v_src, 'u.role = ''customer''',
                          'u.role = ''customer'' and not coalesce(u.is_blocked, false)');
  if v_new = v_src then
    raise exception 'mig164: no segment predicate found -- send_push_campaign body differs from expectation';
  end if;
  v_src := v_new;

  -- (b) Count blocked separately in the classifier.
  v_new := replace(v_src,
    '    count(*) filter (where r.reason = ''no_consent''),
    count(*) filter (where r.reason = ''quiet_hours''),
    count(*) filter (where r.reason is null and not r.has_token)
  into v_no_consent, v_quiet, v_no_token',
    '    count(*) filter (where r.reason = ''no_consent''),
    count(*) filter (where r.reason = ''quiet_hours''),
    count(*) filter (where r.reason is null and not r.has_token),
    count(*) filter (where r.reason = ''blocked'')
  into v_no_consent, v_quiet, v_no_token, v_blocked');
  if v_new = v_src then
    raise exception 'mig164: classifier block not found -- send_push_campaign body differs from expectation';
  end if;
  v_src := v_new;

  -- (c) Declare the new variable alongside the existing counters.
  v_new := replace(v_src, '  v_segment_size int;',
                          '  v_segment_size int;
  v_blocked int := 0;');
  if v_new = v_src then
    raise exception 'mig164: could not declare v_blocked -- send_push_campaign body differs from expectation';
  end if;
  v_src := v_new;

  -- (d) Persist it, and keep the legacy suppressed_count an honest total.
  v_new := replace(v_src,
    'suppressed_no_consent, suppressed_quiet_hours, suppressed_no_token, idempotency_key
  ) values (',
    'suppressed_no_consent, suppressed_quiet_hours, suppressed_no_token, suppressed_blocked, idempotency_key
  ) values (');
  if v_new = v_src then
    raise exception 'mig164: campaign insert column list not found';
  end if;
  v_src := v_new;

  v_new := replace(v_src,
    '    v_no_consent + v_quiet + v_no_token,',
    '    v_no_consent + v_quiet + v_no_token + v_blocked,');
  if v_new = v_src then
    raise exception 'mig164: legacy suppressed_count expression not found';
  end if;
  v_src := v_new;

  v_new := replace(v_src,
    '    v_segment_size, v_no_consent, v_quiet, v_no_token, p_idempotency_key
  )',
    '    v_segment_size, v_no_consent, v_quiet, v_no_token, v_blocked, p_idempotency_key
  )');
  if v_new = v_src then
    raise exception 'mig164: campaign insert values list not found';
  end if;

  execute v_new;
end;
$mig164$;

-- Re-assert grants after the replace, deriving the signature from pg_proc so a
-- hand-typed identity cannot drift (that mistake aborted an earlier migration
-- under ON_ERROR_STOP).
do $mig164_grants$
declare v_sig text;
begin
  select p.oid::regprocedure::text into v_sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'send_push_campaign';
  execute format('revoke all on function %s from public, anon', v_sig);
  execute format('grant execute on function %s to authenticated', v_sig);
end;
$mig164_grants$;
