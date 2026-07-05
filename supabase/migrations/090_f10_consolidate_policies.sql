-- 090_f10_consolidate_policies.sql
-- F10 (2026-07-05 audit): remove the 48 multiple_permissive_policies advisor
-- warnings without changing WHO can do WHAT. Two mechanical patterns:
--
--   1. orders had four permissive SELECT policies (owner/driver/merchant/staff);
--      merged into ONE policy whose USING is the exact OR of the four quals.
--   2. Seven tables had a FOR ALL write policy overlapping a separate SELECT
--      policy (ALL includes SELECT). The ALL policy is split into
--      INSERT/UPDATE/DELETE with identical expressions; the read side is left
--      as (or merged into) a single SELECT policy.
--
-- Access-equivalence notes (why nothing widens or narrows):
--   * menu_items: public read was (is_available = true); merchants/admin also
--     read hidden items via their ALL policy. The merged read policy is the OR
--     of both — same audience, same rows.
--   * menu_sections/modifiers/modifier_options/delivery_fee_rules/
--     platform_settings: public read qual is TRUE, which already covers
--     merchants and admins — dropping the ALL policy's implicit SELECT loses
--     nothing.
--   * merchant_staff: self_select already includes the admin arm.
--
-- All new expressions use (select auth.uid())/(select auth_role()) so this
-- migration also stands alone w.r.t. the initplan advisor (F5/089).
-- Idempotent: drop policy if exists + create (guarded by prior drop).
-- Rollback: recreate the original policies from the audit-report policy dump.

-- 1 · orders: 4 SELECT policies -> 1 ------------------------------------------------
drop policy if exists orders_owner_select      on public.orders;
drop policy if exists orders_driver_select     on public.orders;
drop policy if exists orders_merchant_select   on public.orders;
drop policy if exists orders_staff_admin_select on public.orders;
drop policy if exists orders_select            on public.orders;
create policy orders_select on public.orders for select using (
  ((select auth.uid()) = user_id)
  or public.is_merchant_staff(restaurant_id)
  or ((select auth_role()) = any (array['admin'::public.app_role, 'dispatcher'::public.app_role]))
  or (exists (select 1 from public.drivers d
        where d.id = orders.assigned_driver_id and d.profile_id = (select auth.uid())))
  or (exists (select 1 from public.order_assignments oa
        join public.drivers d on d.id = oa.driver_id
        where oa.order_id = orders.id and d.profile_id = (select auth.uid())
          and oa.status = any (array['offered'::text, 'accepted'::text])))
);

-- 2 · menu_items: merge reads, split writes -----------------------------------------
drop policy if exists menu_items_public_read    on public.menu_items;
drop policy if exists menu_items_merchant_write on public.menu_items;
drop policy if exists menu_items_read           on public.menu_items;
drop policy if exists menu_items_merchant_insert on public.menu_items;
drop policy if exists menu_items_merchant_update on public.menu_items;
drop policy if exists menu_items_merchant_delete on public.menu_items;
create policy menu_items_read on public.menu_items for select using (
  (is_available = true)
  or public.is_merchant_staff(restaurant_id)
  or ((select auth_role()) = 'admin'::public.app_role)
);
create policy menu_items_merchant_insert on public.menu_items for insert
  with check (public.is_merchant_staff(restaurant_id) or ((select auth_role()) = 'admin'::public.app_role));
create policy menu_items_merchant_update on public.menu_items for update
  using (public.is_merchant_staff(restaurant_id) or ((select auth_role()) = 'admin'::public.app_role))
  with check (public.is_merchant_staff(restaurant_id) or ((select auth_role()) = 'admin'::public.app_role));
create policy menu_items_merchant_delete on public.menu_items for delete
  using (public.is_merchant_staff(restaurant_id) or ((select auth_role()) = 'admin'::public.app_role));

-- 3 · menu_sections: read TRUE stays; split the ALL ----------------------------------
drop policy if exists menu_sections_merchant_write on public.menu_sections;
drop policy if exists menu_sections_merchant_insert on public.menu_sections;
drop policy if exists menu_sections_merchant_update on public.menu_sections;
drop policy if exists menu_sections_merchant_delete on public.menu_sections;
create policy menu_sections_merchant_insert on public.menu_sections for insert
  with check (public.is_merchant_staff(restaurant_id) or ((select auth_role()) = 'admin'::public.app_role));
create policy menu_sections_merchant_update on public.menu_sections for update
  using (public.is_merchant_staff(restaurant_id) or ((select auth_role()) = 'admin'::public.app_role))
  with check (public.is_merchant_staff(restaurant_id) or ((select auth_role()) = 'admin'::public.app_role));
create policy menu_sections_merchant_delete on public.menu_sections for delete
  using (public.is_merchant_staff(restaurant_id) or ((select auth_role()) = 'admin'::public.app_role));

-- 4 · modifiers -----------------------------------------------------------------------
drop policy if exists modifiers_merchant_write on public.modifiers;
drop policy if exists modifiers_merchant_insert on public.modifiers;
drop policy if exists modifiers_merchant_update on public.modifiers;
drop policy if exists modifiers_merchant_delete on public.modifiers;
create policy modifiers_merchant_insert on public.modifiers for insert
  with check (exists (select 1 from public.menu_items mi
    where mi.id = modifiers.item_id
      and (public.is_merchant_staff(mi.restaurant_id) or ((select auth_role()) = 'admin'::public.app_role))));
create policy modifiers_merchant_update on public.modifiers for update
  using (exists (select 1 from public.menu_items mi
    where mi.id = modifiers.item_id
      and (public.is_merchant_staff(mi.restaurant_id) or ((select auth_role()) = 'admin'::public.app_role))))
  with check (exists (select 1 from public.menu_items mi
    where mi.id = modifiers.item_id
      and (public.is_merchant_staff(mi.restaurant_id) or ((select auth_role()) = 'admin'::public.app_role))));
create policy modifiers_merchant_delete on public.modifiers for delete
  using (exists (select 1 from public.menu_items mi
    where mi.id = modifiers.item_id
      and (public.is_merchant_staff(mi.restaurant_id) or ((select auth_role()) = 'admin'::public.app_role))));

-- 5 · modifier_options ------------------------------------------------------------------
drop policy if exists modifier_options_merchant_write on public.modifier_options;
drop policy if exists modifier_options_merchant_insert on public.modifier_options;
drop policy if exists modifier_options_merchant_update on public.modifier_options;
drop policy if exists modifier_options_merchant_delete on public.modifier_options;
create policy modifier_options_merchant_insert on public.modifier_options for insert
  with check (exists (select 1 from public.modifiers m
    join public.menu_items mi on mi.id = m.item_id
    where m.id = modifier_options.modifier_id
      and (public.is_merchant_staff(mi.restaurant_id) or ((select auth_role()) = 'admin'::public.app_role))));
create policy modifier_options_merchant_update on public.modifier_options for update
  using (exists (select 1 from public.modifiers m
    join public.menu_items mi on mi.id = m.item_id
    where m.id = modifier_options.modifier_id
      and (public.is_merchant_staff(mi.restaurant_id) or ((select auth_role()) = 'admin'::public.app_role))))
  with check (exists (select 1 from public.modifiers m
    join public.menu_items mi on mi.id = m.item_id
    where m.id = modifier_options.modifier_id
      and (public.is_merchant_staff(mi.restaurant_id) or ((select auth_role()) = 'admin'::public.app_role))));
create policy modifier_options_merchant_delete on public.modifier_options for delete
  using (exists (select 1 from public.modifiers m
    join public.menu_items mi on mi.id = m.item_id
    where m.id = modifier_options.modifier_id
      and (public.is_merchant_staff(mi.restaurant_id) or ((select auth_role()) = 'admin'::public.app_role))));

-- 6 · delivery_fee_rules -------------------------------------------------------------------
drop policy if exists delivery_fee_rules_admin_write on public.delivery_fee_rules;
drop policy if exists delivery_fee_rules_admin_insert on public.delivery_fee_rules;
drop policy if exists delivery_fee_rules_admin_update on public.delivery_fee_rules;
drop policy if exists delivery_fee_rules_admin_delete on public.delivery_fee_rules;
create policy delivery_fee_rules_admin_insert on public.delivery_fee_rules for insert
  with check ((select auth_role()) = 'admin'::public.app_role);
create policy delivery_fee_rules_admin_update on public.delivery_fee_rules for update
  using ((select auth_role()) = 'admin'::public.app_role)
  with check ((select auth_role()) = 'admin'::public.app_role);
create policy delivery_fee_rules_admin_delete on public.delivery_fee_rules for delete
  using ((select auth_role()) = 'admin'::public.app_role);

-- 7 · platform_settings ----------------------------------------------------------------------
drop policy if exists platform_settings_admin_write on public.platform_settings;
drop policy if exists platform_settings_admin_insert on public.platform_settings;
drop policy if exists platform_settings_admin_update on public.platform_settings;
drop policy if exists platform_settings_admin_delete on public.platform_settings;
create policy platform_settings_admin_insert on public.platform_settings for insert
  with check ((select auth_role()) = 'admin'::public.app_role);
create policy platform_settings_admin_update on public.platform_settings for update
  using ((select auth_role()) = 'admin'::public.app_role)
  with check ((select auth_role()) = 'admin'::public.app_role);
create policy platform_settings_admin_delete on public.platform_settings for delete
  using ((select auth_role()) = 'admin'::public.app_role);

-- 8 · merchant_staff ---------------------------------------------------------------------------
drop policy if exists merchant_staff_admin_write on public.merchant_staff;
drop policy if exists merchant_staff_admin_insert on public.merchant_staff;
drop policy if exists merchant_staff_admin_update on public.merchant_staff;
drop policy if exists merchant_staff_admin_delete on public.merchant_staff;
create policy merchant_staff_admin_insert on public.merchant_staff for insert
  with check ((select auth_role()) = 'admin'::public.app_role);
create policy merchant_staff_admin_update on public.merchant_staff for update
  using ((select auth_role()) = 'admin'::public.app_role)
  with check ((select auth_role()) = 'admin'::public.app_role);
create policy merchant_staff_admin_delete on public.merchant_staff for delete
  using ((select auth_role()) = 'admin'::public.app_role);
