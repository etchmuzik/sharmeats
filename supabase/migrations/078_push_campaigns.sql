-- 078_push_campaigns.sql
-- Marketing push-campaign tooling (P1 growth from the 2026-07-03 gap analysis).
-- Push is the only owned re-engagement channel (no email/WhatsApp API), and the
-- token audience is already collected — but there was no way to send a targeted
-- broadcast. This adds a campaign audit table + an ADMIN RPC that resolves a
-- customer segment, records the send, and fans out custom copy via expo-push.
--
-- Segments (kept simple, expandable):
--   'all'            — every customer with a push token
--   'lapsed'         — customers whose last order was > segment_days ago
--   'never_ordered'  — signed-up customers who never placed an order
--   'zone'           — customers whose most recent order delivered to a given zone
--
-- expo-push now accepts optional title/body (custom copy) — this RPC uses that.
-- Non-destructive: new table + RPC. Idempotent.

create table if not exists public.push_campaigns (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  body          text not null,
  segment       text not null,
  segment_param text,                          -- e.g. days for 'lapsed', zone id for 'zone'
  recipients    int not null default 0,
  sent_by       uuid references public.users(id),
  created_at    timestamptz not null default now()
);
create index if not exists push_campaigns_created_idx on public.push_campaigns (created_at desc);

comment on table public.push_campaigns is
  'Audit trail of marketing push campaigns. One row per send: copy, segment, resolved recipient count, who sent it. Sends go through send_push_campaign (admin).';

alter table public.push_campaigns enable row level security;
create policy push_campaigns_admin_select on public.push_campaigns
  for select using (public.auth_role() = 'admin');

-- ============================================================================
-- send_push_campaign — ADMIN resolves a segment to customer ids, records the
-- campaign, and POSTs custom copy to expo-push. Returns the recipient count.
-- ============================================================================
create or replace function public.send_push_campaign(
  p_title text, p_body text, p_segment text, p_segment_param text default null
)
returns int
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_agent   uuid := auth.uid();
  v_base    text;
  v_secret  text;
  v_headers jsonb;
  v_ids     jsonb;
  v_count   int;
  v_days    int;
begin
  if v_agent is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;
  if coalesce(public.auth_role()::text,'') <> 'admin' then raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation'; end if;
  if p_title is null or length(btrim(p_title)) = 0 or p_body is null or length(btrim(p_body)) = 0 then
    raise exception 'EMPTY_COPY' using errcode = 'check_violation';
  end if;
  if p_segment not in ('all','lapsed','never_ordered','zone') then
    raise exception 'INVALID_SEGMENT' using errcode = 'check_violation';
  end if;

  -- Resolve the segment to a set of customer user ids that HAVE a push token
  -- (no token = unreachable, so excluded from the count).
  if p_segment = 'all' then
    select coalesce(jsonb_agg(distinct pt.user_id::text), '[]'::jsonb) into v_ids
      from public.push_tokens pt
      join public.users u on u.id = pt.user_id and u.role = 'customer';

  elsif p_segment = 'lapsed' then
    v_days := coalesce(nullif(btrim(coalesce(p_segment_param,'')),'')::int, 30);
    select coalesce(jsonb_agg(distinct pt.user_id::text), '[]'::jsonb) into v_ids
      from public.push_tokens pt
      join public.users u on u.id = pt.user_id and u.role = 'customer'
     where exists (select 1 from public.orders o where o.user_id = pt.user_id)
       and not exists (
         select 1 from public.orders o
          where o.user_id = pt.user_id and o.placed_at >= now() - make_interval(days => v_days)
       );

  elsif p_segment = 'never_ordered' then
    select coalesce(jsonb_agg(distinct pt.user_id::text), '[]'::jsonb) into v_ids
      from public.push_tokens pt
      join public.users u on u.id = pt.user_id and u.role = 'customer'
     where not exists (select 1 from public.orders o where o.user_id = pt.user_id);

  else -- 'zone'
    select coalesce(jsonb_agg(distinct pt.user_id::text), '[]'::jsonb) into v_ids
      from public.push_tokens pt
      join public.users u on u.id = pt.user_id and u.role = 'customer'
     where exists (
       select 1 from public.orders o
        where o.user_id = pt.user_id and o.zone::text = p_segment_param
     );
  end if;

  v_count := coalesce(jsonb_array_length(v_ids), 0);

  -- Record the campaign regardless (audit), even if 0 recipients.
  insert into public.push_campaigns (title, body, segment, segment_param, recipients, sent_by)
  values (btrim(p_title), btrim(p_body), p_segment, p_segment_param, v_count, v_agent);

  if v_count = 0 then return 0; end if;

  -- Fire the push with custom copy (expo-push honors title/body overrides).
  select value #>> '{}' into v_base from public.platform_settings where key = 'functions_base_url';
  if v_base is not null and v_base <> '' then
    begin
      select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_internal_secret';
    exception when others then v_secret := null;
    end;
    v_headers := '{"Content-Type": "application/json"}'::jsonb;
    if v_secret is not null and v_secret <> '' then
      v_headers := v_headers || jsonb_build_object('x-internal-secret', v_secret);
    end if;
    perform net.http_post(
      url     := v_base || '/expo-push',
      body    := jsonb_build_object(
                   'event', 'campaign',
                   'orderId', '',
                   'title', btrim(p_title),
                   'body', btrim(p_body),
                   'recipientUserIds', v_ids
                 ),
      headers := v_headers
    );
  end if;

  return v_count;
end;
$$;
revoke all on function public.send_push_campaign(text, text, text, text) from public, anon;
grant execute on function public.send_push_campaign(text, text, text, text) to authenticated;

comment on function public.send_push_campaign is
  'ADMIN: resolve a customer segment (all/lapsed/never_ordered/zone), record a push_campaigns audit row, and fan out custom copy via expo-push. Returns reachable recipient count. Only counts customers with a registered push token.';

-- Recent campaigns for the admin UI.
create or replace function public.recent_push_campaigns(p_limit int default 20)
returns setof public.push_campaigns
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select * from public.push_campaigns
   where public.auth_role() = 'admin'
   order by created_at desc
   limit greatest(1, least(coalesce(p_limit,20), 100));
$$;
grant execute on function public.recent_push_campaigns(int) to authenticated;
