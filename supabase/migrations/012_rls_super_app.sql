-- 012_rls_super_app.sql
-- Row Level Security for the four-role super-app. Written/locked LAST so dev
-- iterates fast, then hardened before any real customer data.
--
-- CORE PRINCIPLE — authority by ABSENCE + controlled RPC:
--   The authority columns (orders.status, payment_status, total_egp,
--   assigned_driver_id) get NO direct UPDATE policy for ANY client role. With
--   RLS enabled, "no permissive policy" = deny. Clients mutate orders ONLY via
--   the SECURITY DEFINER RPCs (advance_order_status, assign_driver, ...), which
--   bypass RLS but enforce the state machine + role checks. DO NOT add a
--   permissive UPDATE policy on orders for merchants/drivers/customers — that
--   would let them tamper with status/payment directly.
--
-- Roles: customer | driver | merchant_staff | dispatcher | admin
--   (users.role + merchant_staff link + drivers.profile_id; auth_role() helper)

-- ============================================================================
-- CATALOG (public read already on restaurants/menus/zones/hotels from mig 002).
-- Add: merchant_staff WRITE on their own merchant's catalog; admin all.
-- ============================================================================
-- Restaurants: merchant can update own; admin all.
create policy "restaurants_merchant_update"
  on public.restaurants for update
  using (public.is_merchant_staff(id) or public.auth_role() = 'admin')
  with check (public.is_merchant_staff(id) or public.auth_role() = 'admin');

create policy "restaurants_admin_insert"
  on public.restaurants for insert
  with check (public.auth_role() = 'admin');

-- Menu sections / items / modifiers / options: merchant manages own, admin all.
do $$
declare t text;
begin
  foreach t in array array['menu_sections','menu_items'] loop
    execute format($f$
      create policy "%1$s_merchant_write" on public.%1$I
        for all
        using (public.is_merchant_staff(restaurant_id) or public.auth_role() = 'admin')
        with check (public.is_merchant_staff(restaurant_id) or public.auth_role() = 'admin');
    $f$, t);
  end loop;
end $$;

-- modifiers / modifier_options hang off menu_items (no restaurant_id) — gate via item ownership.
create policy "modifiers_merchant_write"
  on public.modifiers for all
  using (exists (select 1 from public.menu_items mi
                 where mi.id = modifiers.item_id
                   and (public.is_merchant_staff(mi.restaurant_id) or public.auth_role() = 'admin')))
  with check (exists (select 1 from public.menu_items mi
                 where mi.id = modifiers.item_id
                   and (public.is_merchant_staff(mi.restaurant_id) or public.auth_role() = 'admin')));

create policy "modifier_options_merchant_write"
  on public.modifier_options for all
  using (exists (select 1 from public.modifiers m
                 join public.menu_items mi on mi.id = m.item_id
                 where m.id = modifier_options.modifier_id
                   and (public.is_merchant_staff(mi.restaurant_id) or public.auth_role() = 'admin')))
  with check (exists (select 1 from public.modifiers m
                 join public.menu_items mi on mi.id = m.item_id
                 where m.id = modifier_options.modifier_id
                   and (public.is_merchant_staff(mi.restaurant_id) or public.auth_role() = 'admin')));

-- ============================================================================
-- ORDERS — SELECT scoped per role. NO direct UPDATE policy (see CORE PRINCIPLE).
-- Insert is via place_order RPC (definer); we also keep the legacy owner-insert
-- for compatibility but place_order is the real path.
-- ============================================================================
-- Customer already has owner select/insert from mig 002. Add other roles' SELECT.
create policy "orders_merchant_select"
  on public.orders for select
  using (public.is_merchant_staff(restaurant_id));

create policy "orders_driver_select"
  on public.orders for select
  using (exists (select 1 from public.drivers d
                 where d.id = orders.assigned_driver_id and d.profile_id = auth.uid())
         or exists (select 1 from public.order_assignments oa
                 join public.drivers d on d.id = oa.driver_id
                 where oa.order_id = orders.id and d.profile_id = auth.uid()
                   and oa.status in ('offered','accepted')));

create policy "orders_staff_admin_select"
  on public.orders for select
  using (public.auth_role() in ('admin','dispatcher'));

-- ============================================================================
-- ORDER_ITEMS / ORDER_STATUS_EVENTS — readable by anyone who can read the order.
-- ============================================================================
create policy "order_items_select_via_order"
  on public.order_items for select
  using (exists (select 1 from public.orders o where o.id = order_items.order_id and (
            o.user_id = auth.uid()
            or public.is_merchant_staff(o.restaurant_id)
            or public.auth_role() in ('admin','dispatcher')
            or exists (select 1 from public.drivers d where d.id = o.assigned_driver_id and d.profile_id = auth.uid())
         )));

create policy "order_status_events_select_via_order"
  on public.order_status_events for select
  using (exists (select 1 from public.orders o where o.id = order_status_events.order_id and (
            o.user_id = auth.uid()
            or public.is_merchant_staff(o.restaurant_id)
            or public.auth_role() in ('admin','dispatcher')
            or exists (select 1 from public.drivers d where d.id = o.assigned_driver_id and d.profile_id = auth.uid())
         )));

-- ============================================================================
-- DRIVERS — own profile read/update; public-safe info via a VIEW; admin all.
-- ============================================================================
create policy "drivers_self_select"
  on public.drivers for select
  using (profile_id = auth.uid() or public.auth_role() in ('admin','dispatcher'));

create policy "drivers_self_update"
  on public.drivers for update
  using (profile_id = auth.uid() or public.auth_role() = 'admin')
  with check (profile_id = auth.uid() or public.auth_role() = 'admin');

create policy "drivers_admin_insert"
  on public.drivers for insert
  with check (public.auth_role() = 'admin');

-- Public driver card (customer tracking) — name/photo/vehicle/rating only, never phone/earnings.
create or replace view public.public_drivers as
  select id, name, photo, vehicle, rating from public.drivers where is_active;

grant select on public.public_drivers to anon, authenticated;

-- ============================================================================
-- ORDER_ASSIGNMENTS — driver sees own; dispatcher/admin all. Writes via RPC.
-- ============================================================================
create policy "order_assignments_driver_select"
  on public.order_assignments for select
  using (exists (select 1 from public.drivers d where d.id = order_assignments.driver_id and d.profile_id = auth.uid())
         or public.auth_role() in ('admin','dispatcher'));

-- ============================================================================
-- DRIVER_EARNINGS — driver sees own; admin all.
-- ============================================================================
create policy "driver_earnings_self_select"
  on public.driver_earnings for select
  using (exists (select 1 from public.drivers d where d.id = driver_earnings.driver_id and d.profile_id = auth.uid())
         or public.auth_role() = 'admin');

-- ============================================================================
-- MERCHANT_STAFF — staffer sees own links; admin all.
-- ============================================================================
create policy "merchant_staff_self_select"
  on public.merchant_staff for select
  using (profile_id = auth.uid() or public.auth_role() = 'admin');

create policy "merchant_staff_admin_write"
  on public.merchant_staff for all
  using (public.auth_role() = 'admin')
  with check (public.auth_role() = 'admin');

-- ============================================================================
-- CONFIG — fee rules + platform settings: read by staff/admin; write by admin.
-- ============================================================================
create policy "delivery_fee_rules_read"
  on public.delivery_fee_rules for select using (true);  -- safe to read (used by quote)
create policy "delivery_fee_rules_admin_write"
  on public.delivery_fee_rules for all
  using (public.auth_role() = 'admin') with check (public.auth_role() = 'admin');

create policy "platform_settings_read"
  on public.platform_settings for select using (true);   -- dispatch_mode etc. are non-sensitive
create policy "platform_settings_admin_write"
  on public.platform_settings for all
  using (public.auth_role() = 'admin') with check (public.auth_role() = 'admin');

comment on view public.public_drivers is
  'Public-safe driver columns for the customer tracking card. Excludes phone, earnings, current_geo. Use this in client reads; never select drivers directly as a customer.';
