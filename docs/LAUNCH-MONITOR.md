# Launch-day monitoring — Sharm Eats 1.0

Run these against prod (Supabase SQL editor or via the Supabase MCP) to confirm
the live system is healthy and auto-dispatch is handling real orders.

## 1. System heartbeat (run anytime)

```sql
select
  (select value #>> '{}' from public.platform_settings where key='dispatch_mode') as dispatch_mode,        -- expect 'auto'
  (select count(*) from cron.job_run_details jrd join cron.job j on j.jobid=jrd.jobid
    where j.jobname='sharmeats-dispatch-sweep' and jrd.status='succeeded'
      and jrd.start_time > now() - interval '10 minutes') as sweeps_ok_10min,                              -- expect ~30
  (select count(*) from cron.job_run_details jrd join cron.job j on j.jobid=jrd.jobid
    where j.jobname='sharmeats-dispatch-sweep' and jrd.status='failed'
      and jrd.start_time > now() - interval '1 hour') as sweeps_failed_1h,                                  -- expect 0
  (select count(*) from public.drivers where is_active and is_verified and status='online') as drivers_online,
  (select count(*) from public.restaurants where is_active and is_open) as open_restaurants,
  (select count(*) from public.orders where placed_at > now() - interval '24 hours') as orders_24h;
```

## 2. Auto-dispatch in action (run when orders start coming in)

```sql
-- Recent orders + whether auto-dispatch offered/assigned them
select o.short_code, o.status, o.dispatch_mode, o.placed_at,
       oa.status as assignment_status, oa.assigned_by, oa.offer_expires_at,
       d.name as driver_name, d.status as driver_status
  from public.orders o
  left join public.order_assignments oa
    on oa.order_id = o.id and oa.status in ('offered','accepted')
  left join public.drivers d on d.id = oa.driver_id
 where o.placed_at > now() - interval '6 hours'
 order by o.placed_at desc
 limit 20;
```

What healthy looks like: a `ready` order gets an `offered` row with `assigned_by='auto'` within ~20s, a future `offer_expires_at`, and a real driver name. If the driver accepts → `assignment_status='accepted'`. If they ignore it → after the TTL it flips to `rejected` and re-offers to the next driver.

## 3. Referrals working (run when invites start)

```sql
select count(*) as referrals_total,
       count(*) filter (where reward_status='pending')  as pending,
       count(*) filter (where reward_status='rewarded') as rewarded
  from public.referrals;
-- and: how many users have generated a referral code yet
select count(*) filter (where referral_code is not null) as users_with_code from public.users;
```

## 4. Errors to watch (run if something seems off)

- Edge-function logs (expo-push delivery): Supabase Dashboard → Edge Functions → Logs, or MCP `get_logs(edge-function)`.
- Postgres logs for `auto_assign_order` warnings (the function raises a WARNING on real failures): MCP `get_logs(postgres)`, grep for `auto_assign_order`.

## Kill switch

If auto-dispatch misbehaves, pause it instantly (orders fall back to manual dispatcher assignment — nothing breaks):

```sql
update public.platform_settings set value = to_jsonb('manual'::text) where key='dispatch_mode';
```

Re-enable with `to_jsonb('auto'::text)`.
