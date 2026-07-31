\set ON_ERROR_STOP on

-- 202_audit_round_2_security.test.sql
--
-- Category 1 (see supabase/tests/README.md): self-contained, loads its own
-- migration with a real `\ir`, runs against the empty PostgreSQL instance
-- scripts/test-security-migrations.sh spins up, and is listed in that script's
-- test_files array.
--
-- The structure is BEFORE / apply / AFTER. Every stub below is the PRE-202
-- state copied from the migration that created it (104, 075, 078, 074, 193,
-- 191, 192, 188, 136), so each assertion proves the defect exists first and is
-- gone second. A test that only checked the AFTER state would still pass if the
-- migration were empty.
--
-- What this canNOT prove: that the stubs match production. They are written
-- from the same migration sources 202 was written from, so this file certifies
-- internal consistency and behaviour, not that prod's pg_proc looks like this.
-- The prod check is the transaction-wrapped dry run plus the security advisors.

-- Transaction-wrapped so nothing persists (migration house rule 6).
begin;

-- ---------------------------------------------------------------------------
-- Supabase surface stubs.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end;
$$;

-- pgcrypto lives in `extensions` on this project (proved on the live database
-- in mig 197's header). Reproducing THAT placement rather than the local
-- default is the entire point of this half of the test: a fresh replay of migs
-- 001/002 puts pgcrypto in public, where 193's bare pgp_sym_encrypt resolves
-- fine — which is exactly why the harness never caught the bug.
create schema extensions;
create extension pgcrypto with schema extensions;

create schema auth;
create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;

-- Vault stub: delivery_encrypt reads the PII key from vault.decrypted_secrets.
create schema vault;
create table vault.decrypted_secrets (
  name             text primary key,
  decrypted_secret text not null
);
insert into vault.decrypted_secrets (name, decrypted_secret)
values ('delivery_pii_key_v1', 'a-test-only-key-never-used-anywhere');

create schema private;

create type app_role as enum ('customer','driver','merchant_staff','dispatcher','admin');
create type kyc_subject_type as enum ('driver','restaurant');
create type kyc_doc_status as enum ('pending','approved','rejected');

create table public.users (
  id   uuid primary key,
  role app_role not null default 'customer'
);

create table public.platform_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.drivers (
  id         uuid primary key,
  name       text not null,
  profile_id uuid references public.users(id)
);

create table public.driver_cash_ledger (
  id           uuid primary key default gen_random_uuid(),
  driver_id    uuid not null references public.drivers(id) on delete cascade,
  delta_egp    int  not null,
  reason       text not null check (reason in ('cod_collected','hand_in','adjustment','write_off')),
  ref_order_id uuid,
  note         text,
  actor_id     uuid,
  created_at   timestamptz not null default now()
);

create table public.kyc_documents (
  id           uuid primary key default gen_random_uuid(),
  subject_type kyc_subject_type not null,
  subject_id   uuid not null,
  doc_type     text not null,
  storage_path text not null,
  status       kyc_doc_status not null default 'pending',
  review_note  text,
  reviewed_by  uuid references public.users(id),
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now()
);

create table public.push_campaigns (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  body          text not null,
  segment       text not null,
  segment_param text,
  recipients    int not null default 0,
  sent_by       uuid references public.users(id),
  created_at    timestamptz not null default now()
);

create table public.restaurant_settlements (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  period_start  date not null
);

-- mig 007
create function public.auth_role()
returns app_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.users where id = auth.uid();
$$;

create function public.is_merchant_staff(p_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select false;
$$;

-- ---------------------------------------------------------------------------
-- PRE-202 definitions, copied from the migrations that created them.
-- ---------------------------------------------------------------------------

-- mig 104:76-120 — note the NULL-unsafe `not in` and the absent ceiling.
create function public.record_cash_handin(
  p_driver_id uuid,
  p_amount_egp int,
  p_reason text default 'hand_in',
  p_note text default null
)
returns int
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_actor uuid := auth.uid();
  v_balance int;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;
  if (select public.auth_role()) not in ('admin','dispatcher') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  if p_reason not in ('hand_in','adjustment','write_off') then
    raise exception 'INVALID_REASON' using errcode = 'check_violation';
  end if;
  if p_amount_egp is null or p_amount_egp = 0 then
    raise exception 'INVALID_AMOUNT' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.drivers where id = p_driver_id) then
    raise exception 'DRIVER_NOT_FOUND' using errcode = 'check_violation';
  end if;
  insert into public.driver_cash_ledger (driver_id, delta_egp, reason, note, actor_id)
  values (
    p_driver_id,
    case when p_reason = 'adjustment' then p_amount_egp else -abs(p_amount_egp) end,
    p_reason, nullif(btrim(coalesce(p_note,'')), ''), v_actor
  );
  select coalesce(sum(delta_egp),0)::int into v_balance
    from public.driver_cash_ledger where driver_id = p_driver_id;
  return v_balance;
end;
$function$;
revoke all on function public.record_cash_handin(uuid, int, text, text) from public, anon;
grant execute on function public.record_cash_handin(uuid, int, text, text) to authenticated;

-- mig 075:123-138 — granted to authenticated, never revoked from PUBLIC.
create function public.my_kyc_documents(p_subject_type kyc_subject_type, p_subject_id uuid)
returns setof public.kyc_documents
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select k.* from public.kyc_documents k
   where k.subject_type = p_subject_type and k.subject_id = p_subject_id
     and (
       (p_subject_type = 'driver' and exists (select 1 from public.drivers d where d.id = p_subject_id and d.profile_id = auth.uid()))
       or (p_subject_type = 'restaurant' and public.is_merchant_staff(p_subject_id))
       or public.auth_role() = 'admin'
     )
   order by k.created_at desc;
$$;
grant execute on function public.my_kyc_documents(kyc_subject_type, uuid) to authenticated;

-- mig 078:141-152 — same omission.
create function public.recent_push_campaigns(p_limit int default 20)
returns setof public.push_campaigns
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select * from public.push_campaigns
   where public.auth_role() = 'admin'
   order by created_at desc
   limit greatest(1, least(coalesce(p_limit,20), 100));
$$;
grant execute on function public.recent_push_campaigns(int) to authenticated;

-- mig 074:169-180 — same omission.
create function public.my_restaurant_settlements(p_limit int default 12)
returns setof public.restaurant_settlements
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select s.* from public.restaurant_settlements s
   where public.is_merchant_staff(s.restaurant_id)
   order by s.period_start desc
   limit greatest(1, least(coalesce(p_limit,12), 100));
$$;
grant execute on function public.my_restaurant_settlements(int) to authenticated;

-- mig 193:27-57 — the search_path that cannot see pgcrypto.
create function private.delivery_encrypt(p_plain text)
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

create function private.delivery_decrypt(p_cipher bytea)
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
revoke all on function private.delivery_encrypt(text) from public, anon, authenticated;
revoke all on function private.delivery_decrypt(bytea) from public, anon, authenticated;

-- The five private tables from migs 191-193, created WITHOUT the house-rule-5b
-- revoke. The explicit `grant all` stands in for this database's
-- ALTER DEFAULT PRIVILEGES, which hands arwdDxtm to anon/authenticated on every
-- new table and is what 5b exists to undo — the harness has no such default, so
-- without this the "before" state would be indistinguishable from the "after".
create table private.delivery_access_events      (id uuid primary key default gen_random_uuid(), subject_kind text not null);
create table private.delivery_quotes             (id uuid primary key default gen_random_uuid(), total_egp int not null default 0);
create table private.delivery_job_endpoints      (delivery_job_id uuid primary key, pickup_address_enc bytea);
create table private.delivery_job_parcel_details (delivery_job_id uuid primary key, description_enc bytea);
create table private.delivery_job_transitions    (from_status text not null, to_status text not null, primary key (from_status, to_status));
grant all on table private.delivery_access_events,
              private.delivery_quotes,
              private.delivery_job_endpoints,
              private.delivery_job_parcel_details,
              private.delivery_job_transitions
  to anon, authenticated;

-- The five SECURITY INVOKER functions with no search_path pin.
create function public.availability_events_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'AVAILABILITY_AUDIT_IMMUTABLE' using errcode = 'check_violation';
end;
$$;

create function public.delivery_job_events_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'DELIVERY_EVENTS_IMMUTABLE' using errcode = 'check_violation';
end; $$;

create function private.delivery_access_events_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'DELIVERY_ACCESS_EVENTS_IMMUTABLE' using errcode = 'check_violation';
end; $$;

create function public.menu_items_staff_writable_columns()
returns text[]
language sql
immutable
as $$
  select array['is_available', 'sort_order']::text[];
$$;

-- Only the ARGUMENT types matter for the ALTER in 202; the projection is
-- reproduced so a future signature change here trips this file.
create function public.search_catalog(
  p_query text,
  p_vertical text default null,
  p_restaurant_id uuid default null,
  p_limit int default 30,
  p_after_name text default null,
  p_after_id uuid default null
)
returns table (
  item_id       uuid,
  restaurant_id uuid,
  name          text,
  price_egp     int,
  is_available  boolean,
  sku           text,
  unit          text,
  vertical_id   text
)
language sql
stable
as $$
  select null::uuid, null::uuid, null::text, null::int, null::boolean,
         null::text, null::text, null::text
   where false;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures.
-- ---------------------------------------------------------------------------
insert into public.users (id, role) values
  ('80000000-0000-0000-0000-000000000001', 'admin'),
  ('80000000-0000-0000-0000-000000000002', 'dispatcher');
-- '80000000-0000-0000-0000-0000000000ff' is deliberately NOT inserted: it is
-- an authenticated uid with no public.users row, so auth_role() returns NULL.

insert into public.drivers (id, name, profile_id) values
  ('81000000-0000-0000-0000-000000000001', 'Mahmoud El Sayed', null);

-- ===========================================================================
-- BEFORE: prove each defect is real.
-- ===========================================================================
do $$
declare
  v_balance int;
  v_cipher bytea;
begin
  -- 1. The NULL-role hole. `NULL not in ('admin','dispatcher')` is NULL, which
  --    plpgsql reads as false, so the guard never fires and a caller with no
  --    role row records a cash movement.
  perform set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-0000000000ff', true);
  v_balance := public.record_cash_handin('81000000-0000-0000-0000-000000000001', 100, 'hand_in');
  if v_balance is distinct from -100 then
    raise exception 'fixture wrong: expected the pre-202 NULL-role call to succeed at -100, got %',
      coalesce(v_balance::text, 'null');
  end if;
  delete from public.driver_cash_ledger;

  -- 1b. No ceiling: an admin can erase an arbitrary amount in one call.
  perform set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-000000000001', true);
  v_balance := public.record_cash_handin('81000000-0000-0000-0000-000000000001', 999999, 'write_off');
  if v_balance is distinct from -999999 then
    raise exception 'fixture wrong: expected an uncapped pre-202 write-off, got %',
      coalesce(v_balance::text, 'null');
  end if;
  delete from public.driver_cash_ledger;
  perform set_config('request.jwt.claim.sub', '', true);

  -- 2+3. anon holds EXECUTE on all three definer functions.
  if not has_function_privilege('anon', 'public.recent_push_campaigns(int)', 'execute') then
    raise exception 'fixture wrong: anon should hold EXECUTE on recent_push_campaigns before 202';
  end if;
  if not has_function_privilege('anon', 'public.my_kyc_documents(kyc_subject_type, uuid)', 'execute') then
    raise exception 'fixture wrong: anon should hold EXECUTE on my_kyc_documents before 202';
  end if;
  if not has_function_privilege('anon', 'public.my_restaurant_settlements(int)', 'execute') then
    raise exception 'fixture wrong: anon should hold EXECUTE on my_restaurant_settlements before 202';
  end if;

  -- 4. The encrypt path is dead: pgcrypto is in `extensions`, which the pinned
  --    search_path excludes, so this is 42883 and not a key problem.
  begin
    v_cipher := private.delivery_encrypt('Villa 12, Om El Sid');
    raise exception 'fixture wrong: delivery_encrypt should fail before 202 (got % bytes)',
      coalesce(length(v_cipher)::text, 'null');
  exception when undefined_function then null;
  end;

  -- 5. The five private tables carry client ACLs.
  if not has_table_privilege('anon', 'private.delivery_job_endpoints', 'SELECT') then
    raise exception 'fixture wrong: anon should hold SELECT on delivery_job_endpoints before 202';
  end if;
  if not has_table_privilege('authenticated', 'private.delivery_job_transitions', 'TRUNCATE') then
    raise exception 'fixture wrong: authenticated should hold TRUNCATE on delivery_job_transitions before 202';
  end if;

  -- 6. No search_path pinned on any of the five.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname, p.proname) in (
             ('public','availability_events_immutable'),
             ('public','delivery_job_events_immutable'),
             ('private','delivery_access_events_immutable'),
             ('public','menu_items_staff_writable_columns'),
             ('public','search_catalog'))
       and p.proconfig is not null
  ) then
    raise exception 'fixture wrong: none of the five should have a proconfig before 202';
  end if;
end;
$$;

-- ===========================================================================
-- Apply the migration under test.
-- ===========================================================================
\ir ../migrations/202_audit_round_2_security.sql

-- ===========================================================================
-- AFTER: 1. record_cash_handin fails closed and is capped.
-- ===========================================================================
do $$
declare
  v_balance int;
begin
  -- The whole point: a caller with no public.users row is now refused.
  perform set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-0000000000ff', true);
  begin
    v_balance := public.record_cash_handin('81000000-0000-0000-0000-000000000001', 100, 'hand_in');
    raise exception 'a NULL-role caller must not be able to record a cash movement (got %)',
      coalesce(v_balance::text, 'null');
  exception when check_violation then null;
  end;
  if exists (select 1 from public.driver_cash_ledger) then
    raise exception 'the refused NULL-role call still wrote a ledger row';
  end if;

  -- A customer is still refused (this always worked; assert it did not regress).
  perform set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-000000000001', true);
  update public.users set role = 'customer' where id = '80000000-0000-0000-0000-000000000001';
  begin
    perform public.record_cash_handin('81000000-0000-0000-0000-000000000001', 100, 'hand_in');
    raise exception 'a customer must not be able to record a cash movement';
  exception when check_violation then null;
  end;
  update public.users set role = 'admin' where id = '80000000-0000-0000-0000-000000000001';

  -- Admin, within the ceiling: unchanged behaviour, returns the new balance.
  v_balance := public.record_cash_handin('81000000-0000-0000-0000-000000000001', 500, 'hand_in');
  if v_balance is distinct from -500 then
    raise exception 'expected a -500 balance after a 500 hand-in, got %',
      coalesce(v_balance::text, 'null');
  end if;

  -- Dispatcher, within the ceiling: still allowed (the fix must not lock ops out).
  perform set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-000000000002', true);
  v_balance := public.record_cash_handin('81000000-0000-0000-0000-000000000001', 100, 'hand_in');
  if v_balance is distinct from -600 then
    raise exception 'a dispatcher hand-in should still work, balance was %',
      coalesce(v_balance::text, 'null');
  end if;
  delete from public.driver_cash_ledger;

  -- Ceiling, hand_in: 20000 passes, 20001 does not.
  perform set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-000000000001', true);
  perform public.record_cash_handin('81000000-0000-0000-0000-000000000001', 20000, 'hand_in');
  delete from public.driver_cash_ledger;
  begin
    perform public.record_cash_handin('81000000-0000-0000-0000-000000000001', 20001, 'hand_in');
    raise exception 'a hand-in above cash_handin_max_egp must be refused';
  exception when check_violation then null;
  end;

  -- Ceiling, write_off / adjustment: the tighter 2000 applies...
  begin
    perform public.record_cash_handin('81000000-0000-0000-0000-000000000001', 2001, 'write_off');
    raise exception 'a write-off above cash_adjustment_max_egp must be refused';
  exception when check_violation then null;
  end;
  -- ...in BOTH directions, because a negative adjustment is how custody is
  -- destroyed quietly.
  begin
    perform public.record_cash_handin('81000000-0000-0000-0000-000000000001', -2001, 'adjustment');
    raise exception 'a negative adjustment below -cash_adjustment_max_egp must be refused';
  exception when check_violation then null;
  end;
  perform public.record_cash_handin('81000000-0000-0000-0000-000000000001', -2000, 'adjustment');
  delete from public.driver_cash_ledger;

  -- The ceiling must not depend on the settings row existing: deleting it falls
  -- back to the in-function default rather than to NULL (which would compare
  -- as unknown and let everything through — the same fail-open shape again).
  delete from public.platform_settings where key = 'cash_handin_max_egp';
  begin
    perform public.record_cash_handin('81000000-0000-0000-0000-000000000001', 999999, 'hand_in');
    raise exception 'a missing cash_handin_max_egp row must fall back to the default ceiling, not to no ceiling';
  exception when check_violation then null;
  end;
  insert into public.platform_settings (key, value) values ('cash_handin_max_egp', to_jsonb(20000));

  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;

-- The settings the ceiling reads exist, with the documented defaults.
do $$
begin
  if (select (value #>> '{}')::int from public.platform_settings where key = 'cash_handin_max_egp') <> 20000 then
    raise exception 'cash_handin_max_egp should default to 20000';
  end if;
  if (select (value #>> '{}')::int from public.platform_settings where key = 'cash_adjustment_max_egp') <> 2000 then
    raise exception 'cash_adjustment_max_egp should default to 2000';
  end if;
end;
$$;

-- ===========================================================================
-- AFTER: 2+3. The definer functions are off PUBLIC/anon and still on
--             authenticated.
-- ===========================================================================
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.record_cash_handin(uuid, int, text, text)',
    'public.my_kyc_documents(kyc_subject_type, uuid)',
    'public.recent_push_campaigns(int)',
    'public.my_restaurant_settlements(int)'
  ] loop
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception 'anon still holds EXECUTE on %', v_fn;
    end if;
    if not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception 'authenticated lost EXECUTE on % — the app calls it', v_fn;
    end if;
  end loop;
end;
$$;

-- The PUBLIC pseudo-role does not appear in has_function_privilege, so check
-- the ACL directly: grantee 0 is PUBLIC. This is the grant that house rule 3
-- exists for, and the one `grant ... to authenticated` does not remove.
--
-- A NULL proacl is the trap here: for FUNCTIONS (unlike tables) a null ACL
-- means the built-in default, which is EXECUTE to PUBLIC. So "no explicit
-- PUBLIC entry" is not the same as "PUBLIC cannot execute" — only a REVOKE
-- materialises the ACL. Both conditions are checked.
do $$
declare
  v_leaky text;
begin
  select string_agg(format('%s.%s', n.nspname, p.proname), ', ')
    into v_leaky
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where p.proname in ('record_cash_handin','my_kyc_documents','recent_push_campaigns',
                       'my_restaurant_settlements','delivery_encrypt','delivery_decrypt')
     and (p.proacl is null
          or exists (select 1 from aclexplode(p.proacl) a
                      where a.grantee = 0 and a.privilege_type = 'EXECUTE'));
  if v_leaky is not null then
    raise exception 'PUBLIC still holds EXECUTE on: %', v_leaky;
  end if;
end;
$$;

-- The admin disjuncts now fail closed by construction rather than by NULL
-- semantics. Assert on the body so a future edit that reverts the coalesce is
-- caught here rather than by an advisor months later.
do $$
declare
  v_src text;
begin
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'my_kyc_documents';
  if v_src not like '%coalesce(public.auth_role()::text, '''') = ''admin''%' then
    raise exception 'my_kyc_documents no longer uses the fail-closed admin check';
  end if;

  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'recent_push_campaigns';
  if v_src not like '%coalesce(public.auth_role()::text, '''') = ''admin''%' then
    raise exception 'recent_push_campaigns no longer uses the fail-closed admin check';
  end if;
end;
$$;

-- Behavioural: a role-less caller reads nothing through either function.
do $$
begin
  insert into public.push_campaigns (title, body, segment) values ('Eid offer', '20% off', 'all');
  insert into public.kyc_documents (subject_type, subject_id, doc_type, storage_path)
  values ('driver', '81000000-0000-0000-0000-000000000001', 'national_id', 'kyc/nid.jpg');

  perform set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-0000000000ff', true);
  if exists (select 1 from public.recent_push_campaigns(20)) then
    raise exception 'a NULL-role caller must not read the campaign audit trail';
  end if;
  if exists (select 1 from public.my_kyc_documents('driver', '81000000-0000-0000-0000-000000000001')) then
    raise exception 'a NULL-role caller must not read KYC documents';
  end if;

  -- Admin still sees both, i.e. the hardening did not break the admin surface.
  perform set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-000000000001', true);
  if not exists (select 1 from public.recent_push_campaigns(20)) then
    raise exception 'admin should still read the campaign audit trail';
  end if;
  if not exists (select 1 from public.my_kyc_documents('driver', '81000000-0000-0000-0000-000000000001')) then
    raise exception 'admin should still read KYC documents';
  end if;
  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;

-- ===========================================================================
-- AFTER: 4. The delivery PII path resolves pgcrypto and round-trips.
-- ===========================================================================
do $$
declare
  v_cipher bytea;
  v_plain  text;
begin
  v_cipher := private.delivery_encrypt('Villa 12, Om El Sid');
  if v_cipher is null then
    raise exception 'delivery_encrypt returned null for a non-null input';
  end if;
  v_plain := private.delivery_decrypt(v_cipher);
  if v_plain is distinct from 'Villa 12, Om El Sid' then
    raise exception 'encrypt/decrypt did not round-trip (got %)', coalesce(v_plain, 'null');
  end if;

  -- NULL in, NULL out — the shape create_delivery_job relies on for optional
  -- contact fields.
  if private.delivery_encrypt(null) is not null or private.delivery_decrypt(null) is not null then
    raise exception 'the encrypt/decrypt helpers must pass NULL through';
  end if;

  -- Fail closed with no key, unchanged by 202.
  delete from vault.decrypted_secrets where name = 'delivery_pii_key_v1';
  begin
    perform private.delivery_encrypt('anything');
    raise exception 'delivery_encrypt must fail closed when the Vault key is absent';
  exception when check_violation then null;
  end;
  insert into vault.decrypted_secrets (name, decrypted_secret)
  values ('delivery_pii_key_v1', 'a-test-only-key-never-used-anywhere');
end;
$$;

do $$
declare
  v_cfg text;
begin
  foreach v_cfg in array array['delivery_encrypt','delivery_decrypt'] loop
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private' and p.proname = v_cfg
         and array_to_string(p.proconfig, ',') like '%extensions%'
    ) then
      raise exception 'private.% must pin a search_path that includes extensions', v_cfg;
    end if;
    -- pg_temp last is the property that actually prevents shadowing.
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private' and p.proname = v_cfg
         and array_to_string(p.proconfig, ',') like '%pg_temp'
    ) then
      raise exception 'private.% must keep pg_temp LAST in its search_path', v_cfg;
    end if;
  end loop;
end;
$$;

-- ===========================================================================
-- AFTER: 5. The five private tables carry no client privileges.
-- ===========================================================================
do $$
declare
  v_tbl  text;
  v_role text;
  v_priv text;
begin
  foreach v_tbl in array array[
    'private.delivery_access_events',
    'private.delivery_quotes',
    'private.delivery_job_endpoints',
    'private.delivery_job_parcel_details',
    'private.delivery_job_transitions'
  ] loop
    foreach v_role in array array['anon','authenticated'] loop
      -- TRUNCATE is listed explicitly because it IGNORES RLS: "RLS on with no
      -- policies" is not protection against it (see house rule 5b).
      foreach v_priv in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
        if has_table_privilege(v_role, v_tbl, v_priv) then
          raise exception '% still holds % on %', v_role, v_priv, v_tbl;
        end if;
      end loop;
    end loop;
  end loop;
end;
$$;

do $$
declare
  v_leaky text;
begin
  select string_agg(format('%s (%s)', c.relname, a.privilege_type), ', ')
    into v_leaky
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) a
   where n.nspname = 'private'
     and c.relname in ('delivery_access_events','delivery_quotes','delivery_job_endpoints',
                       'delivery_job_parcel_details','delivery_job_transitions')
     and a.grantee = 0;
  if v_leaky is not null then
    raise exception 'PUBLIC still holds privileges on private tables: %', v_leaky;
  end if;
end;
$$;

-- ===========================================================================
-- AFTER: 6. All five advisor-flagged functions pin a search_path.
-- ===========================================================================
do $$
declare
  v_unpinned text;
begin
  select string_agg(format('%s.%s', n.nspname, p.proname), ', ')
    into v_unpinned
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where (n.nspname, p.proname) in (
           ('public','availability_events_immutable'),
           ('public','delivery_job_events_immutable'),
           ('private','delivery_access_events_immutable'),
           ('public','menu_items_staff_writable_columns'),
           ('public','search_catalog'))
     and (p.proconfig is null
          or array_to_string(p.proconfig, ',') not like '%search_path%');
  if v_unpinned is not null then
    raise exception 'still unpinned after 202: %', v_unpinned;
  end if;
end;
$$;

-- The pin must not have turned any of them into a definer by accident, which
-- is the one way this "harmless" change could become harmful.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname, p.proname) in (
             ('public','availability_events_immutable'),
             ('public','delivery_job_events_immutable'),
             ('private','delivery_access_events_immutable'),
             ('public','menu_items_staff_writable_columns'),
             ('public','search_catalog'))
       and p.prosecdef
  ) then
    raise exception 'one of the five INVOKER functions became SECURITY DEFINER';
  end if;
end;
$$;

-- menu_items_staff_writable_columns still returns the allow-list unchanged —
-- the pin must not have altered what the staff tier may write.
do $$
begin
  if public.menu_items_staff_writable_columns() is distinct from array['is_available','sort_order']::text[] then
    raise exception 'the staff-writable column allow-list changed';
  end if;
end;
$$;

-- ===========================================================================
-- House rule 1: exactly one overload each. A second one and PostgREST answers
-- PGRST202 on every call.
-- ===========================================================================
do $$
declare
  v_dupes text;
begin
  select string_agg(format('%s.%s x%s', nspname, proname, cnt), ', ')
    into v_dupes
    from (
      select n.nspname, p.proname, count(*) as cnt
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where (n.nspname, p.proname) in (
               ('public','record_cash_handin'),
               ('public','my_kyc_documents'),
               ('public','recent_push_campaigns'),
               ('public','my_restaurant_settlements'),
               ('private','delivery_encrypt'),
               ('private','delivery_decrypt'),
               ('public','search_catalog'),
               ('public','menu_items_staff_writable_columns'))
       group by 1, 2
      having count(*) <> 1
    ) d;
  if v_dupes is not null then
    raise exception 'overload count wrong (house rule 1): %', v_dupes;
  end if;
end;
$$;

-- Every SECURITY DEFINER function this migration touched still pins a
-- search_path (house rule 6).
do $$
declare
  v_unpinned text;
begin
  select string_agg(format('%s.%s', n.nspname, p.proname), ', ')
    into v_unpinned
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.prosecdef
     and (n.nspname, p.proname) in (
           ('public','record_cash_handin'),
           ('public','my_kyc_documents'),
           ('public','recent_push_campaigns'),
           ('public','my_restaurant_settlements'),
           ('private','delivery_encrypt'),
           ('private','delivery_decrypt'))
     and (p.proconfig is null
          or array_to_string(p.proconfig, ',') not like '%search_path%');
  if v_unpinned is not null then
    raise exception 'definer function with no pinned search_path: %', v_unpinned;
  end if;
end;
$$;

rollback;

\echo '202_audit_round_2_security.test.sql: PASS'
