-- Stop the anon key from reading merchant banking details and commission rates.
--
-- THE LEAK, verified live against production on 2026-08-17 before this migration:
--
--   GET /rest/v1/restaurants?select=name,payout_iban,payout_wallet,payout_holder,
--       commission_pct&is_active=eq.true
--
-- with nothing but the publishable anon key returned a row per active merchant.
-- RLS did not stop it and was never going to: `restaurants_read` (mig 153) is
-- written to expose every active, visible merchant to everyone — that is the
-- storefront. RLS answers "which rows", and the answer here is correctly "all of
-- them". Which COLUMNS come back is an ACL question, and the ACL said "all of
-- them" too, because migration 20260815044240 rebuilt the allow-list from the
-- clients' observed behaviour and the customer app asks for `select('*')`.
--
-- Right now every payout_* value in production is NULL — no merchant has entered
-- banking details yet — so this is being closed before it discloses anything
-- rather than after. commission_pct is already populated (12% and 15%), and a
-- merchant's negotiated rate is not public information.
--
-- WHY COLUMN GRANTS AND NOT A SEPARATE TABLE. Splitting payout_* into a
-- merchant_payout_details table is the tidier schema, but it is a data migration
-- against a live table plus a rewrite of the onboarding RPC, for a set of columns
-- that today hold nothing. PostgreSQL column-level SELECT grants close the same
-- hole with no data movement and no client rewrite. If payout data later needs
-- its own audit trail or encryption, the table split is still available and this
-- migration does not make it harder.
--
-- WHAT BREAKS IF THIS IS WRONG: `select('*')` fails outright when the caller
-- lacks SELECT on even one column of the table — PostgREST expands `*` to every
-- column. The customer app uses `select('*')` in all four of its restaurant
-- reads, so this migration is paired with a commit that pins those to the 25
-- columns rowToRestaurant actually consumes. Apply the two together, in that
-- order: clients first (they work under both ACLs), then this.

-- ---------------------------------------------------------------------------
-- 1. The sensitive column set
-- ---------------------------------------------------------------------------
-- payout_*            merchant banking identity. Written only through the
--                     submit_merchant_application RPC (SECURITY DEFINER), never
--                     read by any client — verified by grepping every surface.
-- commission_pct      the platform's negotiated rate with this merchant. Read by
--                     merchant/restaurant apps ONLY via the my_restaurant_tier
--                     RPC, which is owner-scoped, and by admin-web's founding
--                     rate report RPC. No client reads it off the table.
-- place_id            Google Places identifier, operational not public.
-- terms_version /
-- terms_accepted_at   contractual acceptance record.
-- founding_rate_until pricing-agreement expiry.
--
-- onboarding_status and onboarding_rejection_reason are deliberately NOT in this
-- list: admin-web reads them directly off the table for the onboarding queue,
-- and merchant-web reads them through an embedded join so a merchant can see
-- their own application state. Both callers are `authenticated`.

-- ---------------------------------------------------------------------------
-- 2. anon: revoke table-wide SELECT, re-grant only the storefront columns
-- ---------------------------------------------------------------------------
-- A table-level grant cannot be narrowed by adding column grants beside it — the
-- broad grant keeps winning — so the table-level SELECT must go first.
revoke select on table public.restaurants from anon;

grant select (
  id, slug, name, description,
  cuisines, cuisine_label, cover_image, logo, logo_url,
  zone, geo, distance_meters,
  rating, rating_count,
  prep_time_low, prep_time_high, busy_until, busy_extra_minutes,
  delivery_fee_egp, min_order_egp,
  tourist_safe, is_open, is_open_24h, featured, promo, is_active,
  accepts_cash, accepts_card,
  phone, address, website,
  vertical_id, fulfillment_type, merchant_type, kitchen_id,
  onboarding_status,
  created_at, updated_at
) on table public.restaurants to anon;

-- ---------------------------------------------------------------------------
-- 3. authenticated: same storefront set, plus what the admin queue reads
-- ---------------------------------------------------------------------------
revoke select on table public.restaurants from authenticated;

grant select (
  id, slug, name, description,
  cuisines, cuisine_label, cover_image, logo, logo_url,
  zone, geo, distance_meters,
  rating, rating_count,
  prep_time_low, prep_time_high, busy_until, busy_extra_minutes,
  delivery_fee_egp, min_order_egp,
  tourist_safe, is_open, is_open_24h, featured, promo, is_active,
  accepts_cash, accepts_card,
  phone, address, website,
  vertical_id, fulfillment_type, merchant_type, kitchen_id,
  onboarding_status, onboarding_rejection_reason,
  commission_pct,
  created_at, updated_at
) on table public.restaurants to authenticated;

-- commission_pct stays readable by `authenticated` because admin-web's
-- onboarding queue selects it directly. RLS still decides WHICH rows: mig 153's
-- restaurants_read exposes active merchants, and a merchant seeing its own
-- commission is expected. What this migration removes is a merchant (or anyone
-- with the anon key) reading ANOTHER merchant's banking details.

-- ---------------------------------------------------------------------------
-- 4. service_role keeps its existing narrow grant
-- ---------------------------------------------------------------------------
-- Migration 20260815044240 granted service_role SELECT for scripts/import-menu.mjs.
-- That is a server-side operator tool holding the service key; it is untouched
-- here. The UPDATE column grants from 217 (is_open, payout_*, logo_url) are also
-- untouched — a merchant editing its OWN payout details through the onboarding
-- RPC still works; it simply cannot read them back off the table, which no code
-- does.

-- ---------------------------------------------------------------------------
-- 5. Assertions
-- ---------------------------------------------------------------------------
do $$
declare
  v_col text;
begin
  -- The whole point: no client role may read banking identity or pricing terms.
  foreach v_col in array array[
    'payout_method','payout_bank_name','payout_iban','payout_wallet','payout_holder',
    'place_id','terms_version','terms_accepted_at','founding_rate_until'
  ]
  loop
    if has_column_privilege('anon', 'public.restaurants', v_col, 'SELECT') then
      raise exception '[218] anon can still read restaurants.%', v_col;
    end if;
    if has_column_privilege('authenticated', 'public.restaurants', v_col, 'SELECT') then
      raise exception '[218] authenticated can still read restaurants.%', v_col;
    end if;
  end loop;

  -- commission_pct: closed to anon, open to authenticated (admin onboarding queue).
  if has_column_privilege('anon', 'public.restaurants', 'commission_pct', 'SELECT') then
    raise exception '[218] anon can still read restaurants.commission_pct';
  end if;
  if not has_column_privilege('authenticated', 'public.restaurants', 'commission_pct', 'SELECT') then
    raise exception '[218] admin onboarding queue lost commission_pct';
  end if;

  -- The storefront must keep working for a signed-out browser.
  foreach v_col in array array[
    'id','slug','name','cover_image','logo_url','rating','delivery_fee_egp',
    'min_order_egp','is_open','zone','vertical_id','prep_time_high'
  ]
  loop
    if not has_column_privilege('anon', 'public.restaurants', v_col, 'SELECT') then
      raise exception '[218] storefront lost anon SELECT on restaurants.%', v_col;
    end if;
  end loop;

  -- Writes are unchanged: the onboarding RPC and merchant self-service still work.
  if not has_column_privilege('authenticated', 'public.restaurants', 'payout_iban', 'UPDATE') then
    raise exception '[218] merchant lost the ability to WRITE its own payout_iban';
  end if;
  if not has_column_privilege('authenticated', 'public.restaurants', 'is_open', 'UPDATE') then
    raise exception '[218] merchant lost the ability to toggle is_open';
  end if;
end;
$$;

comment on column public.restaurants.payout_iban is
  'Merchant bank IBAN. NOT readable by anon or authenticated (mig 218) — written through submit_merchant_application and read only by service-role finance tooling.';
comment on column public.restaurants.commission_pct is
  'Platform commission for this merchant. Readable by authenticated (admin onboarding queue) but never by anon (mig 218). Client apps read their own rate through my_restaurant_tier.';
