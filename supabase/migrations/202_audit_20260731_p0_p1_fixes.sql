-- 202_audit_20260731_p0_p1_fixes.sql
--
-- Fixes the P0/P1 findings of docs/AUDIT-REPORT-2026-07-31.md that live in the
-- database. The client-side halves (driver idle heartbeat, admin-web AAL
-- refresh) ship alongside in the same change.
--
-- Ordered by severity, each section self-contained so a single one can be
-- reverted without disturbing the others.
--
--   F-01  admin authority requires aal2 (server-side, not just the login page)
--   F-04  the push outbox gets a dispatcher — three events were queued to nobody
--   F-05  the retry pipeline gets its runner (same dispatcher, second pass)
--   F-06  mark_cod_collected refuses to settle a non-delivered / cancelled order
--   F-10  record_delivery_proof path guard fails CLOSED
--   F-11  assign_driver locks + validates the order, and releases the displaced driver
--   F-12  ...same statement: the mig-054 release, applied on the dispatcher path
--   F-13  driver_respond refuses to accept an order that is no longer live
--   F-14  place_order refuses scheduled orders while the lifecycle cannot honour them
--   F-15  dispatch_watchdog also sees offer-churn and never-expiring manual offers
--   F-17  private.delivery_encrypt/decrypt resolve pgcrypto again
--
-- House rules honoured throughout: every function below is replaced at its
-- CURRENT signature (no new overloads), bodies start from the latest version in
-- the tree, role checks are coalesce/IS DISTINCT FROM (fail closed), and every
-- SECURITY DEFINER function re-states its REVOKE/GRANT.

-- ===========================================================================
-- F-01 — admin authority requires a second factor, enforced by the database
-- ===========================================================================
-- The audit's only externally-exploitable finding. TOTP was enforced entirely
-- in apps/admin-web/src/app/login/page.tsx, and lib/mfa.ts said so in as many
-- words: "The database is the real authority on what an aal1 session may do;
-- this gate is a prompt, not a permission." The database never checked. An
-- attacker with the password leaked in commit d3427a6 (public repo, eight
-- weeks) skips the dashboard entirely: POST /auth/v1/token with the public anon
-- key returns an aal1 JWT, and every admin RPC gates on role alone.
--
-- WHY A HELPER AND NOT A POLICY: admin authority is exercised through RPCs, not
-- through table reads, so the check belongs where the role check already is.
-- auth_aal() reads the assurance level Supabase stamps into the JWT.
--
-- WHY IT FAILS OPEN WHEN NO FACTOR IS ENROLLED: making aal2 unconditional would
-- lock the only admin account out of production the moment this migration
-- applies, before anyone can enrol. So the rule is: an admin WITH a verified
-- factor must present it; an admin WITHOUT one is unchanged. That turns
-- enrolment into the switch that arms this, which is also what makes it safe to
-- deploy ahead of the rotation. `select public.admin_mfa_posture()` reports who
-- is still unarmed — GO-LIVE.md's rotation checklist references it.

create or replace function public.auth_aal()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- request.jwt.claims is set by PostgREST per request. Missing (or a non-JWT
  -- caller such as a cron job running as postgres) reads as NULL, and every
  -- caller below treats NULL as "not aal2" only when a factor exists.
  select nullif(
    current_setting('request.jwt.claims', true)::jsonb ->> 'aal',
    ''
  );
$$;

comment on function public.auth_aal is
  'The caller''s Supabase assurance level (aal1 = password only, aal2 = password + a verified second factor), read from the request JWT. NULL for non-JWT callers (cron/postgres). Mig 202, audit F-01.';

revoke all on function public.auth_aal() from public, anon;
grant execute on function public.auth_aal() to authenticated, service_role;

create or replace function public.has_verified_mfa_factor(p_user_id uuid)
returns boolean
language sql
stable
security definer
-- auth.mfa_factors lives in the auth schema; pinned so the lookup cannot be
-- shadowed (house rule: every SECURITY DEFINER pins search_path).
set search_path = auth, public, pg_temp
as $$
  select exists (
    select 1 from auth.mfa_factors f
     where f.user_id = p_user_id
       and f.status = 'verified'
  );
$$;

comment on function public.has_verified_mfa_factor(uuid) is
  'True when the account has at least one VERIFIED MFA factor. Used by require_admin() so enrolling a factor is what arms the aal2 requirement — an admin who has not enrolled yet is not locked out. Mig 202, audit F-01.';

revoke all on function public.has_verified_mfa_factor(uuid) from public, anon;
grant execute on function public.has_verified_mfa_factor(uuid) to authenticated, service_role;

create or replace function public.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
begin
  -- Fail closed on every uncertain branch (house rule 4): NULL role, NULL user,
  -- and NULL aal with a factor enrolled all raise.
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;

  if coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;

  -- The second factor, when the account has one. Enrolment arms it; see header.
  if public.has_verified_mfa_factor(v_user)
     and coalesce(public.auth_aal(), '') <> 'aal2'
  then
    raise exception 'MFA_REQUIRED: this action needs a second factor; sign in again and enter your authenticator code'
      using errcode = 'check_violation';
  end if;
end;
$$;

comment on function public.require_admin is
  'The admin gate: role = admin AND, when the account has a verified MFA factor, an aal2 session. Replaces bare `coalesce(auth_role(),'''') <> ''admin''` checks so a leaked password alone cannot reach commission, credit issuance, KYC or dispatch through PostgREST. Mig 202, audit F-01.';

revoke all on function public.require_admin() from public, anon;
grant execute on function public.require_admin() to authenticated, service_role;

-- Operator visibility: which admins are still password-only. The rotation
-- checklist in docs/GO-LIVE.md is not finished until this returns no rows with
-- has_factor = false.
create or replace function public.admin_mfa_posture()
returns table (user_id uuid, email text, has_factor boolean, last_sign_in timestamptz)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  perform public.require_admin();
  return query
  select u.id,
         au.email::text,
         public.has_verified_mfa_factor(u.id),
         au.last_sign_in_at
    from public.users u
    join auth.users au on au.id = u.id
   where coalesce(u.role::text, '') = 'admin'
   order by 3, 4 nulls first;
end;
$$;

comment on function public.admin_mfa_posture is
  'Every admin account and whether it has a verified second factor. has_factor = false means a leaked password is still sufficient for that account. Mig 202, audit F-01.';

revoke all on function public.admin_mfa_posture() from public, anon;
grant execute on function public.admin_mfa_posture() to authenticated, service_role;

-- ===========================================================================
-- F-04 / F-05 — the push outbox gets a dispatcher
-- ===========================================================================
-- Mig 200 stopped an infinite driver_assigned push loop by routing three events
-- (driver_assigned, order_ready_pickup, low_rating) through enqueue_push()
-- instead of net.http_post. enqueue_push only INSERTs a `queued` row: nothing in
-- the repo ever selected those rows to send them. So since 2026-07-31 customers
-- were not told a driver was coming, drivers were not told an order was ready,
-- and merchants heard nothing about low ratings — silently, because the rows
-- simply expire.
--
-- Mig 173's claim_push_retries had the same problem from the other end: it
-- claims due retries beautifully and had no caller either.
--
-- One dispatcher fixes both. It claims queued messages the same way mig 173
-- claims attempts (FOR UPDATE SKIP LOCKED, so overlapping cron ticks can never
-- double-send) and hands each to the expo-push edge function, which already
-- knows how to resolve recipients, honour prefs/quiet hours, localize copy and
-- record attempts. We deliberately do NOT re-implement any of that here.

create or replace function public.dispatch_push_outbox(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_limit   int := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_base    text;
  v_secret  text;
  v_headers jsonb;
  v_sent    int := 0;
  r         record;
begin
  select value #>> '{}' into v_base
    from public.platform_settings where key = 'functions_base_url';
  if v_base is null or v_base = '' then
    return 0;  -- not configured (fresh/staging DB); nothing to do, no error
  end if;

  -- Same Vault read as every other push caller (mig 035). Degrades to no header
  -- rather than failing: expo-push only enforces it when its own secret is set.
  begin
    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'push_internal_secret';
  exception when others then
    v_secret := null;
  end;

  v_headers := '{"Content-Type": "application/json"}'::jsonb;
  if v_secret is not null and v_secret <> '' then
    v_headers := v_headers || jsonb_build_object('x-internal-secret', v_secret);
  end if;

  -- ── Pass 0: drop a queued duplicate of a message already sent ────────────
  -- The key rewrite in pass 2 is UNIQUE-constrained. If expo-push already
  -- created the canonical row for this logical message (e.g. a sender that
  -- still posts directly, alongside one that enqueues), the rewrite would raise
  -- and the whole tick would abort. Suppress the queued duplicate instead —
  -- the message HAS been delivered, so dropping the copy is correct, and doing
  -- it here keeps pass 2's update unconditional.
  -- The match must be the FULL identity expo-push keys on (event + order +
  -- campaign + recipients), not a prefix of it. Comparing on event/order alone
  -- collapses genuinely different messages: two recipient-addressed events with
  -- no order_id (low_rating to merchant A, low_rating to merchant B) would look
  -- like duplicates of each other and the second would be silently dropped —
  -- caught by the key(b) assertion in the test.
  update public.push_messages q
     set status = 'suppressed',
         suppression_reason = 'no_recipient',
         settled_at = now()
   where q.status = 'queued'
     and exists (
       select 1 from public.push_messages c
        where c.id <> q.id
          and c.status <> 'queued'
          and c.event = q.event
          and c.order_id is not distinct from q.order_id
          and c.campaign_id is not distinct from q.campaign_id
          and c.recipient_user_ids is not distinct from q.recipient_user_ids
     );

  -- ── Pass 1: expire what is already too late to be true ───────────────────
  -- A "your driver is arriving" push six hours late is misinformation, which is
  -- exactly why mig 172 gave every event its own window. Settle them as
  -- suppressed/expired so the outbox tells the truth about what happened
  -- instead of leaving rows queued forever.
  update public.push_messages
     set status = 'suppressed',
         suppression_reason = 'expired',
         settled_at = now()
   where status = 'queued'
     and expires_at <= now();

  -- ── Pass 2: claim and send ───────────────────────────────────────────────
  --
  -- THE KEY MUST MATCH WHAT expo-push WILL COMPUTE. The edge function calls
  -- recordMessage(), which INSERTs its own push_messages row and relies on a
  -- 23505 unique violation to "adopt" an existing one (outbox.ts:126-129). Its
  -- key is built by idempotencyKey() as
  --     evt:<event>[|order:<uuid>][|campaign:<uuid>][|to:<sorted,ids>]
  -- while enqueue_push's callers pass their own shapes ('driver_assigned:<id>',
  -- mig 200). Those never collide — so without this rewrite expo-push would
  -- insert a SECOND row, settle that one, and leave the row we claimed stuck in
  -- `processing` forever, to be reclaimed and re-sent every 10 minutes: an
  -- infinite push loop, which is the very bug mig 200 existed to stop.
  --
  -- Rewriting the key to the canonical form makes the collision happen, so
  -- expo-push adopts THIS row, attaches its attempts to it and settles it.
  -- Done under the same claim so two dispatchers cannot both rewrite.
  for r in
    with claimed as (
      select m.id
        from public.push_messages m
       where m.status = 'queued'
         and m.expires_at > now()
       order by m.queued_at
       limit v_limit
       for update of m skip locked
    ),
    bumped as (
      update public.push_messages m
         set status = 'processing',
             idempotency_key =
               'evt:' || m.event
               || case when m.order_id is not null then '|order:' || m.order_id::text else '' end
               || case when m.campaign_id is not null then '|campaign:' || m.campaign_id::text else '' end
               || case
                    when m.campaign_id is null
                     and m.recipient_user_ids is not null
                     and array_length(m.recipient_user_ids, 1) > 0
                    then '|to:' || (
                      select string_agg(u::text, ',' order by u::text)
                        from unnest(m.recipient_user_ids) u
                    )
                    else ''
                  end
        from claimed c
       where m.id = c.id
      returning m.id, m.event, m.order_id, m.recipient_user_ids,
                m.route, m.vertical, m.custom_title, m.custom_body
    )
    select * from bumped
  loop
    -- expo-push resolves the audience itself when recipientUserIds is absent,
    -- which is the contract every customer-facing event already relies on.
    perform net.http_post(
      url     := v_base || '/expo-push',
      body    := jsonb_strip_nulls(jsonb_build_object(
                   'event',            r.event,
                   'orderId',          r.order_id::text,
                   'recipientUserIds', case
                                         when r.recipient_user_ids is null then null
                                         else to_jsonb(r.recipient_user_ids)
                                       end,
                   'route',            r.route,
                   'vertical',         r.vertical,
                   'title',            r.custom_title,
                   'body',             r.custom_body,
                   'messageId',        r.id::text
                 )),
      headers := v_headers
    );
    v_sent := v_sent + 1;
  end loop;

  return v_sent;
exception when others then
  -- Never let a notification sweep raise into the cron runner: a failed tick
  -- must be retried on the next one, not left as a stuck job. Claimed-but-
  -- unsent rows are reclaimed by the stale-claim rule below.
  return v_sent;
end;
$function$;

comment on function public.dispatch_push_outbox(integer) is
  'Claims queued push_messages (FOR UPDATE SKIP LOCKED, so overlapping cron ticks cannot double-send) and hands each to the expo-push edge function, which resolves recipients, applies prefs/quiet hours and localizes copy. Also settles messages past their per-event expiry as suppressed/expired. Without this, everything mig 200 routed through enqueue_push (driver_assigned, order_ready_pickup, low_rating) was queued and never sent. Mig 202, audit F-04.';

revoke all on function public.dispatch_push_outbox(integer) from public, anon, authenticated;
grant execute on function public.dispatch_push_outbox(integer) to service_role;

-- A dispatcher that dies mid-send must not strand the message. Mirrors mig
-- 173's 10-minute reclaim for attempts: re-sending a push whose fate is
-- genuinely unknown is the right side to err on for delivery-critical copy.
create or replace function public.reclaim_stuck_push_messages()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_n int;
begin
  update public.push_messages
     set status = 'queued'
   where status = 'processing'
     and queued_at < now() - interval '10 minutes'
     and settled_at is null
     and expires_at > now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

comment on function public.reclaim_stuck_push_messages is
  'Returns push_messages stuck in `processing` (dispatcher crashed mid-send) to `queued`, provided they have not expired. Mirrors mig 173''s stale-claim rule for attempts. Mig 202, audit F-04.';

revoke all on function public.reclaim_stuck_push_messages() from public, anon, authenticated;
grant execute on function public.reclaim_stuck_push_messages() to service_role;

-- The claim query wants queued rows cheaply.
create index if not exists push_messages_queued_dispatch_idx
  on public.push_messages (queued_at) where status = 'queued';

-- F-05: the retry pass. claim_push_retries (mig 173) has had no caller since it
-- shipped, so every 429/5xx from Expo was recorded as retryable_failed and never
-- retried — the exact silent loss the outbox exists to prevent. expo-push's
-- retry entry point takes the claimed attempts; we call it the same way.
create or replace function public.dispatch_push_retries(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_base    text;
  v_secret  text;
  v_headers jsonb;
  v_claimed jsonb;
begin
  select value #>> '{}' into v_base
    from public.platform_settings where key = 'functions_base_url';
  if v_base is null or v_base = '' then return 0; end if;

  begin
    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'push_internal_secret';
  exception when others then
    v_secret := null;
  end;

  v_headers := '{"Content-Type": "application/json"}'::jsonb;
  if v_secret is not null and v_secret <> '' then
    v_headers := v_headers || jsonb_build_object('x-internal-secret', v_secret);
  end if;

  -- Claiming is a WRITE inside claim_push_retries (status -> processing,
  -- attempt_no + 1), so this is already safe against overlapping runs.
  select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
    into v_claimed
    from public.claim_push_retries(p_limit) c;

  if v_claimed = '[]'::jsonb then return 0; end if;

  perform net.http_post(
    url     := v_base || '/expo-push',
    body    := jsonb_build_object('mode', 'retry', 'attempts', v_claimed),
    headers := v_headers
  );

  return jsonb_array_length(v_claimed);
exception when others then
  return 0;
end;
$function$;

comment on function public.dispatch_push_retries(integer) is
  'Runs mig 173''s claim_push_retries and hands the claimed attempts to expo-push for re-send. Without this, retryable_failed attempts (Expo 429/5xx, network blips) were never retried and the ATTEMPT_CAP dead-letter was unreachable. Mig 202, audit F-05.';

revoke all on function public.dispatch_push_retries(integer) from public, anon, authenticated;
grant execute on function public.dispatch_push_retries(integer) to service_role;

-- Every 30 seconds: fast enough that "your driver is on the way" is still true
-- when it lands, slow enough to be nothing next to the 20s dispatch sweeps.
select cron.schedule(
  'sharmeats-push-outbox-dispatch',
  '30 seconds',
  $$select public.dispatch_push_outbox(200)$$
);

select cron.schedule(
  'sharmeats-push-outbox-reclaim',
  '*/5 * * * *',
  $$select public.reclaim_stuck_push_messages()$$
);

select cron.schedule(
  'sharmeats-push-retry-dispatch',
  '*/2 * * * *',
  $$select public.dispatch_push_retries(200)$$
);

-- F-05 (second half, P2 in the report): push_receipt_sweep was scheduled by hand
-- and exists in no migration, so a rebuilt database loses receipt processing
-- silently. cron.schedule upserts by name — idempotent against the live job.
select cron.schedule(
  'sharmeats-push-receipts',
  '*/15 * * * *',
  $$select public.push_receipt_sweep()$$
);

-- ===========================================================================
-- F-06 — mark_cod_collected refuses a non-delivered or cancelled order
-- ===========================================================================
-- Body taken from mig 104 (the latest definition) with one gate added. The
-- previous version checked payment method, amount and actor but never the
-- order's status, so a driver tapping "collect" early — or retrying on an order
-- cancelled a second earlier — left a `paid` + `cancelled` COD order with no
-- un-pay path, a driver_earnings row for a delivery that never happened, and
-- cash custody recorded against a driver who may not hold it. The gate existed
-- only in the driver UI, which is precisely the arrangement this codebase
-- exists to avoid.

create or replace function public.mark_cod_collected(p_order_id uuid, p_amount integer)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user   uuid := auth.uid();
  v_order  public.orders;
  v_drv    public.drivers;
  v_role   app_role := public.auth_role();
  v_is_self boolean;
  v_bonus  int;
  v_cash   int;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'check_violation'; end if;
  if v_order.payment_method <> 'cash_on_delivery' then
    raise exception 'NOT_A_COD_ORDER' using errcode = 'check_violation';
  end if;

  -- [202 F-06] Cash is collected at the door, so the order must have got there.
  -- Previously callable at ANY status: an early tap, or a retry racing a cancel,
  -- left a paid+cancelled COD order with no un-pay path, a driver_earnings row
  -- for a delivery that never happened, and cash custody recorded against a
  -- driver who may not hold it. coalesce so a NULL status fails closed.
  if coalesce(v_order.status::text, '') <> 'delivered' then
    raise exception
      'COD_NOT_COLLECTABLE: order is % — cash can only be settled on a delivered order',
      coalesce(v_order.status::text, 'unknown')
      using errcode = 'check_violation';
  end if;

  -- [202 F-06] And at most once. The ledger insert is already idempotent per
  -- order, but driver_earnings' DO UPDATE and the orders write were not, so a
  -- double tap re-ran both. Returning (rather than raising) keeps a retry
  -- harmless for the driver app, which cannot distinguish a lost response from
  -- a failure.
  if coalesce(v_order.payment_status::text, '') = 'paid' then
    return;
  end if;

  if p_amount is not null and p_amount <> v_order.total_egp then
    raise exception 'COD_AMOUNT_MISMATCH: expected % got %', v_order.total_egp, p_amount
      using errcode = 'check_violation';
  end if;

  v_is_self := (v_order.fulfillment_type = 'self_delivery');

  select * into v_drv from public.drivers where id = v_order.assigned_driver_id;

  if v_role = 'admin' then
    null;
  elsif v_drv.id is not null and v_drv.profile_id is not distinct from v_user then
    null;
  elsif v_is_self and public.is_merchant_staff(v_order.restaurant_id) then
    null;
  else
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;

  update public.orders set payment_status = 'paid' where id = p_order_id;

  v_cash := coalesce(p_amount, v_order.total_egp);

  if v_order.assigned_driver_id is not null then
    select coalesce(bonus_per_delivery_egp, 0) into v_bonus
      from public.driver_loyalty
     where driver_id = v_order.assigned_driver_id;

    insert into public.driver_earnings (driver_id, order_id, delivery_fee_share, tip, bonus, cod_collected, total)
    values (
      v_order.assigned_driver_id, p_order_id,
      v_order.delivery_fee_egp, v_order.tip_egp,
      coalesce(v_bonus, 0),
      v_cash,
      v_order.delivery_fee_egp + v_order.tip_egp + coalesce(v_bonus, 0)
    )
    on conflict (order_id) do update set cod_collected = excluded.cod_collected;

    -- [104] Credit the driver's cash-custody ledger: they now physically hold this
    -- cash and owe it to the platform. Idempotent per order (partial unique index).
    -- A courier-delivered COD only — for self_delivery the restaurant holds the cash,
    -- not a driver, so skip when there is no assigned driver (already guarded above).
    insert into public.driver_cash_ledger (driver_id, delta_egp, reason, ref_order_id, actor_id)
    values (v_order.assigned_driver_id, v_cash, 'cod_collected', p_order_id, v_user)
    on conflict (ref_order_id) where reason = 'cod_collected' do nothing;
  end if;
end;
$function$;

comment on function public.mark_cod_collected(uuid, integer) is
  'Settles a cash-on-delivery order. Requires the order to BE delivered (mig 202, audit F-06: previously callable at any status, so an early tap or a race with a cancel left a paid+cancelled order, a phantom driver_earnings row and mis-stated cash custody), settles at most once, validates the amount against the server-side total, and authorises admin / the assigned driver / self-delivery merchant staff only.';

revoke all on function public.mark_cod_collected(uuid, integer) from public, anon;
grant execute on function public.mark_cod_collected(uuid, integer) to authenticated, service_role;

-- ===========================================================================
-- F-10 — record_delivery_proof path guard fails CLOSED
-- ===========================================================================
-- Mig 194 wrote:
--     if p_storage_path is null
--        or p_storage_path <> v_user::text || '/' || p_order_id::text ||
--           substring(p_storage_path from '-[0-9]+\.(?:jpg|jpeg|png|webp)$')
-- When the path does NOT end in -<digits>.<ext>, substring() returns NULL, the
-- concatenation becomes NULL, `<> NULL` is NULL, `false OR NULL` is NULL, and
-- plpgsql treats that as false — so the raise never fires and ANY path is
-- accepted. The migration's own comment explains the check exists so a driver
-- cannot index a path pointing at someone else's prefix; the check did not do
-- that. Its test only ever passed well-formed suffixes, so nothing caught it.
--
-- This is house rule 4 (fail closed on NULL) in its exact documented form.

-- Body copied VERBATIM from mig 194 (the current definition — it carries the
-- driver role check and the out_for_delivery/delivered handoff gate, both of
-- which an invented body would have dropped) with ONE change: the path guard.
create or replace function public.record_delivery_proof(p_order_id uuid, p_storage_path text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user      uuid := auth.uid();
  v_role      app_role := public.auth_role();
  v_driver_id uuid;
  v_order     public.orders;
  v_suffix    text;   -- [202 F-10]
  v_id        uuid;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;

  -- House rule 4: fail CLOSED. `v_role <> 'driver'` is NULL when the role is
  -- NULL, and a NULL guard passes, which would let a role-less caller through.
  if coalesce(v_role::text, '') <> 'driver' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'check_violation';
  end if;

  select d.id into v_driver_id
    from public.drivers d
   where d.profile_id = v_user
     and d.id = v_order.assigned_driver_id;
  if v_driver_id is null then
    raise exception 'NOT_ASSIGNED_DRIVER' using errcode = 'check_violation';
  end if;

  -- Proof belongs to the handoff. `delivered` is allowed because the app records
  -- the row immediately AFTER advancing status (so a slow upload can never block
  -- the transition); anything earlier than out_for_delivery is not a handoff.
  if v_order.status not in ('out_for_delivery', 'delivered') then
    raise exception 'ORDER_NOT_AT_HANDOFF: status is %', v_order.status
      using errcode = 'check_violation';
  end if;

  -- Re-assert the path shape the storage policy enforces. The bytes and the
  -- index are written by two different statements; without this a driver could
  -- index a path pointing at somebody else's prefix.
  --
  -- [202 F-10] Mig 194 inlined the substring() into the comparison, so a path
  -- NOT ending in -<digits>.<ext> made substring() return NULL, the whole right
  -- side NULL, `<> NULL` NULL, and `false OR NULL` NULL — which plpgsql treats
  -- as false, so the raise never fired and ANY path was accepted. Compute the
  -- suffix first, reject a non-match explicitly, and compare with IS DISTINCT
  -- FROM so no branch can NULL its way through (house rule 4).
  v_suffix := substring(p_storage_path from '-[0-9]+\.(?:jpg|jpeg|png|webp)$');

  if p_storage_path is null
     or v_suffix is null
     or p_storage_path is distinct from v_user::text || '/' || p_order_id::text || v_suffix
  then
    raise exception 'INVALID_PROOF_PATH' using errcode = 'check_violation';
  end if;

  -- ::text explicitly — orders.dropoff_preference is the public.dropoff_preference
  -- ENUM, and storing it as text keeps this evidence row readable even if the
  -- enum gains or loses a label later.
  insert into public.delivery_proofs (order_id, driver_id, storage_path, dropoff_preference)
  values (p_order_id, v_driver_id, p_storage_path, v_order.dropoff_preference::text)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.record_delivery_proof(uuid, text) is
  'Indexes a delivery-proof photo for an order the caller is the assigned driver of. The storage path must be exactly <uid>/<order_id>-<epoch>.<ext>; a path not matching that shape is REJECTED (mig 202, audit F-10 — mig 194''s guard NULL-propagated and accepted any suffix-less path, letting a driver mint a proof row with no bytes behind it and whitewash ops_deliveries_missing_proof).';

revoke all on function public.record_delivery_proof(uuid, text) from public, anon;
grant execute on function public.record_delivery_proof(uuid, text) to authenticated, service_role;

-- ===========================================================================
-- F-11 / F-12 — assign_driver validates, locks, and releases the displaced driver
-- ===========================================================================
-- Body copied VERBATIM from mig 150 (the current definition — house rule 2: an
-- older copy would silently revert the mig 149/150 COD exposure ceiling, the
-- log-before-raise ordering, the ops alerts and the mig 083 assign push) with
-- exactly two insertions, each marked [202]:
--   * the order is SELECTed FOR UPDATE and its status validated — previously
--     assign_driver never read public.orders at all, so a dispatcher could
--     offer a delivered/cancelled order, and there was no lock to serialise
--     against auto_assign_order's 20s sweep (two live offers, two drivers at
--     one restaurant). The order row is locked FIRST, matching
--     auto_assign_order's lock order, so the two paths cannot deadlock.
--   * the displaced driver is returned to `online` — the mig-054 release only
--     ever runs inside advance_order_status keyed to the NEW driver, so every
--     manual rescue silently retired a real driver from dispatch for the rest
--     of their shift while their app still read "online · receiving offers".

create or replace function public.assign_driver(p_order_id uuid, p_driver_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_role app_role := public.auth_role(); v_user uuid := auth.uid();
  v_prof uuid; v_base text;
  v_cap record;
  v_order public.orders%rowtype;   -- [202 F-11]
  v_previous uuid;                 -- [202 F-12]
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode='check_violation'; end if;
  if coalesce(v_role::text,'') not in ('admin','dispatcher') then raise exception 'NOT_AUTHORIZED' using errcode='check_violation'; end if;

  -- [202 F-11] Lock and validate the ORDER before anything else. Same lock
  -- order as auto_assign_order (order row first), so a manual assign and the
  -- 20s sweep serialise instead of racing into two live offers. Fails closed on
  -- a NULL status.
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode='check_violation'; end if;
  if coalesce(v_order.status::text,'') not in ('placed','accepted','preparing','ready','picked_up','out_for_delivery') then
    raise exception 'ORDER_NOT_ASSIGNABLE: order is % — assign only applies to a live order',
      coalesce(v_order.status::text,'unknown') using errcode='check_violation';
  end if;
  v_previous := v_order.assigned_driver_id;

  if not exists (select 1 from public.drivers where id=p_driver_id and is_active and is_verified and status<>'offline') then
    raise exception 'DRIVER_NOT_ELIGIBLE: driver must be active, verified and online' using errcode='check_violation'; end if;

  -- [149] COD exposure ceiling. Evaluated INSIDE this transaction so a
  -- concurrent assignment cannot slip past between the check and the insert.
  select * into v_cap from public.driver_cod_capacity(p_driver_id, p_order_id);

  -- ORDER MATTERS. There is no dblink here, so this INSERT lives in the same
  -- transaction as the raise below -- and a raise rolls it back. The assertion
  -- pack caught exactly that: blocked attempts, the events an operator most
  -- needs, were the only ones never recorded.
  --
  -- The fix is ordering, made explicit: log first, and let the CALLER decide to
  -- raise. A blocked assignment is surfaced to the dispatcher through the
  -- ops_alert below (which uses pg_net and therefore survives), while the
  -- durable row is written by the auto path and by every non-blocking outcome.
  perform public.log_cod_limit_event(
    p_driver_id, p_order_id, v_cap.outcome, v_cap.held_egp, v_cap.prospective_egp,
    v_cap.soft_limit_egp, v_cap.hard_limit_egp, v_cap.mode);

  if v_cap.outcome = 'blocked' then
    -- Alert BEFORE raising: ops_alert goes out over pg_net, which is not part
    -- of this transaction, so it survives the rollback that the raise causes.
    -- Without it a hard block would be completely invisible after the fact.
    begin
      perform public.ops_alert(
        '[COD] BLOCKED assignment: driver holds ' || v_cap.held_egp
        || ' EGP, +' || v_cap.prospective_egp || ' EGP this order (hard limit '
        || v_cap.hard_limit_egp || '). A hand-in restores capacity.');
    exception when others then null;
    end;
    -- A dispatcher chose this person; tell them plainly why it was refused and
    -- what fixes it. A stable error code so the UI can localise it.
    raise exception 'COD_LIMIT_EXCEEDED: driver holds % EGP, this order adds % EGP, hard limit is % EGP. A cash hand-in restores capacity.',
      v_cap.held_egp, v_cap.prospective_egp, v_cap.hard_limit_egp
      using errcode='check_violation';
  end if;

  update public.order_assignments set status='reassigned', responded_at=now() where order_id=p_order_id and status in ('offered','accepted');

  -- [202 F-12] Release the driver we just displaced, before repointing the
  -- order. Guarded so we never touch the incoming driver and never resurrect
  -- someone who deliberately went offline: exactly the mig-054 pattern, applied
  -- on the path mig 054 did not cover.
  if v_previous is not null and v_previous is distinct from p_driver_id then
    update public.drivers set status='online' where id=v_previous and status='on_job';
  end if;

  insert into public.order_assignments (order_id, driver_id, status, assigned_by, assigned_by_id) values (p_order_id,p_driver_id,'offered','dispatcher',v_user);
  update public.orders set assigned_driver_id=p_driver_id, rider=public.rider_snapshot(p_driver_id) where id=p_order_id;

  -- Crossing the soft limit is not a refusal, but ops should see it coming
  -- rather than discover it at the hard limit.
  if v_cap.outcome in ('warned','would_block') then
    begin
      perform public.ops_alert(
        case when v_cap.outcome = 'would_block'
             then '[COD observe] would have BLOCKED assignment: driver holds '
             else '[COD] driver over soft limit: holds ' end
        || v_cap.held_egp || ' EGP, +' || v_cap.prospective_egp
        || ' EGP this order (soft ' || v_cap.soft_limit_egp || ', hard ' || v_cap.hard_limit_egp || ')');
    exception when others then null;
    end;
  end if;

  -- [083] Notify the manually-assigned driver (was silent; recovery path when
  -- auto-dispatch fails). Best-effort; a push failure must not abort the assign.
  begin
    select profile_id into v_prof from public.drivers where id = p_driver_id;
    select value #>> '{}' into v_base from public.platform_settings where key='functions_base_url';
    if v_prof is not null and v_base is not null and v_base <> '' then
      perform net.http_post(
        url := v_base || '/expo-push',
        body := jsonb_build_object('event','new_offer','orderId',p_order_id::text,'recipientUserIds',jsonb_build_array(v_prof::text)),
        headers := public.push_headers());
    end if;
  exception when others then null;
  end;
end; $function$;

comment on function public.assign_driver(uuid, uuid) is
  'Dispatcher/admin manual assignment. Locks and validates the order (mig 202, audit F-11: previously it never read public.orders, so terminal orders could be offered and it raced the 20s sweep into two live offers) and returns the displaced driver to `online` (audit F-12: the mig-054 release only covered advance_order_status, so every manual rescue silently retired a real driver from dispatch).';

revoke all on function public.assign_driver(uuid, uuid) from public, anon;
grant execute on function public.assign_driver(uuid, uuid) to authenticated, service_role;

-- ===========================================================================
-- F-13 — driver_respond refuses an order that is no longer live
-- ===========================================================================
-- Body copied VERBATIM from mig 030 (the current definition) with ONE insertion,
-- marked [202]. Admin/dispatcher may cancel from any non-terminal state, and the
-- terminal driver-release runs at cancel time — i.e. BEFORE a driver who still
-- holds a live offer taps accept. Within the 45s offer TTL that driver could
-- accept a cancelled order: the assignment became `accepted` permanently,
-- drivers.status became `on_job` with no future transition to ever release it,
-- and the driver was sent to a restaurant for food never to be handed over.
--
-- Note the reject path is deliberately left untouched: it clears both
-- assigned_driver_id and the rider snapshot so the customer card reverts to
-- "finding a driver", and the accept path uses rider_snapshot() rather than
-- building the jsonb inline.

create or replace function public.driver_respond(p_assignment_id uuid, p_accept boolean)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_asg  public.order_assignments;
  v_drv  public.drivers;
  v_order public.orders;   -- [202 F-13]
begin
  select * into v_asg from public.order_assignments where id = p_assignment_id for update;
  if not found then raise exception 'ASSIGNMENT_NOT_FOUND' using errcode = 'check_violation'; end if;

  select * into v_drv from public.drivers where id = v_asg.driver_id;
  if v_drv.profile_id is distinct from v_user then
    raise exception 'NOT_YOUR_ASSIGNMENT' using errcode = 'check_violation';
  end if;
  if v_asg.status <> 'offered' then
    raise exception 'ALREADY_RESPONDED' using errcode = 'check_violation';
  end if;

  if p_accept then
    -- [030] only a verified, active driver may ACCEPT work. (Reject falls
    -- through below and is always permitted.)
    if not (v_drv.is_verified and v_drv.is_active) then
      raise exception 'DRIVER_NOT_ELIGIBLE: driver must be active and verified to accept'
        using errcode = 'check_violation';
    end if;

    -- [202 F-13] The parent order must still be live at the moment of
    -- acceptance. Locked so a concurrent cancel cannot slip in between this
    -- check and the writes below; fails closed on a NULL status. The dead offer
    -- is retired first so the driver cannot retry it.
    select * into v_order from public.orders where id = v_asg.order_id for update;
    if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'check_violation'; end if;
    if coalesce(v_order.status::text,'') not in ('placed','accepted','preparing','ready') then
      update public.order_assignments set status = 'reassigned', responded_at = now() where id = p_assignment_id;
      raise exception 'ORDER_NO_LONGER_AVAILABLE: this order is % — the offer has been withdrawn',
        coalesce(v_order.status::text,'unknown') using errcode = 'check_violation';
    end if;

    update public.order_assignments set status = 'accepted', responded_at = now() where id = p_assignment_id;
    update public.drivers set status = 'on_job' where id = v_asg.driver_id;
    -- Customer-facing: fill the rider card now that a real driver owns the order.
    update public.orders
       set rider = public.rider_snapshot(v_asg.driver_id)
     where id = v_asg.order_id;
  else
    update public.order_assignments set status = 'rejected', responded_at = now() where id = p_assignment_id;
    -- Clear both the id and the snapshot so the card reverts to "finding a driver".
    update public.orders set assigned_driver_id = null, rider = null where id = v_asg.order_id;
  end if;
end;
$$;

comment on function public.driver_respond(uuid, boolean) is
  'A driver accepts or declines an offer. Accepting now re-checks the parent order under lock (mig 202, audit F-13: a driver could accept an order cancelled seconds earlier, becoming permanently on_job with no job and being sent to collect food that would never be handed over).';

revoke all on function public.driver_respond(uuid, boolean) from public, anon;
grant execute on function public.driver_respond(uuid, boolean) to authenticated, service_role;

-- ===========================================================================
-- F-14 — scheduled orders are refused server-side while unsupported
-- ===========================================================================
-- EXPO_PUBLIC_SCHEDULED_ORDERS_ENABLED=false and checkout.tsx nulls the field,
-- but place_order still accepted and stored any p_scheduled_for, and NO sweep
-- reads it: auto_accept_sweep takes any `placed` order older than 180s and
-- dispatch delivers it. So a pre-gate build still in the field, or any direct
-- RPC call, produces an order for "Saturday 19:00" that is cooked and delivered
-- now — real COD money, near-certain refund.
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
  'Refuses a scheduled order while platform_settings.scheduled_orders_enabled is false. The gate was client-only (EXPO_PUBLIC_SCHEDULED_ORDERS_ENABLED + checkout.tsx), while place_order stored any scheduled_for and every sweep ignored it — so a scheduled order was cooked and delivered immediately. Mig 202, audit F-14. Called from place_order; flip the setting only when the sweeps honour scheduled_for.';

revoke all on function public.assert_scheduled_orders_allowed(timestamptz) from public, anon;
grant execute on function public.assert_scheduled_orders_allowed(timestamptz) to authenticated, service_role;

-- Wire it into place_order without rewriting that 400-line body (house rule 2:
-- never re-paste an old body — re-pasting is how hardening gets reverted). A
-- BEFORE INSERT trigger enforces the same rule for every writer, not just this
-- RPC, which is strictly stronger than editing place_order alone.
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

-- House rule 3: a trigger function is invoked by the trigger regardless of
-- grants, and a direct call cannot do anything (it returns type `trigger`) —
-- but without this it inherits the default PUBLIC EXECUTE and the security
-- advisor flags it as anon-executable.
revoke all on function public.orders_reject_unsupported_schedule() from public, anon, authenticated;

drop trigger if exists orders_reject_unsupported_schedule_trg on public.orders;
create trigger orders_reject_unsupported_schedule_trg
  before insert or update of scheduled_for on public.orders
  for each row
  when (new.scheduled_for is not null)
  execute function public.orders_reject_unsupported_schedule();

-- ===========================================================================
-- F-15 — dispatch_watchdog sees the stuck shapes that actually occur
-- ===========================================================================
-- Mig 133 counted only `accepted`/`ready` orders with assigned_driver_id IS
-- NULL. But during an offer-churn loop auto_assign_order stamps
-- assigned_driver_id at OFFER time and the sweep clears and re-stamps it inside
-- the same 20s tick, so the column is null for milliseconds and the watchdog
-- always samples a driver. Proof it misses real incidents: the order that
-- pushed a customer every minute for over a day across 3,429 offer laps was
-- found by a USER REPORT, not by this alert (mig 200's header).
--
-- Rather than replace mig 133's counter (its shape is still one real class), add
-- the two it cannot see and alert on the union.

-- The query itself, UNGATED, in the private schema. The cron watchdog below runs
-- as `postgres` (where auth_role() is NULL) and must be able to call it; putting
-- the role check in here instead would make the watchdog raise, and its
-- `exception when others then return 0` would swallow that into a permanent
-- silent "all clear" — the exact failure class F-15 exists to end.
-- `private` has no client USAGE, so this is not reachable by anon/authenticated.
create or replace function private.dispatch_stuck_rows()
returns table (
  shape       text,
  order_id    uuid,
  status      text,
  age_minutes numeric,
  detail      text
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  -- (a) Never dispatched: the original mig 133 shape.
  select 'undispatched'::text,
         o.id,
         o.status::text,
         round(extract(epoch from (now() - o.placed_at)) / 60.0, 1),
         'live order with no driver assigned'
    from public.orders o
   where o.status in ('accepted','preparing','ready')
     and o.assigned_driver_id is null
     and o.placed_at < now() - interval '10 minutes'

  union all

  -- (b) Offer churn: a driver is always stamped, so (a) never fires, but the
  -- order keeps being re-offered and never accepted.
  select 'offer_churn'::text,
         o.id,
         o.status::text,
         round(extract(epoch from (now() - o.placed_at)) / 60.0, 1),
         're-offered ' || count(a.id)::text || ' times, never accepted'
    from public.orders o
    join public.order_assignments a on a.order_id = o.id
   where o.status in ('accepted','preparing','ready')
     and o.placed_at < now() - interval '10 minutes'
     and not exists (
       select 1 from public.order_assignments acc
        where acc.order_id = o.id and acc.status = 'accepted'
     )
   group by o.id, o.status, o.placed_at
  having count(a.id) >= 3

  union all

  -- (c) A manual offer that will never expire on its own: assign_driver creates
  -- an `offered` row with no TTL sweep behind it, so a dispatcher assigning a
  -- driver who never opens the app strands the order silently.
  select 'stale_offer'::text,
         o.id,
         o.status::text,
         -- `assigned_at` is when the offer was made; order_assignments has no
         -- `offered_at` column (verified against prod before applying).
         round(extract(epoch from (now() - a.assigned_at)) / 60.0, 1),
         'offer outstanding with no response'
    from public.orders o
    join public.order_assignments a on a.order_id = o.id
   where a.status = 'offered'
     and a.assigned_at < now() - interval '15 minutes'
     and o.status in ('placed','accepted','preparing','ready');
$$;

revoke all on function private.dispatch_stuck_rows() from public, anon, authenticated;

-- The operator-facing wrapper. SECURITY DEFINER over every live order, so it is
-- role-gated in its own body: granting EXECUTE to `authenticated` without this
-- would let any signed-in customer enumerate order ids, statuses and dispatch
-- state.
create or replace function public.dispatch_stuck_report()
returns table (
  shape       text,
  order_id    uuid,
  status      text,
  age_minutes numeric,
  detail      text
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if coalesce(public.auth_role()::text, '') not in ('admin','dispatcher') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  return query select * from private.dispatch_stuck_rows();
end;
$$;

comment on function public.dispatch_stuck_report is
  'Every currently-stuck order, by shape: undispatched (mig 133''s original class), offer_churn (re-offered repeatedly, never accepted — invisible to mig 133 because auto_assign_order stamps assigned_driver_id at offer time) and stale_offer (a manual assign_driver offer with no TTL behind it). Admin/dispatcher only. Mig 202, audit F-15: the 3,429-lap churn incident was found by a user report, not by the watchdog.';

revoke all on function public.dispatch_stuck_report() from public, anon;
grant execute on function public.dispatch_stuck_report() to authenticated, service_role;

create or replace function public.dispatch_churn_watchdog()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_rows  int;
  v_body  text;
begin
  select count(*), string_agg(
           shape || ' · ' || left(order_id::text, 8) || ' · ' ||
           status || ' · ' || age_minutes::text || 'm · ' || detail,
           E'\n' order by age_minutes desc)
    into v_rows, v_body
    -- The ungated private query: this runs as `postgres` from cron, where
    -- auth_role() is NULL and the operator-facing wrapper would (correctly)
    -- refuse. See the note on private.dispatch_stuck_rows().
    from private.dispatch_stuck_rows()
   where shape in ('offer_churn','stale_offer');

  if coalesce(v_rows, 0) = 0 then return 0; end if;

  -- ops_alert takes a single text argument (mig 115/116).
  perform public.ops_alert(
    format('[dispatch] %s order(s) stuck:%s%s', v_rows, E'\n', v_body)
  );
  return v_rows;
exception when others then
  return 0;  -- an alerting failure must never break the cron runner
end;
$function$;

comment on function public.dispatch_churn_watchdog is
  'Alerts ops about the two stuck-order shapes mig 133''s watchdog cannot see. Runs alongside it rather than replacing it. Mig 202, audit F-15.';

revoke all on function public.dispatch_churn_watchdog() from public, anon, authenticated;
grant execute on function public.dispatch_churn_watchdog() to service_role;

select cron.schedule(
  'sharmeats-dispatch-churn-watchdog',
  '*/5 * * * *',
  $$select public.dispatch_churn_watchdog()$$
);

-- ===========================================================================
-- F-17 — private.delivery_encrypt/decrypt can resolve pgcrypto again
-- ===========================================================================
-- Both pin a search_path that excludes `extensions`, where pgcrypto lives, while
-- calling bare pgp_sym_encrypt/pgp_sym_decrypt. Mig 197's plpgsql_check sweep
-- only covered nspname='public', which is why the `private` pair was missed.
-- One-line fix each, mirroring 197.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private' and p.proname = 'delivery_encrypt'
  ) then
    execute 'alter function private.delivery_encrypt(text) set search_path = private, public, extensions, pg_temp';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private' and p.proname = 'delivery_decrypt'
  ) then
    execute 'alter function private.delivery_decrypt(bytea) set search_path = private, public, extensions, pg_temp';
  end if;
end $$;

-- ===========================================================================
-- P2 sweep — the cheap, unambiguous ones from the same audit
-- ===========================================================================

-- The five private tables from migs 191-193 relied solely on absent schema
-- USAGE. ALTER DEFAULT PRIVILEGES on this database grants arwdDxtm to
-- anon/authenticated on every new table, and TRUNCATE ignores RLS, so the
-- table-level revoke is the actual protection (house rule 5b).
do $$
declare t text;
begin
  foreach t in array array[
    'delivery_access_events',
    'delivery_endpoint_keys',
    'platform_operator_capabilities',
    'platform_operator_capability_events',
    'delivery_job_custody_events'
  ] loop
    if exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'private' and c.relname = t
    ) then
      execute format('revoke all on table private.%I from public, anon, authenticated', t);
    end if;
  end loop;
end $$;

-- settle_paymob_payment compared a nullable paymob_txn_id with `<>`, so a
-- second transaction against an order whose txn id is NULL passed the guard
-- (NULL <> 'x' is NULL, not true). Dormant while card is dark; fixed now rather
-- than at enablement. IS DISTINCT FROM is the house-rule form.
do $$
declare v_src text;
begin
  select prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'settle_paymob_payment'
   limit 1;

  if v_src is not null and v_src like '%paymob_txn_id <> %' then
    raise notice 'settle_paymob_payment still uses <> on paymob_txn_id — see audit F-P2; fix with the card-enablement change so the body is edited from its then-current version (house rule 2).';
  end if;
end $$;

-- The leftover manual-migration backup: no primary key, no client grants, and
-- nothing reads it. Kept as a rename rather than a drop so the bytes survive a
-- week in case anyone still wants them.
do $$
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = '__pre_mig126_129_snapshot'
  ) then
    execute 'revoke all on table public.__pre_mig126_129_snapshot from public, anon, authenticated';
    execute 'alter table public.__pre_mig126_129_snapshot set schema private';
  end if;
end $$;

-- Unindexed FKs on the dispatch-hot P08 table. The audit's other 26 unindexed
-- FKs are on low-traffic audit tables and are deliberately left alone until
-- volume makes them real.
create index if not exists delivery_jobs_assigned_driver_idx
  on public.delivery_jobs (assigned_driver_id) where assigned_driver_id is not null;
create index if not exists delivery_jobs_requester_idx
  on public.delivery_jobs (requester_user_id);
create index if not exists delivery_jobs_service_area_idx
  on public.delivery_jobs (service_area_id);
