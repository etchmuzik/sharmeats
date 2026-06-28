-- 035_push_secret_from_vault.sql
-- Read the expo-push shared secret from Vault instead of a DB GUC (M4, follow-up).
--
-- WHY THIS SUPERSEDES 034's approach
-- Mig 034 read the secret from current_setting('app.push_secret'), which would
-- be set via `ALTER DATABASE ... SET`. On Supabase that DDL needs superuser /
-- db-owner privilege that isn't available (the API/CLI roles are restricted), so
-- the GUC can't actually be set. Supabase Vault is the supported encrypted-secret
-- store: vault.create_secret(...) holds it, and vault.decrypted_secrets returns
-- the plaintext to a privileged (SECURITY DEFINER) reader.
--
-- The secret row is named 'push_internal_secret' and must equal the
-- PUSH_INTERNAL_SECRET function secret on the expo-push edge function. Stored
-- out-of-band (not in this migration). If the Vault row is absent the trigger
-- fails open (omits the header) exactly as before.
--
-- Non-destructive: CREATE OR REPLACE of one trigger function.

create or replace function public.notify_order_status_event()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_event   text;
  v_base    text;
  v_secret  text;
  v_headers jsonb;
begin
  v_event := case new.status
    when 'accepted'         then 'order_accepted'
    when 'ready'            then 'order_ready'
    when 'picked_up'        then 'order_picked_up'
    when 'out_for_delivery' then 'order_out_for_delivery'
    when 'delivered'        then 'order_delivered'
    else null
  end;
  if v_event is null then return new; end if;

  select value #>> '{}' into v_base
    from public.platform_settings where key = 'functions_base_url';
  if v_base is null or v_base = '' then return new; end if;

  -- [035 M4] Read the internal shared secret from Vault. Wrapped so a missing
  -- secret / no Vault access degrades to "no header" (fail open) rather than
  -- breaking the push fan-out. expo-push only enforces the header when its own
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

  perform net.http_post(
    url     := v_base || '/expo-push',
    body    := jsonb_build_object('event', v_event, 'orderId', new.order_id::text),
    headers := v_headers
  );
  return new;
exception when others then
  return new;
end;
$$;

comment on function public.notify_order_status_event is
  'AFTER INSERT on order_status_events: fans the status change out to the customer via pg_net -> expo-push. Sends x-internal-secret read from Vault (push_internal_secret) when present (M4). Best-effort; never blocks the order flow.';
