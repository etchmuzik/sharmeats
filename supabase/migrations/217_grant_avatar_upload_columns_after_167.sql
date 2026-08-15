-- Repair the column-level UPDATE grants on drivers/restaurants so a replay from
-- scratch produces the ACL production actually has.
--
-- HISTORY (all on 2026-08-15). Migration 20260815044240 originally granted
-- `drivers.photo_url` / `restaurants.logo_url`. Applying it to production
-- aborted with 42703 — those columns did not exist there, because migration 167
-- (which creates them, plus the public `avatars` bucket) had been committed
-- months earlier and NEVER APPLIED. The grant list was then "corrected" to the
-- columns that did exist, `photo` / `logo` — which was the wrong direction:
-- those are seed/catalog columns holding external URLs (restaurants.logo held a
-- gstatic.com link; drivers.photo was empty on all 4 rows) that no client
-- writes. Migration 167 was then applied for real, and 20260815044240's list was
-- put back to photo_url/logo_url.
--
-- This file is the checked-in form of the ad-hoc repair that was applied to
-- production between those two steps, so that a fresh project reaches the same
-- end state. It is idempotent and safe to run after 167 + 20260815044240.
--
-- The upload call sites are apps/driver/src/avatar.ts and
-- apps/restaurant/src/logo.ts; they write photo_url / logo_url and always did.

grant update (
  status,
  payout_method,
  payout_bank_name,
  payout_iban,
  payout_wallet,
  payout_holder,
  photo_url
) on table public.drivers to authenticated;

grant update (
  is_open,
  payout_method,
  payout_bank_name,
  payout_iban,
  payout_wallet,
  payout_holder,
  logo_url
) on table public.restaurants to authenticated;

-- `photo` and `logo` are catalog/seed columns; no client writes them, so the
-- interim grant was unnecessary reach.
revoke update (photo) on table public.drivers from authenticated;
revoke update (logo) on table public.restaurants from authenticated;

do $$
begin
  if not has_column_privilege('authenticated', 'public.drivers', 'photo_url', 'UPDATE') then
    raise exception '[217] driver avatar column is not writable by authenticated';
  end if;
  if not has_column_privilege('authenticated', 'public.restaurants', 'logo_url', 'UPDATE') then
    raise exception '[217] merchant logo column is not writable by authenticated';
  end if;
  -- Authority columns must remain unreachable from a client JWT.
  if has_column_privilege('authenticated', 'public.drivers', 'is_verified', 'UPDATE') then
    raise exception '[217] drivers.is_verified became client-writable';
  end if;
  if has_column_privilege('authenticated', 'public.restaurants', 'commission_pct', 'UPDATE') then
    raise exception '[217] restaurants.commission_pct became client-writable';
  end if;
end;
$$;
