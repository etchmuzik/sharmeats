-- 118_ops_stats_text.sql
--
-- On-demand stats for the ops Telegram bot's /today and /week commands
-- (served by the telegram-bot edge function; see mig 117 for the push feed).
-- One definer function returns the fully formatted message so all stats +
-- formatting logic lives in SQL next to ops_daily_digest, and the edge
-- function stays a thin auth-and-relay shim.
--
-- Same money semantics as the digest [117]: order counts include everything
-- placed in the window; revenue excludes cancelled/rejected. "in flight" is
-- platform-wide (any active order regardless of when placed) — at 23:50 an
-- order from 23:40 still needs eyes.
--
-- Callable ONLY by service_role (the edge function's key). Unknown scope
-- returns NULL (edge fn answers with help text) — fail closed, no exception.
--
-- The bot's webhook secret lives in platform_settings.telegram_webhook_secret
-- (seeded at deploy time via SQL, NEVER committed to the repo).

create or replace function public.ops_stats_text(p_scope text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_day    date;
  v_from   timestamptz;
  v_orders int;
  v_gone   int;
  v_rev    bigint;
  v_active int;
  v_lines  text;
begin
  v_day := (now() at time zone 'Africa/Cairo')::date;

  if p_scope = 'today' then
    v_from := v_day::timestamp at time zone 'Africa/Cairo';

    select count(*),
           count(*) filter (where status in ('cancelled', 'rejected')),
           coalesce(sum(total_egp) filter (where status not in ('cancelled', 'rejected')), 0)
      into v_orders, v_gone, v_rev
      from public.orders
     where placed_at >= v_from;

    select count(*) into v_active
      from public.orders
     where status not in ('delivered', 'cancelled', 'rejected');

    if v_orders = 0 then
      return '📊 Today ' || to_char(v_day, 'DD Mon') || ': no orders'
          || case when v_active > 0
                  then E'\n' || v_active || ' in flight' else '' end;
    end if;

    return '📊 Today ' || to_char(v_day, 'DD Mon') || E'\n'
        || v_orders || ' order' || case when v_orders = 1 then '' else 's' end
        || ' · EGP ' || to_char(v_rev, 'FM999,999,999')
        || case when v_gone > 0 then ' · ' || v_gone || ' ❌' else '' end
        || E'\n' || v_active || ' in flight'
        || case when v_orders > v_gone
                then ' · avg EGP ' || round(v_rev::numeric / (v_orders - v_gone))
                else '' end;

  elsif p_scope = 'week' then
    v_from := (v_day - 6)::timestamp at time zone 'Africa/Cairo';

    select count(*),
           count(*) filter (where status in ('cancelled', 'rejected')),
           coalesce(sum(total_egp) filter (where status not in ('cancelled', 'rejected')), 0)
      into v_orders, v_gone, v_rev
      from public.orders
     where placed_at >= v_from;

    -- One compact line per Cairo day, zero-days included (rhythm matters).
    select string_agg(t.line, E'\n' order by t.d) into v_lines
      from (
        select d.d::date as d,
               to_char(d.d, 'Dy DD') || ' · ' || count(o.id) || ' · EGP '
            || to_char(coalesce(sum(o.total_egp) filter (
                 where o.status not in ('cancelled', 'rejected')), 0), 'FM999,999,999')
            || case when count(*) filter (where o.status in ('cancelled', 'rejected')) > 0
                    then ' · ' || count(*) filter (where o.status in ('cancelled', 'rejected')) || '❌'
                    else '' end as line
          from generate_series(v_day - 6, v_day, interval '1 day') as d(d)
          left join public.orders o
            on o.placed_at >= v_from
           and (o.placed_at at time zone 'Africa/Cairo')::date = d.d::date
         group by d.d
      ) t;

    return '📊 Last 7 days: '
        || v_orders || ' order' || case when v_orders = 1 then '' else 's' end
        || ' · EGP ' || to_char(v_rev, 'FM999,999,999')
        || case when v_gone > 0 then ' · ' || v_gone || ' ❌' else '' end
        || E'\n' || v_lines;
  end if;

  return null;  -- unknown scope: fail closed, edge fn replies with help
end;
$$;

revoke all on function public.ops_stats_text(text) from public, anon, authenticated;
grant execute on function public.ops_stats_text(text) to service_role;
