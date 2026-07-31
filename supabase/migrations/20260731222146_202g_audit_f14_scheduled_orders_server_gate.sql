-- ============================================================================
-- TRANSCRIPT OF AN ALREADY-APPLIED MIGRATION — DO NOT RE-APPLY TO PRODUCTION.
--
--   prod ledger version : 20260731222146
--   prod ledger name    : 202g_audit_f14_scheduled_orders_server_gate
--   applied to prod     : 2026-07-31 (directly, with no file in this repo)
--   reconstructed       : 2026-08-01, from
--                         supabase_migrations.schema_migrations.statements
--
-- WHY THIS FILE EXISTS. On 2026-07-31 eleven migrations were applied straight to
-- production and never committed. The repo therefore no longer described the
-- database. This file is a byte-exact copy of what production recorded, written
-- back so that (a) the repo describes production again, and (b) a fresh database
-- rebuilt by replaying supabase/migrations/ ends up in the same state.
--
-- WHAT IT IS NOT. It is not a change. Production ALREADY has everything below.
-- Do not point this at production, do not "re-run it to be sure", and do not
-- edit it to fix a defect — a later, higher-numbered migration does that. Editing
-- a transcript makes the repo lie about production a second time.
--
-- NOTE ON THE INSERT. The platform_settings seed uses ON CONFLICT DO NOTHING, so
-- re-running would not clobber a live value — but that is not licence to re-run
-- it. Re-enabling scheduled orders is an ops UPDATE to
-- platform_settings.scheduled_orders_enabled once the sweeps honour
-- scheduled_for, not a re-apply of this file and not an edit to it.
--
-- The body below this marker is reproduced verbatim, including its own original
-- header comments (which refer to a "202" file that was never committed) and its
-- own numbering claims. Those are left untouched on purpose: this records what
-- ran, not what we wish had run. Verified byte-for-byte against the prod ledger
-- (md5 730a0c44fc79bccbf135c2b67827e911).
-- ============================================================================
-- ===== BEGIN TRANSCRIPT =====
-- 202 section F-14 — scheduled orders are refused server-side while unsupported.
--
-- EXPO_PUBLIC_SCHEDULED_ORDERS_ENABLED=false and checkout.tsx nulls the field,
-- but place_order still accepted and stored any p_scheduled_for, and NO sweep
-- reads it: auto_accept_sweep takes any `placed` order older than 180s and
-- dispatch delivers it. So a pre-gate build still in the field, or any direct
-- RPC call, produces an order for "Saturday 19:00" that is cooked and delivered
-- now — real COD money, near-certain refund.
--
-- Verified before applying: zero existing orders carry a scheduled_for, so the
-- trigger cannot break an UPDATE on live data.
--
-- The flag lives in platform_settings so re-enabling is an ops action once the
-- lifecycle honours it, not another migration.
insert into public.platform_settings (key, value)
values ('scheduled_orders_enabled', to_jsonb(false))
on conflict (key) do nothing;

create or replace function public.assert_scheduled_orders_allowed(p_scheduled_for timestamptz)
returns void
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_enabled boolean;
begin
  if p_scheduled_for is null then return; end if;

  select coalesce((value #>> '{}')::boolean, false)
    into v_enabled
    from public.platform_settings
   where key = 'scheduled_orders_enabled';

  -- Missing row / unreadable value => disabled. Fails closed.
  if coalesce(v_enabled, false) is not true then
    raise exception
      'SCHEDULED_ORDERS_DISABLED: scheduled delivery is not available yet'
      using errcode = 'check_violation';
  end if;
end;
$function$;

comment on function public.assert_scheduled_orders_allowed(timestamptz) is
  'Refuses a scheduled order while platform_settings.scheduled_orders_enabled is false. The gate was client-only (EXPO_PUBLIC_SCHEDULED_ORDERS_ENABLED + checkout.tsx), while place_order stored any scheduled_for and every sweep ignored it — so a scheduled order was cooked and delivered immediately. Mig 202, audit F-14. Flip the setting only when the sweeps honour scheduled_for.';

revoke all on function public.assert_scheduled_orders_allowed(timestamptz) from public, anon;
grant execute on function public.assert_scheduled_orders_allowed(timestamptz) to authenticated, service_role;

-- Wire it in without rewriting place_order's 400-line body (house rule 2: never
-- re-paste an old body — re-pasting is how hardening gets reverted). A trigger
-- covers every writer, not just that RPC, which is strictly stronger.
create or replace function public.orders_reject_unsupported_schedule()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  perform public.assert_scheduled_orders_allowed(new.scheduled_for);
  return new;
end;
$function$;

comment on function public.orders_reject_unsupported_schedule is
  'BEFORE INSERT/UPDATE on orders: refuses a scheduled_for while scheduled orders are disabled. A trigger rather than an edit to place_order''s body, so every writer is covered and the 400-line RPC body is not re-pasted (house rule 2). Mig 202, audit F-14.';

drop trigger if exists orders_reject_unsupported_schedule_trg on public.orders;
create trigger orders_reject_unsupported_schedule_trg
  before insert or update of scheduled_for on public.orders
  for each row
  when (new.scheduled_for is not null)
  execute function public.orders_reject_unsupported_schedule();
