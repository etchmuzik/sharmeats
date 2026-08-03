-- 212_register_push_token_reapply.sql
--
-- Land the push half of migration 120 that never actually reached production.
--
-- WHAT BROKE, VISIBLY: Sentry SHARMEATS-CUSTOMER-8 (first seen 2026-08-03),
-- PGRST202 "Could not find the function public.register_push_token". All three
-- 1.1.0 binaries call this RPC on every authenticated launch; the driver app's
-- own comment states the stakes: "a failure here means this driver receives NO
-- offers." Old binaries still write push_tokens directly, which is why the
-- table shows recent activity — coverage decays quietly as users update to the
-- builds that only know the RPC. The newest builds are the broken ones.
--
-- HOW A RECORDED MIGRATION CAN BE MISSING: migration 120's history row exists,
-- but neither of its push artifacts does (function absent, unique index
-- absent), while its KYC pieces are live. The runbook explains: on 2026-07-24
-- the repo and the linked ledger had diverged beyond `db push` (122 repo
-- migrations absent from the ledger), so changes went to prod selectively, by
-- hand. Migration 122's header records the decision that the push section of
-- 120 should "wait for the binary release train." The train shipped 2026-08-01;
-- the wait was never ended. One feature gate, opened client-side first.
--
-- Verified against prod before writing this (2026-08-03):
--   register_push_token        -> does not exist (0 overloads)
--   push_tokens_token_uidx     -> does not exist
--   duplicate tokens           -> 11 (53 rows, 42 distinct) — the shared-device
--                                 misdelivery 120 was closing is live: a token
--                                 on two accounts sends the previous owner the
--                                 next owner's order pushes.
--
-- House rules: body carried VERBATIM from 120 — the only definition that has
-- ever existed, so there is no later hardening to lose (rule 2); argument list
-- matches what all three shipped apps send, and the assertion below proves
-- exactly one overload so PGRST202 cannot return as its evil twin, the
-- ambiguous-overload variant (rule 1); REVOKE before narrow grants (rule 3).
-- Idempotent throughout: re-applying 120 later over this is a no-op, exactly
-- as 122's header promised for its own carry-forwards.

-- ---------------------------------------------------------------------------
-- 1. Dedupe, keeping the most recently refreshed row per physical token.
--    Must precede the unique index; prod has 11 violations today.
-- ---------------------------------------------------------------------------
with ranked as (
  select
    id,
    row_number() over (
      partition by token
      order by updated_at desc, created_at desc, id desc
    ) as position
  from public.push_tokens
)
delete from public.push_tokens as token
using ranked
where token.id = ranked.id
  and ranked.position > 1;

create unique index if not exists push_tokens_token_uidx
  on public.push_tokens(token);

-- ---------------------------------------------------------------------------
-- 2. The RPC, verbatim from 120: an atomic token transfer, not an upsert-only.
--    ON CONFLICT (token) moves the device to the current account, which is the
--    entire reason the clients stopped writing the table directly.
-- ---------------------------------------------------------------------------
create or replace function public.register_push_token(
  p_token text, p_platform text
)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_token text := nullif(btrim(coalesce(p_token, '')), '');
  v_platform text := lower(nullif(btrim(coalesce(p_platform, '')), ''));
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;
  if v_token is null or length(v_token) < 20 or length(v_token) > 512 then
    raise exception 'INVALID_PUSH_TOKEN' using errcode = 'check_violation';
  end if;
  if v_platform is null or v_platform not in ('ios', 'android', 'web') then
    raise exception 'INVALID_PLATFORM' using errcode = 'check_violation';
  end if;

  insert into public.push_tokens (user_id, token, platform)
  values (v_user, v_token, v_platform)
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        updated_at = now();
end;
$$;

revoke all on function public.register_push_token(text, text)
  from public, anon;
grant execute on function public.register_push_token(text, text)
  to authenticated;

comment on function public.register_push_token(text, text) is
  'Atomically registers this device''s Expo push token to the calling account, transferring it away from any previous account (shared-device case). Defined by mig 120, which never reached prod — reapplied by mig 212 after Sentry PGRST202 showed every 1.1.0 binary failing registration.';

-- ---------------------------------------------------------------------------
-- 3. Prove exactly one overload. PGRST202 has two causes — missing function
--    and ambiguous overloads — and this migration must not fix one by
--    introducing the other.
-- ---------------------------------------------------------------------------
do $$
declare
  v_count int;
begin
  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'register_push_token';
  if v_count <> 1 then
    raise exception 'register_push_token has % overloads, expected exactly 1', v_count;
  end if;
end;
$$;

-- PostgREST reloads its schema cache on DDL via event trigger on Supabase, but
-- the explicit notify costs nothing and removes the one remaining way the
-- PGRST202 could outlive the fix.
notify pgrst, 'reload schema';
