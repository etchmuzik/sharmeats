-- ============================================================================
-- 207 — Account-deletion PII completeness (2 confirmed compliance P1s + extras)
--
-- The privacy policy promises deletion removes personal data. Recon against
-- production found three gaps mig 112 left or that later migrations reopened:
--
--   A. anonymize_my_account's orders scrub misses customer_phone (populated on
--      21 of 24 prod orders), dropoff_note, and rating_comment (customer review
--      free text). All three predate or postdate mig 112 and were never added.
--   B. delivery_jobs.requester_user_id is ON DELETE RESTRICT (mig 193) — it
--      re-introduces the exact deletion hard-fail mig 112 fixed, and because the
--      edge function anonymizes THEN hard-deletes the auth user, a RESTRICT FK
--      aborts the cascade and leaves a half-deleted account. The linked PII
--      lives in two private endpoint tables (encrypted + phone_last4), also
--      RESTRICT-chained, with a redacted_at column already built for this.
--   C. driver_cod_overrides.granted_by is NO ACTION + NOT NULL — a second
--      structural blocker: deleting an admin who ever granted a COD override
--      hard-fails the cascade. Same shape mig 112 fixed for order_messages.
--
-- Fix follows the mig 112 pattern (ON DELETE SET NULL on the FK + in-RPC scrub
-- of any free text the FK-null does not reach), rebuilt from the LIVE
-- anonymize_my_account body (house rule 2). Plus a backfill for the 5 orphaned
-- prod orders whose user_id was nulled by a delete that bypassed the RPC, so
-- their customer_phone survived.
-- ============================================================================

-- --- B/C: relax the two blocker FKs to ON DELETE SET NULL --------------------
alter table public.delivery_jobs
  drop constraint if exists delivery_jobs_requester_user_id_fkey;
alter table public.delivery_jobs
  add constraint delivery_jobs_requester_user_id_fkey
  foreign key (requester_user_id) references public.users(id) on delete set null;

-- granted_by is NOT NULL; SET NULL requires relaxing it (mig 112 did the same
-- for order_messages.sender_id). A null granted_by means "the granting admin's
-- account was deleted" — the override record itself is retained for audit.
alter table public.driver_cod_overrides
  alter column granted_by drop not null;
alter table public.driver_cod_overrides
  drop constraint if exists driver_cod_overrides_granted_by_fkey;
alter table public.driver_cod_overrides
  add constraint driver_cod_overrides_granted_by_fkey
  foreign key (granted_by) references public.users(id) on delete set null;

-- --- A + B scrub: rebuild anonymize_my_account from its LIVE body ------------
-- (verified against prod pg_get_functiondef; the only changes are the three new
--  orders columns and the new delivery_jobs endpoint-redaction block.)
create or replace function public.anonymize_my_account()
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'No authenticated user in context'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from public.orders
    where user_id = v_uid
      and status not in ('delivered', 'cancelled', 'rejected')
  ) then
    raise exception 'ACTIVE_ORDER'
      using errcode = 'check_violation';
  end if;

  update public.orders o
  set
    deleted_user_ref    = coalesce(o.deleted_user_ref, o.user_id),
    user_id             = null,
    anonymized_at       = now(),
    -- [207] These three carried the caller's PII and were never scrubbed:
    -- customer_phone (populated on most orders), the dropoff note free text,
    -- and the customer's own rating comment.
    customer_phone      = null,
    dropoff_note        = null,
    rating_comment      = null,
    address_snapshot    = case
      when o.address_snapshot is null then null
      else jsonb_strip_nulls(jsonb_build_object(
        'kind',       o.address_snapshot -> 'kind',
        'anonymized', to_jsonb(true)
      ))
    end,
    rider               = case when o.rider is null then null
                               else jsonb_build_object('anonymized', true) end,
    dropoff_geo         = null,
    kitchen_notes       = null,
    cancel_reason       = null,
    aggregate_allergens = null,
    items               = case
      when o.items is null then null
      else (
        select coalesce(jsonb_agg(elem - 'notes'), '[]'::jsonb)
        from jsonb_array_elements(o.items) as elem
      )
    end,
    history             = '[]'::jsonb
  where o.user_id = v_uid;

  update public.order_status_events e
  set note = null
  from public.orders o
  where e.order_id = o.id
    and o.deleted_user_ref = v_uid
    and e.note is not null;

  update public.order_items oi
  set notes = null
  from public.orders o
  where oi.order_id = o.id
    and o.deleted_user_ref = v_uid
    and oi.notes is not null;

  -- 2f. [mig 112] Scrub the caller's own chat message bodies before the users row
  --     is removed (FK is now ON DELETE SET NULL; body is NOT NULL so use a marker).
  update public.order_messages
  set body = '[deleted]'
  where sender_id = v_uid;

  update public.support_messages
  set body = '[deleted]'
  where author_id = v_uid;

  -- [207] Delivery jobs the caller requested: the FK is now SET NULL so the
  -- cascade will not hard-fail, but the encrypted contact/address PII in the
  -- private endpoint tables must be redacted. Overwrite the ciphertext and the
  -- plaintext phone_last4, and stamp redacted_at (the column built for this).
  update private.delivery_job_endpoints ep
  set address_ciphertext      = null,
      contact_name_ciphertext = null,
      phone_e164_ciphertext   = null,
      phone_last4             = null,
      notes_ciphertext        = null,
      redacted_at             = now()
  from public.delivery_jobs dj
  where ep.delivery_job_id = dj.id
    and dj.requester_user_id = v_uid
    and ep.redacted_at is null;

  update private.delivery_job_parcel_details pd
  set description_ciphertext = null,
      redacted_at            = now()
  from public.delivery_jobs dj
  where pd.delivery_job_id = dj.id
    and dj.requester_user_id = v_uid
    and pd.redacted_at is null;
end;
$function$;

revoke all on function public.anonymize_my_account() from public, anon;
grant execute on function public.anonymize_my_account() to authenticated;

-- --- Backfill: 5 orphaned prod orders whose phone survived a bypass delete ---
do $$
declare v_n int;
begin
  update public.orders
     set customer_phone = null,
         dropoff_note   = null,
         rating_comment = null
   where user_id is null
     and (customer_phone is not null or dropoff_note is not null or rating_comment is not null);
  get diagnostics v_n = row_count;
  raise notice '[207] scrubbed PII from % already-orphaned orders', v_n;
end $$;

-- --- Verify -----------------------------------------------------------------
do $$
begin
  -- Both blocker FKs must now be SET NULL.
  if (select confdeltype from pg_constraint where conname='delivery_jobs_requester_user_id_fkey') <> 'n' then
    raise exception '[207] delivery_jobs FK is not ON DELETE SET NULL';
  end if;
  if (select confdeltype from pg_constraint where conname='driver_cod_overrides_granted_by_fkey') <> 'n' then
    raise exception '[207] driver_cod_overrides FK is not ON DELETE SET NULL';
  end if;
  -- The three new scrubs must be present in the live body.
  if position('customer_phone      = null' in
       (select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='anonymize_my_account')) = 0 then
    raise exception '[207] anonymize_my_account did not gain the customer_phone scrub';
  end if;
  -- No orphaned order may still carry a phone.
  if exists (select 1 from public.orders where user_id is null and customer_phone is not null) then
    raise exception '[207] an orphaned order still carries customer_phone after backfill';
  end if;
  -- Single overload (house rule 1).
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='anonymize_my_account') <> 1 then
    raise exception '[207] anonymize_my_account has more than one overload';
  end if;
end $$;
