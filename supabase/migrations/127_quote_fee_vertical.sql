-- 127_quote_fee_vertical.sql
--
-- Fix: quote_delivery_fee hardcoded vertical_id = 'food', so a fee rule for
-- any other vertical could never fire (docs/VERTICALS-ROADMAP.md Phase 0 item
-- 1 — a live bug, not a feature). Resolve the merchant's actual vertical_id
-- and prefer a (zone, that-vertical) rule, falling back to the zone's
-- NULL-vertical rule, exactly as the delivery_fee_rules unique index
-- (zone_id, coalesce(vertical_id,'')) was designed for (mig 010).
--
-- Body taken from PRODUCTION via pg_get_functiondef (house rule 2 — the repo
-- is not the source of truth for bodies), one change: the vertical
-- resolution. Signature UNCHANGED (uuid, geography, integer default 0) ->
-- CREATE OR REPLACE cannot create a second overload (house rule 1), and the
-- existing ACL is preserved untouched — this function is on the guest
-- checkout quoting path, so grants are deliberately not restated here.
--
-- Standalone, additive, idempotent. No binary coupling. Rollback: re-apply
-- the previous body (prod dump archived in this file's git history).

create or replace function public.quote_delivery_fee(p_restaurant_id uuid, p_dropoff geography, p_subtotal integer default 0)
returns integer
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_zone     zone_type;
  v_vertical text;
  v_rule     public.delivery_fee_rules;
  v_fee      int;
begin
  v_zone := public.resolve_zone_nearest(p_dropoff);

  -- [127] The merchant's actual vertical, not a hardcoded 'food'. coalesce is
  -- belt-and-braces: restaurants.vertical_id defaults 'food' and was
  -- backfilled in mig 006, but a NULL must not turn the preference filter off.
  select coalesce(r.vertical_id, 'food') into v_vertical
    from public.restaurants r where r.id = p_restaurant_id;
  v_vertical := coalesce(v_vertical, 'food');  -- merchant not found -> behave as before

  -- Prefer a (zone, merchant-vertical) rule; fall back to (zone, null vertical).
  select * into v_rule from public.delivery_fee_rules
   where zone_id = v_zone and (vertical_id = v_vertical or vertical_id is null)
   order by vertical_id nulls last
   limit 1;

  if not found then
    return 30;  -- safe default if no rule configured
  end if;

  -- MVP: flat base (per_km_fee defaults 0). Free over threshold honored.
  if v_rule.free_over is not null and p_subtotal >= v_rule.free_over then
    return 0;
  end if;
  v_fee := greatest(v_rule.base_fee, v_rule.min_fee);
  return v_fee;
end;
$function$;

comment on function public.quote_delivery_fee(uuid, geography, integer) is
  'Delivery fee quote for a merchant + dropoff. Vertical-aware since mig 127: prefers the (zone, merchant vertical) rule, falls back to the zone''s NULL-vertical rule, then a 30 EGP default. Called by place_order and checkout preview.';
