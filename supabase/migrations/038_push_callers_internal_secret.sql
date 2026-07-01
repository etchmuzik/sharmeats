-- 038_push_callers_internal_secret.sql
-- Attach the x-internal-secret header to the TWO remaining /expo-push callers.
--
-- THE BUG THIS FIXES
-- expo-push fails closed: with PUSH_INTERNAL_SECRET set it 401-rejects any POST
-- lacking a matching `x-internal-secret` header (and 503s if the secret is unset).
-- Mig 035 patched only ONE caller — notify_order_status_event (customer status
-- pushes) — to read the secret from Vault and send the header. The other two
-- callers still hardcode `{"Content-Type": "application/json"}` with no secret:
--   * auto_assign_order (025)            -> driver 'new_offer' push
--   * reward_referrer_on_delivery (026)  -> referrer 'referral_rewarded' push
-- So the moment PUSH_INTERNAL_SECRET is provisioned (required for ANY push to
-- work), these two are 401-dropped: drivers stop getting "New delivery offer"
-- and referrers stop getting their reward notification.
--
-- THE FIX
-- CREATE OR REPLACE both functions with the exact Vault-read + conditional-header
-- pattern established in 035: read `push_internal_secret` from vault, build the
-- headers with the secret when present, fall open (no header) when absent. The
-- function bodies are otherwise byte-for-byte the originals (025 / 026) — only
-- the header construction changes.
--
-- Companion change (NOT in this migration — edit the edge function): add a
-- `referral_rewarded` entry to expo-push's COPY map so that push has real title/
-- body instead of the generic "Sharm Eats / Order update" fallback. `new_offer`
-- already exists in the map.
--
-- Non-destructive: CREATE OR REPLACE of two existing functions. Grants/triggers
-- unchanged (reward_referrer_on_delivery stays trigger-only; auto_assign_order
-- stays SECURITY DEFINER, cron/admin-callable).

-- ============================================================================
-- 1) auto_assign_order — driver new-offer push now carries the internal secret.
-- ============================================================================
create or replace function public.auto_assign_order(p_order_id uuid)
returns uuid
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_order     public.orders;
  v_radius    int;
  v_ttl       int;
  v_driver    uuid;
  v_prof      uuid;
  v_asg_id    uuid;
  v_base      text;
  v_secret    text;
  v_headers   jsonb;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then return null; end if;

  -- Never double-offer: bail if an active (offered/accepted) assignment exists.
  if exists (
    select 1 from public.order_assignments
     where order_id = p_order_id and status in ('offered','accepted')
  ) then
    return null;
  end if;

  -- Only dispatch orders that are actually ready to move.
  if v_order.status not in ('accepted','preparing','ready') then
    return null;
  end if;
  if v_order.dropoff_geo is null then
    return null;  -- no destination to route from; manual fallback
  end if;

  select coalesce((value #>> '{}')::int, 5000) into v_radius
    from public.platform_settings where key = 'dispatch_radius_m';
  select coalesce((value #>> '{}')::int, 45) into v_ttl
    from public.platform_settings where key = 'dispatch_offer_ttl_seconds';

  -- Nearest eligible driver who hasn't already seen (offered/rejected) this order.
  select nd.driver_id into v_driver
    from public.nearest_drivers(v_order.dropoff_geo, coalesce(v_radius,5000), 20) nd
   where not exists (
           select 1 from public.order_assignments oa
            where oa.order_id = p_order_id
              and oa.driver_id = nd.driver_id
              and oa.status in ('offered','rejected','reassigned')
         )
   order by nd.distance_m asc
   limit 1;

  if v_driver is null then
    return null;  -- no one in range; sweep retries next tick
  end if;

  insert into public.order_assignments
    (order_id, driver_id, status, assigned_by, offer_expires_at)
  values
    (p_order_id, v_driver, 'offered', 'auto', now() + make_interval(secs => coalesce(v_ttl,45)))
  returning id into v_asg_id;

  update public.orders
     set assigned_driver_id = v_driver, dispatch_mode = 'auto'
   where id = p_order_id;

  -- Push the offer to that driver (resolve their auth profile for push_tokens).
  select profile_id into v_prof from public.drivers where id = v_driver;
  select value #>> '{}' into v_base
    from public.platform_settings where key = 'functions_base_url';

  -- [038] Read the internal shared secret from Vault (same pattern as 035). A
  -- missing secret / no Vault access degrades to "no header" (fail open) rather
  -- than breaking dispatch. expo-push enforces the header only when its own
  -- PUSH_INTERNAL_SECRET is set, so the two must be provisioned together.
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

  if v_prof is not null and v_base is not null and v_base <> '' then
    perform net.http_post(
      url     := v_base || '/expo-push',
      body    := jsonb_build_object(
                   'event', 'new_offer',
                   'orderId', p_order_id::text,
                   'recipientUserIds', jsonb_build_array(v_prof::text)
                 ),
      headers := v_headers
    );
  end if;

  return v_driver;
exception when others then
  -- Dispatch is best-effort per order: one bad order must not abort the whole
  -- sweep. But DON'T swallow silently — emit a WARNING so a real error (FK
  -- violation, bad data) is visible in the Postgres logs instead of an order
  -- mysteriously never dispatching. Returning null lets the sweep continue.
  raise warning 'auto_assign_order(%) failed: % (%)', p_order_id, sqlerrm, sqlstate;
  return null;
end;
$$;

comment on function public.auto_assign_order is
  'Offers one order to the nearest eligible driver (online/verified/active, not already offered/rejected this order). Creates an auto order_assignments row + pushes the driver (x-internal-secret from Vault, mig 038). Returns offered driver_id or NULL.';

-- ============================================================================
-- 2) reward_referrer_on_delivery — referrer push now carries the internal secret.
-- ============================================================================
create or replace function public.reward_referrer_on_delivery()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_ref     public.referrals;
  v_reward  int;
  v_code    text;
begin
  if new.status <> 'delivered' or old.status = 'delivered' then return new; end if;

  -- FOR UPDATE: serialize concurrent delivery transitions so the reward is
  -- minted exactly once. Without the lock, two simultaneous 'delivered' updates
  -- could both read reward_status='pending' and each mint a REF code, leaving an
  -- orphaned duplicate. The lock makes the second waiter see 'rewarded' and bail.
  select * into v_ref from public.referrals
   where order_id = new.id and reward_status = 'pending'
   for update;
  if not found then return new; end if;

  select coalesce((value #>> '{}')::int, 50) into v_reward
    from public.platform_settings where key = 'referral_referrer_reward_egp';

  -- Mint a one-time fixed promo code for the referrer (per_user_limit 1).
  v_code := 'REF-' || substr(replace(gen_random_uuid()::text,'-',''), 1, 6);
  insert into public.promo_codes (code, kind, value, per_user_limit, is_active)
  values (upper(v_code), 'fixed', greatest(1, coalesce(v_reward,50)), 1, true);

  update public.referrals
     set reward_status = 'rewarded', reward_code = upper(v_code), rewarded_at = now()
   where id = v_ref.id;

  -- Best-effort push to the referrer ("Your friend ordered — here's EGP off").
  declare
    v_base   text;
    v_prof   uuid;
    v_secret text;
    v_headers jsonb;
  begin
    select value #>> '{}' into v_base from public.platform_settings where key = 'functions_base_url';

    -- [038] internal secret from Vault (same pattern as 035); fail open if absent.
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

    -- referrer_id IS the users.id == auth user id; expo-push resolves push_tokens by user_id.
    if v_base is not null and v_base <> '' then
      perform net.http_post(
        url     := v_base || '/expo-push',
        body    := jsonb_build_object(
                     'event', 'referral_rewarded',
                     'orderId', new.id::text,
                     'recipientUserIds', jsonb_build_array(v_ref.referrer_id::text)
                   ),
        headers := v_headers
      );
    end if;
  exception when others then null;
  end;

  return new;
exception when others then
  return new;  -- never block the delivery transition on reward bookkeeping
end;
$$;

-- Trigger-only function — never a direct RPC. Re-assert the client-role lockdown
-- (CREATE OR REPLACE preserves grants, but be explicit / idempotent).
revoke all on function public.reward_referrer_on_delivery() from public, anon, authenticated;
