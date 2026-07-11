-- 099: pin search_path on app trigger helpers (advisor: function_search_path_mutable).
-- Behavior-neutral: ALTER FUNCTION ... SET only; bodies unchanged. Idempotent.
-- Originally authored as a second "095_*" file and applied to prod
-- ilqpsebcfbaoaogimhud on 2026-07-06 via MCP apply_migration (history version
-- 20260705212120). Renumbered 095 -> 099 to remove the local filename-prefix
-- collision that would break `supabase db push`/repair linearity; prod is
-- unaffected (the ALTERs are already live and re-applying them is a no-op).
alter function public.touch_updated_at() set search_path = public, pg_temp;
alter function public.generate_order_short_code() set search_path = public, pg_temp;
alter function public.set_order_short_code() set search_path = public, pg_temp;
