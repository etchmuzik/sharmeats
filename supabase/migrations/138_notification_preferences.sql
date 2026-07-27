-- 138_notification_preferences.sql
--
-- The customer app shows two notification toggles that do nothing. This makes
-- them real, and makes marketing push honour them.
--
-- ================= THE DEFECT =================
-- apps/customer/app/settings.tsx:101-111 renders "Order updates" and
-- "Promotions" as static <View>s -- not switches. No handler, no state, no
-- persistence, and no table for them to persist INTO: a repo-wide search finds
-- no preference/consent/opt-out column anywhere in 137 migrations. So:
--   * a customer who wants to stop marketing push has no way to say so;
--   * send_push_campaign (mig 078/137) has no preference to consult and pushes
--     to every customer with a token;
--   * the UI actively implies "Promotions" is OFF (the toggle renders in the
--     off style) while campaigns send to everyone -- worse than no control,
--     because it looks like a working opt-out.
--
-- That last point is why this is not merely a missing feature. Marketing push
-- to someone the interface told was opted out is a consent problem, not a
-- backlog item.
--
-- ================= THE MODEL =================
-- Two independent switches, matching the two the UI already promises:
--   transactional -- order status, chat, support, credit, delivery. Default ON.
--   marketing     -- campaigns and future lifecycle nudges. Default OFF.
--
-- Marketing defaults to OFF (opt-IN). The 40 existing token holders never
-- agreed to marketing, and defaulting them to ON would manufacture consent
-- that was never given -- the same fiction mig 125 refused to backfill. Opt-in
-- is also the safer read of Egypt's Consumer Protection Law 181/2018 and of
-- the Apple/Google store policies on marketing notifications, and it matches
-- what the settings screen currently shows the user (Promotions rendered off).
--
-- Quiet hours are stored per user as local-clock integers (0-23) with an
-- explicit timezone, because "no pushes at 3am" is a wall-clock promise. They
-- suppress MARKETING ONLY: an order-status or support push must never be
-- delayed by a quiet-hours window -- the food is at the door now.
--
-- ================= WHERE ENFORCEMENT LIVES =================
-- In the SENDER (SECURITY DEFINER), never in client-writable state alone.
-- notification_prefs is user-writable by design (that is the whole point), so
-- a client could otherwise flip another user's row -- RLS prevents that, but
-- the sender must still be the authority. send_push_campaign filters through
-- marketing_allowed(), so opting out is enforced server-side even if a client
-- lies about anything.
--
-- Transactional pushes are deliberately NOT filtered by this migration: every
-- current caller (order status, chat, support, credit, KYC, settlement) is
-- operationally necessary, and silently dropping "your order is here" because
-- of a preference toggle would be a worse defect than the one being fixed.
-- transactional=false is recorded and surfaced, and wiring it into those
-- senders is a deliberate follow-up, not an oversight -- see the comment on
-- the column.

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
create table if not exists public.notification_prefs (
  user_id         uuid primary key references public.users(id) on delete cascade,
  transactional   boolean not null default true,
  marketing       boolean not null default false,
  quiet_hours_start smallint,
  quiet_hours_end   smallint,
  timezone        text not null default 'Africa/Cairo',
  -- Consent provenance. Regulators and store reviewers ask "when did they
  -- agree, and to what?" -- a boolean alone cannot answer that.
  marketing_consent_at     timestamptz,
  marketing_consent_source text,
  updated_at      timestamptz not null default now(),
  constraint notification_prefs_quiet_start_chk
    check (quiet_hours_start is null or quiet_hours_start between 0 and 23),
  constraint notification_prefs_quiet_end_chk
    check (quiet_hours_end is null or quiet_hours_end between 0 and 23),
  -- Both or neither: half a window is not a window.
  constraint notification_prefs_quiet_pair_chk
    check ((quiet_hours_start is null) = (quiet_hours_end is null)),
  constraint notification_prefs_consent_source_chk
    check (marketing_consent_source is null
           or marketing_consent_source in ('settings','onboarding','support','import'))
);

comment on table public.notification_prefs is
  'Per-customer notification consent. One row per user, created on first write (absent row = defaults: transactional on, marketing OFF). Marketing is opt-IN: the 40 pre-existing token holders never consented, and defaulting them on would manufacture consent. Enforcement lives in the SENDERS (marketing_allowed()), not here — this table is user-writable by design. Mig 138.';
comment on column public.notification_prefs.transactional is
  'Order status, chat, support, credit, delivery. Default ON. NOT yet enforced by the transactional senders: dropping "your order is here" on a preference toggle would be a worse defect than the missing control. Recorded and surfaced now; wiring it into those senders (with a hard-exception list for delivery-critical events) is a deliberate follow-up.';
comment on column public.notification_prefs.marketing is
  'Campaigns and lifecycle nudges. Default OFF (opt-in). ENFORCED server-side by marketing_allowed(), which send_push_campaign filters through. Mig 138.';
comment on column public.notification_prefs.quiet_hours_start is
  'Local-clock hour (0-23) when marketing suppression begins, in `timezone`. Windows may wrap midnight (22 -> 7). Applies to MARKETING ONLY — a transactional push is never delayed. Mig 138.';
comment on column public.notification_prefs.marketing_consent_at is
  'When marketing was last switched ON, with marketing_consent_source. Null whenever marketing is off. This is the audit answer to "when did this person agree?". Mig 138.';

alter table public.notification_prefs enable row level security;

-- Owner-only, mirroring push_tokens_owner_all (the shape already proven on the
-- adjacent table). anon is included deliberately: customers are anonymous
-- Supabase sessions until they link a phone, so auth.uid() is their identity
-- either way, and the qual pins every row to the caller.
drop policy if exists notification_prefs_owner_all on public.notification_prefs;
create policy notification_prefs_owner_all on public.notification_prefs
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.notification_prefs from public, anon, authenticated;
grant select on public.notification_prefs to anon, authenticated;
-- Writes go through set_notification_prefs() so consent timestamps cannot be
-- forged and quiet-hours validation cannot be skipped. No direct INSERT/UPDATE
-- grant: RLS cannot restrict columns (house rule 5), and marketing_consent_at
-- is an audit field, not user data.

create index if not exists notification_prefs_marketing_idx
  on public.notification_prefs (user_id) where marketing;

-- ---------------------------------------------------------------------------
-- 2. marketing_allowed() — the single source of truth for "may we send this?"
-- ---------------------------------------------------------------------------
-- in_quiet_hours is defined FIRST because marketing_allowed's body references
-- it and a SQL-language function is parsed at creation time (unlike plpgsql,
-- whose body is only parsed on execution). Ordering caught by the real-schema
-- dry run, not by any shim.
create or replace function public.in_quiet_hours(
  p_start smallint, p_end smallint, p_tz text
)
returns boolean
language plpgsql
immutable
as $function$
declare v_hour int;
begin
  if p_start is null or p_end is null then return false; end if;
  -- A bad/unknown tz must not silently evaluate as "not quiet" (which would
  -- push during someone's night); treat it as quiet and let it be corrected.
  begin
    v_hour := extract(hour from (now() at time zone coalesce(p_tz, 'Africa/Cairo')))::int;
  exception when others then return true;
  end;
  if p_start = p_end then return false;           -- zero-width window
  elsif p_start < p_end then return v_hour >= p_start and v_hour < p_end;
  else return v_hour >= p_start or v_hour < p_end;  -- wraps midnight (22 -> 7)
  end if;
end;
$function$;

comment on function public.in_quiet_hours(smallint, smallint, text) is
  'True when the current wall-clock hour in p_tz falls inside [start, end), handling windows that wrap midnight. An invalid timezone returns TRUE (suppress) so a bad value cannot cause a 3am push. Marked immutable for use in the marketing_allowed inline path; it reads now(), so never index on it. Mig 138.';

-- STABLE + definer so senders can call it in a set-returning context. Absent
-- row = NOT allowed, because marketing is opt-in: silence is not consent.
create or replace function public.marketing_allowed(p_user_id uuid)
returns boolean
language sql
stable
security definer set search_path to 'public','pg_temp'
as $function$
  select coalesce((
    select p.marketing
       and not public.in_quiet_hours(p.quiet_hours_start, p.quiet_hours_end, p.timezone)
      from public.notification_prefs p
     where p.user_id = p_user_id
  ), false);
$function$;

revoke all on function public.marketing_allowed(uuid) from public, anon, authenticated;

comment on function public.marketing_allowed(uuid) is
  'Whether a marketing push may be sent to this user RIGHT NOW: marketing opted in AND not inside their quiet-hours window. Returns FALSE when no prefs row exists — marketing is opt-in, so silence is not consent. Client EXECUTE is revoked; senders call it as definer. Mig 138.';

-- ---------------------------------------------------------------------------
-- 3. set_notification_prefs() — the only writer
-- ---------------------------------------------------------------------------
-- NULL means "leave unchanged" for every field, so the client can send one
-- toggle without clobbering the others (the NULL-preserving upsert pattern
-- from mig 126's admin_upsert_kitchen).
create or replace function public.set_notification_prefs(
  p_transactional     boolean default null,
  p_marketing         boolean default null,
  p_quiet_hours_start smallint default null,
  p_quiet_hours_end   smallint default null,
  p_timezone          text default null,
  p_clear_quiet_hours boolean default false,
  p_source            text default 'settings'
)
returns public.notification_prefs
language plpgsql
security definer set search_path to 'public','pg_temp'
as $function$
declare v_uid uuid := auth.uid(); v_row public.notification_prefs;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;
  if p_source is not null and p_source not in ('settings','onboarding','support','import') then
    raise exception 'INVALID_SOURCE' using errcode = 'check_violation';
  end if;

  insert into public.notification_prefs (user_id) values (v_uid)
  on conflict (user_id) do nothing;

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

  return v_row;
end;
$function$;

revoke all on function public.set_notification_prefs(boolean, boolean, smallint, smallint, text, boolean, text) from public, anon;
grant execute on function public.set_notification_prefs(boolean, boolean, smallint, smallint, text, boolean, text) to authenticated, anon;

comment on function public.set_notification_prefs(boolean, boolean, smallint, smallint, text, boolean, text) is
  'Upserts the CALLER''S notification prefs (auth.uid() only — a caller cannot target another user). NULL leaves a field unchanged so one toggle never clobbers another. Stamps marketing_consent_at on the off->on edge and clears it on opt-out. Granted to anon as well as authenticated because customers are anonymous sessions until they link a phone. Mig 138.';

-- get_notification_prefs: returns the effective values (defaults when no row
-- exists) so the UI never has to encode the defaults itself and drift from them.
create or replace function public.get_notification_prefs()
returns public.notification_prefs
language plpgsql
stable
security definer set search_path to 'public','pg_temp'
as $function$
declare v_uid uuid := auth.uid(); v_row public.notification_prefs;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;
  select * into v_row from public.notification_prefs where user_id = v_uid;
  if not found then
    v_row.user_id := v_uid;
    v_row.transactional := true;
    v_row.marketing := false;      -- opt-in default, matches the table default
    v_row.timezone := 'Africa/Cairo';
    v_row.updated_at := now();
  end if;
  return v_row;
end;
$function$;

revoke all on function public.get_notification_prefs() from public;
grant execute on function public.get_notification_prefs() to authenticated, anon;

comment on function public.get_notification_prefs() is
  'The caller''s effective notification prefs, synthesising the defaults when no row exists yet, so the client never encodes defaults that could drift from the table''s. Mig 138.';

-- ---------------------------------------------------------------------------
-- 4. send_push_campaign — honour the opt-out
-- ---------------------------------------------------------------------------
-- The column MUST exist before the function body below references it: a
-- create-or-replace parses the body immediately, so adding the column later in
-- the file fails with 42703. (The mig 126 dry run caught this exact ordering
-- class against the real schema; the shim suite could not.)
alter table public.push_campaigns
  add column if not exists suppressed_count integer not null default 0;

comment on column public.push_campaigns.suppressed_count is
  'How many users matched the segment but were NOT sent to because they have not opted in to marketing (or were inside quiet hours). recipients + suppressed_count = the raw segment size. Mig 138.';

-- Body from the mig 137 version (which is what is deployed), with one change:
-- every segment is filtered through marketing_allowed(). Kept as one edit in
-- one place -- the four segment branches all feed v_ids, so filtering there
-- covers present and future segments alike.
create or replace function public.send_push_campaign(
  p_title text, p_body text, p_segment text, p_segment_param text default null::text
)
returns integer
language plpgsql
security definer set search_path to 'public','pg_temp'
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
  v_eligible int;
  v_suppressed int;
begin
  if v_agent is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;
  if coalesce(public.auth_role()::text,'') <> 'admin' then raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation'; end if;
  if p_title is null or length(btrim(p_title)) = 0 or p_body is null or length(btrim(p_body)) = 0 then
    raise exception 'EMPTY_COPY' using errcode = 'check_violation';
  end if;
  if p_segment not in ('all','lapsed','never_ordered','zone') then
    raise exception 'INVALID_SEGMENT' using errcode = 'check_violation';
  end if;

  -- Resolve the segment into a temp set, then apply consent once. Splitting
  -- these lets us report how many were suppressed, which is the number that
  -- tells an operator their audience is smaller than the segment implies.
  create temp table if not exists _campaign_targets (user_id uuid primary key) on commit drop;
  delete from _campaign_targets;

  if p_segment = 'all' then
    insert into _campaign_targets (user_id)
    select distinct pt.user_id from public.push_tokens pt
      join public.users u on u.id = pt.user_id and u.role = 'customer';

  elsif p_segment = 'lapsed' then
    v_days := coalesce(nullif(btrim(coalesce(p_segment_param,'')),'')::int, 30);
    insert into _campaign_targets (user_id)
    select distinct pt.user_id from public.push_tokens pt
      join public.users u on u.id = pt.user_id and u.role = 'customer'
     where exists (select 1 from public.orders o where o.user_id = pt.user_id)
       and not exists (
         select 1 from public.orders o
          where o.user_id = pt.user_id and o.placed_at >= now() - make_interval(days => v_days));

  elsif p_segment = 'never_ordered' then
    insert into _campaign_targets (user_id)
    select distinct pt.user_id from public.push_tokens pt
      join public.users u on u.id = pt.user_id and u.role = 'customer'
     where not exists (select 1 from public.orders o where o.user_id = pt.user_id);

  else
    insert into _campaign_targets (user_id)
    select distinct pt.user_id from public.push_tokens pt
      join public.users u on u.id = pt.user_id and u.role = 'customer'
     where exists (
       select 1 from public.orders o
        where o.user_id = pt.user_id and o.zone::text = p_segment_param);
  end if;

  select count(*) into v_eligible from _campaign_targets;

  -- CONSENT GATE. Opting out is enforced HERE, server-side, not in the client.
  select coalesce(jsonb_agg(t.user_id::text), '[]'::jsonb) into v_ids
    from _campaign_targets t where public.marketing_allowed(t.user_id);

  v_count := coalesce(jsonb_array_length(v_ids), 0);
  v_suppressed := v_eligible - v_count;

  insert into public.push_campaigns (title, body, segment, segment_param, recipients, sent_by,
                                     delivery_status, suppressed_count)
  values (btrim(p_title), btrim(p_body), p_segment, p_segment_param, v_count, v_agent,
          case when v_count = 0 then 'not_attempted' else 'dispatched' end, v_suppressed)
  returning id into v_campaign_id;

  if v_count = 0 then
    update public.push_campaigns
       set delivery_detail = case
             when v_eligible = 0 then 'No customers in this segment have a push token.'
             else v_suppressed::text || ' matched the segment but have not opted in to marketing (or are in quiet hours).'
           end,
           settled_at = now()
     where id = v_campaign_id;
    return 0;
  end if;

  select value #>> '{}' into v_base from public.platform_settings where key = 'functions_base_url';
  if v_base is null or v_base = '' then
    update public.push_campaigns
       set delivery_status = 'not_attempted',
           delivery_detail = 'platform_settings.functions_base_url is unset — no push was attempted.',
           settled_at = now()
     where id = v_campaign_id;
    return v_count;
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

  return v_count;
end;
$function$;

revoke all on function public.send_push_campaign(text, text, text, text) from public, anon;
grant execute on function public.send_push_campaign(text, text, text, text) to authenticated;

comment on function public.send_push_campaign(text, text, text, text) is
  'Admin-only marketing push. Returns the number of CONSENTED recipients — every segment is filtered through marketing_allowed(), so a customer who opted out is not sent to regardless of what any client does. push_campaigns.suppressed_count records how many the consent gate removed; delivery_status carries the send outcome. Migs 078, 137, 138.';
