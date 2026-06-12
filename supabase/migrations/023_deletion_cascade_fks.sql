-- =====================================================================
-- 023_deletion_cascade_fks.sql
-- Completes account deletion (022): two FKs discovered ON THE LIVE SCHEMA
-- still block the auth.users delete cascade.
--
--   1. orders.address_id -> addresses  ON DELETE RESTRICT, NOT NULL (mig 002).
--      The user cascade deletes their addresses rows; retained (anonymized)
--      orders pointing at them would abort the whole deletion. The order's
--      address_snapshot jsonb (scrubbed by 022) is the authoritative record
--      after placement, so the FK can safely become nullable + SET NULL.
--      Bonus: users can now remove an address that an old order used (was a
--      hard error under RESTRICT).
--
--   2. riders.user_id -> auth.users  with default NO ACTION (mig 002).
--      NO ACTION blocks deletes just like RESTRICT. If a deleted customer's
--      auth id ever appears on a riders row, deletion would abort. Flip to
--      SET NULL (column is already nullable).
--
-- Idempotent: guarded drops/recreates, safe to re-apply.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. orders.address_id: RESTRICT -> SET NULL (+ drop NOT NULL)
-- ---------------------------------------------------------------------
alter table public.orders
  alter column address_id drop not null;

do $$
declare
  v_conname text;
begin
  for v_conname in
    select con.conname
    from pg_constraint con
    join pg_class rel     on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'orders'
      and con.contype = 'f'
      and (
        select att.attname
        from pg_attribute att
        where att.attrelid = con.conrelid
          and att.attnum = con.conkey[1]
      ) = 'address_id'
  loop
    execute format('alter table public.orders drop constraint %I', v_conname);
  end loop;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_address_id_fkey'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_address_id_fkey
      foreign key (address_id) references public.addresses(id) on delete set null;
  end if;
end $$;

comment on column public.orders.address_id is
  'Live address reference at placement time; nulled if the address (or its owner account) is deleted. address_snapshot is the authoritative delivery record.';

-- ---------------------------------------------------------------------
-- 2. riders.user_id: NO ACTION -> SET NULL
-- ---------------------------------------------------------------------
do $$
declare
  v_conname text;
begin
  for v_conname in
    select con.conname
    from pg_constraint con
    join pg_class rel     on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'riders'
      and con.contype = 'f'
      and (
        select att.attname
        from pg_attribute att
        where att.attrelid = con.conrelid
          and att.attnum = con.conkey[1]
      ) = 'user_id'
  loop
    execute format('alter table public.riders drop constraint %I', v_conname);
  end loop;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'riders_user_id_fkey'
      and conrelid = 'public.riders'::regclass
  ) then
    alter table public.riders
      add constraint riders_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete set null;
  end if;
end $$;

commit;
