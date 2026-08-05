\set ON_ERROR_STOP on

-- Transaction-wrapped so nothing persists (migration house rule 6).
begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end;
$$;

create schema auth;
create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create schema realtime;
create table realtime.messages (
  id bigint generated always as identity primary key,
  extension text not null
);
create function realtime.topic()
returns text
language sql
stable
as $$
  select current_setting('realtime.topic', true)
$$;

grant usage on schema auth, realtime to authenticated;
grant execute on function auth.uid(), realtime.topic() to authenticated;
grant select, insert on realtime.messages to authenticated;
alter table realtime.messages enable row level security;

create table public.drivers (
  id uuid primary key,
  profile_id uuid unique
);
create table public.orders (
  id uuid primary key,
  user_id uuid,
  assigned_driver_id uuid references public.drivers(id)
);
grant select on public.orders, public.drivers to authenticated;

\ir ../migrations/216_realtime_driver_location_authorization.sql

insert into public.drivers (id, profile_id) values
  ('81000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000003'),
  ('81000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-000000000004');

insert into public.orders (id, user_id, assigned_driver_id) values
  ('82000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001'),
  ('82000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-000000000002', '81000000-0000-0000-0000-000000000002');

-- The synthetic message Realtime uses during a subscription carries the
-- requested extension. A broadcast row is visible only when the caller owns
-- the order named by the private topic; a Presence row must not piggyback.
insert into realtime.messages (extension) values ('broadcast'), ('presence');

-- ---------------------------------------------------------------------------
-- Receive: the owning customer can join/read exactly their order's Broadcast.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-000000000001', true);
select set_config('realtime.topic', 'order:82000000-0000-0000-0000-000000000001:driver_loc', true);
set local role authenticated;

do $$
begin
  if (select count(*) from realtime.messages) <> 1 then
    raise exception 'owner must receive exactly the Broadcast extension';
  end if;
end;
$$;

reset role;

-- A different customer cannot subscribe to the same topic, nor can the owner
-- turn an arbitrary/malformed topic into a database lookup.
select set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-000000000002', true);
set local role authenticated;

do $$
begin
  if (select count(*) from realtime.messages) <> 0 then
    raise exception 'non-owner received another customer''s location channel';
  end if;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-000000000001', true);
select set_config('realtime.topic', 'order:not-a-uuid:driver_loc', true);
set local role authenticated;

do $$
begin
  if (select count(*) from realtime.messages) <> 0 then
    raise exception 'malformed channel topic matched an order';
  end if;
end;
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Send: only the driver presently assigned to this exact order can broadcast.
-- Drivers do not receive the customer-side stream themselves.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-000000000003', true);
select set_config('realtime.topic', 'order:82000000-0000-0000-0000-000000000001:driver_loc', true);
set local role authenticated;

do $$
begin
  if (select count(*) from realtime.messages) <> 0 then
    raise exception 'driver should not receive customer-only location stream';
  end if;
  insert into realtime.messages (extension) values ('broadcast');
end;
$$;

reset role;

-- The customer and another driver both fail closed on insert. PostgreSQL uses
-- insufficient_privilege (42501) for an RLS WITH CHECK rejection.
select set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-000000000001', true);
set local role authenticated;

do $$
begin
  begin
    insert into realtime.messages (extension) values ('broadcast');
    raise exception 'customer unexpectedly sent a driver location';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-000000000004', true);
set local role authenticated;

do $$
begin
  begin
    insert into realtime.messages (extension) values ('broadcast');
    raise exception 'unassigned driver unexpectedly sent a location';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;

-- The assigned driver cannot use a valid identity to send Presence or a
-- different order topic.
select set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-000000000003', true);
set local role authenticated;

do $$
begin
  begin
    insert into realtime.messages (extension) values ('presence');
    raise exception 'driver unexpectedly sent a non-Broadcast message';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;
select set_config('realtime.topic', 'order:82000000-0000-0000-0000-000000000002:driver_loc', true);
set local role authenticated;

do $$
begin
  begin
    insert into realtime.messages (extension) values ('broadcast');
    raise exception 'driver unexpectedly sent to a different order topic';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;
rollback;
