-- 145_prepare_cart.sql
--
-- Package 02 Slice A — server-authoritative cart preparation.
--
-- THE PROBLEM. One-tap reorder loads a PAST order's lines into the cart. Menus
-- change, so the customer could see a stale basket all the way to checkout and
-- only discover it at the final tap, where place_order recomputes every price
-- and raises on the first problem. Commit ec68934 added a CLIENT-side
-- reconciliation (src/lib/reorderCheck.ts) which fixed the visible symptom, but
-- it can only see what that client happened to fetch: it cannot check whether
-- the restaurant is open, whether the basket still clears the minimum order, or
-- whether a modifier option has moved to a different item.
--
-- This RPC answers those questions from the same tables place_order reads.
--
-- ADVISORY, NEVER AUTHORITATIVE. Two rules keep this safe:
--   1. It must never be STRICTER than place_order, or it blocks carts that
--      would actually have succeeded.
--   2. It must never be LOOSER, or it promises a cart that fails at checkout.
-- So every per-line decision below mirrors the deployed place_order body
-- (fetched with pg_get_functiondef on 2026-07-27) -- it just COLLECTS issues
-- instead of raising on the first one. place_order still revalidates
-- everything; nothing here is trusted at placement, and no price computed here
-- is ever sent back by the client.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--   * no stock reservation and no order creation -- it is a read;
--   * no delivery fee or total: those need an address, and quoting money the
--     customer has not committed to invites the client to echo it back. Only a
--     SUBTOTAL is returned, for display beside the live prices;
--   * no promo evaluation, for the same reason.
--
-- MIRRORED FROM place_order, PER LINE, IN ORDER:
--   qty < 1                                  -> INVALID_QTY
--   item not found for THIS restaurant       -> ITEM_NOT_FOUND
--   item.is_available = false                -> ITEM_UNAVAILABLE
--   option not joined to this item           -> silently dropped by place_order
--                                               (the join is `m.item_id =
--                                               v_item.id`), so it is reported
--                                               here as MODIFIER_GONE rather
--                                               than failing the line
--
-- REQUIRED_MODIFIER_MISSING is reported but is NOT a blocking issue, because
-- place_order does not enforce `modifiers.required` today (verified: zero
-- references in the deployed body, and zero required modifiers exist in
-- production). Reporting it lets the UI prompt; treating it as blocking would
-- make preparation stricter than placement, which rule 1 forbids.

create or replace function public.prepare_cart(
  p_restaurant_id uuid,
  p_cart jsonb
)
returns table (
  restaurant_id uuid,
  restaurant_open boolean,
  minimum_order_egp integer,
  prepared_items jsonb,
  issues jsonb,
  subtotal_egp integer
)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user     uuid := auth.uid();
  v_rest     public.restaurants;
  v_line     jsonb;
  v_item     public.menu_items;
  v_opt_ids  uuid[];
  v_mod_delta int;
  v_mods_snap jsonb;
  v_kept_ids uuid[];
  v_qty      int;
  v_idx      int := -1;
  v_line_total int;
  v_subtotal int := 0;
  v_items    jsonb := '[]'::jsonb;
  v_issues   jsonb := '[]'::jsonb;
  v_missing_required text[];
begin
  -- Authenticated callers only. This reads menu data that is otherwise public,
  -- but an unauthenticated caller has no cart to prepare, and requiring a
  -- session keeps the surface consistent with place_order.
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;

  if p_cart is null or jsonb_typeof(p_cart) <> 'array' then
    raise exception 'EMPTY_CART' using errcode = 'check_violation';
  end if;

  -- A basket is capped to keep this bounded: an unbounded array from a client
  -- is a cheap way to make the server do arbitrary work.
  if jsonb_array_length(p_cart) > 100 then
    raise exception 'CART_TOO_LARGE' using errcode = 'check_violation';
  end if;

  select * into v_rest from public.restaurants where restaurants.id = p_restaurant_id;
  if not found then
    raise exception 'MERCHANT_NOT_FOUND' using errcode = 'check_violation';
  end if;

  for v_line in select * from jsonb_array_elements(p_cart) loop
    v_idx := v_idx + 1;
    v_qty := coalesce((v_line->>'quantity')::int, 0);

    -- place_order raises INVALID_QTY here. Report and skip: the customer can
    -- fix a quantity, and failing the whole basket over one bad line would
    -- hide every other problem in it.
    if v_qty < 1 or v_qty > 99 then
      v_issues := v_issues || jsonb_build_object(
        'code', 'INVALID_QTY', 'index', v_idx,
        'itemId', v_line->>'item_id');
      continue;
    end if;

    -- `restaurant_id = p_restaurant_id` is the cross-restaurant guard: an item
    -- id from another merchant simply does not match, exactly as in place_order.
    select * into v_item
      from public.menu_items
     where menu_items.id = (v_line->>'item_id')::uuid
       and menu_items.restaurant_id = p_restaurant_id;

    if not found then
      v_issues := v_issues || jsonb_build_object(
        'code', 'ITEM_NOT_FOUND', 'index', v_idx,
        'itemId', v_line->>'item_id');
      continue;
    end if;

    if not v_item.is_available then
      v_issues := v_issues || jsonb_build_object(
        'code', 'ITEM_UNAVAILABLE', 'index', v_idx,
        'itemId', v_item.id, 'name', v_item.name);
      continue;
    end if;

    v_opt_ids := coalesce(
      (select array_agg((x)::uuid)
         from jsonb_array_elements_text(coalesce(v_line->'modifier_option_ids', '[]'::jsonb)) as x),
      '{}'::uuid[]);

    -- Identical join to place_order: an option whose modifier belongs to a
    -- DIFFERENT item is not matched, so it contributes no price and vanishes.
    -- place_order does that silently; here it becomes a reported issue.
    select coalesce(sum(mo.price_delta_egp), 0),
           coalesce(jsonb_agg(jsonb_build_object(
             'optionId', mo.id, 'modifierId', m.id,
             'modifierName', m.name, 'optionName', mo.name,
             'priceDeltaEgp', mo.price_delta_egp) order by mo.sort_order), '[]'::jsonb),
           coalesce(array_agg(mo.id), '{}'::uuid[])
      into v_mod_delta, v_mods_snap, v_kept_ids
      from public.modifier_options mo
      join public.modifiers m on m.id = mo.modifier_id
     where mo.id = any(v_opt_ids) and m.item_id = v_item.id;

    if array_length(v_opt_ids, 1) is distinct from array_length(v_kept_ids, 1) then
      v_issues := v_issues || jsonb_build_object(
        'code', 'MODIFIER_GONE', 'index', v_idx,
        'itemId', v_item.id, 'name', v_item.name);
    end if;

    -- Required modifiers with nothing selected. Reported, never blocking --
    -- see the header note: place_order does not enforce this, and preparation
    -- must not be stricter than placement.
    select coalesce(array_agg(m.name order by m.sort_order), '{}'::text[])
      into v_missing_required
      from public.modifiers m
     where m.item_id = v_item.id
       and m.required
       and not exists (
         select 1 from public.modifier_options mo2
          where mo2.modifier_id = m.id and mo2.id = any(v_kept_ids));

    if array_length(v_missing_required, 1) > 0 then
      v_issues := v_issues || jsonb_build_object(
        'code', 'REQUIRED_MODIFIER_MISSING', 'index', v_idx,
        'itemId', v_item.id, 'name', v_item.name,
        'modifiers', to_jsonb(v_missing_required));
    end if;

    v_line_total := (v_item.price_egp + coalesce(v_mod_delta, 0)) * v_qty;
    v_subtotal := v_subtotal + v_line_total;

    -- Display fields come from the LIVE item, so a renamed dish or new photo is
    -- not shown as last month's version. quantity and notes are the customer's
    -- own input and are passed through untouched.
    v_items := v_items || jsonb_build_object(
      'index', v_idx,
      'itemId', v_item.id,
      'name', v_item.name,
      'image', v_item.image,
      'unitPriceEgp', v_item.price_egp,
      'quantity', v_qty,
      'modifierChoices', v_mods_snap,
      'lineTotalEgp', v_line_total,
      'notes', v_line->>'notes');
  end loop;

  -- Restaurant-level state the client could not check for itself. Reported as
  -- fields rather than issues: they describe the STORE, not a line, and the UI
  -- shows the prepared basket either way (the spec asks for a viewable cart
  -- with checkout blocked when closed).
  restaurant_id     := v_rest.id;
  restaurant_open   := v_rest.is_active and v_rest.is_open;
  minimum_order_egp := greatest(0, coalesce(v_rest.min_order_egp, 0));
  prepared_items    := v_items;
  issues            := v_issues;
  subtotal_egp      := v_subtotal;
  return next;
end;
$function$;

-- Granting to `authenticated` does NOT revoke the default PUBLIC/anon EXECUTE
-- that ALTER DEFAULT PRIVILEGES hands out on this database (house rule 3).
revoke all on function public.prepare_cart(uuid, jsonb) from public, anon;
grant execute on function public.prepare_cart(uuid, jsonb) to authenticated;

comment on function public.prepare_cart(uuid, jsonb) is
  'Package 02 Slice A. Reconciles a proposed cart (past order, saved preset or restored cart) against the CURRENT menu and returns live prices, a display subtotal and a bounded issue list. Advisory only: it mirrors place_order''s per-line validation exactly but collects issues instead of raising, and place_order still revalidates everything at placement. Deliberately returns no delivery fee, promo or total -- money the customer has not committed to should not be quoted back by the client. REQUIRED_MODIFIER_MISSING is reported but non-blocking because place_order does not enforce modifiers.required. Mig 145.';
