-- 089_f5_rls_initplan.sql
-- F5 (2026-07-05 audit): wrap auth.uid()/auth_role() in scalar subselects across
-- the 45 policies flagged by the auth_rls_initplan performance advisor. A bare
-- auth.uid() re-evaluates per row; (select auth.uid()) evaluates once per
-- statement (InitPlan). Logic is IDENTICAL — every expression below is the live
-- policy expression with only the wrapping added.
--
-- ALTER POLICY is used (not drop/create) so cmd/roles/permissive are untouched.
-- Idempotent: re-running re-sets the same expressions.
-- Rollback: re-run with the unwrapped expressions (see pg_policies dump in
-- docs/AUDIT-REPORT-2026-07-05.md for the originals).

-- users -----------------------------------------------------------------------
alter policy users_insert_self on public.users
  with check ((select auth.uid()) = id);
alter policy users_select_self on public.users
  using ((select auth.uid()) = id);
alter policy users_update_self on public.users
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- addresses / payment_methods / favorites / push_tokens ------------------------
alter policy addresses_owner_all on public.addresses
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
alter policy payment_methods_owner_all on public.payment_methods
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
alter policy favorites_owner_all on public.favorites
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
alter policy push_tokens_owner_all on public.push_tokens
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- orders ------------------------------------------------------------------------
alter policy orders_owner_insert on public.orders
  with check ((select auth.uid()) = user_id);
alter policy orders_owner_select on public.orders
  using ((select auth.uid()) = user_id);
alter policy orders_owner_update_rating on public.orders
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
alter policy orders_driver_select on public.orders
  using (
    (exists (select 1 from public.drivers d
       where d.id = orders.assigned_driver_id and d.profile_id = (select auth.uid())))
    or (exists (select 1 from public.order_assignments oa
       join public.drivers d on d.id = oa.driver_id
       where oa.order_id = orders.id and d.profile_id = (select auth.uid())
         and oa.status = any (array['offered'::text, 'accepted'::text])))
  );
alter policy orders_staff_admin_select on public.orders
  using ((select auth_role()) = any (array['admin'::public.app_role, 'dispatcher'::public.app_role]));

-- order children -----------------------------------------------------------------
alter policy order_items_select_via_order on public.order_items
  using (exists (select 1 from public.orders o
    where o.id = order_items.order_id and (
      (o.user_id = (select auth.uid()))
      or public.is_merchant_staff(o.restaurant_id)
      or ((select auth_role()) = any (array['admin'::public.app_role, 'dispatcher'::public.app_role]))
      or (exists (select 1 from public.drivers d
            where d.id = o.assigned_driver_id and d.profile_id = (select auth.uid())))
    )));
alter policy order_status_events_select_via_order on public.order_status_events
  using (exists (select 1 from public.orders o
    where o.id = order_status_events.order_id and (
      (o.user_id = (select auth.uid()))
      or public.is_merchant_staff(o.restaurant_id)
      or ((select auth_role()) = any (array['admin'::public.app_role, 'dispatcher'::public.app_role]))
      or (exists (select 1 from public.drivers d
            where d.id = o.assigned_driver_id and d.profile_id = (select auth.uid())))
    )));
alter policy order_messages_insert on public.order_messages
  with check ((sender_id = (select auth.uid())) and public.can_access_order_thread(order_id));
alter policy order_assignments_driver_select on public.order_assignments
  using (
    (exists (select 1 from public.drivers d
       where d.id = order_assignments.driver_id and d.profile_id = (select auth.uid())))
    or ((select auth_role()) = any (array['admin'::public.app_role, 'dispatcher'::public.app_role]))
  );

-- drivers -------------------------------------------------------------------------
alter policy drivers_admin_insert on public.drivers
  with check ((select auth_role()) = 'admin'::public.app_role);
alter policy drivers_self_select on public.drivers
  using ((profile_id = (select auth.uid()))
    or ((select auth_role()) = any (array['admin'::public.app_role, 'dispatcher'::public.app_role])));
alter policy drivers_self_update on public.drivers
  using ((profile_id = (select auth.uid())) or ((select auth_role()) = 'admin'::public.app_role))
  with check ((profile_id = (select auth.uid())) or ((select auth_role()) = 'admin'::public.app_role));
alter policy driver_earnings_self_select on public.driver_earnings
  using (
    (exists (select 1 from public.drivers d
       where d.id = driver_earnings.driver_id and d.profile_id = (select auth.uid())))
    or ((select auth_role()) = 'admin'::public.app_role)
  );

-- money / loyalty -------------------------------------------------------------------
alter policy credit_ledger_self_select on public.credit_ledger
  using (((select auth.uid()) = user_id) or ((select auth_role()) = 'admin'::public.app_role));
alter policy credit_balance_self_select on public.customer_credit_balance
  using (((select auth.uid()) = user_id) or ((select auth_role()) = 'admin'::public.app_role));
alter policy customer_loyalty_read_own on public.customer_loyalty
  using (user_id = (select auth.uid()));
alter policy loyalty_ledger_customer_read_own on public.loyalty_points_ledger
  using ((subject_type = 'customer'::text) and (subject_id = (select auth.uid())));
alter policy driver_loyalty_self_select on public.driver_loyalty
  using (
    (exists (select 1 from public.drivers d
       where d.id = driver_loyalty.driver_id and d.profile_id = (select auth.uid())))
    or ((select auth_role()) = any (array['admin'::public.app_role, 'dispatcher'::public.app_role]))
  );
alter policy restaurant_loyalty_staff_select on public.restaurant_loyalty
  using (public.is_merchant_staff(restaurant_id) or ((select auth_role()) = 'admin'::public.app_role));
alter policy order_financials_restaurant_select on public.order_financials
  using (((select auth_role()) = 'admin'::public.app_role)
    or (exists (select 1 from public.restaurants r
          join public.merchant_staff ms on ms.restaurant_id = r.id
          where r.id = order_financials.restaurant_id and ms.profile_id = (select auth.uid()))));
alter policy restaurant_settlements_select on public.restaurant_settlements
  using (((select auth_role()) = 'admin'::public.app_role) or public.is_merchant_staff(restaurant_id));
alter policy referrals_read_own on public.referrals
  using ((referrer_id = (select auth.uid())) or (referred_id = (select auth.uid())));

-- merchant catalog ---------------------------------------------------------------
alter policy menu_items_merchant_write on public.menu_items
  using (public.is_merchant_staff(restaurant_id) or ((select auth_role()) = 'admin'::public.app_role))
  with check (public.is_merchant_staff(restaurant_id) or ((select auth_role()) = 'admin'::public.app_role));
alter policy menu_sections_merchant_write on public.menu_sections
  using (public.is_merchant_staff(restaurant_id) or ((select auth_role()) = 'admin'::public.app_role))
  with check (public.is_merchant_staff(restaurant_id) or ((select auth_role()) = 'admin'::public.app_role));
alter policy modifiers_merchant_write on public.modifiers
  using (exists (select 1 from public.menu_items mi
    where mi.id = modifiers.item_id
      and (public.is_merchant_staff(mi.restaurant_id) or ((select auth_role()) = 'admin'::public.app_role))))
  with check (exists (select 1 from public.menu_items mi
    where mi.id = modifiers.item_id
      and (public.is_merchant_staff(mi.restaurant_id) or ((select auth_role()) = 'admin'::public.app_role))));
alter policy modifier_options_merchant_write on public.modifier_options
  using (exists (select 1 from public.modifiers m
    join public.menu_items mi on mi.id = m.item_id
    where m.id = modifier_options.modifier_id
      and (public.is_merchant_staff(mi.restaurant_id) or ((select auth_role()) = 'admin'::public.app_role))))
  with check (exists (select 1 from public.modifiers m
    join public.menu_items mi on mi.id = m.item_id
    where m.id = modifier_options.modifier_id
      and (public.is_merchant_staff(mi.restaurant_id) or ((select auth_role()) = 'admin'::public.app_role))));

-- staff / admin tables --------------------------------------------------------------
alter policy merchant_staff_admin_write on public.merchant_staff
  using ((select auth_role()) = 'admin'::public.app_role)
  with check ((select auth_role()) = 'admin'::public.app_role);
alter policy merchant_staff_self_select on public.merchant_staff
  using ((profile_id = (select auth.uid())) or ((select auth_role()) = 'admin'::public.app_role));
alter policy delivery_fee_rules_admin_write on public.delivery_fee_rules
  using ((select auth_role()) = 'admin'::public.app_role)
  with check ((select auth_role()) = 'admin'::public.app_role);
alter policy platform_settings_admin_write on public.platform_settings
  using ((select auth_role()) = 'admin'::public.app_role)
  with check ((select auth_role()) = 'admin'::public.app_role);
alter policy push_campaigns_admin_select on public.push_campaigns
  using ((select auth_role()) = 'admin'::public.app_role);
alter policy batch_candidate_log_admin_read on public.batch_candidate_log
  using (coalesce(((select auth_role()))::text, ''::text) = 'admin'::text);
alter policy restaurants_admin_insert on public.restaurants
  with check ((select auth_role()) = 'admin'::public.app_role);
alter policy restaurants_merchant_update on public.restaurants
  using (public.is_merchant_staff(id) or ((select auth_role()) = 'admin'::public.app_role))
  with check (public.is_merchant_staff(id) or ((select auth_role()) = 'admin'::public.app_role));

-- kyc / support ----------------------------------------------------------------------
alter policy kyc_documents_insert on public.kyc_documents
  with check (
    ((subject_type = 'driver'::public.kyc_subject_type) and (exists (select 1 from public.drivers d
        where d.id = kyc_documents.subject_id and d.profile_id = (select auth.uid()))))
    or ((subject_type = 'restaurant'::public.kyc_subject_type) and public.is_merchant_staff(subject_id))
  );
alter policy kyc_documents_select on public.kyc_documents
  using (
    ((select auth_role()) = 'admin'::public.app_role)
    or ((subject_type = 'driver'::public.kyc_subject_type) and (exists (select 1 from public.drivers d
        where d.id = kyc_documents.subject_id and d.profile_id = (select auth.uid()))))
    or ((subject_type = 'restaurant'::public.kyc_subject_type) and public.is_merchant_staff(subject_id))
  );
alter policy support_messages_select on public.support_messages
  using ((user_id = (select auth.uid())) or ((select auth_role()) = 'admin'::public.app_role));
alter policy support_messages_update on public.support_messages
  using ((user_id = (select auth.uid())) or ((select auth_role()) = 'admin'::public.app_role))
  with check ((user_id = (select auth.uid())) or ((select auth_role()) = 'admin'::public.app_role));

-- saved_orders (mig 086): its owner-all policy shipped with a bare auth.uid(),
-- so it is the one remaining auth_rls_initplan hit after this migration. Wrap it
-- here too. Guarded so this migration still applies if 086 has not been applied
-- yet on the target (086 must be applied before this migration regardless — see
-- the prod apply order in docs/AUDIT-REPORT-2026-07-05.md).
do $$
begin
  if exists (select 1 from pg_policies
             where schemaname = 'public' and tablename = 'saved_orders'
               and policyname = 'saved_orders_owner_all') then
    execute 'alter policy saved_orders_owner_all on public.saved_orders '
         || 'using ((select auth.uid()) = user_id) '
         || 'with check ((select auth.uid()) = user_id)';
  end if;
end $$;
