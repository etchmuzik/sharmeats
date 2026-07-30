-- money_path_assertions.sql — Package 04 Slice A: the executable money-path proof.
--
-- Runs the eight scenario families the spec requires against a SCRATCH database
-- restored to production schema (never production — it places orders), inside one
-- BEGIN..ROLLBACK. Usage:
--
--   psql -d "$SCRATCH_DB" -f supabase/tests/money_path_assertions.sql
--
-- Exit contract: every step prints PASS in the summary table; any violated
-- invariant raises 'FAIL: ...' and aborts. 34 assertions across the families.
--
-- ================= THE RPC-ONLY RULE =================
-- Money and order state are created ONLY through the public RPC surface —
-- place_order, advance_order_status, assign_driver, driver_respond,
-- mark_cod_collected, redeem_credit, admin_issue_credit, record_cash_handin,
-- generate_settlements, generate_driver_settlements, settle_paymob_payment,
-- finalize_full_card_refund — exactly as the apps and edge functions do. Direct
-- writes are permitted for exactly three things, mirroring their real writers:
--   1. base entities that exist before any order (users/auth.users, restaurant
--      geo, menu, addresses, platform/vertical config) — created by onboarding
--      flows and operators in prod, out of scope for a money-path proof;
--   2. payment_attempts rows — service-plane state the paymob-intention edge
--      function writes directly with the service key; the pack does the same;
--   3. order_refunds request rows — written by the paymob-refund edge function
--      (service key) before it calls the provider.
-- Anything else written directly would prove nothing: the whole point is that
-- the public surface alone produces books that balance.
--
-- ================= THE FOUR IDENTITIES (asserted per completed scenario) ======
--   I1  order total = subtotal + delivery + tax + service + small-order + tip
--       − discount            (credit arrives AS discount via a minted promo code)
--   I2  captured/refunded = the authoritative provider and refund records
--       (card: paymob_txn_id + a paid payment_attempt; COD: the cod_collected
--        cash-ledger row; refunds: succeeded order_refunds rows)
--   I3  merchant payable + platform commission + driver components = the
--       documented treatment (docs/FINANCIALS.md): commission floor(subtotal ×
--       snapshot pct / 100); driver keeps 100% of delivery fee + tip;
--       merchant net = card_sales − commission + COD-discount reimbursement;
--       driver net = gross − COD collected
--   I4  driver cash balance = sum over the immutable ledger — via THREE
--       independent surfaces (my_cash_balance, driver_cash_balance view, raw sum)

\set ON_ERROR_STOP on
begin;

create temp table pack(step text, result text) on commit drop;

-- ---------------------------------------------------------------------------
-- 0. Drift guard: the pack refuses to "pass" against a database missing the
--    functions it exists to prove. (A missing RPC failing at first call would
--    also stop the run, but a named check reports the ACTUAL problem.)
-- ---------------------------------------------------------------------------
do $$
declare fn text;
begin
  foreach fn in array array['place_order','advance_order_status','assign_driver',
    'driver_respond','mark_cod_collected','redeem_credit','admin_issue_credit',
    'record_cash_handin','generate_settlements','generate_driver_settlements',
    'settle_paymob_payment','finalize_full_card_refund','my_cash_balance',
    'payment_reconciliation_report'] loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = fn) then
      raise exception 'FAIL: required function public.% is absent — this database drifted from the repo (the mig-121 incident shape); run scripts/check-db-drift.sh', fn;
    end if;
  end loop;
end $$;
insert into pack values ('00_no_drift','PASS');

-- ---------------------------------------------------------------------------
-- Impersonation + fixtures
-- ---------------------------------------------------------------------------
create or replace function pg_temp.as_user(p_uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.as_service() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('role', 'service_role')::text, true);
end $$;

create or replace function pg_temp.mk_user(p_role text, p_name text) returns uuid
language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    v || '@pack.test', 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.users (id, phone, display_name, role)
  values (v, '+2011' || substr(md5(v::text), 1, 7), p_name, p_role::app_role)
  on conflict (id) do update set role = excluded.role, display_name = excluded.display_name;
  return v;
end $$;

create temp table fx (k text primary key, v uuid);

do $$
declare
  v_rest uuid; v_cust uuid; v_cust2 uuid; v_drvuser uuid; v_drv uuid;
  v_staffuser uuid; v_admin uuid; v_disp uuid; v_addr uuid; v_sec uuid; v_item uuid;
begin
  select id into v_rest from public.restaurants where slug = 'dryrun-cafe';
  if v_rest is null then
    raise exception 'FAIL: fixture restaurant dryrun-cafe missing — restore the scratch DB first';
  end if;

  -- Fixture config, mirroring prod: the vertical is live, the restaurant has a
  -- location, and the ceiling mode observes (prod defaults, mig 149).
  update public.verticals set is_active = true, launch_stage = 'public' where id = 'food';

  -- Prod keeps pgcrypto in the `extensions` schema and redeem_credit calls
  -- extensions.gen_random_bytes by qualified name (mig 120's fix). A scratch
  -- restore lands pgcrypto in `public`, so mirror prod's layout with a shim.
  if not exists (select 1 from pg_namespace where nspname = 'extensions') then
    create schema extensions;
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'extensions' and p.proname = 'gen_random_bytes') then
    create function extensions.gen_random_bytes(int) returns bytea
      language sql as 'select public.gen_random_bytes($1)';
  end if;
  update public.restaurants
     set geo = st_setsrid(st_makepoint(34.3300, 27.9158), 4326)::geography
   where id = v_rest;

  v_cust  := pg_temp.mk_user('customer', 'Pack Customer');
  v_cust2 := pg_temp.mk_user('customer', 'Pack Customer 2');
  v_admin := pg_temp.mk_user('admin', 'Pack Admin');
  v_disp  := pg_temp.mk_user('dispatcher', 'Pack Dispatcher');
  v_staffuser := pg_temp.mk_user('merchant_staff', 'Pack Staff');
  insert into public.merchant_staff (restaurant_id, profile_id) values (v_rest, v_staffuser);
  v_drvuser := pg_temp.mk_user('driver', 'Pack Driver');
  insert into public.drivers (profile_id, name, is_active, is_verified, status)
  values (v_drvuser, 'Pack Driver', true, true, 'online') returning id into v_drv;

  insert into public.menu_sections (restaurant_id, name) values (v_rest, 'Pack') returning id into v_sec;
  insert into public.menu_items (restaurant_id, section_id, name, price_egp, is_available)
  values (v_rest, v_sec, 'Pack Meal', 100, true) returning id into v_item;

  -- 300 m from the restaurant — inside any sane radius.
  insert into public.addresses (user_id, kind, label, room_number, geo)
  values (v_cust, 'hotel', 'Pack Hotel', '101',
          st_setsrid(st_makepoint(34.3330, 27.9160), 4326)::geography)
  returning id into v_addr;

  insert into fx values ('rest', v_rest), ('cust', v_cust), ('cust2', v_cust2),
    ('admin', v_admin), ('disp', v_disp), ('staff', v_staffuser),
    ('drvuser', v_drvuser), ('drv', v_drv), ('addr', v_addr), ('item', v_item);
end $$;
insert into pack values ('01_fixtures','PASS');

-- ---------------------------------------------------------------------------
-- Shared helpers: place an order as the customer; walk it to delivered; assert
-- identity I1 on any order.
-- ---------------------------------------------------------------------------
create or replace function pg_temp.place(p_pm text, p_tip int default 0,
  p_promo text default null) returns uuid
language plpgsql as $$
declare v_ord uuid;
begin
  -- place_order builds `_lines` ON COMMIT DROP. In prod each call is its own
  -- transaction, so it never survives; this pack is ONE transaction, so the
  -- second placement would collide. Clearing it between calls changes nothing
  -- about what is being proven.
  drop table if exists _lines;
  perform pg_temp.as_user((select v from fx where k = 'cust'));
  select id into v_ord from public.place_order(
    p_restaurant_id => (select v from fx where k = 'rest'),
    p_address_id    => (select v from fx where k = 'addr'),
    p_cart          => jsonb_build_array(jsonb_build_object(
                         'item_id', (select v from fx where k = 'item'), 'quantity', 2)),
    p_payment_method => p_pm,
    p_tip            => p_tip,
    p_promo_code     => p_promo);
  perform set_config('request.jwt.claims', null, true);
  return v_ord;
end $$;

create or replace function pg_temp.advance(p_ord uuid, p_to text, p_actor text)
returns void language plpgsql as $$
begin
  perform pg_temp.as_user((select v from fx where k = p_actor));
  perform public.advance_order_status(p_ord, p_to::order_status_type);
  perform set_config('request.jwt.claims', null, true);
end $$;

-- Merchant accepts through ready, dispatcher assigns, driver accepts + delivers.
create or replace function pg_temp.deliver(p_ord uuid) returns void
language plpgsql as $$
declare v_assign uuid;
begin
  perform pg_temp.advance(p_ord, 'accepted', 'staff');
  perform pg_temp.advance(p_ord, 'preparing', 'staff');
  perform pg_temp.advance(p_ord, 'ready', 'staff');

  perform pg_temp.as_user((select v from fx where k = 'disp'));
  perform public.assign_driver(p_ord, (select v from fx where k = 'drv'));
  perform set_config('request.jwt.claims', null, true);

  select id into v_assign from public.order_assignments
   where order_id = p_ord and status = 'offered'
   order by assigned_at desc limit 1;
  perform pg_temp.as_user((select v from fx where k = 'drvuser'));
  perform public.driver_respond(v_assign, true);
  perform set_config('request.jwt.claims', null, true);

  perform pg_temp.advance(p_ord, 'picked_up', 'drvuser');
  perform pg_temp.advance(p_ord, 'out_for_delivery', 'drvuser');
  perform pg_temp.advance(p_ord, 'delivered', 'drvuser');
end $$;

-- I1: total composition, recomputed from the row.
create or replace function pg_temp.assert_i1(p_ord uuid) returns void
language plpgsql as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_ord;
  if o.total_egp <> greatest(0, o.subtotal_egp + o.delivery_fee_egp + o.tax_egp
       + o.service_fee_egp + o.small_order_fee_egp + o.tip_egp - o.discount_egp) then
    raise exception 'FAIL: I1 broken on %: total % <> % + % + % + % + % + % - %',
      p_ord, o.total_egp, o.subtotal_egp, o.delivery_fee_egp, o.tax_egp,
      o.service_fee_egp, o.small_order_fee_egp, o.tip_egp, o.discount_egp;
  end if;
end $$;

-- ===========================================================================
-- SCENARIO 1 — COD full lifecycle: place, accept, assign, collect exact, deliver
-- ===========================================================================
do $$
declare v_ord uuid; v_total int; v_bal_before int; v_bal_after int;
begin
  v_ord := pg_temp.place('cash_on_delivery', 10);
  perform pg_temp.assert_i1(v_ord);
  select total_egp into v_total from public.orders where id = v_ord;

  perform pg_temp.deliver(v_ord);

  -- Wrong amount refused BEFORE the right one lands (collect EXACT amount).
  perform pg_temp.as_user((select v from fx where k = 'drvuser'));
  begin
    perform public.mark_cod_collected(v_ord, v_total - 1);
    raise exception 'FAIL: COD accepted a wrong amount';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;  -- COD_AMOUNT_MISMATCH expected
  end;

  select coalesce(sum(delta_egp), 0) into v_bal_before
    from public.driver_cash_ledger where driver_id = (select v from fx where k = 'drv');
  perform public.mark_cod_collected(v_ord, v_total);
  perform set_config('request.jwt.claims', null, true);

  -- I2 (COD): captured = the cod_collected ledger row, exactly once, exact total.
  if (select count(*) from public.driver_cash_ledger
       where ref_order_id = v_ord and reason = 'cod_collected') <> 1 then
    raise exception 'FAIL: I2 COD — expected exactly one collection ledger row'; end if;
  if (select delta_egp from public.driver_cash_ledger
       where ref_order_id = v_ord and reason = 'cod_collected') <> v_total then
    raise exception 'FAIL: I2 COD — ledger delta <> order total'; end if;
  if (select payment_status from public.orders where id = v_ord) <> 'paid' then
    raise exception 'FAIL: I2 COD — order not marked paid'; end if;

  -- Collection is idempotent: a second call must not double-credit the ledger.
  perform pg_temp.as_user((select v from fx where k = 'drvuser'));
  perform public.mark_cod_collected(v_ord, v_total);
  perform set_config('request.jwt.claims', null, true);
  select coalesce(sum(delta_egp), 0) into v_bal_after
    from public.driver_cash_ledger where driver_id = (select v from fx where k = 'drv');
  if v_bal_after <> v_bal_before + v_total then
    raise exception 'FAIL: repeated COD collection changed the ledger (% -> %)',
      v_bal_before + v_total, v_bal_after; end if;

  -- Scenario 8 seed: the delivered transition snapshotted the money (mig 135).
  if (select count(*) from public.order_financials where order_id = v_ord) <> 1 then
    raise exception 'FAIL: no order_financials snapshot for a delivered order'; end if;
  if exists (select 1 from public.order_financials_failures
              where order_id = v_ord and resolved_at is null) then
    raise exception 'FAIL: delivered order landed in the repair queue'; end if;
end $$;
insert into pack values ('10_cod_lifecycle','PASS');

-- ===========================================================================
-- SCENARIO 2 — COD cancellation before pickup and after acceptance
-- ===========================================================================
do $$
declare v_ord uuid; e text;
begin
  -- Before acceptance: the customer may cancel their own placed order.
  v_ord := pg_temp.place('cash_on_delivery');
  perform pg_temp.advance(v_ord, 'cancelled', 'cust');
  if (select status from public.orders where id = v_ord) <> 'cancelled' then
    raise exception 'FAIL: customer could not cancel a placed order'; end if;
  if (select payment_status from public.orders where id = v_ord) <> 'pending' then
    raise exception 'FAIL: cancellation touched payment_status'; end if;
  if exists (select 1 from public.order_financials where order_id = v_ord) then
    raise exception 'FAIL: a cancelled order entered the financial snapshot'; end if;

  -- After acceptance: the customer may NOT; dispatcher may.
  v_ord := pg_temp.place('cash_on_delivery');
  perform pg_temp.advance(v_ord, 'accepted', 'staff');
  begin
    perform pg_temp.advance(v_ord, 'cancelled', 'cust');
    e := 'NO ERROR';
  exception when others then e := sqlerrm; end;
  if e = 'NO ERROR' then
    raise exception 'FAIL: customer cancelled an ACCEPTED order'; end if;
  perform pg_temp.advance(v_ord, 'cancelled', 'disp');
  if (select status from public.orders where id = v_ord) <> 'cancelled' then
    raise exception 'FAIL: dispatcher could not cancel post-acceptance'; end if;
  if exists (select 1 from public.order_financials where order_id = v_ord) then
    raise exception 'FAIL: post-acceptance cancellation entered the snapshot'; end if;
end $$;
insert into pack values ('20_cod_cancellations','PASS');

-- ===========================================================================
-- SCENARIO 3 — customer credit alone and combined with COD
-- ===========================================================================
do $$
declare v_code text; v_ord uuid; v_bal int;
begin
  perform pg_temp.as_user((select v from fx where k = 'admin'));
  perform public.admin_issue_credit((select v from fx where k = 'cust'), 60, 'goodwill');
  perform set_config('request.jwt.claims', null, true);

  perform pg_temp.as_user((select v from fx where k = 'cust'));
  v_bal := public.my_credit_balance();
  if v_bal <> 60 then raise exception 'FAIL: issued 60, balance %', v_bal; end if;
  v_code := public.redeem_credit(60);
  if public.my_credit_balance() <> 0 then
    raise exception 'FAIL: redeem did not debit the balance'; end if;
  perform set_config('request.jwt.claims', null, true);

  -- Credit spends WITH COD (the current contract permits it): the minted code
  -- lands as discount_egp and I1 still balances.
  v_ord := pg_temp.place('cash_on_delivery', 0, v_code);
  perform pg_temp.assert_i1(v_ord);
  if (select discount_egp from public.orders where id = v_ord) <> 60 then
    raise exception 'FAIL: credit code did not become a 60 EGP discount'; end if;

  -- The credit ledger records the redemption exactly once.
  if (select count(*) from public.credit_ledger
       where user_id = (select v from fx where k = 'cust')
         and reason = 'redeem' and delta_egp = -60) <> 1 then
    raise exception 'FAIL: credit ledger missing the redeem row'; end if;

  -- Another customer cannot spend a code minted from THIS customer's credit.
  drop table if exists _lines;
  perform pg_temp.as_user((select v from fx where k = 'cust2'));
  begin
    perform public.place_order(
      p_restaurant_id => (select v from fx where k = 'rest'),
      p_address_id    => (select v from fx where k = 'addr'),
      p_cart          => jsonb_build_array(jsonb_build_object(
                           'item_id', (select v from fx where k = 'item'), 'quantity', 2)),
      p_payment_method => 'cash_on_delivery',
      p_promo_code     => v_code);
    raise exception 'FAIL: a stranger spent another customer''s credit code';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', null, true);
end $$;
insert into pack values ('30_credit_alone_and_with_cod','PASS');

-- ===========================================================================
-- SCENARIO 4 — card: success, decline, abandonment, timeout, delayed webhook,
--              duplicate webhook
-- ===========================================================================
do $$
declare v_ord uuid; v_total int; v_user uuid; r jsonb; e text; v_cnt int;
begin
  v_user := (select v from fx where k = 'cust');

  -- SUCCESS: intention (service-plane) → webhook settles → merchant can accept.
  v_ord := pg_temp.place('card', 15);
  perform pg_temp.assert_i1(v_ord);
  select total_egp into v_total from public.orders where id = v_ord;

  -- An unpaid card order cannot advance (CARD_NOT_PAID) — money gates status.
  begin
    perform pg_temp.advance(v_ord, 'accepted', 'staff');
    e := 'NO ERROR';
  exception when others then e := sqlerrm; end;
  if e = 'NO ERROR' then
    raise exception 'FAIL: merchant accepted an UNPAID card order'; end if;

  insert into public.payment_attempts (order_id, user_id, status, amount_egp,
    integration_id, provider_order_id)
  values (v_ord, v_user, 'ready', v_total, 'INT-PACK', 'PO-PACK-1');

  perform pg_temp.as_service();
  r := public.settle_paymob_payment('PO-PACK-1', 'TXN-PACK-1', v_total * 100, 'INT-PACK');
  if (r->>'transitioned')::bool is not true then
    raise exception 'FAIL: settlement did not transition'; end if;
  -- DUPLICATE WEBHOOK: same txn again = quiet no-op.
  r := public.settle_paymob_payment('PO-PACK-1', 'TXN-PACK-1', v_total * 100, 'INT-PACK');
  if (r->>'transitioned')::bool is not false then
    raise exception 'FAIL: duplicate webhook re-settled the order'; end if;
  perform set_config('request.jwt.claims', null, true);

  -- I2 (card): captured = provider records, both sides.
  if (select paymob_txn_id from public.orders where id = v_ord) <> 'TXN-PACK-1' then
    raise exception 'FAIL: I2 card — order does not carry the settling txn'; end if;
  if (select status from public.payment_attempts where provider_order_id = 'PO-PACK-1') <> 'paid' then
    raise exception 'FAIL: I2 card — attempt not marked paid'; end if;

  perform pg_temp.deliver(v_ord);
  -- Card delivery books driver earnings with zero COD.
  if (select cod_collected from public.driver_earnings where order_id = v_ord) <> 0 then
    raise exception 'FAIL: card order booked COD into driver earnings'; end if;
  if (select total from public.driver_earnings where order_id = v_ord)
     <> (select delivery_fee_egp + tip_egp from public.orders where id = v_ord)
        + coalesce((select bonus_per_delivery_egp from public.driver_loyalty
                     where driver_id = (select v from fx where k = 'drv')), 0) then
    raise exception 'FAIL: I3 — driver earning <> fee + tip + bonus'; end if;

  -- DECLINE: the attempt fails at the provider; the order never pays.
  v_ord := pg_temp.place('card');
  select total_egp into v_total from public.orders where id = v_ord;
  insert into public.payment_attempts (order_id, user_id, status, amount_egp,
    integration_id, provider_order_id, last_error)
  values (v_ord, v_user, 'failed', v_total, 'INT-PACK', 'PO-PACK-DECL', 'card_declined');
  if (select payment_status from public.orders where id = v_ord) <> 'pending' then
    raise exception 'FAIL: a declined attempt changed the order'; end if;

  -- ABANDONMENT/TIMEOUT: stale pending checkout; the reconciler cancels it.
  -- (Backdating placed_at is fixture time-travel, not money-state mutation.)
  update public.orders set placed_at = now() - interval '45 minutes' where id = v_ord;
  v_cnt := public.reconcile_stale_card_orders();
  if v_cnt < 1 then raise exception 'FAIL: reconciler cancelled nothing'; end if;
  if (select payment_status || '/' || status from public.orders where id = v_ord)
     <> 'failed/cancelled' then
    raise exception 'FAIL: stale card order not failed/cancelled'; end if;

  -- DELAYED WEBHOOK after local cancel: settlement legally records the capture
  -- (the money moved at the provider) — and the mig-181 detector flags the
  -- resulting cancelled-but-captured order for refund.
  insert into public.payment_attempts (order_id, user_id, status, amount_egp,
    integration_id, provider_order_id)
  values (v_ord, v_user, 'ready', v_total, 'INT-PACK', 'PO-PACK-LATE');
  perform pg_temp.as_service();
  r := public.settle_paymob_payment('PO-PACK-LATE', 'TXN-PACK-LATE', v_total * 100, 'INT-PACK');
  perform set_config('request.jwt.claims', null, true);
  if (select payment_status from public.orders where id = v_ord) <> 'paid' then
    raise exception 'FAIL: delayed webhook did not record the capture'; end if;
  perform pg_temp.as_user((select v from fx where k = 'admin'));
  if not exists (select 1 from public.payment_reconciliation_report(30)
                  where mismatch_class = 'card_captured_but_cancelled'
                    and order_id = v_ord) then
    raise exception 'FAIL: cancelled-but-captured order not flagged by reconciliation'; end if;
  perform set_config('request.jwt.claims', null, true);
end $$;
insert into pack values ('40_card_rails','PASS');

-- ===========================================================================
-- SCENARIO 5 — full refund, duplicate request, provider retry
-- ===========================================================================
do $$
declare v_ord uuid; v_total int; v_user uuid; v_ref uuid; r jsonb; v_got uuid; e text;
begin
  v_user := (select v from fx where k = 'cust');
  v_ord := pg_temp.place('card');
  select total_egp into v_total from public.orders where id = v_ord;
  insert into public.payment_attempts (order_id, user_id, status, amount_egp,
    integration_id, provider_order_id)
  values (v_ord, v_user, 'ready', v_total, 'INT-PACK', 'PO-PACK-RF');
  perform pg_temp.as_service();
  r := public.settle_paymob_payment('PO-PACK-RF', 'TXN-PACK-RF', v_total * 100, 'INT-PACK');
  perform set_config('request.jwt.claims', null, true);

  -- The refund request row, as the paymob-refund edge function writes it.
  insert into public.order_refunds (order_id, amount_egp, reason, status)
  values (v_ord, v_total, 'customer request', 'requested') returning id into v_ref;

  -- DUPLICATE refund request: the partial unique index refuses a second active.
  begin
    insert into public.order_refunds (order_id, amount_egp, reason, status)
    values (v_ord, v_total, 'double click', 'requested');
    raise exception 'FAIL: a second concurrent refund request was accepted';
  exception when unique_violation then null;
  end;

  perform pg_temp.as_service();
  v_got := public.finalize_full_card_refund(v_ref, 'PROV-PACK-RF');
  -- PROVIDER RETRY with the same reference: quiet idempotent success.
  v_got := public.finalize_full_card_refund(v_ref, 'PROV-PACK-RF');
  perform set_config('request.jwt.claims', null, true);

  -- I2 (refund): refunded = the authoritative refund record, exactly once.
  if (select payment_status from public.orders where id = v_ord) <> 'refunded' then
    raise exception 'FAIL: I2 refund — order not refunded'; end if;
  if (select count(*) from public.order_refunds
       where order_id = v_ord and status = 'succeeded') <> 1 then
    raise exception 'FAIL: I2 refund — expected exactly one succeeded refund'; end if;
  if (select sum(amount_egp) from public.order_refunds
       where order_id = v_ord and status = 'succeeded') <> v_total then
    raise exception 'FAIL: I2 refund — refunded <> captured'; end if;
end $$;
insert into pack values ('50_full_refund_family','PASS');

-- ===========================================================================
-- SCENARIOS 6+7 — merchant settlement (card + COD), driver earning, COD ledger,
--                 hand-in and statement
-- ===========================================================================
do $$
declare
  v_rest uuid := (select v from fx where k = 'rest');
  v_drv uuid := (select v from fx where k = 'drv');
  s public.restaurant_settlements; d public.driver_settlements;
  agg record; v_n int; v_bal int; v_stmt int;
begin
  perform pg_temp.as_user((select v from fx where k = 'admin'));
  v_n := public.generate_settlements(current_date, current_date);
  v_n := v_n + public.generate_driver_settlements(current_date, current_date);
  perform set_config('request.jwt.claims', null, true);

  -- I3 merchant: recompute the documented treatment from order_financials and
  -- demand the settlement row equals it. Pack orders delivered today: one COD
  -- (scenario 1) and one card (scenario 4).
  select * into s from public.restaurant_settlements
   where restaurant_id = v_rest and period_start = current_date and period_end = current_date;
  if s.id is null then raise exception 'FAIL: no merchant settlement generated'; end if;

  select coalesce(sum(subtotal_egp), 0) as gross,
         coalesce(sum(subtotal_egp) filter (where payment_method = 'cash_on_delivery'), 0) as cod,
         coalesce(sum(subtotal_egp) filter (where payment_method <> 'cash_on_delivery'), 0) as card,
         coalesce(sum(commission_egp), 0) as comm,
         coalesce(sum(discount_egp) filter (where payment_method = 'cash_on_delivery'), 0) as cod_disc
    into agg
    from public.order_financials
   where restaurant_id = v_rest and delivered_at::date = current_date;

  if s.gross_sales_egp <> agg.gross or s.cod_sales_egp <> agg.cod
     or s.card_sales_egp <> agg.card or s.commission_egp <> agg.comm then
    raise exception 'FAIL: I3 merchant — settlement row disagrees with order_financials'; end if;
  if s.net_payable_egp <> agg.card - agg.comm + agg.cod_disc then
    raise exception 'FAIL: I3 merchant — net % <> card % - commission % + cod_discount %',
      s.net_payable_egp, agg.card, agg.comm, agg.cod_disc; end if;

  -- Commission itself follows the documented snapshot math on every pack order.
  if exists (
    select 1 from public.order_financials f
      join public.orders o on o.id = f.order_id
     where f.restaurant_id = v_rest and f.delivered_at::date = current_date
       and f.commission_egp <> floor(f.subtotal_egp * f.commission_pct / 100.0)::int) then
    raise exception 'FAIL: I3 — commission <> floor(subtotal * snapshot pct / 100)'; end if;

  -- I3 driver: gross = fee + tip + bonus; net = gross − COD collected.
  select * into d from public.driver_settlements
   where driver_id = v_drv and period_start = current_date and period_end = current_date;
  if d.id is null then raise exception 'FAIL: no driver settlement generated'; end if;
  select coalesce(sum(total), 0) as gross, coalesce(sum(cod_collected), 0) as cod into agg
    from public.driver_earnings
   where driver_id = v_drv and created_at::date = current_date;
  if d.gross_earnings_egp <> agg.gross or d.cod_collected_egp <> agg.cod
     or d.net_payable_egp <> agg.gross - agg.cod then
    raise exception 'FAIL: I3 driver — settlement disagrees with earnings (% % % vs % %)',
      d.gross_earnings_egp, d.cod_collected_egp, d.net_payable_egp, agg.gross, agg.cod; end if;

  -- I4: the driver's cash balance is the ledger sum — three independent surfaces.
  select coalesce(sum(delta_egp), 0) into v_bal
    from public.driver_cash_ledger where driver_id = v_drv;
  perform pg_temp.as_user((select v from fx where k = 'drvuser'));
  if public.my_cash_balance() <> v_bal then
    raise exception 'FAIL: I4 — my_cash_balance <> ledger sum'; end if;
  -- The driver reads their own statement.
  select count(*) into v_stmt from public.my_driver_settlements(12);
  if v_stmt < 1 then raise exception 'FAIL: driver cannot read their statement'; end if;
  perform set_config('request.jwt.claims', null, true);
  if (select balance_egp from public.driver_cash_balance where driver_id = v_drv) <> v_bal then
    raise exception 'FAIL: I4 — balance view <> ledger sum'; end if;

  -- HAND-IN closes the loop: admin records it; balance returns to zero.
  perform pg_temp.as_user((select v from fx where k = 'admin'));
  v_bal := public.record_cash_handin(v_drv, v_bal);
  perform set_config('request.jwt.claims', null, true);
  if v_bal <> 0 then raise exception 'FAIL: hand-in left balance %', v_bal; end if;
  perform pg_temp.as_user((select v from fx where k = 'drvuser'));
  if public.my_cash_balance() <> 0 then
    raise exception 'FAIL: I4 — driver still shows cash after hand-in'; end if;
  perform set_config('request.jwt.claims', null, true);
end $$;
insert into pack values ('60_settlements_and_cash','PASS');

-- ===========================================================================
-- SCENARIO 8 — financial snapshot / repair queue, tied to the reconciliation
--              surface (mig 181)
-- ===========================================================================
do $$
declare v_ord uuid; v_n int;
begin
  -- Happy path was proven in scenario 1 (snapshot exists, queue empty). Now the
  -- failure path: an open repair item MUST surface through the operator report.
  -- The failure row is injected directly — mig 135's queue is written from an
  -- exception handler, and no public RPC can (or should) produce the failure.
  select order_id into v_ord from public.order_financials limit 1;
  insert into public.order_financials_failures (order_id, sqlstate, message)
  values (v_ord, 'P0001', 'pack: simulated snapshot failure')
  on conflict (order_id) do update set resolved_at = null;

  perform pg_temp.as_user((select v from fx where k = 'admin'));
  select count(*) into v_n from public.payment_reconciliation_report(30)
   where mismatch_class = 'finance_repair_open' and order_id = v_ord;
  perform set_config('request.jwt.claims', null, true);
  if v_n <> 1 then
    raise exception 'FAIL: open repair item invisible to the reconciliation report'; end if;

  -- Repair contract: stamping resolved_at clears it.
  update public.order_financials_failures set resolved_at = now() where order_id = v_ord;
  perform pg_temp.as_user((select v from fx where k = 'admin'));
  select count(*) into v_n from public.payment_reconciliation_report(30)
   where mismatch_class = 'finance_repair_open' and order_id = v_ord;
  perform set_config('request.jwt.claims', null, true);
  if v_n <> 0 then
    raise exception 'FAIL: resolved repair item still reported open'; end if;
end $$;
insert into pack values ('70_snapshot_repair_queue','PASS');

select step, result from pack order by step;
rollback;
