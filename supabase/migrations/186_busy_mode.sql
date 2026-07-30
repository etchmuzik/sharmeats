-- 186_busy_mode.sql
--
-- Package 06 Stage 3: busy mode that increases HONEST prep estimates.
-- Recon 2026-07-30: no such control existed anywhere — prep_time_low/high have
-- no client write path (correctly), so a slammed kitchen had no way to tell
-- customers the truth about tonight's prep times.
--
-- Design: a bounded, self-expiring bump. set_busy_mode stamps busy_until +
-- busy_extra_minutes; delivery_feasibility adds the bump only while
-- busy_until is in the future. No cron, no cleanup, no forgotten flag — an
-- expired busy mode simply stops applying. The ETA the customer sees at
-- checkout (and the SLA credit engine downstream of it) both move together,
-- so busy mode makes the promise HONEST rather than papering over lateness.

alter table public.restaurants
  add column if not exists busy_until timestamptz,
  add column if not exists busy_extra_minutes int not null default 0
    check (busy_extra_minutes between 0 and 60);

-- No client UPDATE grant on either column — set_busy_mode is the only writer
-- (mig 136's column-grant discipline: staff may touch is_open + payout_* only).

create or replace function public.set_busy_mode(
  p_restaurant_id uuid,
  p_extra_minutes int,
  p_duration_minutes int default 60
)
returns timestamptz
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_until timestamptz;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;
  -- Manager+ of THIS brand (mig 136's staff-role model); admin passes too.
  if coalesce(public.auth_role()::text, '') <> 'admin'
     and not public.is_merchant_manager(p_restaurant_id) then
    raise exception 'MANAGER_REQUIRED' using errcode = 'check_violation';
  end if;

  if coalesce(p_extra_minutes, 0) = 0 then
    -- Clearing busy mode is always legal and takes effect immediately.
    update public.restaurants
       set busy_until = null, busy_extra_minutes = 0
     where id = p_restaurant_id;
    return null;
  end if;

  if p_extra_minutes not between 5 and 60 then
    raise exception 'EXTRA_MINUTES_OUT_OF_BOUNDS: 5..60' using errcode = 'check_violation';
  end if;
  if coalesce(p_duration_minutes, 0) not between 15 and 240 then
    raise exception 'DURATION_OUT_OF_BOUNDS: 15..240 minutes' using errcode = 'check_violation';
  end if;

  v_until := now() + make_interval(mins => p_duration_minutes);
  update public.restaurants
     set busy_until = v_until, busy_extra_minutes = p_extra_minutes
   where id = p_restaurant_id;
  return v_until;
end;
$$;

revoke all on function public.set_busy_mode(uuid, int, int) from public, anon;
grant execute on function public.set_busy_mode(uuid, int, int) to authenticated;

comment on function public.set_busy_mode(uuid, int, int) is
  'Manager+ (or admin): bounded self-expiring prep bump (5..60 extra minutes for 15..240 minutes; 0 clears). delivery_feasibility adds the bump while busy_until is in the future, so checkout ETAs and the SLA credit engine move together — busy mode makes the promise honest. Mig 186.';

-- delivery_feasibility rebuilt from the CURRENT prod body (house rule 2) with
-- exactly one delta: the busy bump in the prep read.
CREATE OR REPLACE FUNCTION public.delivery_feasibility(p_restaurant_id uuid, p_dropoff geography)
 RETURNS TABLE(distance_m numeric, in_range boolean, eta_minutes integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_rest_geo geography;
  v_prep     int;
  v_radius   int;
  v_speed    int;
  v_buffer   int;
  v_dist     numeric;
  v_travel   numeric;
begin
  -- [mig 186] Busy mode: a bounded, SELF-EXPIRING prep bump set by the kitchen
  -- when it is slammed. Reading busy_until here (not a flag someone must
  -- remember to clear) means a forgotten busy mode cannot understate honesty
  -- forever — it expires on its own and the ETA returns to normal.
  select geo,
         prep_time_high
           + case when busy_until is not null and busy_until > now()
                  then coalesce(busy_extra_minutes, 0) else 0 end
    into v_rest_geo, v_prep
    from public.restaurants where id = p_restaurant_id;
  -- [159] HIDDEN-VERTICAL GATE. Exact distance/ETA leaks private geography: a
  -- caller supplying probe coordinates can trilaterate a hidden merchant's
  -- location from st_distance alone. An earlier draft argued this was a
  -- "deliberate exception" because place_order calls it internally; that was
  -- wrong and is withdrawn.
  --
  -- Subject-scoped so the internal call still works: inside place_order,
  -- auth.uid() is the CUSTOMER, who has already passed the same gate. A
  -- caller who may not see the vertical gets the not-found shape rather than a
  -- distinguishable error.
  if not public.user_can_view_vertical(auth.uid(),
        (select r.vertical_id from public.restaurants r where r.id = p_restaurant_id)) then
    distance_m := null; in_range := false; eta_minutes := null;
    return next; return;
  end if;
  select coalesce((value #>> '{}')::int, 8000) into v_radius from public.platform_settings where key = 'max_delivery_radius_m';
  select coalesce((value #>> '{}')::int, 18)   into v_speed  from public.platform_settings where key = 'delivery_avg_speed_kmh';
  select coalesce((value #>> '{}')::int, 5)    into v_buffer from public.platform_settings where key = 'dispatch_buffer_minutes';
  v_prep := coalesce(v_prep, 30);

  if v_rest_geo is null or p_dropoff is null then
    distance_m := null; in_range := true; eta_minutes := v_prep + v_buffer;
    return next; return;
  end if;

  v_dist := st_distance(v_rest_geo, p_dropoff);
  v_travel := (v_dist / 1000.0) / greatest(v_speed, 1) * 60.0;

  distance_m  := round(v_dist, 0);
  in_range    := v_dist <= v_radius;
  eta_minutes := ceil(v_prep + v_buffer + v_travel)::int;
  return next;
end;
$function$;

-- ACL restated (this function is called internally by place_order and by
-- clients for the checkout ETA).
revoke all on function public.delivery_feasibility(uuid, geography) from public, anon;
grant execute on function public.delivery_feasibility(uuid, geography) to authenticated;
