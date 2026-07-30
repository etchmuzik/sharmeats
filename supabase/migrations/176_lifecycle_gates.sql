-- 176_lifecycle_gates.sql
--
-- Package 03 Slice G (with Package 02 Slice E) — the gate every lifecycle
-- producer must pass through, plus the decision ledger.
--
-- ================= WHAT THIS ADDS, AND WHAT ALREADY EXISTED =================
-- `marketing_allowed(user)` (migs 138/142/143) already covers TWO of the seven
-- gates the spec lists, and covers them well: marketing consent, and quiet hours
-- with a fail-CLOSED default for an unknown timezone. It is not reimplemented
-- here; it is called.
--
-- The five gates that did not exist:
--   * global and per-event frequency caps;
--   * active-order suppression;
--   * subject validity (is the cart/order/restaurant still real and orderable);
--   * lifecycle idempotency (one reminder per user per event per subject);
--   * holdout assignment, for measuring incremental lift.
--
-- ================= SHIPS DARK. OBSERVE FIRST =================
-- Following the COD ceiling (mig 149), which is the house precedent for a feature
-- that can harm customers if it misfires. `lifecycle_mode` defaults to 'observe':
-- producers evaluate every gate and record what they WOULD have sent, and enqueue
-- nothing. Applying this migration therefore changes no customer-visible behaviour
-- at all. Marketing that goes out unobserved is how a business trains its
-- customers to disable notifications.
--
-- ================= WHAT THE FREQUENCY CAP COUNTS, AND WHY IT MATTERS =================
-- The obvious design counts SENT messages. That breaks observe mode: nothing is
-- ever sent, so every user looks eligible on every run forever, and the observed
-- volume is wildly optimistic — exactly the number an operator would use to decide
-- whether to go live.
--
-- So the ledger records EVERY decision, and the cap counts rows with
-- `would_send = true`. In observe mode that is the honest counterfactual ("this
-- would have consumed budget"); in live mode it is the real send. One column
-- serves both, and the volume an operator sees before flipping the flag is the
-- volume they will actually get.
--
-- ================= HOLDOUTS ARE DETERMINISTIC =================
-- A user's holdout group is derived from hashtext(user_id || event), NOT from
-- random() and NOT stored per send. Two consequences, both required:
--   * stable across runs, so a user held out of reorder reminders stays held out
--     and the comparison is between two fixed cohorts rather than noise;
--   * per-EVENT, so being in the control group for reorder reminders does not also
--     silence abandoned-cart reminders. A user held out of everything is just a
--     user with notifications off, which measures nothing.

-- ---------------------------------------------------------------------------
-- 1. Settings. Conservative, and observe mode, so applying this changes nothing.
-- ---------------------------------------------------------------------------
insert into public.platform_settings (key, value) values
  ('lifecycle_mode',                 to_jsonb('observe'::text)),
  -- Global ceiling across ALL lifecycle events, so six producers cannot each
  -- politely stay under their own cap and collectively spam someone.
  ('lifecycle_cap_per_user_per_week', to_jsonb(3)),
  -- Per-event ceiling, rolling 7 days.
  ('lifecycle_cap_per_event_per_week', to_jsonb(1)),
  -- Percentage of users held back per event for incremental measurement.
  ('lifecycle_holdout_pct',          to_jsonb(10)),
  -- A cart is "abandoned" after this long untouched.
  ('lifecycle_cart_idle_hours',      to_jsonb(24))
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. The decision ledger. Doubles as the frequency-cap source (see header).
-- ---------------------------------------------------------------------------
create table if not exists public.lifecycle_sends (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users(id) on delete cascade,
  -- Which producer decided. Text rather than an enum so a new producer does not
  -- need a migration in lockstep with its own deploy.
  lifecycle_event  text not null,
  -- What the reminder is ABOUT: a cart's restaurant, a delivered order, a saved
  -- item. Untyped uuid because the referent differs per event, and a FK per
  -- producer would mean altering this table for each new one.
  subject_id       uuid null,
  -- TRUE = this consumed budget (a real send in live mode, a counterfactual in
  -- observe mode). FALSE = a gate refused it. See the header on why the cap counts
  -- this column rather than actual sends.
  would_send       boolean not null,
  -- Bounded vocabulary so suppressions are countable in operator UI, never free
  -- text from an error.
  suppression_reason text null
    check (suppression_reason is null or suppression_reason in
           ('no_consent','quiet_hours','global_cap','event_cap','active_order',
            'subject_invalid','already_sent','holdout','no_recipient')),
  -- Which cohort this user is in for THIS event. Recorded so lift can be measured
  -- without recomputing the hash later (and so a changed holdout_pct does not
  -- retroactively rewrite history).
  holdout_group    text not null check (holdout_group in ('treatment','control')),
  -- Which mode produced this row, so observe-era rows are never mistaken for sends.
  mode             text not null check (mode in ('observe','live')),
  -- The outbox message, when one was actually enqueued. Null in observe mode.
  message_id       uuid null references public.push_messages(id) on delete set null,
  decided_at       timestamptz not null default now()
);

comment on table public.lifecycle_sends is
  'Every lifecycle-reminder DECISION, not just the sends. Doubles as the frequency-cap source: the cap counts would_send = true, which in observe mode is the honest counterfactual and in live mode the real send — counting only actual sends would make every user look eligible forever while dark, and the volume an operator reads before going live would be fiction. mode distinguishes observe-era rows from real ones. Package 03 Slice G, mig 176.';
comment on column public.lifecycle_sends.would_send is
  'TRUE = consumed frequency budget (real send when mode=live, counterfactual when mode=observe). FALSE = a gate refused it, and suppression_reason says which. Mig 176.';
comment on column public.lifecycle_sends.holdout_group is
  'Deterministic per (user, event) from hashtext — never random, never stored as the source of truth. Stable so the comparison is between two fixed cohorts rather than noise, and per-event so a control-group user for reorder reminders still gets abandoned-cart ones. Mig 176.';

-- The frequency-cap queries: "how many in the last 7 days, globally and per event".
create index if not exists lifecycle_sends_user_recent_idx
  on public.lifecycle_sends (user_id, decided_at desc) where would_send;
create index if not exists lifecycle_sends_user_event_recent_idx
  on public.lifecycle_sends (user_id, lifecycle_event, decided_at desc) where would_send;
-- The idempotency query: "have we already covered this exact subject".
create index if not exists lifecycle_sends_subject_idx
  on public.lifecycle_sends (user_id, lifecycle_event, subject_id) where subject_id is not null;
-- Operator reporting.
create index if not exists lifecycle_sends_reason_idx
  on public.lifecycle_sends (lifecycle_event, suppression_reason, decided_at desc);

-- House rule 5b: ALTER DEFAULT PRIVILEGES grants arwdDxtm to anon/authenticated on
-- every new table, and TRUNCATE IGNORES RLS — so "RLS on, no policy" would still
-- let any anon-key holder erase the whole marketing-decision history.
revoke all on table public.lifecycle_sends from public, anon, authenticated;
alter table public.lifecycle_sends enable row level security;
-- No client policy at all: this is operator telemetry, read through admin surfaces.

-- ---------------------------------------------------------------------------
-- 3. Holdout assignment
-- ---------------------------------------------------------------------------
-- Deterministic and per-event. hashtext is stable within a Postgres major version,
-- which is the property that matters: the same user must land in the same cohort on
-- every run. abs() because hashtext returns negative values for about half its
-- inputs, and a negative modulus would put ~50% of users in the control group
-- regardless of the configured percentage — a bug that would look like the feature
-- simply underperforming.
create or replace function public.lifecycle_holdout_group(p_user_id uuid, p_event text)
returns text
language sql
immutable
set search_path to 'public', 'pg_temp'
as $function$
  select case
           when p_user_id is null then 'treatment'
           else case when abs(hashtext(p_user_id::text || ':' || coalesce(p_event, ''))) % 100
                          < greatest(0, least(100,
                              coalesce((select (value #>> '{}')::int
                                          from public.platform_settings
                                         where key = 'lifecycle_holdout_pct'), 10)))
                     then 'control' else 'treatment' end
         end;
$function$;

comment on function public.lifecycle_holdout_group(uuid, text) is
  'Which measurement cohort a user is in for one lifecycle event. Deterministic (hashtext, not random) so a user stays in the same cohort across runs and the comparison is between two fixed groups rather than noise; per-event so a control-group user for reorder reminders still receives abandoned-cart ones. abs() is load-bearing — hashtext returns negatives for ~half of inputs, and a negative modulus would hold back ~50% of users regardless of the configured percentage. Mig 176.';

-- Not marked STABLE by accident: it reads platform_settings, so it is not truly
-- IMMUTABLE. Declared immutable would license the planner to cache across a
-- settings change. Corrected here rather than left as a latent trap.
alter function public.lifecycle_holdout_group(uuid, text) stable;

-- ---------------------------------------------------------------------------
-- 4. The gate
-- ---------------------------------------------------------------------------
-- Returns the FIRST failing reason rather than a boolean, so the ledger can record
-- WHY — which is the whole point of observe mode. Order is deliberate: cheapest and
-- most decisive first, so a user with marketing off costs one lookup rather than
-- five.
create or replace function public.lifecycle_eligible(
  p_user_id    uuid,
  p_event      text,
  p_subject_id uuid default null
)
returns table (allowed boolean, reason text, holdout_group text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_group      text;
  v_global_cap int;
  v_event_cap  int;
  v_count      int;
begin
  holdout_group := public.lifecycle_holdout_group(p_user_id, p_event);
  v_group := holdout_group;

  if p_user_id is null then
    allowed := false; reason := 'no_recipient'; return next; return;
  end if;

  -- 1. Consent AND quiet hours, via the existing single source of truth. Fails
  --    closed on an absent prefs row (marketing defaults off) and on an unknown
  --    timezone.
  if not public.marketing_allowed(p_user_id) then
    allowed := false;
    -- Distinguish the two so an operator can tell "nobody consented" from "we ran
    -- at the wrong hour", which are completely different problems.
    reason := case
      when coalesce((select marketing from public.notification_prefs
                      where user_id = p_user_id), false) then 'quiet_hours'
      else 'no_consent' end;
    return next; return;
  end if;

  -- 2. Idempotency. One reminder per user per event per subject, ever. Checked
  --    before the caps so a repeat attempt does not look like cap exhaustion.
  if p_subject_id is not null and exists (
       select 1 from public.lifecycle_sends s
        where s.user_id = p_user_id
          and s.lifecycle_event = p_event
          and s.subject_id = p_subject_id
          and s.would_send
     ) then
    allowed := false; reason := 'already_sent'; return next; return;
  end if;

  -- 3. Active order. Somebody mid-order does not want marketing about a different
  --    one, and an abandoned-cart nudge while they are checking out is absurd.
  if exists (
       select 1 from public.orders o
        where o.user_id = p_user_id
          and o.status not in ('delivered','cancelled','rejected')
     ) then
    allowed := false; reason := 'active_order'; return next; return;
  end if;

  -- 4. Per-event cap, rolling 7 days.
  select coalesce((select (value #>> '{}')::int from public.platform_settings
                    where key = 'lifecycle_cap_per_event_per_week'), 1)
    into v_event_cap;
  select count(*) into v_count from public.lifecycle_sends s
   where s.user_id = p_user_id and s.lifecycle_event = p_event
     and s.would_send and s.decided_at > now() - interval '7 days';
  if v_count >= v_event_cap then
    allowed := false; reason := 'event_cap'; return next; return;
  end if;

  -- 5. Global cap across every lifecycle event, so six producers each staying
  --    under their own cap cannot collectively spam one person.
  select coalesce((select (value #>> '{}')::int from public.platform_settings
                    where key = 'lifecycle_cap_per_user_per_week'), 3)
    into v_global_cap;
  select count(*) into v_count from public.lifecycle_sends s
   where s.user_id = p_user_id and s.would_send
     and s.decided_at > now() - interval '7 days';
  if v_count >= v_global_cap then
    allowed := false; reason := 'global_cap'; return next; return;
  end if;

  -- 6. Holdout LAST, deliberately. A held-out user must pass every other gate
  --    first, or the control group would be contaminated with people who were
  --    ineligible anyway and the measured lift would be meaningless.
  if v_group = 'control' then
    allowed := false; reason := 'holdout'; return next; return;
  end if;

  allowed := true; reason := null; return next;
end;
$function$;

revoke all on function public.lifecycle_eligible(uuid, text, uuid) from public, anon, authenticated;

comment on function public.lifecycle_eligible(uuid, text, uuid) is
  'The gate every lifecycle producer passes through. Returns the FIRST failing reason rather than a boolean, because recording WHY is the point of observe mode. Calls marketing_allowed for consent + quiet hours rather than reimplementing them, then adds idempotency, active-order suppression, per-event and global weekly caps, and holdout. Order is deliberate twice over: cheapest gate first, and HOLDOUT LAST so the control group contains only users who would genuinely have been sent to — otherwise it fills with ineligible people and the measured lift is meaningless. Not executable by anon or authenticated. Mig 176.';

-- ---------------------------------------------------------------------------
-- 5. Ledger writer
-- ---------------------------------------------------------------------------
-- A separate function so the six producers cannot each invent their own row shape,
-- and so the mode is read in exactly one place. Never raises: a producer is a cron
-- sweep, and failing to record a decision must not abort the batch.
create or replace function public.lifecycle_record(
  p_user_id    uuid,
  p_event      text,
  p_subject_id uuid,
  p_would_send boolean,
  p_reason     text,
  p_group      text,
  p_message_id uuid default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_mode text;
begin
  select coalesce((select value #>> '{}' from public.platform_settings
                    where key = 'lifecycle_mode'), 'observe') into v_mode;
  if v_mode not in ('observe','live') then v_mode := 'observe'; end if;

  insert into public.lifecycle_sends
    (user_id, lifecycle_event, subject_id, would_send, suppression_reason,
     holdout_group, mode, message_id)
  values
    (p_user_id, p_event, p_subject_id, coalesce(p_would_send, false), p_reason,
     coalesce(nullif(p_group, ''), 'treatment'), v_mode, p_message_id);
exception when others then
  raise warning 'lifecycle_record(%, %) failed: %', p_event, p_user_id, sqlerrm;
end;
$function$;

revoke all on function public.lifecycle_record(uuid, text, uuid, boolean, text, text, uuid)
  from public, anon, authenticated;

comment on function public.lifecycle_record(uuid, text, uuid, boolean, text, text, uuid) is
  'Writes one lifecycle decision to the ledger, and is the single place lifecycle_mode is read — so six producers cannot each invent a row shape or each decide independently whether they are live. Never raises: a producer is a cron sweep and a failed write must not abort the batch. Mig 176.';

-- ---------------------------------------------------------------------------
-- 6. Is the feature live?
-- ---------------------------------------------------------------------------
create or replace function public.lifecycle_is_live()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce((select value #>> '{}' from public.platform_settings
                    where key = 'lifecycle_mode'), 'observe') = 'live';
$function$;

revoke all on function public.lifecycle_is_live() from public, anon, authenticated;

comment on function public.lifecycle_is_live() is
  'Whether lifecycle producers may actually enqueue. Defaults to FALSE for an absent or unrecognised setting, so a typo in platform_settings leaves the feature dark rather than silently sending marketing. Mig 176.';
