-- 199_site_health_watchdog.sql
--
-- The database watches the websites. Every 10 minutes a cron probes the
-- public surfaces over HTTP and raises ops_alert (the existing Telegram path,
-- migs 115/116) when one stops answering — and again when it recovers.
--
-- WHY: the 2026-07-30 audit found production had served a build ~8 weeks stale,
-- including 404s on the Play Data Safety pages Google checks, and nothing
-- noticed because nothing was looking. The deploy workflow closes the
-- stale-content gap; this closes the is-it-even-up gap. Zero new services —
-- pg_cron + pg_net + ops_alert are all already installed and wired.
--
-- SHAPE — self-pipelining, because pg_net is ASYNC. net.http_get() queues a
-- request and returns an id; the response lands in net._http_response later.
-- So each sweep does two things: (1) evaluate the responses to the requests the
-- PREVIOUS sweep fired, then (2) fire fresh requests for the next sweep. A
-- probe is therefore judged ~10 minutes after it was sent, which for an uptime
-- check is fine — and it means the sweep itself never blocks on the network.
--
-- ALERT DISCIPLINE — transitions only, debounced by one cycle:
--   * first failed evaluation marks failing_since and stays QUIET (one blip on
--     a 10-minute cadence is noise);
--   * second consecutive failure alerts, once (alerted flag);
--   * recovery alerts only if the failure was alerted, then clears state.
-- So a flap costs at most one alert + one all-clear, and a real outage is
-- reported 10–20 minutes in, with Telegram never spammed on every cycle.

-- ---------------------------------------------------------------------------
-- State: one row per watched URL.
-- ---------------------------------------------------------------------------
create table if not exists public.site_health_checks (
  url            text primary key,
  request_id     bigint,           -- pg_net id of the probe in flight (null = none yet)
  fired_at       timestamptz,
  last_status    int,              -- last observed HTTP status (null = no response)
  last_ok_at     timestamptz,
  failing_since  timestamptz,      -- null = healthy
  alerted        boolean not null default false
);

-- House rule 5b: default privileges grant broadly on every new table, and
-- TRUNCATE ignores RLS. Ops-internal table — no client role touches it; the
-- RLS-on-no-policies shape follows promo_codes (mig 019).
revoke all on table public.site_health_checks from public, anon, authenticated;
alter table public.site_health_checks enable row level security;

comment on table public.site_health_checks is
  'Uptime state for the public web surfaces, maintained by site_health_sweep() (cron, every 10 min). Ops-internal: no client policies by design.';

insert into public.site_health_checks (url) values
  ('https://sharmeats.online/'),
  ('https://sharmeats.online/track/'),
  ('https://merchant.sharmeats.online/'),
  ('https://admin.sharmeats.online/')
on conflict (url) do nothing;

-- ---------------------------------------------------------------------------
-- The sweep.
-- ---------------------------------------------------------------------------
create or replace function public.site_health_sweep()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row    public.site_health_checks;
  v_status int;
  v_ok     boolean;
  v_req    bigint;
begin
  for v_row in select * from public.site_health_checks order by url loop
    begin
      -- (1) Evaluate the probe the PREVIOUS sweep fired. request_id null means
      -- there is nothing to judge yet (first run, or a fire that failed) — skip
      -- evaluation entirely rather than treating "never asked" as "down".
      if v_row.request_id is not null then
        select r.status_code into v_status
          from net._http_response r
         where r.id = v_row.request_id;
        -- A missing row after ~10 minutes is a timeout or an expired response:
        -- either way the site did not provably answer. found=false → v_status null.
        v_ok := v_status is not null and v_status between 200 and 299;

        if v_ok then
          if v_row.alerted then
            perform public.ops_alert('✅ Site recovered: ' || v_row.url
              || ' (status ' || v_status || ')');
          end if;
          update public.site_health_checks
             set last_status = v_status, last_ok_at = now(),
                 failing_since = null, alerted = false
           where url = v_row.url;
        else
          if v_row.failing_since is null then
            -- First bad evaluation: mark, stay quiet (debounce one cycle).
            update public.site_health_checks
               set last_status = v_status, failing_since = now()
             where url = v_row.url;
          elsif not v_row.alerted then
            -- Second consecutive: this is real. Say it once.
            perform public.ops_alert('🔴 Site check FAILING: ' || v_row.url
              || coalesce(' (status ' || v_status || ')', ' (no response)')
              || ' since ' || to_char(v_row.failing_since, 'HH24:MI') || ' UTC');
            update public.site_health_checks
               set last_status = v_status, alerted = true
             where url = v_row.url;
          else
            update public.site_health_checks
               set last_status = v_status where url = v_row.url;
          end if;
        end if;
      end if;

      -- (2) Fire the next probe. Fully qualified: search_path excludes net.
      v_req := net.http_get(
        url => v_row.url,
        headers => '{"User-Agent": "sharmeats-health/1"}'::jsonb,
        timeout_milliseconds => 8000
      );
      update public.site_health_checks
         set request_id = v_req, fired_at = now()
       where url = v_row.url;

    exception when others then
      -- One URL's failure must not stop the others being checked.
      raise warning 'site_health_sweep(%) failed: %', v_row.url, sqlerrm;
    end;
  end loop;
end;
$$;

revoke all on function public.site_health_sweep() from public, anon, authenticated;

comment on function public.site_health_sweep() is
  'Evaluates last cycle''s HTTP probes of the public surfaces and fires the next ones (pg_net, async). Alerts via ops_alert on the second consecutive failure and on recovery. Cron: every 10 minutes.';

-- cron.schedule upserts by name — idempotent on replay.
select cron.schedule(
  'sharmeats-site-health',
  '*/10 * * * *',
  $$select public.site_health_sweep()$$
);
