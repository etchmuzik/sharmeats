-- 142_in_quiet_hours_search_path.sql
--
-- public.in_quiet_hours (mig 138) was created without `set search_path`, which
-- the Supabase security advisor flags as function_search_path_mutable.
--
-- Why it matters here specifically: in_quiet_hours is called by
-- marketing_allowed(), which is SECURITY DEFINER and is the gate
-- send_push_campaign uses to decide whether a customer may be sent marketing.
-- A definer function calling a mutable-search_path function means the callee
-- resolves unqualified names against whatever search_path the CALLER had.
-- in_quiet_hours only calls built-ins (extract, now), so there is no known
-- exploitable path today -- but "no known path" is not the standard this
-- schema holds itself to, and every other function added tonight pins it.
--
-- Also flips it from IMMUTABLE to STABLE, which is the correct volatility:
-- the body reads now(), so its result changes within a transaction boundary.
-- Labelling it IMMUTABLE was wrong and would license the planner to cache a
-- result across statements -- a quiet-hours check that answers with a stale
-- hour is a marketing push sent at 3am.

create or replace function public.in_quiet_hours(
  p_start smallint, p_end smallint, p_tz text
)
returns boolean
language plpgsql
stable
set search_path to 'public','pg_temp'
as $function$
declare v_hour int;
begin
  if p_start is null or p_end is null then return false; end if;
  -- A bad/unknown tz must not silently evaluate as "not quiet" (which would
  -- push during someone's night); treat it as quiet and let it be corrected.
  begin
    v_hour := extract(hour from (now() at time zone coalesce(p_tz, 'Africa/Cairo')))::int;
  exception when others then return true;
  end;
  if p_start = p_end then return false;           -- zero-width window
  elsif p_start < p_end then return v_hour >= p_start and v_hour < p_end;
  else return v_hour >= p_start or v_hour < p_end;  -- wraps midnight (22 -> 7)
  end if;
end;
$function$;

revoke all on function public.in_quiet_hours(smallint, smallint, text) from public, anon, authenticated;

comment on function public.in_quiet_hours(smallint, smallint, text) is
  'True when the current wall-clock hour in p_tz falls inside [start, end), handling windows that wrap midnight. An invalid timezone returns TRUE (suppress) so a bad value cannot cause a 3am push. STABLE (it reads now(), so NOT immutable — mig 138 mislabelled it) with a pinned search_path because marketing_allowed() calls it from a SECURITY DEFINER context. Migs 138, 142.';
