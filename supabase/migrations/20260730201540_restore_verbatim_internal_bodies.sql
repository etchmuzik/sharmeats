-- ============================================================================
-- TRANSCRIPT OF AN ALREADY-APPLIED MIGRATION — DO NOT RE-APPLY TO PRODUCTION.
--
--   prod ledger version : 20260730201540
--   prod ledger name    : 20260730162500_restore_verbatim_internal_bodies
--   applied to prod     : 2026-07-30 (directly, with no file in this repo)
--   reconstructed       : 2026-08-01, from
--                         supabase_migrations.schema_migrations.statements
--
-- WHY THIS FILE EXISTS. This is the TWELFTH orphaned ledger row, and it predates
-- the eleven from 2026-07-31 that the sibling transcripts cover. The 2026-07-31
-- audit report noticed it (§7, "Ledger rows without a repo file: 1") and left it
-- there; the round-2 verification pass found it again. It is recorded here for
-- the same reason as the others: a ledger row with no file means the repo does
-- not describe the database, and every later migration written from the repo
-- inherits that blind spot.
--
-- WHAT IT IS NOT. It is not a change. Production ALREADY has everything below.
-- Do not point this at production, do not "re-run it to be sure", and do not
-- edit it to fix a defect — a later, higher-numbered migration does that.
--
-- WHAT IT ACTUALLY DID, since the name is opaque: it re-applied two functions
-- from 20260730162500 with their PL/pgSQL comment blocks intact, so that
-- pg_proc.prosrc would match the repo file byte for byte. Behaviour-neutral by
-- construction — only comments differ. That is also why it is unreproducible
-- from the repo alone and why check-db-drift.sh never caught it: that script
-- checks file -> ledger, and this direction (ledger -> file) is unmonitored.
--
-- The body below this marker is reproduced verbatim, including its own original
-- header comments. Verified byte-for-byte against the prod ledger
-- (md5 64a373ce989e74a89b3bef09929f9e32, 7777 characters).
-- ============================================================================
-- ===== BEGIN TRANSCRIPT =====
-- Re-apply the two internal functions from 20260730162500 with their comment
-- blocks intact, so pg_proc.prosrc matches the repo file byte for byte.
-- Behaviour is unchanged: only PL/pgSQL comments differ.

create or replace function private.acquire_merchant_menu_locks(
  p_restaurant_ids uuid[]
)
returns void
language plpgsql
set search_path = pg_catalog
as $lock$
declare
  v_ids uuid[];
  v_id uuid;
begin
  select coalesce(array_agg(distinct candidate order by candidate), '{}'::uuid[])
    into v_ids
    from unnest(coalesce(p_restaurant_ids, '{}'::uuid[])) as candidate
   where candidate is not null;

  if cardinality(v_ids) = 0 then
    raise exception 'CSV_IMPORT_INVALID: a restaurant id is required'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Canonical lock order: all involved merchant rows in UUID order, then all
  -- semantic advisory keys in the same order. FOR UPDATE makes opposite
  -- cross-merchant moves serialize rather than deadlock, and makes restaurant
  -- deletion/vertical reassignment wait before this transaction holds the menu
  -- advisory key.
  perform r.id
    from public.restaurants r
   where r.id = any (v_ids)
   order by r.id
   for update;

  foreach v_id in array v_ids loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('merchant-menu:' || v_id::text, 0)
    );
  end loop;
end;
$lock$;

create or replace function public.merchant_menu_mutation_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $guard$
declare
  v_restaurant_ids uuid[];
  v_may_write boolean;
begin
  if tg_op = 'INSERT' then
    v_restaurant_ids := array[new.restaurant_id];
  elsif tg_op = 'DELETE' then
    v_restaurant_ids := array[old.restaurant_id];
  else
    v_restaurant_ids := array[old.restaurant_id, new.restaurant_id];
  end if;

  -- Does this caller have any write authority over EVERY restaurant involved?
  --
  -- This trigger is SECURITY DEFINER and BEFORE ROW, and PostgreSQL evaluates
  -- an INSERT's RLS WITH CHECK only AFTER before-row triggers run. Without
  -- this gate the definer-privileged duplicate-name lookups below execute for
  -- any authenticated caller, and their 'name "X" already exists' message --
  -- distinguishable from the generic RLS rejection, and echoing the name --
  -- turns a failing INSERT into a confirmation oracle for the hidden menu of
  -- an unapproved or private-vertical merchant.
  --
  -- Exemptions mirror migration 136: a context with NO request JWT
  -- (service_role, psql, migrations, seeds) and admin both pass through.
  if auth.uid() is null
     or coalesce(public.auth_role()::text, '') = 'admin'  -- house rule 4: fail closed
  then
    v_may_write := true;
  else
    select bool_and(public.is_merchant_staff(candidate))
      into v_may_write
      from unnest(v_restaurant_ids) as candidate
     where candidate is not null;
    v_may_write := coalesce(v_may_write, false);
  end if;

  perform private.acquire_merchant_menu_locks(v_restaurant_ids);

  if tg_table_name = 'menu_sections' and tg_op <> 'DELETE' then
    -- Normalize and bound-check the name ONLY when this statement actually
    -- writes it. Two reasons, both load-bearing:
    --   1. Unconditionally assigning NEW.name makes mig 136's to_jsonb(NEW) vs
    --      to_jsonb(OLD) diff see `name` as changed on an unrelated UPDATE
    --      (this trigger is named aaa_ so it runs first), so a staff-tier
    --      availability toggle on a legacy untrimmed row is rejected with
    --      MANAGER_REQUIRED mid-shift.
    --   2. Rows predating this migration have no length/trim guarantee, so an
    --      unconditional bound check makes an over-long legacy name
    --      permanently un-updatable through every path, manager included.
    -- Names that are being written are still fully normalized and validated.
    if tg_op = 'INSERT' or old.name is distinct from new.name then
      new.name := btrim(new.name);
      if new.name = '' or length(new.name) > 120 then
        raise exception 'CSV_IMPORT_INVALID: section name must contain 1 to 120 characters'
          using errcode = 'invalid_parameter_value';
      end if;
    end if;

    -- btrim both sides: NEW.name is only normalized above when it is written,
    -- so an untouched legacy name can still carry whitespace here.
    --
    -- v_may_write gates the lookup, not the outcome: an unauthorized caller
    -- simply skips it and is rejected by RLS with its uniform error, so a
    -- correct guess is indistinguishable from a wrong one. The write cannot
    -- succeed either way.
    if v_may_write and (
      tg_op = 'INSERT'
      or old.restaurant_id is distinct from new.restaurant_id
      or lower(btrim(old.name)) is distinct from lower(btrim(new.name))
    ) and exists (
      select 1
        from public.menu_sections ms
       where ms.restaurant_id = new.restaurant_id
         and lower(btrim(ms.name)) = lower(btrim(new.name))
         and ms.id is distinct from new.id
    ) then
      raise exception 'CSV_IMPORT_INVALID: section name "%" already exists', new.name
        using errcode = 'invalid_parameter_value';
    end if;

    if tg_op = 'INSERT' and exists (
      select 1
        from public.menu_sections ms
       where ms.restaurant_id = new.restaurant_id
         and ms.sort_order = new.sort_order
    ) then
      select coalesce(max(ms.sort_order) + 1, 0)
        into new.sort_order
        from public.menu_sections ms
       where ms.restaurant_id = new.restaurant_id;
    end if;
  elsif tg_table_name = 'menu_items' and tg_op <> 'DELETE' then
    -- Conditional for the same two reasons as menu_sections above: an
    -- unconditional NEW.name assignment breaks the staff availability toggle
    -- via mig 136's column diff, and an unconditional bound check strands
    -- legacy rows whose names predate these limits.
    if tg_op = 'INSERT' or old.name is distinct from new.name then
      new.name := btrim(new.name);
      if new.name = '' or length(new.name) > 160 then
        raise exception 'CSV_IMPORT_INVALID: item name must contain 1 to 160 characters'
          using errcode = 'invalid_parameter_value';
      end if;
    end if;

    if not exists (
      select 1
        from public.menu_sections ms
       where ms.id = new.section_id
         and ms.restaurant_id = new.restaurant_id
    ) then
      raise exception 'CSV_IMPORT_INVALID: section does not belong to this restaurant'
        using errcode = 'invalid_parameter_value';
    end if;

    -- btrim both sides, and gate on v_may_write, for the same reasons as the
    -- section branch above.
    if v_may_write and (
      tg_op = 'INSERT'
      or old.restaurant_id is distinct from new.restaurant_id
      or old.section_id is distinct from new.section_id
      or lower(btrim(old.name)) is distinct from lower(btrim(new.name))
    ) and exists (
      select 1
        from public.menu_items mi
       where mi.restaurant_id = new.restaurant_id
         and mi.section_id = new.section_id
         and lower(btrim(mi.name)) = lower(btrim(new.name))
         and mi.id is distinct from new.id
    ) then
      raise exception 'CSV_IMPORT_INVALID: item name "%" already exists in this section', new.name
        using errcode = 'invalid_parameter_value';
    end if;

    if tg_op = 'INSERT' and exists (
      select 1
        from public.menu_items mi
       where mi.section_id = new.section_id
         and mi.sort_order = new.sort_order
    ) then
      select coalesce(max(mi.sort_order) + 1, 0)
        into new.sort_order
        from public.menu_items mi
       where mi.section_id = new.section_id;
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$guard$;
