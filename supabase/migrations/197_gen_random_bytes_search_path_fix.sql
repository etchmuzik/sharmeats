-- 197_gen_random_bytes_search_path_fix.sql
--
-- Four SECURITY DEFINER functions could never have succeeded past the line
-- where they mint a random token. All of them pin
--
--     set search_path = public, pg_temp
--
-- and then call bare `gen_random_bytes(16)`. That function is pgcrypto's, and on
-- this project pgcrypto is installed into the `extensions` schema — which the
-- pinned search_path excludes. Proven on the live database 2026-07-30:
--
--     set local search_path = public, pg_temp;
--     select to_regprocedure('gen_random_bytes(integer)');            -> NULL
--     select to_regprocedure('extensions.gen_random_bytes(integer)'); -> resolves
--
-- So each of these raises 42883 "function gen_random_bytes(integer) does not
-- exist" the moment it reaches that statement:
--
--   * public.redeem_points(integer)          — loyalty redemption (mig 046)
--   * public.redeem_credit(integer)          — wallet credit redemption (mig 062)
--   * public.reward_referrer_on_delivery()   — referral payout trigger (mig 026)
--   * public.create_order_share(uuid)        — follow-my-order links (mig 195)
--
-- Three of those are customer-facing money paths. They are latent rather than
-- reported because at 23 lifetime orders nobody has yet redeemed points, spent
-- wallet credit, or completed a referral. The first customer to try any of them
-- would have hit a hard error.
--
-- Found by plpgsql_check (installed in mig 197's companion) on its first run
-- across every SECURITY DEFINER function in public — which is precisely the
-- class of bug that typecheck, the test harness and CI cannot see, because the
-- SQL is valid and only fails at execution.
--
-- FIX: extend the pinned search_path rather than rewrite the bodies.
--
-- ALTER FUNCTION ... SET search_path touches only the config, leaving every
-- body byte-for-byte intact. That matters here specifically: house rule 2 says
-- never restate a function body from an older migration, because re-pasting
-- silently reverts later hardening. redeem_points alone has been amended by
-- migrations 049, 061 and 113; reproducing its body to change one identifier
-- would risk undoing all three. This does not touch them at all.
--
-- Adding `extensions` is safe and is the Supabase-recommended shape: the schema
-- is owned by supabase_admin and unprivileged roles cannot create objects in it,
-- so it introduces no search_path hijacking surface. pg_temp stays LAST, which
-- is the property that actually matters for shadowing.

alter function public.redeem_points(integer)
  set search_path = public, extensions, pg_temp;

alter function public.redeem_credit(integer)
  set search_path = public, extensions, pg_temp;

alter function public.reward_referrer_on_delivery()
  set search_path = public, extensions, pg_temp;

alter function public.create_order_share(uuid)
  set search_path = public, extensions, pg_temp;
