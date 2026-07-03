-- 081_privilege_escalation_lockdown.sql
--
-- Fixes 3 CRITICAL privilege-escalation holes found by the 2026-07-03 adversarial
-- audit. Each was verified exploitable against LIVE PROD with only the public
-- anon key. All three are the SAME root cause the house standard already knows:
-- a broad default grant (table UPDATE / function EXECUTE) that a targeted RLS
-- policy or a fail-open body guard does NOT actually constrain.
--
--   C1. assign_driver — SECURITY DEFINER, anon still holds EXECUTE, and the only
--       gate is `v_role not in ('admin','dispatcher')`. For an anon caller
--       auth_role() is NULL, so `NULL not in (...)` is NULL (not TRUE) → the
--       guard never raises → anyone with the anon key can (re)assign any driver
--       to any order and sabotage dispatch. (mig 072 revoked 10 sibling RPCs but
--       missed this one; its body guard is not null-safe.)
--
--   C2. drivers table — RLS row-scopes UPDATE to the driver's own row, but anon
--       AND authenticated hold column UPDATE on ALL columns incl is_verified,
--       is_active, rating. A driver can PATCH their own is_verified=true and
--       clear the admin-only KYC gate (mig 030) → unvetted driver becomes
--       dispatchable. The 037/orders + 053/users lockdown was never applied here.
--
--   C3. restaurants table — same shape: merchant_staff can PATCH their own row's
--       commission_pct=0 (also featured, rating). Commission is FROZEN into
--       order_financials at delivery (mig 062) → permanent, unrecoverable
--       platform-revenue loss. Apps only ever write is_open.
--
-- Also folds in two related fail-open / posture fixes the audit confirmed:
--   H1. issue_credit guard `public.auth_role() <> 'admin'` is not null-safe →
--       latent fail-open wallet mint. Make it coalesce()-guarded (house standard).
--   M1. Blanket revoke anon EXECUTE on the remaining mutating SECURITY DEFINER
--       dispatch/order RPCs so the transport layer enforces auth rather than
--       relying on each body being null-safe.
--
-- Defense-in-depth: we fix BOTH layers — revoke the broad grant (transport) AND
-- make the body guard null-safe (logic) — so neither alone is load-bearing.

-- ---------------------------------------------------------------------------
-- C1 + M1: dispatch / order SECURITY DEFINER RPCs — revoke anon, null-safe gate
-- ---------------------------------------------------------------------------

-- assign_driver: add an explicit auth pre-check and a null-safe role gate.
create or replace function public.assign_driver(p_order_id uuid, p_driver_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_role app_role := public.auth_role();
  v_user uuid := auth.uid();
begin
  -- [081] Fail CLOSED for unauthenticated callers. Previously an anon caller
  -- (auth_role() = NULL) slipped past `NULL not in (...)` = NULL.
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;
  if coalesce(v_role::text, '') not in ('admin','dispatcher') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;

  if not exists (
    select 1 from public.drivers
     where id = p_driver_id and is_active and is_verified and status <> 'offline'
  ) then
    raise exception 'DRIVER_NOT_ELIGIBLE: driver must be active, verified and online'
      using errcode = 'check_violation';
  end if;

  update public.order_assignments
     set status = 'reassigned', responded_at = now()
   where order_id = p_order_id and status in ('offered','accepted');

  insert into public.order_assignments (order_id, driver_id, status, assigned_by, assigned_by_id)
  values (p_order_id, p_driver_id, 'offered', 'dispatcher', v_user);

  update public.orders
     set assigned_driver_id = p_driver_id,
         rider = public.rider_snapshot(p_driver_id)
   where id = p_order_id;
end;
$function$;

-- Transport-layer lockdown: no anon/public EXECUTE on the mutating dispatch/order
-- definer RPCs (the set mig 072 missed). Each is authenticated-role gated in-body;
-- these revokes make anon exposure impossible regardless of body-guard bugs.
do $$
declare
  fn text;
  fns text[] := array[
    'public.assign_driver(uuid,uuid)',
    'public.advance_order_status(uuid,order_status_type,text)',
    'public.driver_respond(uuid,boolean)',
    'public.driver_ping(double precision,double precision,text)',
    'public.mark_cod_collected(uuid,integer)'
  ];
begin
  foreach fn in array fns loop
    execute format('revoke all on function %s from public, anon;', fn);
    execute format('grant execute on function %s to authenticated;', fn);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- C2: drivers table — column-scoped UPDATE grant (house pattern from mig 037/053)
-- ---------------------------------------------------------------------------
-- The driver app only ever writes drivers.status (apps/driver/src/jobs.ts:176).
-- Everything else (is_verified/is_active/rating/geo/...) is admin/service-role
-- or trigger-managed. RLS still row-scopes to the driver's own row.
revoke update on public.drivers from anon, authenticated;
grant update (status) on public.drivers to authenticated;

-- ---------------------------------------------------------------------------
-- C3: restaurants table — column-scoped UPDATE grant
-- ---------------------------------------------------------------------------
-- Restaurant + merchant apps only ever write restaurants.is_open
-- (apps/restaurant/src/orders.ts:199, apps/merchant-web/src/app/page.tsx:171).
-- commission_pct / featured / rating must NEVER be client-writable.
revoke update on public.restaurants from anon, authenticated;
grant update (is_open) on public.restaurants to authenticated;

-- ---------------------------------------------------------------------------
-- C4/H2: push-header regressions — auto_assign_order & reward_referrer_on_delivery
--        lost their x-internal-secret header (migs 048/060 & 047/058 restated
--        pre-038 bodies), so expo-push 401-rejects every driver new-offer push
--        and every referral-reward push. Fix by swapping the hardcoded header
--        jsonb for the existing public.push_headers() helper (STABLE, returns
--        Content-Type + x-internal-secret when the Vault secret is set).
-- ---------------------------------------------------------------------------

-- auto_assign_order: identical to the live mig-060 body, ONLY the final
-- net.http_post header arg changed to public.push_headers().
create or replace function public.auto_assign_order(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_order       public.orders;
  v_radius      int;
  v_ttl         int;
  v_driver      uuid;
  v_prof        uuid;
  v_asg_id      uuid;
  v_base        text;
  v_gold_driver uuid;
  v_first_look  int;
  v_held_since  timestamptz;
  v_reoffer_cd  int;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then return null; end if;

  if exists (
    select 1 from public.order_assignments
     where order_id = p_order_id and status in ('offered','accepted')
  ) then
    return null;
  end if;

  if v_order.status not in ('accepted','preparing','ready') then
    return null;
  end if;
  if v_order.dropoff_geo is null then
    return null;
  end if;

  if v_order.dispatch_eligible_at is null then
    update public.orders
       set dispatch_eligible_at = now()
     where id = p_order_id
    returning dispatch_eligible_at into v_order.dispatch_eligible_at;
  end if;

  select coalesce((value #>> '{}')::int, 5000) into v_radius
    from public.platform_settings where key = 'dispatch_radius_m';
  select coalesce((value #>> '{}')::int, 45) into v_ttl
    from public.platform_settings where key = 'dispatch_offer_ttl_seconds';

  select coalesce((value #>> '{}')::int, 3600) into v_reoffer_cd
    from public.platform_settings where key = 'dispatch_reoffer_cooldown_seconds';

  select nd.driver_id into v_driver
    from public.nearest_drivers(v_order.dropoff_geo, coalesce(v_radius,5000), 20) nd
   where not exists (
           select 1 from public.order_assignments oa
            where oa.order_id = p_order_id
              and oa.driver_id = nd.driver_id
              and (
                    oa.status = 'offered'
                    or (oa.status in ('rejected','reassigned')
                        and oa.assigned_at > now() - make_interval(secs => coalesce(v_reoffer_cd,3600)))
                  )
         )
   order by nd.distance_m asc
   limit 1;

  if v_driver is null then
    return null;
  end if;

  select dl.first_look_seconds into v_first_look
    from public.driver_loyalty dl where dl.driver_id = v_driver;

  if coalesce(v_first_look, 0) = 0 then
    select nd.driver_id into v_gold_driver
      from public.nearest_drivers(v_order.dropoff_geo, coalesce(v_radius,5000), 20) nd
      join public.driver_loyalty dl on dl.driver_id = nd.driver_id and dl.tier = 'gold'
     where not exists (
             select 1 from public.order_assignments oa
              where oa.order_id = p_order_id
                and oa.driver_id = nd.driver_id
                and (
                      oa.status = 'offered'
                      or (oa.status in ('rejected','reassigned')
                          and oa.assigned_at > now() - make_interval(secs => coalesce(v_reoffer_cd,3600)))
                    )
           )
     order by nd.distance_m asc
     limit 1;

    if v_gold_driver is not null and v_gold_driver <> v_driver then
      select coalesce((value #>> '{}')::int, 8) into v_first_look
        from public.platform_settings where key = 'loyalty_driver_first_look_gold_seconds';
      v_held_since := coalesce(v_order.dispatch_eligible_at, v_order.placed_at);
      if now() - v_held_since < make_interval(secs => coalesce(v_first_look,8)) then
        return null;
      end if;
    end if;
  end if;

  insert into public.order_assignments
    (order_id, driver_id, status, assigned_by, offer_expires_at)
  values
    (p_order_id, v_driver, 'offered', 'auto', now() + make_interval(secs => coalesce(v_ttl,45)))
  returning id into v_asg_id;

  update public.orders
     set assigned_driver_id = v_driver, dispatch_mode = 'auto'
   where id = p_order_id;

  select profile_id into v_prof from public.drivers where id = v_driver;
  select value #>> '{}' into v_base
    from public.platform_settings where key = 'functions_base_url';

  if v_prof is not null and v_base is not null and v_base <> '' then
    perform net.http_post(
      url     := v_base || '/expo-push',
      body    := jsonb_build_object(
                   'event', 'new_offer',
                   'orderId', p_order_id::text,
                   'recipientUserIds', jsonb_build_array(v_prof::text)
                 ),
      headers := public.push_headers()  -- [081] was hardcoded; restore secret
    );
  end if;

  return v_driver;
exception when others then
  raise warning 'auto_assign_order(%) failed: % (%)', p_order_id, sqlerrm, sqlstate;
  return null;
end;
$function$;

-- reward_referrer_on_delivery: identical to the live mig-058 body, ONLY the
-- push header arg changed to public.push_headers().
create or replace function public.reward_referrer_on_delivery()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_ref public.referrals; v_reward int; v_code text;
begin
  if new.status <> 'delivered' or old.status = 'delivered' then return new; end if;
  select * into v_ref from public.referrals where order_id = new.id and reward_status = 'pending' for update;
  if not found then return new; end if;
  select coalesce((value #>> '{}')::int, 50) into v_reward from public.platform_settings where key = 'referral_referrer_reward_egp';
  v_code := 'REF-' || upper(encode(gen_random_bytes(16), 'hex'));
  -- [058] bind the reward code to the referrer.
  insert into public.promo_codes (code, kind, value, per_user_limit, is_active, owner_user_id)
  values (upper(v_code), 'fixed', greatest(1, coalesce(v_reward,50)), 1, true, v_ref.referrer_id);
  update public.referrals set reward_status = 'rewarded', reward_code = upper(v_code), rewarded_at = now() where id = v_ref.id;
  declare v_base text;
  begin
    select value #>> '{}' into v_base from public.platform_settings where key = 'functions_base_url';
    if v_base is not null and v_base <> '' then
      perform net.http_post(
        url := v_base || '/expo-push',
        body := jsonb_build_object('event','referral_rewarded','orderId',new.id::text,'recipientUserIds',jsonb_build_array(v_ref.referrer_id::text)),
        headers := public.push_headers());  -- [081] was hardcoded; restore secret
    end if;
  exception when others then null;
  end;
  return new;
exception when others then return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- H1: issue_credit — make the admin gate null-safe (house standard).
--     Faithful copy of the live mig-071 body with ONLY the guard line changed
--     from `public.auth_role() <> 'admin'` to a coalesce()-wrapped comparison.
-- ---------------------------------------------------------------------------
create or replace function public.issue_credit(
  p_user_id uuid,
  p_amount_egp integer,
  p_reason text,
  p_order_id uuid default null,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_actor uuid := auth.uid();
  v_base   text;
begin
  if p_amount_egp is null or p_amount_egp <= 0 then
    raise exception 'INVALID_AMOUNT' using errcode = 'check_violation';
  end if;
  if p_reason not in ('refund','goodwill','sla_late','redeem','adjustment') then
    raise exception 'INVALID_REASON' using errcode = 'check_violation';
  end if;
  -- [081] null-safe admin gate (was `public.auth_role() <> 'admin'`, which is
  -- NULL for a caller with no public.users row = fail-open).
  if p_reason <> 'sla_late' and coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;

  insert into public.credit_ledger (user_id, delta_egp, reason, ref_order_id, note, actor_id)
  values (p_user_id, p_amount_egp, p_reason, p_order_id, p_note, v_actor);

  insert into public.customer_credit_balance (user_id, balance_egp)
  values (p_user_id, p_amount_egp)
  on conflict (user_id) do update
    set balance_egp = public.customer_credit_balance.balance_egp + p_amount_egp,
        updated_at = now();

  if p_reason <> 'redeem' then
    begin
      select value #>> '{}' into v_base from public.platform_settings where key = 'functions_base_url';
      if v_base is not null and v_base <> '' then
        perform net.http_post(
          url     := v_base || '/expo-push',
          body    := jsonb_build_object(
                       'event', 'credit_issued',
                       'orderId', coalesce(p_order_id::text, p_user_id::text),
                       'recipientUserIds', jsonb_build_array(p_user_id::text)),
          headers := public.push_headers()
        );
      end if;
    exception when others then
      null;
    end;
  end if;
end;
$function$;

revoke all on function public.issue_credit(uuid,integer,text,uuid,text) from public, anon;
grant execute on function public.issue_credit(uuid,integer,text,uuid,text) to authenticated;
