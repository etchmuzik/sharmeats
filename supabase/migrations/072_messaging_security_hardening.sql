-- 072_messaging_security_hardening.sql
-- Security fixes from the 2026-07-03 A-to-Z review of migs 062-071.
--
-- C-1 (CRITICAL, exploit-confirmed): reply_support_message was anon-callable
--   (default PUBLIC execute grant never revoked) and its ONLY guard was
--   `if auth_role() <> 'admin'`. For an unauthenticated anon caller auth_role()
--   is NULL, and `NULL <> 'admin'` is NULL (not true), so the guard did NOT
--   fire — an anon attacker could insert a from_support=true message into ANY
--   user's support thread (phishing: fake "Support" replies + a real push).
--   FIX: add an auth.uid() null-guard first + make the role check null-safe +
--   revoke execute from public, anon.
--
-- H-1 (HIGH): several authenticated-only RPCs relied on `grant to authenticated`
--   alone, which does NOT remove Postgres's implicit PUBLIC (anon) execute.
--   Only C-1 was exploitable (the rest self-guard on auth.uid()), but the
--   posture is fragile. FIX: blanket-revoke execute from public, anon on every
--   authenticated-only RPC added in 062/067/069 so the transport layer enforces
--   auth, not just each function body.
--
-- H-2 (HIGH): waitlist_anon_insert let the public anon key write arbitrary
--   ip / user_agent / referrer / whatsapp. FIX: tighten WITH CHECK to forbid
--   client-set ip/user_agent/referrer and bound email length + validate locale.
--
-- M-2 (MEDIUM): order_messages / support_messages UPDATE policies were
--   table-wide, letting a thread party rewrite any message's `body` (not just
--   read_at) directly via PostgREST. FIX: column-scope UPDATE to read_at only
--   via GRANT (revoke table UPDATE, grant UPDATE(read_at)); RLS policy stays.
--
-- Non-destructive: guard/grant/policy changes only. Idempotent.

-- ============================================================================
-- C-1: reply_support_message — null-guard + null-safe role check + revoke.
-- ============================================================================
create or replace function public.reply_support_message(p_user_id uuid, p_body text)
returns public.support_messages
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare v_agent uuid := auth.uid(); v_msg public.support_messages;
begin
  -- Reject unauthenticated callers FIRST (mirrors send_support_message).
  if v_agent is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;
  -- Null-safe admin check: coalesce so a non-admin/NULL role can never slip past.
  if coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  if p_body is null or length(btrim(p_body)) = 0 then raise exception 'EMPTY_MESSAGE' using errcode = 'check_violation'; end if;
  insert into public.support_messages (user_id, from_support, author_id, body)
  values (p_user_id, true, v_agent, btrim(p_body))
  returning * into v_msg;
  return v_msg;
end;
$$;

-- ============================================================================
-- H-1: revoke implicit PUBLIC/anon execute on all authenticated-only RPCs, then
-- re-grant to authenticated only. (issue_credit/snapshot already revoked in 062.)
-- ============================================================================
revoke all on function public.redeem_credit(int)                    from public, anon;
revoke all on function public.my_credit_balance()                   from public, anon;
revoke all on function public.send_order_message(uuid, text)        from public, anon;
revoke all on function public.mark_order_thread_read(uuid)          from public, anon;
revoke all on function public.my_unread_message_count()             from public, anon;
revoke all on function public.can_access_order_thread(uuid)         from public, anon;
revoke all on function public.send_support_message(text)            from public, anon;
revoke all on function public.reply_support_message(uuid, text)     from public, anon;
revoke all on function public.mark_support_thread_read(uuid)        from public, anon;
revoke all on function public.my_support_unread_count()             from public, anon;

grant execute on function public.redeem_credit(int)                 to authenticated;
grant execute on function public.my_credit_balance()                to authenticated;
grant execute on function public.send_order_message(uuid, text)     to authenticated;
grant execute on function public.mark_order_thread_read(uuid)       to authenticated;
grant execute on function public.my_unread_message_count()          to authenticated;
grant execute on function public.can_access_order_thread(uuid)      to authenticated;
grant execute on function public.send_support_message(text)         to authenticated;
grant execute on function public.reply_support_message(uuid, text)  to authenticated;
grant execute on function public.mark_support_thread_read(uuid)     to authenticated;
grant execute on function public.my_support_unread_count()          to authenticated;

-- ============================================================================
-- H-2: tighten the waitlist anon insert policy.
-- ============================================================================
drop policy if exists "waitlist_anon_insert" on public.waitlist;
create policy "waitlist_anon_insert"
  on public.waitlist
  for insert
  to anon
  with check (
    email is not null
    and email = lower(email)
    and length(email) between 3 and 254
    and source = 'landing'
    and locale in ('en','ar','ru','it','de')
    -- Client may NOT set server/analytics columns; the DB records those itself.
    and ip is null
    and user_agent is null
    and referrer is null
  );
comment on policy "waitlist_anon_insert" on public.waitlist is
  'Landing signups: anon INSERT only, non-null lowercased bounded email, valid locale, source=landing, and NO client-set ip/user_agent/referrer. No anon SELECT/UPDATE/DELETE.';

-- ============================================================================
-- M-2: column-scope UPDATE on message tables to read_at only. RLS still gates
-- WHICH rows; the column grant gates WHICH columns. Body becomes immutable to
-- clients (integrity / non-repudiation of the chat log).
-- ============================================================================
revoke update on public.order_messages   from authenticated;
revoke update on public.support_messages from authenticated;
grant update (read_at) on public.order_messages   to authenticated;
grant update (read_at) on public.support_messages to authenticated;
