-- 219 — revoke dead client write grants left by default privileges (rule 5b sweep).
--
-- FOUND (2026-08-21 spot-check on verticals → full sweep): ALTER DEFAULT
-- PRIVILEGES on this database grants arwdDxtm to anon/authenticated on every new
-- public table, and ten tables still carry INSERT/UPDATE/DELETE (one also
-- TRUNCATE) grants for client roles with NO RLS write policy that could ever
-- pass for that role. RLS deny-by-default makes the grants unusable today, but
-- each is one careless CREATE POLICY or RLS toggle away from a live hole — and
-- TRUNCATE IGNORES RLS entirely, so the ranking_integrity_audit TRUNCATE grant
-- meant any authenticated caller could wipe that audit table NOW (same class as
-- the mig 139 finding on order_financials_failures / push_campaigns).
--
-- KEPT (write grant backed by a pg_policies entry whose qual is satisfiable for
-- the granted role; verified against live prod policies 2026-08-21):
--   addresses            authenticated I/D  — addresses_owner_all (auth.uid() = user_id)
--   favorites            authenticated I/U/D — favorites_owner_all
--   favorite_items       authenticated I/D  — favorite_items_owner_all (app writes this: apps/customer/src/data/supabase/user.ts)
--   saved_orders         authenticated I/D  — saved_orders_owner_{insert,update,delete}
--   push_tokens          authenticated D    — push_tokens_owner_all (logout token cleanup)
--   kyc_documents        authenticated I    — kyc_documents_insert (self-scoped storage path + subject checks)
--   restaurants          authenticated I    — restaurants_admin_insert (admin + vertical='food')
--   menu_items           authenticated I/U/D — menu_items_merchant_* (is_merchant_manager/staff or admin)
--   menu_sections        authenticated I/U/D — menu_sections_merchant_*
--   delivery_fee_rules   authenticated I/U/D — delivery_fee_rules_admin_* (auth_role() = 'admin')
--   driver_applications  anon+authenticated I — driver_applications_public_insert (public application form),
--                        authenticated U    — driver_applications_admin_update
--   waitlist             anon I             — waitlist_anon_insert (landing form, mig 063)
--
-- anon REVOKEs where a {public}-role write policy technically exists: every such
-- qual is auth.uid()- or auth_role()-based and cannot pass with a NULL uid, so
-- the anon grant is unreachable — dead weight, stripped.
--
-- NOT TOUCHED: spatial_ref_sys, geography_columns, geometry_columns — owned by
-- supabase_admin; the postgres migration role cannot revoke another grantor's
-- grants (mig 102 documented that REVOKE as a silent no-op). The spatial_ref_sys
-- write hole is already closed by the mig 109 guard trigger, and the two
-- *_columns objects are non-updatable PostGIS catalog views — client writes fail
-- regardless of grants.

-- ── No usable client write policy at all → strip every client write ──────────
revoke insert, update, delete           on public.batch_candidate_log     from anon, authenticated;
revoke update, delete                   on public.order_items             from anon, authenticated;
revoke insert, update, delete           on public.promo_redemptions       from anon, authenticated;
revoke insert, update, delete           on public.referrals               from anon, authenticated;
revoke insert, update, delete, truncate on public.ranking_integrity_audit from authenticated;
revoke insert, update, delete           on public.verticals               from anon, authenticated;

-- ── Partially backed → keep the policy-backed paths, strip the rest ──────────
revoke insert, update, delete on public.delivery_fee_rules  from anon;                -- admin policies need authenticated
revoke delete                 on public.driver_applications from anon, authenticated; -- no DELETE policy exists
revoke update                 on public.driver_applications from anon;                -- admin UPDATE qual needs auth
revoke insert, delete         on public.favorite_items      from anon;                -- owner qual needs auth.uid()
revoke update, delete         on public.waitlist            from anon, authenticated; -- only policy is anon INSERT
revoke insert                 on public.waitlist            from authenticated;       -- landing submits as anon

-- ── Asserts: every revoked path is gone, every kept path is intact ───────────
-- has_table_privilege with a comma list is true if ANY listed privilege is held.
do $$
declare
  bad text := '';
begin
  -- must be GONE
  if has_table_privilege('anon',          'public.batch_candidate_log',     'insert, update, delete')           then bad := bad || ' batch_candidate_log:anon-writes';     end if;
  if has_table_privilege('authenticated', 'public.batch_candidate_log',     'insert, update, delete')           then bad := bad || ' batch_candidate_log:auth-writes';     end if;
  if has_table_privilege('anon',          'public.order_items',             'update, delete')                   then bad := bad || ' order_items:anon-writes';             end if;
  if has_table_privilege('authenticated', 'public.order_items',             'update, delete')                   then bad := bad || ' order_items:auth-writes';             end if;
  if has_table_privilege('anon',          'public.promo_redemptions',       'insert, update, delete')           then bad := bad || ' promo_redemptions:anon-writes';       end if;
  if has_table_privilege('authenticated', 'public.promo_redemptions',       'insert, update, delete')           then bad := bad || ' promo_redemptions:auth-writes';       end if;
  if has_table_privilege('anon',          'public.referrals',               'insert, update, delete')           then bad := bad || ' referrals:anon-writes';               end if;
  if has_table_privilege('authenticated', 'public.referrals',               'insert, update, delete')           then bad := bad || ' referrals:auth-writes';               end if;
  if has_table_privilege('authenticated', 'public.ranking_integrity_audit', 'insert, update, delete, truncate') then bad := bad || ' ranking_integrity_audit:auth-writes'; end if;
  if has_table_privilege('anon',          'public.verticals',               'insert, update, delete')           then bad := bad || ' verticals:anon-writes';               end if;
  if has_table_privilege('authenticated', 'public.verticals',               'insert, update, delete')           then bad := bad || ' verticals:auth-writes';               end if;
  if has_table_privilege('anon',          'public.delivery_fee_rules',      'insert, update, delete')           then bad := bad || ' delivery_fee_rules:anon-writes';      end if;
  if has_table_privilege('anon',          'public.driver_applications',     'update, delete')                   then bad := bad || ' driver_applications:anon-ud';         end if;
  if has_table_privilege('authenticated', 'public.driver_applications',     'delete')                           then bad := bad || ' driver_applications:auth-delete';     end if;
  if has_table_privilege('anon',          'public.favorite_items',          'insert, delete')                   then bad := bad || ' favorite_items:anon-writes';          end if;
  if has_table_privilege('anon',          'public.waitlist',                'update, delete')                   then bad := bad || ' waitlist:anon-ud';                    end if;
  if has_table_privilege('authenticated', 'public.waitlist',                'insert, update, delete')           then bad := bad || ' waitlist:auth-writes';                end if;

  -- must REMAIN (policy-backed live paths; each checked individually)
  if not has_table_privilege('authenticated', 'public.delivery_fee_rules',  'insert') then bad := bad || ' LOST:delivery_fee_rules:auth-insert';  end if;
  if not has_table_privilege('authenticated', 'public.delivery_fee_rules',  'update') then bad := bad || ' LOST:delivery_fee_rules:auth-update';  end if;
  if not has_table_privilege('authenticated', 'public.delivery_fee_rules',  'delete') then bad := bad || ' LOST:delivery_fee_rules:auth-delete';  end if;
  if not has_table_privilege('anon',          'public.driver_applications', 'insert') then bad := bad || ' LOST:driver_applications:anon-insert'; end if;
  if not has_table_privilege('authenticated', 'public.driver_applications', 'insert') then bad := bad || ' LOST:driver_applications:auth-insert'; end if;
  if not has_table_privilege('authenticated', 'public.driver_applications', 'update') then bad := bad || ' LOST:driver_applications:auth-update'; end if;
  if not has_table_privilege('authenticated', 'public.favorite_items',      'insert') then bad := bad || ' LOST:favorite_items:auth-insert';      end if;
  if not has_table_privilege('authenticated', 'public.favorite_items',      'delete') then bad := bad || ' LOST:favorite_items:auth-delete';      end if;
  if not has_table_privilege('anon',          'public.waitlist',            'insert') then bad := bad || ' LOST:waitlist:anon-insert';            end if;
  if not has_table_privilege('authenticated', 'public.addresses',           'insert') then bad := bad || ' LOST:addresses:auth-insert';           end if;
  if not has_table_privilege('authenticated', 'public.addresses',           'delete') then bad := bad || ' LOST:addresses:auth-delete';           end if;
  if not has_table_privilege('authenticated', 'public.favorites',           'insert') then bad := bad || ' LOST:favorites:auth-insert';           end if;
  if not has_table_privilege('authenticated', 'public.favorites',           'update') then bad := bad || ' LOST:favorites:auth-update';           end if;
  if not has_table_privilege('authenticated', 'public.favorites',           'delete') then bad := bad || ' LOST:favorites:auth-delete';           end if;
  if not has_table_privilege('authenticated', 'public.saved_orders',        'insert') then bad := bad || ' LOST:saved_orders:auth-insert';        end if;
  if not has_table_privilege('authenticated', 'public.saved_orders',        'delete') then bad := bad || ' LOST:saved_orders:auth-delete';        end if;
  if not has_table_privilege('authenticated', 'public.push_tokens',         'delete') then bad := bad || ' LOST:push_tokens:auth-delete';         end if;
  if not has_table_privilege('authenticated', 'public.kyc_documents',       'insert') then bad := bad || ' LOST:kyc_documents:auth-insert';       end if;
  if not has_table_privilege('authenticated', 'public.restaurants',         'insert') then bad := bad || ' LOST:restaurants:auth-insert';         end if;
  if not has_table_privilege('authenticated', 'public.menu_items',          'insert') then bad := bad || ' LOST:menu_items:auth-insert';          end if;
  if not has_table_privilege('authenticated', 'public.menu_items',          'update') then bad := bad || ' LOST:menu_items:auth-update';          end if;
  if not has_table_privilege('authenticated', 'public.menu_items',          'delete') then bad := bad || ' LOST:menu_items:auth-delete';          end if;
  if not has_table_privilege('authenticated', 'public.menu_sections',       'insert') then bad := bad || ' LOST:menu_sections:auth-insert';       end if;
  if not has_table_privilege('authenticated', 'public.menu_sections',       'update') then bad := bad || ' LOST:menu_sections:auth-update';       end if;
  if not has_table_privilege('authenticated', 'public.menu_sections',       'delete') then bad := bad || ' LOST:menu_sections:auth-delete';       end if;

  if bad <> '' then
    raise exception 'mig 219 grant assertions failed:%', bad;
  end if;
end $$;
