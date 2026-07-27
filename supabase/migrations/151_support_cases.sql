-- 151_support_cases.sql
--
-- Package 04 Slice D — support cases and SLA.
--
-- WHAT EXISTS. support_messages is ONE flat thread per customer: body,
-- from_support, read_at. It has realtime and it works, but it cannot express
-- anything an operator needs to run support as a process:
--
--   * no status      -- is this waiting on us or on the customer?
--   * no owner       -- who is handling it? (so: nobody)
--   * no priority    -- a cold meal and a missing EGP 400 look identical
--   * no SLA         -- "we reply fast" is unmeasurable, so unenforceable
--   * no resolution  -- what actually happened, and did it recur?
--
-- ADDITIVE, NOT A REPLACEMENT. support_messages keeps its shape, its policies
-- and its realtime subscription. Existing threads stay readable exactly as they
-- are. A case is a container placed AROUND the conversation, and `case_id` is
-- nullable so an old client that knows nothing about cases keeps working --
-- its messages simply land on the customer's open case, or none.
--
-- OPERATOR ROLES. app_role has no 'support' value (customer/driver/
-- merchant_staff/dispatcher/admin), and adding an enum value is a bigger
-- contract change than this slice needs -- every role check across the schema
-- would have to be revisited. Support operators are 'admin' and 'dispatcher',
-- which is who actually staffs this today.
--
-- LEGACY BACKFILL. The spec permits attaching historical messages to a
-- migration-created case "only if the relationship is unambiguous". Production
-- has messages from exactly ONE customer, so it is unambiguous here: one legacy
-- case, already resolved, so it never appears in a live queue pretending to be
-- work. Were there several interleaved threads per customer this would be left
-- alone instead of guessed at.

create table if not exists public.support_cases (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references public.users(id) on delete cascade,
  order_id      uuid references public.orders(id) on delete set null,
  status        text not null default 'open',
  priority      text not null default 'normal',
  reason_code   text not null default 'other',
  assigned_to   uuid references public.users(id) on delete set null,
  opened_at     timestamptz not null default now(),
  first_response_due_at timestamptz,
  resolution_due_at     timestamptz,
  first_responded_at    timestamptz,
  resolved_at   timestamptz,
  closed_at     timestamptz,
  resolution_code text,
  resolution_note text,
  last_message_at timestamptz not null default now(),

  constraint support_cases_status_chk
    check (status in ('open','waiting_customer','waiting_ops','resolved','closed')),
  constraint support_cases_priority_chk
    check (priority in ('low','normal','high','urgent')),
  constraint support_cases_reason_chk
    check (reason_code in ('order_late','order_wrong','order_missing_items','food_quality',
                           'payment','refund','driver','app_issue','account','other')),
  -- A resolved case must say WHAT happened. "Resolved" with no code is how a
  -- support process stops being measurable.
  constraint support_cases_resolution_chk
    check (status not in ('resolved','closed') or resolution_code is not null)
);

create index if not exists support_cases_customer_idx on public.support_cases (customer_id, opened_at desc);
create index if not exists support_cases_queue_idx on public.support_cases (status, priority, first_response_due_at)
  where status in ('open','waiting_ops');

-- Append-only audit of everything that happened to a case.
create table if not exists public.support_case_events (
  id         uuid primary key default gen_random_uuid(),
  case_id    uuid not null references public.support_cases(id) on delete cascade,
  event      text not null,
  actor_id   uuid references public.users(id) on delete set null,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint support_case_events_event_chk
    check (event in ('opened','assigned','unassigned','status_changed','priority_changed',
                     'first_response','resolved','reopened','closed','note'))
);

create index if not exists support_case_events_case_idx on public.support_case_events (case_id, created_at);

-- Case linkage on messages. NULLABLE on purpose: an old client posting a
-- message knows nothing about cases, and must not start failing.
alter table public.support_messages
  add column if not exists case_id uuid references public.support_cases(id) on delete set null;

create index if not exists support_messages_case_idx on public.support_messages (case_id, created_at);

-- HOUSE RULE 5b. ALTER DEFAULT PRIVILEGES grants arwdDxtm to anon/authenticated
-- on every new table, and TRUNCATE ignores RLS entirely. Revoke first.
revoke all on table public.support_cases from public, anon, authenticated;
revoke all on table public.support_case_events from public, anon, authenticated;

alter table public.support_cases enable row level security;
alter table public.support_case_events enable row level security;

-- A customer reads their OWN cases and nothing else. All writes go through the
-- RPCs below, so there is no INSERT/UPDATE policy at all.
grant select on table public.support_cases to authenticated;

drop policy if exists support_cases_own_select on public.support_cases;
create policy support_cases_own_select
  on public.support_cases for select to authenticated
  using (
    customer_id = auth.uid()
    or coalesce(public.auth_role()::text, '') in ('admin','dispatcher')
  );

-- Case history is operator-facing: it records who claimed and reassigned a
-- case, which is not the customer's business. Admin/dispatcher only.
grant select on table public.support_case_events to authenticated;

drop policy if exists support_case_events_staff_select on public.support_case_events;
create policy support_case_events_staff_select
  on public.support_case_events for select to authenticated
  using (coalesce(public.auth_role()::text, '') in ('admin','dispatcher'));

-- Immutable history: correcting a case means appending an event, never editing
-- one. Enforced by trigger so even a definer writer cannot rewrite it.
create or replace function public.support_case_events_immutable()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  raise exception 'SUPPORT_CASE_EVENTS_ARE_APPEND_ONLY'
    using errcode = 'check_violation',
          hint = 'Append a new event instead of editing or deleting history.';
end;
$function$;

drop trigger if exists support_case_events_no_mutate on public.support_case_events;
create trigger support_case_events_no_mutate
  before update or delete on public.support_case_events
  for each row execute function public.support_case_events_immutable();

comment on table public.support_cases is
  'Support conversations as a measurable process (Package 04 Slice D): status, owner, priority, SLA targets and a structured resolution. support_messages is unchanged and still holds the conversation; this is the container around it. Written only by the RPCs below. Mig 151.';
comment on table public.support_case_events is
  'Append-only audit of everything that happened to a support case. UPDATE/DELETE refused by trigger even for definer callers -- a history its own writer can edit is not evidence. Staff-readable only: who claimed or reassigned a case is operator information. Mig 151.';
comment on column public.support_messages.case_id is
  'The case this message belongs to. NULLABLE so an old client that knows nothing about cases keeps working -- open_support_case()/post via the app attaches it. Mig 151.';


-- ---------------------------------------------------------------------------
-- Customer: open a case.
-- ---------------------------------------------------------------------------
create or replace function public.open_support_case(
  p_reason_code text,
  p_order_id uuid default null,
  p_message text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_fr_mins int;
  v_res_mins int;
  v_existing uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;
  if p_reason_code is null or p_reason_code not in
     ('order_late','order_wrong','order_missing_items','food_quality',
      'payment','refund','driver','app_issue','account','other') then
    raise exception 'INVALID_REASON' using errcode = 'check_violation';
  end if;
  -- An order id must belong to the CALLER. Without this check a customer could
  -- attach their case to a stranger's order and pull it into the operator view
  -- beside that order's details.
  if p_order_id is not null and not exists (
    select 1 from public.orders o where o.id = p_order_id and o.user_id = v_uid
  ) then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'check_violation';
  end if;

  -- One live case at a time per customer: a second "my order is late" while the
  -- first is still open splits the conversation and doubles the queue.
  select id into v_existing from public.support_cases
   where customer_id = v_uid and status in ('open','waiting_customer','waiting_ops')
   order by opened_at desc limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  select coalesce((value #>> '{}')::int, 60) into v_fr_mins
    from public.platform_settings where key = 'support_first_response_minutes';
  select coalesce((value #>> '{}')::int, 1440) into v_res_mins
    from public.platform_settings where key = 'support_resolution_minutes';

  insert into public.support_cases
    (customer_id, order_id, reason_code, first_response_due_at, resolution_due_at,
     priority)
  values
    (v_uid, p_order_id, p_reason_code,
     now() + make_interval(mins => coalesce(v_fr_mins, 60)),
     now() + make_interval(mins => coalesce(v_res_mins, 1440)),
     -- Money problems outrank everything else by default: a missing refund is
     -- not the same class of problem as a late meal.
     case when p_reason_code in ('payment','refund') then 'high' else 'normal' end)
  returning id into v_id;

  insert into public.support_case_events (case_id, event, actor_id, metadata)
  values (v_id, 'opened', v_uid, jsonb_build_object('reason_code', p_reason_code));

  if p_message is not null and length(btrim(p_message)) > 0 then
    insert into public.support_messages (user_id, from_support, author_id, body, case_id)
    values (v_uid, false, v_uid, btrim(p_message), v_id);
    update public.support_cases set last_message_at = now() where id = v_id;
  end if;

  return v_id;
end;
$function$;

revoke all on function public.open_support_case(text, uuid, text) from public, anon;
grant execute on function public.open_support_case(text, uuid, text) to authenticated;

comment on function public.open_support_case(text, uuid, text) is
  'Open a support case for the CALLER (Package 04 Slice D). Owner-bound: no customer id parameter, and an attached order must belong to the caller. Returns the existing live case if one is already open, so a customer cannot split one problem across two queue entries. Payment/refund reasons default to high priority. Mig 151.';


-- ---------------------------------------------------------------------------
-- Staff: claim, resolve.
-- ---------------------------------------------------------------------------
create or replace function public.claim_support_case(p_case_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode='check_violation'; end if;
  if coalesce(public.auth_role()::text,'') not in ('admin','dispatcher') then
    raise exception 'NOT_AUTHORIZED' using errcode='check_violation';
  end if;
  if not exists (select 1 from public.support_cases where id = p_case_id) then
    raise exception 'CASE_NOT_FOUND' using errcode='check_violation';
  end if;

  update public.support_cases
     set assigned_to = v_uid, status = case when status = 'open' then 'waiting_ops' else status end
   where id = p_case_id;

  insert into public.support_case_events (case_id, event, actor_id)
  values (p_case_id, 'assigned', v_uid);
end;
$function$;

revoke all on function public.claim_support_case(uuid) from public, anon;
grant execute on function public.claim_support_case(uuid) to authenticated;

create or replace function public.resolve_support_case(
  p_case_id uuid,
  p_resolution_code text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode='check_violation'; end if;
  if coalesce(public.auth_role()::text,'') not in ('admin','dispatcher') then
    raise exception 'NOT_AUTHORIZED' using errcode='check_violation';
  end if;
  if p_resolution_code is null or p_resolution_code not in
     ('refunded','credited','redelivered','explained','no_action','duplicate','unreachable') then
    raise exception 'INVALID_RESOLUTION' using errcode='check_violation';
  end if;
  if not exists (select 1 from public.support_cases where id = p_case_id) then
    raise exception 'CASE_NOT_FOUND' using errcode='check_violation';
  end if;

  update public.support_cases
     set status = 'resolved', resolved_at = now(),
         resolution_code = p_resolution_code, resolution_note = nullif(btrim(coalesce(p_note,'')), '')
   where id = p_case_id;

  insert into public.support_case_events (case_id, event, actor_id, metadata)
  values (p_case_id, 'resolved', v_uid, jsonb_build_object('resolution_code', p_resolution_code));
end;
$function$;

revoke all on function public.resolve_support_case(uuid, text, text) from public, anon;
grant execute on function public.resolve_support_case(uuid, text, text) to authenticated;

comment on function public.resolve_support_case(uuid, text, text) is
  'Resolve a case with a STRUCTURED code (Package 04 Slice D). Staff-only, fails closed. A free-text-only resolution cannot be reported on, which is why the code is required and the CHECK constraint refuses a resolved case without one. Mig 151.';


-- ---------------------------------------------------------------------------
-- SLA defaults + legacy backfill.
-- ---------------------------------------------------------------------------
insert into public.platform_settings (key, value) values
  ('support_first_response_minutes', to_jsonb(60)),
  ('support_resolution_minutes',     to_jsonb(1440))
on conflict (key) do nothing;

-- Attach historical messages ONLY where the relationship is unambiguous (one
-- customer, one thread). Created already-resolved so it never appears in a live
-- queue as work nobody is doing.
do $$
declare r record; v_case uuid;
begin
  for r in
    select user_id, min(created_at) as first_at, max(created_at) as last_at
      from public.support_messages
     where case_id is null
     group by user_id
  loop
    insert into public.support_cases
      (customer_id, reason_code, status, opened_at, last_message_at,
       resolved_at, resolution_code, resolution_note)
    values
      (r.user_id, 'other', 'resolved', r.first_at, r.last_at,
       r.last_at, 'no_action',
       'Backfilled from pre-mig-151 messages. Historical thread, not a live case.')
    returning id into v_case;

    update public.support_messages set case_id = v_case
     where user_id = r.user_id and case_id is null;

    insert into public.support_case_events (case_id, event, metadata)
    values (v_case, 'opened', jsonb_build_object('backfilled', true));
  end loop;
end $$;
