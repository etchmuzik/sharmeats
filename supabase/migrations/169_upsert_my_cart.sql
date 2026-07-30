-- 169_upsert_my_cart.sql
--
-- Package 02 Slice D — the only writer of public.customer_carts.
--
-- WHY A DEFINER RPC INSTEAD OF A DIRECT GRANT. See mig 168's header: version-
-- based optimistic concurrency only works if the client cannot choose the
-- version it writes. With a client UPDATE grant, a device could send any version
-- and silently clobber a newer cart from another device -- the exact collision
-- `version` exists to detect. So the client gets SELECT (RLS-scoped) for
-- restore, and this function owns every mutation and every version bump.
--
-- ================= THE CONCURRENCY CONTRACT =================
-- The caller sends the version it believes it is editing:
--   p_expected_version = 0     -> "I have no server cart" (first write)
--   p_expected_version = N > 0 -> "I am editing the row I last read at N"
--
-- Accepted iff the stored version matches (or no row exists and N = 0). On
-- mismatch it raises CART_VERSION_CONFLICT and writes nothing, so the client can
-- ask the customer which cart to keep. The refusal deliberately carries NO
-- information about the other cart's contents -- the client re-reads through its
-- own RLS-scoped SELECT for that, which keeps this function free of any
-- read-back path that could leak another user's row if the ownership check were
-- ever weakened.
--
-- The whole read-compare-write runs in one statement (INSERT .. ON CONFLICT ..
-- WHERE) rather than a SELECT then an UPDATE. Two concurrent writers from the
-- same account would otherwise both read version N, both see a match, and both
-- write N+1 -- losing one basket with no conflict reported. The single statement
-- makes the compare and the write atomic under the row lock.
--
-- ================= IDENTITY IS NEVER A PARAMETER =================
-- There is no p_user_id. The row written is always auth.uid()'s. A definer
-- function that accepts a user id is one typo away from letting any caller
-- overwrite any customer's cart (house rule: no client-supplied user ID through
-- a definer function without auth.uid() enforcement).
--
-- ================= NO PRICES, AND THE VERTICAL GATE =================
-- Items are stored identity-only; this function does not read menu_items at all,
-- so it cannot be used as a price or existence oracle. It deliberately does NOT
-- validate that the items exist or that the merchant is visible to this
-- customer, for two reasons:
--   1. Persisting a basket is not ordering one. prepare_cart (mig 145) and
--      place_order both re-check visibility and availability, and a restore
--      routes through prepare_cart -- so a cart naming a hidden merchant simply
--      fails to restore. Nothing is gained by refusing to *store* it.
--   2. Validating here would make this an existence oracle: "cart saved" vs
--      "merchant not found" would tell a caller which UUIDs are real, which is
--      exactly the leak mig 162 closed by collapsing VERTICAL_NOT_AVAILABLE
--      into MERCHANT_NOT_FOUND on the ordering paths.
-- The restaurant_id FK still guarantees the id references a real restaurant row;
-- whether the CUSTOMER may see it is decided at prepare/place time.

create or replace function public.upsert_my_cart(
  p_restaurant_id     uuid,
  p_items             jsonb,
  p_kitchen_notes     text,
  p_expected_version  bigint
)
returns table (
  version    bigint,
  updated_at timestamptz,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user uuid := auth.uid();
  v_line jsonb;
  v_qty  int;
  v_new  bigint;
  v_at   timestamptz;
  v_exp  timestamptz;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'INVALID_CART' using errcode = 'check_violation';
  end if;

  -- Same bound as prepare_cart (mig 145).
  if jsonb_array_length(p_items) > 100 then
    raise exception 'CART_TOO_LARGE' using errcode = 'check_violation';
  end if;

  if p_expected_version is null or p_expected_version < 0 then
    raise exception 'INVALID_CART' using errcode = 'check_violation';
  end if;

  -- A cart with lines must name its restaurant. Mirrors the table check, but
  -- raised here so the client gets a named error instead of a raw 23514.
  if jsonb_array_length(p_items) > 0 and p_restaurant_id is null then
    raise exception 'INVALID_CART' using errcode = 'check_violation';
  end if;

  -- Per-line shape validation. This is NOT menu validation (see the header);
  -- it only refuses values that could not be a cart line under any menu, so a
  -- malformed row can never reach prepare_cart on restore.
  for v_line in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_line) <> 'object' then
      raise exception 'INVALID_CART' using errcode = 'check_violation';
    end if;
    -- A non-uuid item_id raises 22P02 from the cast; catching it here turns
    -- that into the same named error the client already handles.
    begin
      if (v_line->>'item_id') is null or (v_line->>'item_id')::uuid is null then
        raise exception 'INVALID_CART' using errcode = 'check_violation';
      end if;
    exception when invalid_text_representation then
      raise exception 'INVALID_CART' using errcode = 'check_violation';
    end;

    v_qty := coalesce((v_line->>'quantity')::int, 0);
    if v_qty < 1 or v_qty > 99 then
      raise exception 'INVALID_CART' using errcode = 'check_violation';
    end if;

    if v_line ? 'modifier_option_ids'
       and jsonb_typeof(v_line->'modifier_option_ids') <> 'array' then
      raise exception 'INVALID_CART' using errcode = 'check_violation';
    end if;

    -- Bound the per-line note the same way the table bounds kitchen_notes; an
    -- unbounded note array is the other cheap way to inflate this row.
    if length(coalesce(v_line->>'notes', '')) > 500 then
      raise exception 'INVALID_CART' using errcode = 'check_violation';
    end if;
  end loop;

  -- ONE STATEMENT, so the version compare and the write are atomic. The WHERE
  -- on the DO UPDATE branch is the concurrency check: it fires only when the
  -- stored version is the one the caller expected.
  insert into public.customer_carts as c
    (user_id, restaurant_id, items, kitchen_notes, version, updated_at, expires_at)
  values
    (v_user, p_restaurant_id, p_items, nullif(btrim(coalesce(p_kitchen_notes, '')), ''),
     1, now(), now() + interval '30 days')
  on conflict (user_id) do update
     set restaurant_id = excluded.restaurant_id,
         items         = excluded.items,
         kitchen_notes = excluded.kitchen_notes,
         version       = c.version + 1,
         updated_at    = now(),
         -- Every accepted write extends the life of an actively-edited cart.
         expires_at    = now() + interval '30 days'
   where c.version = p_expected_version
  returning c.version, c.updated_at, c.expires_at
       into v_new, v_at, v_exp;

  -- No row returned means one of two things, and they are NOT the same:
  --   * the ON CONFLICT branch was skipped by the WHERE -> a real version
  --     conflict, another device wrote first;
  --   * p_expected_version > 0 but no row exists at all -> the caller thinks it
  --     is editing a cart that has since been deleted (TTL cleanup, account
  --     reset). That is also a conflict from the client's point of view: its
  --     assumption about server state was wrong, and the app should re-read.
  -- Both therefore raise the same code; the client's response (re-read, ask the
  -- customer) is identical.
  if v_new is null then
    raise exception 'CART_VERSION_CONFLICT' using errcode = 'check_violation';
  end if;

  version    := v_new;
  updated_at := v_at;
  expires_at := v_exp;
  return next;
end;
$function$;

-- Granting to `authenticated` does NOT revoke the default PUBLIC/anon EXECUTE
-- that ALTER DEFAULT PRIVILEGES hands out on this database (house rule 3).
revoke all on function public.upsert_my_cart(uuid, jsonb, text, bigint) from public, anon;
grant execute on function public.upsert_my_cart(uuid, jsonb, text, bigint) to authenticated;

comment on function public.upsert_my_cart(uuid, jsonb, text, bigint) is
  'Package 02 Slice D. The ONLY writer of customer_carts: clients hold SELECT but no write grant, because version-based optimistic concurrency requires that the client not choose its own version. Writes auth.uid()''s row only — identity is never a parameter. Refuses a stale or absent-row write with CART_VERSION_CONFLICT and writes nothing, so the app can ask the customer which cart to keep. Stores identity-only lines and reads no menu data, so it is neither a price nor an existence oracle; visibility and availability are decided later by prepare_cart (mig 145) and place_order. Mig 169.';

-- ---------------------------------------------------------------------------
-- Explicit clear (order placed, or the customer emptied the basket)
-- ---------------------------------------------------------------------------
-- A separate function rather than "upsert an empty cart" because the two mean
-- different things: an empty cart is still an active row whose version keeps
-- advancing, while a clear retires it. Retiring the row means the next device
-- to sync starts from version 0 with no conflict to resolve, which is the
-- correct outcome after a placed order.
--
-- No version parameter: clearing is idempotent and never needs to lose a race.
-- A retry, or two devices both clearing after the same placement, must both
-- succeed quietly.
create or replace function public.clear_my_cart()
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;
  delete from public.customer_carts where user_id = v_user;
end;
$function$;

revoke all on function public.clear_my_cart() from public, anon;
grant execute on function public.clear_my_cart() to authenticated;

comment on function public.clear_my_cart() is
  'Package 02 Slice D. Retires the caller''s server cart after a confirmed order placement or an explicit empty. Deliberately versionless and idempotent: a retry, or two devices clearing after the same placement, must both succeed quietly. Retiring the row (rather than storing an empty cart) means the next device syncs from version 0 with no conflict to resolve. Sign-out must NOT call this — the account''s cart should survive to the next sign-in. Mig 169.';
