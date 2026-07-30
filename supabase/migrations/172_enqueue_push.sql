-- 172_enqueue_push.sql
--
-- Package 03 Slice C — the enqueue entry point every DB sender calls.
--
-- ================= WHY A FUNCTION AND NOT AN INSERT =================
-- Fifteen senders will call this. If each wrote its own INSERT, then every future
-- change to the outbox contract -- a new column, a different default expiry, a
-- changed suppression vocabulary -- would mean editing fifteen SECURITY DEFINER
-- bodies. That is precisely the hazard house rule 2 exists to prevent, and it is
-- how migration 138's `transactional` flag came to be honoured in one place and
-- ignored in fourteen others.
--
-- So the contract lives here, once.
--
-- ================= IDEMPOTENT BY CONSTRUCTION =================
-- ON CONFLICT (idempotency_key) DO NOTHING. A trigger that fires twice for the
-- same transition enqueues once. The function returns the message id either way,
-- so a caller cannot tell (and should not care) whether it won the race.
--
-- RETURNS NULL only when the caller passed no key, which is a programming error
-- rather than a runtime condition -- an unkeyed message could be enqueued
-- unboundedly by a retrying trigger.
--
-- ================= IT MUST NEVER RAISE =================
-- Every caller is a trigger or an RPC inside an order/financial transaction.
-- Those already guard themselves with `exception when others`, but relying on a
-- caller's guard to protect the caller's own transaction is fragile: one sender
-- written later without a guard would make a notification bug able to roll back
-- an order. So this swallows its own failures and returns null. A lost enqueue is
-- a missed notification; a raised exception could be a lost order.
--
-- ================= EXPIRY IS PER-EVENT =================
-- A default 6-hour window is wrong for both extremes. "Your driver is arriving"
-- is worthless after 20 minutes; a settlement notice is still worth sending
-- tomorrow. The caller passes p_expires_in, and the DEFAULTS below encode the
-- per-event judgement so that fifteen callers do not each invent one.

create or replace function public.enqueue_push(
  p_event              text,
  p_order_id           uuid    default null,
  p_recipient_user_ids uuid[]  default null,
  p_idempotency_key    text    default null,
  p_route              text    default null,
  p_vertical           text    default null,
  p_category           text    default 'operational',
  p_custom_title       text    default null,
  p_custom_body        text    default null,
  p_campaign_id        uuid    default null,
  p_expires_in         interval default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_id      uuid;
  v_expires interval;
begin
  if p_event is null or btrim(p_event) = '' then
    return null;
  end if;
  -- An unkeyed message could be enqueued without bound by a retrying trigger,
  -- which is the failure mode this whole table exists to avoid.
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    return null;
  end if;

  -- Per-event send window. These are judgements, not arbitrary: the first group
  -- is worthless if late, the last is still useful tomorrow.
  v_expires := coalesce(
    p_expires_in,
    case p_event
      when 'order_out_for_delivery' then interval '30 minutes'
      when 'order_picked_up'        then interval '30 minutes'
      when 'driver_assigned'        then interval '30 minutes'
      when 'new_offer'              then interval '10 minutes'
      when 'order_ready'            then interval '1 hour'
      when 'order_ready_pickup'     then interval '1 hour'
      when 'order_placed_merchant'  then interval '1 hour'
      -- Money and account state stay valuable for a long time.
      when 'settlement_paid'        then interval '7 days'
      when 'settlement_finalized'   then interval '7 days'
      when 'credit_issued'          then interval '7 days'
      when 'payment_failed'         then interval '1 day'
      when 'kyc_approved'           then interval '7 days'
      when 'kyc_rejected'           then interval '7 days'
      when 'kyc_submitted'          then interval '7 days'
      when 'campaign'               then interval '1 day'
      else interval '6 hours'
    end);

  insert into public.push_messages (
    event, order_id, recipient_user_ids, campaign_id, route, vertical,
    custom_title, custom_body, category, idempotency_key, expires_at
  ) values (
    btrim(p_event),
    p_order_id,
    -- An empty array is not the same as "no hint": it would mean "send to
    -- nobody". Normalise it to null so the dispatcher resolves recipients.
    case when p_recipient_user_ids is null or cardinality(p_recipient_user_ids) = 0
         then null else p_recipient_user_ids end,
    p_campaign_id,
    nullif(btrim(coalesce(p_route, '')), ''),
    nullif(btrim(lower(coalesce(p_vertical, ''))), ''),
    nullif(btrim(coalesce(p_custom_title, '')), ''),
    nullif(btrim(coalesce(p_custom_body, '')), ''),
    case when p_category = 'marketing' then 'marketing' else 'operational' end,
    btrim(p_idempotency_key),
    now() + v_expires
  )
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  -- Lost the race, or a duplicate trigger fire. Return the EXISTING id so the
  -- caller sees a successful enqueue either way.
  if v_id is null then
    select id into v_id from public.push_messages
     where idempotency_key = btrim(p_idempotency_key);
  end if;

  return v_id;
exception when others then
  -- See the header: a notification bug must never be able to roll back an order.
  -- Deliberately a warning, not a re-raise. It lands in the Postgres log where
  -- an operator can find it without any customer-facing consequence.
  raise warning 'enqueue_push(%) failed: %', p_event, sqlerrm;
  return null;
end;
$function$;

-- Callable only by the definer senders (which run as their own owner) and the
-- service role. Granting to `authenticated` does NOT revoke the default
-- PUBLIC/anon EXECUTE this database hands out (house rule 3), so revoke first.
revoke all on function public.enqueue_push(text, uuid, uuid[], text, text, text, text, text, text, uuid, interval)
  from public, anon, authenticated;

comment on function public.enqueue_push(text, uuid, uuid[], text, text, text, text, text, text, uuid, interval) is
  'Package 03 Slice C. The single enqueue contract for all 15 DB push senders — one place, so a future change to the outbox does not mean editing fifteen SECURITY DEFINER bodies (the hazard that left mig 138''s `transactional` flag honoured in one sender and ignored in fourteen). Idempotent via ON CONFLICT on idempotency_key, returning the existing id when it loses the race. NEVER raises: every caller sits inside an order or financial transaction, and a missed notification must never be able to roll back an order — failures become a warning and a null return. Per-event expiry defaults encode how long each event stays worth sending. Not executable by anon or authenticated. Mig 172.';
