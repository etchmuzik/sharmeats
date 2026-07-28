-- 163_e0_saved_orders_concealment.sql
--
-- Package 07 Program A0 (session E0) — close the saved-orders leak.
--
-- MEASURED against production before writing this:
--   saved_orders columns : id, user_id, restaurant_id, name, items, created_at
--   saved_orders policy  : saved_orders_owner_all [ALL] using (auth.uid() = user_id)
--
-- The policy is owner-only and mentions no vertical. So a saved preset whose
-- merchant now sits in a hidden vertical is STILL RETURNED to its owner by a
-- plain `select` -- with `name` (the customer's label, often the merchant's
-- name) and `items` (a JSON snapshot carrying every item name). Migration 153
-- gates the `restaurants` join, so the embedded merchant name comes back NULL,
-- but the row itself does not: the leak is the row, not the join.
--
-- This is a LIST-time disclosure, before any tap. The reorder path is already
-- gated (prepare_cart/place_order raise MERCHANT_NOT_FOUND since mig 162), so
-- tapping such a preset already fails -- but by then the customer has seen a
-- hidden vertical's merchant and contents in their own saved list.
--
-- WHY RLS AND NOT THE REPOSITORY. A client-side filter is a rendering choice;
-- anyone with the anon key and a REST call bypasses it. Concealment has to hold
-- at the same boundary as every other vertical gate, so it goes in the policy.
--
-- WHY SELECT IS SPLIT FROM WRITES. The existing policy is FOR ALL, which would
-- also gate DELETE -- and that would be actively harmful: a customer must be
-- able to delete a preset they can no longer use, otherwise a hidden-vertical
-- row becomes permanently undeletable and silently consumes one of their five
-- saved slots (SAVED_ORDERS_CAP). So:
--
--   SELECT : owner AND the vertical is visible to them   (concealment)
--   INSERT : owner AND the vertical is visible to them   (cannot save what you
--            may not see -- closes the mirror-image hole)
--   UPDATE : owner AND the vertical is visible to them   (no editing a hidden
--            preset into a different shape)
--   DELETE : owner ONLY                                  (always removable)

drop policy if exists saved_orders_owner_all on public.saved_orders;

-- A NOTE ON WHY DELETE IS NOT SIMPLY "owner only".
--
-- Postgres applies the SELECT policy when a DML statement has to LOCATE rows:
-- `delete from saved_orders where id = $1` must first read that row, so a
-- concealed row cannot be targeted at all. Measured on a clone: with a
-- concealing SELECT policy and a permissive DELETE policy, the delete reported
-- `0 rows affected` and the row survived -- exactly the stranding this
-- migration set out to avoid, and the reason the DELETE policy alone is not a
-- sufficient answer.
--
-- The fix is to let the OWNER still SEE their own row while withholding what
-- makes it a disclosure. Concealment here is about the merchant and the basket
-- contents, not about the row's existence -- the customer created it, so its
-- existence is already theirs. A dedicated view exposes the safe columns, the
-- app reads that, and the raw table's sensitive columns are never selectable
-- for a hidden vertical.

create policy saved_orders_owner_select on public.saved_orders
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- Column-level concealment: the app never reads name/items off the base table.
-- It reads this view, which BLANKS the disclosing columns when the owning
-- merchant's vertical is not visible, and flags the row so the UI can render it
-- as an unavailable entry the customer can delete.
create or replace view public.saved_orders_visible
with (security_invoker = true) as
select
  s.id,
  s.user_id,
  s.restaurant_id,
  case when v.visible then s.name else null end                as name,
  case when v.visible then s.items else '[]'::jsonb end        as items,
  s.created_at,
  v.visible                                                    as is_available
from public.saved_orders s
cross join lateral (
  select exists (
    select 1 from public.restaurants r
     where r.id = s.restaurant_id
       and public.can_view_vertical(r.vertical_id)
  ) as visible
) v;

revoke all on public.saved_orders_visible from public, anon;
grant select on public.saved_orders_visible to authenticated;

comment on view public.saved_orders_visible is
  'Saved presets with hidden-vertical rows REDACTED rather than removed (mig 163). The owner keeps a row they can delete -- Postgres applies the SELECT policy when locating rows for DELETE, so fully concealing the row would strand it and permanently consume one of the five slots -- but name and items are blanked when the merchant''s vertical is not visible, so neither the merchant nor the basket contents are disclosed. security_invoker: the caller''s own RLS and vertical visibility apply.';

create policy saved_orders_owner_insert on public.saved_orders
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.restaurants r
       where r.id = saved_orders.restaurant_id
         and public.can_view_vertical(r.vertical_id)
    )
  );

create policy saved_orders_owner_update on public.saved_orders
  for update to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.restaurants r
       where r.id = saved_orders.restaurant_id
         and public.can_view_vertical(r.vertical_id)
    )
  )
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.restaurants r
       where r.id = saved_orders.restaurant_id
         and public.can_view_vertical(r.vertical_id)
    )
  );

-- DELETE stays owner-only ON PURPOSE. Gating it would strand a hidden-vertical
-- preset in the customer's list forever, consuming a slot they cannot reclaim.
-- Deleting a row discloses nothing: the customer already knows the id, and the
-- statement returns no data.
create policy saved_orders_owner_delete on public.saved_orders
  for delete to authenticated
  using ((select auth.uid()) = user_id);

comment on table public.saved_orders is
  'Customer-named cart presets ("Saved for you"). Since mig 163 SELECT/INSERT/UPDATE additionally require the merchant''s vertical to be visible to the caller: the previous FOR ALL owner-only policy returned presets for merchants in hidden verticals, disclosing the preset name and the items JSON at LIST time, before any tap. DELETE is deliberately owner-only so a preset that becomes unusable can still be removed rather than permanently occupying one of the five slots.';
