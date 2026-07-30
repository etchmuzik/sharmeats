-- 193_delivery_job_model.sql
--
-- Package 08 Slice C: the delivery-job model — jobs with hard identity shapes,
-- encrypted endpoint snapshots in the unexposed private schema, an append-only
-- custody event log, and the FULL state-machine transition table (Slice D's
-- assignment states plug into the same authority; only the pre-assignment
-- subset is reachable today). Internal requester kind only; Sharm remains
-- disabled+closed, so nothing here is reachable by anyone without both the
-- delivery_dispatch capability AND an owner-opened stage.
--
-- ================= PII ENCRYPTION =================
-- Contact/address/notes are pgp-encrypted with a key minted into Supabase
-- Vault ('delivery_pii_key_v1') — generated random at migration time, held
-- server-side only, never in a client, row or repo. The encrypt/decrypt
-- helpers FAIL CLOSED if the key is absent: without the key there are no jobs,
-- which is the correct failure. PostGIS points stay plaintext inside private
-- (spec rule: dispatch needs spatial indexes; the points are not exposed).

do $mig$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'delivery_pii_key_v1') then
    perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'delivery_pii_key_v1');
  end if;
end;
$mig$;

create or replace function private.delivery_encrypt(p_plain text)
returns bytea
language plpgsql
security definer set search_path = private, public, pg_temp
as $$
declare v_key text;
begin
  if p_plain is null then return null; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'delivery_pii_key_v1';
  if v_key is null then
    raise exception 'DELIVERY_PII_KEY_MISSING' using errcode = 'check_violation';
  end if;
  return pgp_sym_encrypt(p_plain, v_key);
end;
$$;

create or replace function private.delivery_decrypt(p_cipher bytea)
returns text
language plpgsql
stable
security definer set search_path = private, public, pg_temp
as $$
declare v_key text;
begin
  if p_cipher is null then return null; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'delivery_pii_key_v1';
  if v_key is null then
    raise exception 'DELIVERY_PII_KEY_MISSING' using errcode = 'check_violation';
  end if;
  return pgp_sym_decrypt(p_cipher, v_key);
end;
$$;


-- House rule 3: functions default to PUBLIC execute even in the unexposed
-- private schema — the missing schema-USAGE grant is a barrier, not a policy.
revoke all on function private.delivery_encrypt(text) from public, anon, authenticated;
revoke all on function private.delivery_decrypt(bytea) from public, anon, authenticated;

-- ================= JOBS =================
create table if not exists public.delivery_jobs (
  id uuid primary key default gen_random_uuid(),
  public_reference text not null unique,
  requester_kind text not null check (requester_kind in ('internal','customer','merchant')),
  requester_user_id uuid references public.users(id) on delete restrict,
  requester_restaurant_id uuid references public.restaurants(id) on delete restrict,
  created_by_user_id uuid not null,
  internal_reason text,
  merchant_reference text check (length(merchant_reference) <= 64),
  requester_scope_key text not null,
  quote_id uuid not null unique,
  idempotency_key text not null check (length(idempotency_key) between 8 and 80),

  parcel_category text not null,
  parcel_band_code text not null,
  package_count int not null check (package_count = 1),   -- v1 contract
  declared_value_egp int not null check (declared_value_egp >= 0),
  fragile boolean not null default false,
  prohibited_goods_version text not null,
  terms_version text not null,

  service_area_id uuid not null references public.service_areas(id) on delete restrict,
  status text not null default 'requested' check (status in
    ('payment_pending','requested','offered','accepted','arrived_pickup',
     'pickup_verified','picked_up','out_for_delivery','delivered',
     'pickup_failed','delivery_failed','returning','returned',
     'delivery_recovery_required','return_recovery_required','custody_exception',
     'handed_to_ops','lost','damaged','disposed','cancelled','completed')),
  version int not null default 1,
  assigned_driver_id uuid references public.drivers(id) on delete restrict,

  quoted_fee_egp int not null check (quoted_fee_egp >= 0),
  quoted_driver_earning_egp int not null check (quoted_driver_earning_egp >= 0),
  pricing_version_id uuid not null,
  payment_method text not null check (payment_method in ('internal','merchant_invoice','merchant_prepaid','card')),
  zero_fee_reason text,

  requested_at timestamptz,
  accepted_at timestamptz,
  arrived_pickup_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  return_started_at timestamptz,
  returned_at timestamptz,
  cancelled_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (requester_scope_key, idempotency_key),
  -- Identity shapes (spec): internal has neither subject and needs a reason;
  -- merchant has both user+restaurant; customer has user only.
  constraint delivery_jobs_identity_shape check (
    (requester_kind = 'internal' and requester_user_id is null
       and requester_restaurant_id is null and internal_reason is not null)
    or (requester_kind = 'merchant' and requester_user_id is not null
       and requester_restaurant_id is not null)
    or (requester_kind = 'customer' and requester_user_id is not null
       and requester_restaurant_id is null)
  ),
  constraint delivery_jobs_internal_zero_fee check (
    requester_kind <> 'internal' or (payment_method = 'internal' and zero_fee_reason is not null)
  )
);

create unique index if not exists delivery_jobs_merchant_reference_uniq
  on public.delivery_jobs (requester_restaurant_id, lower(merchant_reference))
  where requester_kind = 'merchant' and merchant_reference is not null;
create index if not exists delivery_jobs_status_idx on public.delivery_jobs (status)
  where status not in ('completed','cancelled');

alter table public.delivery_jobs enable row level security;
revoke all on table public.delivery_jobs from public, anon, authenticated;
grant select on table public.delivery_jobs to authenticated;
grant select, insert, update on table public.delivery_jobs to service_role;
-- Read scope: the requester, the assigned driver, and delivery operators.
create policy delivery_jobs_participant_read on public.delivery_jobs
  for select using (
    requester_user_id = auth.uid()
    or created_by_user_id = auth.uid()
    or exists (select 1 from public.drivers d
                where d.id = delivery_jobs.assigned_driver_id and d.profile_id = auth.uid())
    or public.i_have_platform_capability('delivery_dispatch')
    or public.i_have_platform_capability('delivery_support')
  );

comment on table public.delivery_jobs is
  'Parcel jobs (Package 08 Slice C). NOT restaurant orders: separate lifecycle, finance and custody trail. Identity CHECK shapes per requester kind; v1 reachable kind is internal only. Status moves only through delivery_job_transition (the transitions table is the machine); version is optimistic concurrency. Mig 193.';

-- ================= PRIVATE SNAPSHOTS =================
create table if not exists private.delivery_job_endpoints (
  id uuid primary key default gen_random_uuid(),
  delivery_job_id uuid not null references public.delivery_jobs(id) on delete restrict,
  contact_kind text not null check (contact_kind in ('pickup','dropoff')),
  point geography(point, 4326) not null,
  address_ciphertext bytea,
  contact_name_ciphertext bytea,
  phone_e164_ciphertext bytea,
  phone_last4 text check (phone_last4 ~ '^[0-9]{2,4}$'),
  notes_ciphertext bytea,
  encryption_key_version int not null default 1,
  retention_until timestamptz,
  redacted_at timestamptz,
  unique (delivery_job_id, contact_kind)
);

create table if not exists private.delivery_job_parcel_details (
  delivery_job_id uuid primary key references public.delivery_jobs(id) on delete restrict,
  description_ciphertext bytea,
  encryption_key_version int not null default 1,
  retention_until timestamptz,
  redacted_at timestamptz
);

-- ================= CUSTODY EVENTS =================
create table if not exists public.delivery_job_events (
  id uuid primary key default gen_random_uuid(),
  delivery_job_id uuid not null references public.delivery_jobs(id) on delete restrict,
  event_type text not null check (event_type ~ '^[a-z_]{2,40}$'),
  from_status text,
  to_status text,
  actor_kind text not null check (actor_kind in
    ('requester','driver','dispatcher','support','system','finance')),
  actor_user_id uuid,
  reason_code text check (length(reason_code) <= 60),
  metadata jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  occurred_at timestamptz not null default clock_timestamp(),
  unique (delivery_job_id, idempotency_key)
);

alter table public.delivery_job_events enable row level security;
revoke all on table public.delivery_job_events from public, anon, authenticated;
grant select on table public.delivery_job_events to authenticated;
grant select, insert on table public.delivery_job_events to service_role;
create policy delivery_job_events_participant_read on public.delivery_job_events
  for select using (
    exists (select 1 from public.delivery_jobs j
             where j.id = delivery_job_events.delivery_job_id
               and (j.requester_user_id = auth.uid() or j.created_by_user_id = auth.uid()
                    or exists (select 1 from public.drivers d
                                where d.id = j.assigned_driver_id and d.profile_id = auth.uid())))
    or public.i_have_platform_capability('delivery_dispatch')
    or public.i_have_platform_capability('delivery_support')
  );

create or replace function public.delivery_job_events_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'DELIVERY_EVENTS_IMMUTABLE' using errcode = 'check_violation';
end; $$;
revoke all on function public.delivery_job_events_immutable() from public, anon, authenticated;
drop trigger if exists delivery_job_events_immutable on public.delivery_job_events;
create trigger delivery_job_events_immutable
  before update or delete on public.delivery_job_events
  for each row execute function public.delivery_job_events_immutable();

-- ================= THE STATE MACHINE, AS DATA =================
create table if not exists private.delivery_job_transitions (
  from_status text not null,
  to_status text not null,
  allowed_actor_kinds text[] not null,
  primary key (from_status, to_status)
);

-- Full machine from the spec, including branches only reachable once Slice D
-- (assignments) and Slice G (finance) land. Encoding it now means those slices
-- add CALLERS, not new authority.
insert into private.delivery_job_transitions (from_status, to_status, allowed_actor_kinds) values
  ('payment_pending','requested',                array['system']),
  ('payment_pending','cancelled',                array['requester','support','system']),
  ('requested','offered',                        array['dispatcher','system']),
  ('offered','requested',                        array['driver','dispatcher','system']),
  ('offered','accepted',                         array['driver']),
  ('requested','cancelled',                      array['requester','support','dispatcher']),
  ('offered','cancelled',                        array['requester','support','dispatcher']),
  ('accepted','cancelled',                       array['requester','support','dispatcher']),
  ('accepted','arrived_pickup',                  array['driver']),
  ('arrived_pickup','pickup_verified',           array['driver','system']),
  ('pickup_verified','picked_up',                array['driver']),
  ('accepted','pickup_failed',                   array['driver','dispatcher','support']),
  ('arrived_pickup','pickup_failed',             array['driver','dispatcher','support']),
  ('pickup_verified','pickup_failed',            array['driver','dispatcher','support']),
  ('pickup_failed','requested',                  array['dispatcher','support']),
  ('pickup_failed','cancelled',                  array['requester','support','dispatcher']),
  ('picked_up','out_for_delivery',               array['driver']),
  ('out_for_delivery','delivered',               array['driver','system']),
  ('picked_up','delivery_failed',                array['driver','dispatcher','support']),
  ('out_for_delivery','delivery_failed',         array['driver','dispatcher','support']),
  ('delivery_failed','returning',                array['driver','dispatcher','support']),
  ('returning','returned',                       array['driver','system']),
  ('picked_up','delivery_recovery_required',     array['dispatcher','support']),
  ('out_for_delivery','delivery_recovery_required', array['dispatcher','support']),
  ('delivery_recovery_required','out_for_delivery', array['system']),
  ('delivery_recovery_required','custody_exception', array['support']),
  ('returning','return_recovery_required',       array['dispatcher','support']),
  ('return_recovery_required','returning',       array['system']),
  ('return_recovery_required','custody_exception', array['support']),
  ('returning','custody_exception',              array['support']),
  ('custody_exception','handed_to_ops',          array['support']),
  ('custody_exception','lost',                   array['support']),
  ('custody_exception','damaged',                array['support']),
  ('custody_exception','disposed',               array['support']),
  ('delivered','completed',                      array['finance','system']),
  ('returned','completed',                       array['finance','system']),
  ('cancelled','completed',                      array['finance','system']),
  ('handed_to_ops','completed',                  array['finance','system']),
  ('lost','completed',                           array['finance','system']),
  ('damaged','completed',                        array['finance','system']),
  ('disposed','completed',                       array['finance','system'])
on conflict do nothing;

-- The ONE writer of delivery_jobs.status. Internal (no client grant): callers
-- are the slice RPCs, which self-authorize the ACTOR before invoking.
create or replace function private.delivery_job_transition(
  p_job_id uuid,
  p_expected_status text,
  p_expected_version int,
  p_to_status text,
  p_actor_kind text,
  p_actor_user_id uuid,
  p_reason_code text,
  p_idempotency_key text
)
returns void
language plpgsql
security definer set search_path = private, public, pg_temp
as $$
declare v_job public.delivery_jobs;
begin
  select * into v_job from public.delivery_jobs where id = p_job_id for update;
  if v_job.id is null then
    raise exception 'JOB_NOT_FOUND' using errcode = 'check_violation';
  end if;

  -- Idempotent replay: same event key already recorded -> quietly done.
  if exists (select 1 from public.delivery_job_events
              where delivery_job_id = p_job_id and idempotency_key = p_idempotency_key) then
    return;
  end if;

  if v_job.status is distinct from p_expected_status
     or v_job.version is distinct from p_expected_version then
    raise exception 'STALE_JOB_STATE: at %/v% (expected %/v%)',
      v_job.status, v_job.version, p_expected_status, p_expected_version
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from private.delivery_job_transitions t
                  where t.from_status = v_job.status and t.to_status = p_to_status
                    and p_actor_kind = any (t.allowed_actor_kinds)) then
    raise exception 'TRANSITION_NOT_ALLOWED: % -> % as %',
      v_job.status, p_to_status, p_actor_kind using errcode = 'check_violation';
  end if;

  update public.delivery_jobs
     set status = p_to_status,
         version = version + 1,
         updated_at = now(),
         requested_at      = case when p_to_status = 'requested'       then coalesce(requested_at, now())  else requested_at end,
         accepted_at       = case when p_to_status = 'accepted'        then now() else accepted_at end,
         arrived_pickup_at = case when p_to_status = 'arrived_pickup'  then now() else arrived_pickup_at end,
         picked_up_at      = case when p_to_status = 'picked_up'       then now() else picked_up_at end,
         delivered_at      = case when p_to_status = 'delivered'       then now() else delivered_at end,
         return_started_at = case when p_to_status = 'returning'       then coalesce(return_started_at, now()) else return_started_at end,
         returned_at       = case when p_to_status = 'returned'        then now() else returned_at end,
         cancelled_at      = case when p_to_status = 'cancelled'       then now() else cancelled_at end,
         completed_at      = case when p_to_status = 'completed'       then now() else completed_at end
   where id = p_job_id;

  insert into public.delivery_job_events
    (delivery_job_id, event_type, from_status, to_status, actor_kind,
     actor_user_id, reason_code, idempotency_key)
  values
    (p_job_id, 'status_change', v_job.status, p_to_status, p_actor_kind,
     p_actor_user_id, p_reason_code, p_idempotency_key);
end;
$$;


revoke all on function private.delivery_job_transition(uuid, text, int, text, text, uuid, text, text)
  from public, anon, authenticated;

-- ================= RPCs =================
create or replace function public.create_delivery_job(
  p_quote_id uuid,
  p_internal_reason text,
  p_pickup_contact_name text,
  p_pickup_phone text,
  p_pickup_address text,
  p_dropoff_contact_name text,
  p_dropoff_phone text,
  p_dropoff_address text,
  p_parcel_description text,
  p_idempotency_key text
)
returns table (job_id uuid, public_reference text, status text)
language plpgsql
security definer set search_path = public, private, pg_temp
as $$
declare
  v_quote private.delivery_quotes;
  v_cfg public.delivery_service_configs;
  v_job uuid; v_ref text;
begin
  -- v1: internal kind only, capability-gated (merchant/customer kinds arrive
  -- with their slices and their own eligibility predicates).
  if auth.uid() is null or not public.i_have_platform_capability('delivery_dispatch') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  if p_internal_reason is null or length(btrim(p_internal_reason)) < 3 then
    raise exception 'INTERNAL_REASON_REQUIRED' using errcode = 'check_violation';
  end if;
  if p_dropoff_contact_name is null or p_dropoff_phone is null or p_dropoff_address is null then
    raise exception 'DROPOFF_CONTACT_REQUIRED' using errcode = 'check_violation';
  end if;

  -- Idempotent replay of the whole call.
  select j.id, j.public_reference, j.status into v_job, v_ref, status
    from public.delivery_jobs j
   where j.requester_scope_key = auth.uid()::text and j.idempotency_key = p_idempotency_key;
  if v_job is not null then
    return query select v_job, v_ref, status; return;
  end if;

  select * into v_quote from private.delivery_quotes where id = p_quote_id for update;
  if v_quote.id is null or v_quote.created_by_user_id <> auth.uid() then
    raise exception 'QUOTE_NOT_FOUND' using errcode = 'check_violation';
  end if;
  if v_quote.consumed_at is not null then
    raise exception 'QUOTE_ALREADY_CONSUMED' using errcode = 'check_violation';
  end if;
  if v_quote.expires_at <= now() then
    raise exception 'QUOTE_EXPIRED' using errcode = 'check_violation';
  end if;

  -- Stage/intake re-check inside the transaction (a quote is not a promise).
  select * into v_cfg from public.delivery_service_configs
   where service_area_id = v_quote.service_area_id;
  if v_cfg.launch_stage = 'disabled' or v_cfg.intake_state <> 'open' then
    raise exception 'DELIVERY_NOT_AVAILABLE' using errcode = 'check_violation';
  end if;

  update private.delivery_quotes set consumed_at = now() where id = p_quote_id;

  v_ref := 'DJ-' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
  insert into public.delivery_jobs
    (public_reference, requester_kind, created_by_user_id, internal_reason,
     requester_scope_key, quote_id, idempotency_key,
     parcel_category, parcel_band_code, package_count, declared_value_egp, fragile,
     prohibited_goods_version, terms_version, service_area_id,
     quoted_fee_egp, quoted_driver_earning_egp, pricing_version_id,
     payment_method, zero_fee_reason, requested_at)
  values
    (v_ref, 'internal', auth.uid(), btrim(p_internal_reason),
     auth.uid()::text, p_quote_id, p_idempotency_key,
     v_quote.parcel_category, v_quote.parcel_band_code, 1, v_quote.declared_value_egp, v_quote.fragile,
     v_quote.prohibited_goods_version, v_quote.terms_version, v_quote.service_area_id,
     v_quote.price_egp, v_quote.driver_earning_egp, v_quote.pricing_version_id,
     'internal', 'internal pilot job (Package 08 E2): ' || btrim(p_internal_reason), now())
  returning id into v_job;

  insert into private.delivery_job_endpoints
    (delivery_job_id, contact_kind, point, address_ciphertext, contact_name_ciphertext,
     phone_e164_ciphertext, phone_last4, notes_ciphertext)
  values
    (v_job, 'pickup', v_quote.pickup_point,
     private.delivery_encrypt(p_pickup_address), private.delivery_encrypt(p_pickup_contact_name),
     private.delivery_encrypt(p_pickup_phone), right(regexp_replace(coalesce(p_pickup_phone,''), '\D', '', 'g'), 4), null),
    (v_job, 'dropoff', v_quote.dropoff_point,
     private.delivery_encrypt(p_dropoff_address), private.delivery_encrypt(p_dropoff_contact_name),
     private.delivery_encrypt(p_dropoff_phone), right(regexp_replace(coalesce(p_dropoff_phone,''), '\D', '', 'g'), 4), null);

  if p_parcel_description is not null and length(btrim(p_parcel_description)) > 0 then
    insert into private.delivery_job_parcel_details (delivery_job_id, description_ciphertext)
    values (v_job, private.delivery_encrypt(left(btrim(p_parcel_description), 500)));
  end if;

  insert into public.delivery_job_events
    (delivery_job_id, event_type, to_status, actor_kind, actor_user_id, idempotency_key)
  values (v_job, 'created', 'requested', 'dispatcher', auth.uid(), 'create:' || p_idempotency_key);

  return query select v_job, v_ref, 'requested'::text;
end;
$$;
revoke all on function public.create_delivery_job(uuid, text, text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_delivery_job(uuid, text, text, text, text, text, text, text, text, text)
  to authenticated;

comment on function public.create_delivery_job(uuid, text, text, text, text, text, text, text, text, text) is
  'Package 08 Slice C (v1 internal kind, delivery_dispatch only): atomically consumes an unexpired unconsumed quote OWNED BY THE CALLER, re-checks stage/intake inside the transaction, snapshots parcel/pricing facts from the quote (never from the caller), writes vault-encrypted endpoint contacts, and creates the job as requested with its created event. Idempotent per (caller, key). Fails closed without the vault PII key. Mig 193.';

create or replace function public.cancel_delivery_job(
  p_job_id uuid,
  p_expected_version int,
  p_reason text,
  p_idempotency_key text
)
returns void
language plpgsql
security definer set search_path = public, private, pg_temp
as $$
declare v_job public.delivery_jobs; v_actor text;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'REASON_REQUIRED' using errcode = 'check_violation';
  end if;
  select * into v_job from public.delivery_jobs where id = p_job_id;
  if v_job.id is null then
    raise exception 'JOB_NOT_FOUND' using errcode = 'check_violation';
  end if;
  -- Requester may cancel their own; dispatch/support may cancel any —
  -- the transition table itself refuses cancellation once custody exists
  -- (picked_up+ has no -> cancelled edge), so "a parcel in custody cannot
  -- become simply cancelled" is structural, not procedural.
  if v_job.created_by_user_id = auth.uid() or v_job.requester_user_id = auth.uid() then
    v_actor := 'requester';
  elsif public.i_have_platform_capability('delivery_dispatch') then
    v_actor := 'dispatcher';
  elsif public.i_have_platform_capability('delivery_support') then
    v_actor := 'support';
  else
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;

  perform private.delivery_job_transition(
    p_job_id, v_job.status, p_expected_version, 'cancelled',
    v_actor, auth.uid(), left(btrim(p_reason), 60), p_idempotency_key);
end;
$$;
revoke all on function public.cancel_delivery_job(uuid, int, text, text)
  from public, anon, authenticated;
grant execute on function public.cancel_delivery_job(uuid, int, text, text)
  to authenticated;

comment on function public.cancel_delivery_job(uuid, int, text, text) is
  'Requester (own job) or delivery_dispatch/support. The transitions table is the custody guard: no cancelled edge exists from picked_up onward, so in-custody parcels structurally cannot be cancelled — they take the return path. Optimistic version check; idempotent per event key. Mig 193.';
