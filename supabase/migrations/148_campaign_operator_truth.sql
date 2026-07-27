-- 148_campaign_operator_truth.sql
--
-- Package 03 A4 — campaign enforcement and operator truth.
--
-- WHAT IS WRONG TODAY. send_push_campaign returns ONE integer (the recipient
-- count) and stores ONE suppressed_count, because marketing_allowed() collapses
-- two completely different states into a single boolean:
--
--     no consent  -> suppressed        (your audience does not want this)
--     quiet hours -> suppressed        (your audience is ASLEEP; retry at 10am)
--
-- Those demand opposite operator actions, and today they are indistinguishable.
-- A campaign that reports "180 opted out" when the real answer is "180 are in
-- quiet hours" sends an operator to fix a consent problem that does not exist.
--
-- Three further A4 gaps this closes:
--   * no dry run, so the only way to learn an audience size is to SEND to it;
--   * no idempotency, so a double-clicked Send is two campaigns to the same
--     people (and push, unlike an order, has no natural dedupe);
--   * the return value is one ambiguous integer.
--
-- WHAT THIS DOES NOT DO. It does not expose recipient identities to the admin
-- UI: every output is a COUNT. Knowing that 180 people were suppressed is
-- operationally necessary; knowing WHICH 180 is not, and would turn the
-- campaign screen into a consent-status browser.
--
-- SIGNATURE CHANGE. send_push_campaign gains p_dry_run and p_idempotency_key
-- and now returns a TABLE. The old 4-arg integer-returning version is DROPPED
-- rather than left beside it: two overloads means PostgREST answers PGRST202 on
-- every call (house rule 1). The admin UI is updated in the same commit, and
-- this RPC has exactly one caller, so there is no old-binary exposure -- it is
-- an admin web surface, not a shipped mobile binary.

-- ---------------------------------------------------------------------------
-- 1. Per-user suppression REASON, replacing the boolean.
--
-- marketing_allowed() is kept exactly as-is: it is the gate other callers use
-- and changing its meaning would be the "restating an old body" trap. This is
-- an additive companion that explains the same decision.
-- ---------------------------------------------------------------------------
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
  -- be eligible.
  select case
    when p.user_id is null then 'no_consent'      -- absent row = opt-in default OFF
    when not p.marketing   then 'no_consent'
    when public.in_quiet_hours(p.quiet_hours_start, p.quiet_hours_end, p.timezone)
                           then 'quiet_hours'
    else null
  end
  from (select 1) dummy
  left join public.notification_prefs p on p.user_id = p_user_id;
$function$;

revoke all on function public.marketing_suppression_reason(uuid) from public, anon, authenticated;
grant execute on function public.marketing_suppression_reason(uuid) to service_role;

comment on function public.marketing_suppression_reason(uuid) is
  'Why a customer may not receive marketing right now: NULL = may be sent to, ''no_consent'' = never opted in or opted out, ''quiet_hours'' = consented but currently inside their quiet window. The permanent reason wins over the temporary one so an operator is never told to retry for someone who will never be eligible. Companion to marketing_allowed() (unchanged); this one EXPLAINS the same decision. Not granted to clients -- another customer''s consent state is not a customer''s business. Mig 148.';


-- ---------------------------------------------------------------------------
-- 2. Campaign columns for the breakdown + idempotency.
-- ---------------------------------------------------------------------------
alter table public.push_campaigns
  add column if not exists segment_size int,
  add column if not exists suppressed_no_consent int,
  add column if not exists suppressed_quiet_hours int,
  add column if not exists suppressed_no_token int,
  add column if not exists idempotency_key text;

-- One campaign per key per admin. Partial so the many pre-148 rows (all NULL)
-- do not collide with each other.
create unique index if not exists push_campaigns_idempotency_uidx
  on public.push_campaigns (sent_by, idempotency_key)
  where idempotency_key is not null;

comment on column public.push_campaigns.segment_size is
  'How many customers matched the SEGMENT, before any consent or token filtering. The denominator: recipients/segment_size is the real reach of a campaign. Mig 148.';
comment on column public.push_campaigns.suppressed_no_consent is
  'Matched the segment but never opted in to marketing (or opted out). PERMANENT until they consent -- retrying later changes nothing. Mig 148.';
comment on column public.push_campaigns.suppressed_quiet_hours is
  'Consented, but currently inside their quiet window. TEMPORARY -- these customers are reachable later, which is a different operator action from no_consent. Mig 148.';
comment on column public.push_campaigns.suppressed_no_token is
  'In the segment and consented, but has no usable push token (never granted OS permission, or the token was pruned as DeviceNotRegistered). Mig 148.';


-- ---------------------------------------------------------------------------
-- 3. Replace send_push_campaign.
--
-- Body derived from the DEPLOYED definition (pg_get_functiondef, 2026-07-28).
-- The segment resolution, the vault secret lookup and the net.http_post call
-- are re-stated verbatim; what changes is the counting, the dry-run branch,
-- idempotency, and the return type.
-- ---------------------------------------------------------------------------
drop function if exists public.send_push_campaign(text, text, text, text);

create or replace function public.send_push_campaign(
  p_title text,
  p_body text,
  p_segment text,
  p_segment_param text default null,
  p_dry_run boolean default false,
  p_idempotency_key text default null
)
returns table (
  campaign_id uuid,
  segment_size int,
  recipients int,
  suppressed_no_consent int,
  suppressed_quiet_hours int,
  suppressed_no_token int,
  dry_run boolean
)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_agent   uuid := auth.uid();
  v_base    text;
  v_secret  text;
  v_headers jsonb;
  v_ids     jsonb;
  v_count   int;
  v_days    int;
  v_campaign_id uuid;
  v_req_id  bigint;
  v_segment_size int;
  v_no_consent int;
  v_quiet int;
  v_no_token int;
  v_existing public.push_campaigns;
begin
  if v_agent is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;
  if coalesce(public.auth_role()::text,'') <> 'admin' then raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation'; end if;
  if p_title is null or length(btrim(p_title)) = 0 or p_body is null or length(btrim(p_body)) = 0 then
    raise exception 'EMPTY_COPY' using errcode = 'check_violation';
  end if;
  if p_segment not in ('all','lapsed','never_ordered','zone') then
    raise exception 'INVALID_SEGMENT' using errcode = 'check_violation';
  end if;

  -- IDEMPOTENCY. A double-clicked Send is two pushes to the same people, and
  -- unlike an order there is nothing downstream that dedupes them. Return the
  -- FIRST campaign's numbers rather than sending again. Dry runs are excluded:
  -- they send nothing, so replaying one is harmless and must not burn the key.
  if p_idempotency_key is not null and not coalesce(p_dry_run, false) then
    select * into v_existing from public.push_campaigns c
     where c.sent_by = v_agent and c.idempotency_key = p_idempotency_key;
    if found then
      campaign_id := v_existing.id;
      segment_size := v_existing.segment_size;
      recipients := v_existing.recipients;
      suppressed_no_consent := v_existing.suppressed_no_consent;
      suppressed_quiet_hours := v_existing.suppressed_quiet_hours;
      suppressed_no_token := v_existing.suppressed_no_token;
      dry_run := false;
      return next;
      return;
    end if;
  end if;

  -- Segment resolution WITHOUT the push-token join, so "in the segment" and
  -- "has a token" become separable. The deployed version joined push_tokens
  -- here, which is why a tokenless customer was invisible rather than counted.
  create temp table if not exists _campaign_segment (user_id uuid primary key) on commit drop;
  delete from _campaign_segment;

  if p_segment = 'all' then
    insert into _campaign_segment (user_id)
    select u.id from public.users u where u.role = 'customer';

  elsif p_segment = 'lapsed' then
    v_days := coalesce(nullif(btrim(coalesce(p_segment_param,'')),'')::int, 30);
    insert into _campaign_segment (user_id)
    select u.id from public.users u
     where u.role = 'customer'
       and exists (select 1 from public.orders o where o.user_id = u.id)
       and not exists (
         select 1 from public.orders o
          where o.user_id = u.id and o.placed_at >= now() - make_interval(days => v_days));

  elsif p_segment = 'never_ordered' then
    insert into _campaign_segment (user_id)
    select u.id from public.users u
     where u.role = 'customer'
       and not exists (select 1 from public.orders o where o.user_id = u.id);

  else
    insert into _campaign_segment (user_id)
    select u.id from public.users u
     where u.role = 'customer'
       and exists (
         select 1 from public.orders o
          where o.user_id = u.id and o.zone::text = p_segment_param);
  end if;

  select count(*) into v_segment_size from _campaign_segment;

  -- Classify every segment member exactly once.
  select
    count(*) filter (where r.reason = 'no_consent'),
    count(*) filter (where r.reason = 'quiet_hours'),
    count(*) filter (where r.reason is null and not r.has_token)
  into v_no_consent, v_quiet, v_no_token
  from (
    select s.user_id,
           public.marketing_suppression_reason(s.user_id) as reason,
           exists (select 1 from public.push_tokens t where t.user_id = s.user_id) as has_token
      from _campaign_segment s
  ) r;

  -- Eligible = consented, outside quiet hours, and reachable.
  select coalesce(jsonb_agg(s.user_id::text), '[]'::jsonb) into v_ids
    from _campaign_segment s
   where public.marketing_suppression_reason(s.user_id) is null
     and exists (select 1 from public.push_tokens t where t.user_id = s.user_id);

  v_count := coalesce(jsonb_array_length(v_ids), 0);

  -- DRY RUN: answer the audience question without sending or recording a
  -- campaign. An operator must be able to learn the reach of a segment without
  -- pushing to it first.
  if coalesce(p_dry_run, false) then
    campaign_id := null;
    segment_size := v_segment_size;
    recipients := v_count;
    suppressed_no_consent := v_no_consent;
    suppressed_quiet_hours := v_quiet;
    suppressed_no_token := v_no_token;
    dry_run := true;
    return next;
    return;
  end if;

  insert into public.push_campaigns (
    title, body, segment, segment_param, recipients, sent_by,
    delivery_status, suppressed_count, segment_size,
    suppressed_no_consent, suppressed_quiet_hours, suppressed_no_token, idempotency_key
  ) values (
    btrim(p_title), btrim(p_body), p_segment, p_segment_param, v_count, v_agent,
    case when v_count = 0 then 'not_attempted' else 'dispatched' end,
    -- Retained so anything still reading the old column keeps working; it is
    -- now simply the sum of the three specific reasons.
    v_no_consent + v_quiet + v_no_token,
    v_segment_size, v_no_consent, v_quiet, v_no_token, p_idempotency_key
  )
  returning id into v_campaign_id;

  if v_count = 0 then
    update public.push_campaigns
       set delivery_detail = case
             when v_segment_size = 0 then 'No customers match this segment.'
             else v_no_consent::text || ' have not opted in, '
                  || v_quiet::text || ' are in quiet hours, '
                  || v_no_token::text || ' have no push token.'
           end,
           settled_at = now()
     where id = v_campaign_id;

    campaign_id := v_campaign_id; segment_size := v_segment_size; recipients := 0;
    suppressed_no_consent := v_no_consent; suppressed_quiet_hours := v_quiet;
    suppressed_no_token := v_no_token; dry_run := false;
    return next; return;
  end if;

  select value #>> '{}' into v_base from public.platform_settings where key = 'functions_base_url';
  if v_base is null or v_base = '' then
    update public.push_campaigns
       set delivery_status = 'not_attempted',
           delivery_detail = 'platform_settings.functions_base_url is unset — no push was attempted.',
           settled_at = now()
     where id = v_campaign_id;

    campaign_id := v_campaign_id; segment_size := v_segment_size; recipients := v_count;
    suppressed_no_consent := v_no_consent; suppressed_quiet_hours := v_quiet;
    suppressed_no_token := v_no_token; dry_run := false;
    return next; return;
  end if;

  begin
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_internal_secret';
  exception when others then v_secret := null;
  end;
  v_headers := '{"Content-Type": "application/json"}'::jsonb;
  if v_secret is not null and v_secret <> '' then
    v_headers := v_headers || jsonb_build_object('x-internal-secret', v_secret);
  end if;

  select net.http_post(
    url     := v_base || '/expo-push',
    body    := jsonb_build_object(
                 'event', 'campaign',
                 'route', '/',
                 'title', btrim(p_title), 'body', btrim(p_body),
                 'recipientUserIds', v_ids
               ),
    headers := v_headers
  ) into v_req_id;

  update public.push_campaigns set net_request_id = v_req_id where id = v_campaign_id;

  campaign_id := v_campaign_id; segment_size := v_segment_size; recipients := v_count;
  suppressed_no_consent := v_no_consent; suppressed_quiet_hours := v_quiet;
  suppressed_no_token := v_no_token; dry_run := false;
  return next;
end;
$function$;

revoke all on function public.send_push_campaign(text, text, text, text, boolean, text) from public, anon;
grant execute on function public.send_push_campaign(text, text, text, text, boolean, text) to authenticated;

comment on function public.send_push_campaign(text, text, text, text, boolean, text) is
  'Admin-only marketing campaign send (Package 03 A4). Returns a campaign id plus a SUPPRESSION BREAKDOWN rather than one ambiguous integer: no_consent is permanent (retrying changes nothing) while quiet_hours is temporary (the same customers are reachable later) -- opposite operator actions that the previous single suppressed_count could not distinguish. p_dry_run answers the audience question without sending or recording anything. p_idempotency_key makes a double-clicked Send return the first campaign instead of pushing twice; dry runs never burn a key. Every output is a COUNT: recipient identities are deliberately not exposed. Migs 137, 138, 146, 148.';
