-- ============ SETTINGS (host) ============
create or replace function public.update_match_settings(_match uuid, _settings jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m matches%rowtype;
  v_patch jsonb;
begin
  select * into m from matches where id = _match;
  if m.id is null then raise exception 'Match not found'; end if;
  if m.host_id <> auth.uid() then raise exception 'Only the host can change settings'; end if;
  if m.status = 'lobby' then
    update matches set settings = hn_settings(_settings) where id = _match;
  elsif m.status in ('active', 'paused') and hn_settings(m.settings)->>'mid_match_adjustments' = 'true' then
    v_patch := jsonb_build_object(
      'shadow_ping_interval_minutes', coalesce((_settings->>'shadow_ping_interval_minutes')::int, (m.settings->>'shadow_ping_interval_minutes')::int),
      'hunter_reveal_interval_minutes', coalesce((_settings->>'hunter_reveal_interval_minutes')::int, (m.settings->>'hunter_reveal_interval_minutes')::int),
      'zone_shrink_interval_minutes', coalesce((_settings->>'zone_shrink_interval_minutes')::int, (m.settings->>'zone_shrink_interval_minutes')::int)
    );
    update matches set settings = m.settings || v_patch where id = _match;
    insert into match_events (match_id, event_type, actor_id, payload)
    values (_match, 'settings_adjusted', auth.uid(), v_patch);
  else
    raise exception 'Settings are locked once the match has started';
  end if;
end $$;

-- ============ ROLES (host) ============
create or replace function public.set_participant_role(_match uuid, _target uuid, _role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from matches where id = _match and host_id = auth.uid()) then
    raise exception 'Only the host can assign roles';
  end if;
  if _role is not null and _role not in ('hunter', 'shadow') then raise exception 'Invalid role'; end if;
  update match_participants set role = _role where match_id = _match and user_id = _target;
end $$;

create or replace function public.randomize_roles(_match uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m matches%rowtype;
  v_hunters int;
  v_idx int := 0;
  v_r record;
begin
  select * into m from matches where id = _match;
  if m.id is null then raise exception 'Match not found'; end if;
  if m.host_id <> auth.uid() then raise exception 'Only the host can assign roles'; end if;
  if m.status <> 'lobby' then raise exception 'Roles can only be assigned in the lobby'; end if;
  v_hunters := least((m.settings->>'num_hunters')::int, (select count(*) from match_participants where match_id = _match));
  for v_r in
    select user_id from match_participants where match_id = _match order by random()
  loop
    v_idx := v_idx + 1;
    update match_participants
    set role = case when v_idx <= v_hunters then 'hunter' else 'shadow' end
    where match_id = _match and user_id = v_r.user_id;
  end loop;
  insert into match_events (match_id, event_type, actor_id)
  values (_match, 'roles_assigned', auth.uid(), jsonb_build_object('mode', 'random'));
end $$;

-- ============ START MATCH ============
create or replace function public.start_match(_match uuid, _center_lat double precision, _center_lng double precision)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m matches%rowtype;
  v_settings jsonb;
  v_hunters int;
  v_shadows int;
begin
  select * into m from matches where id = _match for update;
  if m.id is null then raise exception 'Match not found'; end if;
  if m.host_id <> auth.uid() then raise exception 'Only the host can start the match'; end if;
  if m.status <> 'lobby' then raise exception 'Match already started'; end if;
  if _center_lat is null or _center_lng is null then raise exception 'A safe-zone center is required'; end if;
  v_settings := hn_settings(m.settings);
  select count(*) into v_hunters from match_participants where match_id = _match and role = 'hunter';
  select count(*) into v_shadows from match_participants where match_id = _match and role = 'shadow';
  if v_hunters = 0 or v_shadows = 0 then raise exception 'Assign at least one hunter and one shadow'; end if;

  update matches set
    status = 'active',
    started_at = now(),
    grace_ends_at = now() + (v_settings->>'grace_period_minutes')::int * interval '1 minute',
    ends_at = now() + ((v_settings->>'grace_period_minutes')::int + (v_settings->>'duration_minutes')::int) * interval '1 minute',
    zone_center_lat = _center_lat,
    zone_center_lng = _center_lng,
    zone_radius_m = (v_settings->>'zone_initial_radius_m')::numeric,
    zone_initial_radius_m = (v_settings->>'zone_initial_radius_m')::numeric,
    zone_min_radius_m = (v_settings->>'zone_min_radius_m')::numeric,
    zone_last_shrink_at = now(),
    shadow_last_ping_at = now(),
    hunter_last_reveal_at = now()
  where id = _match;

  update match_participants set status = 'active' where match_id = _match and role is not null and status = 'lobby';

  insert into match_events (match_id, event_type, actor_id, payload)
  values (_match, 'match_started', auth.uid(), jsonb_build_object(
    'grace_minutes', v_settings->>'grace_period_minutes',
    'duration_minutes', v_settings->>'duration_minutes'
  ));
end $$;

-- ============ SUBMIT POSITION ============
create or replace function public.submit_position(
  _match uuid, _lat double precision, _lng double precision,
  _accuracy double precision, _heading double precision, _speed double precision
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  m matches%rowtype;
  v_prev player_positions%rowtype;
  v_dist double precision;
  v_dt double precision;
  v_implied_speed double precision;
  v_max_speed double precision;
  v_max_accuracy numeric;
  v_flagged bool := false;
  v_flag_reason text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into m from matches where id = _match;
  if m.id is null then raise exception 'Match not found'; end if;
  if not exists (select 1 from match_participants where match_id = _match and user_id = auth.uid()) then
    raise exception 'You are not in this match';
  end if;
  if m.status not in ('active', 'paused') then raise exception 'Match is not running'; end if;
  if _lat is null or _lng is null or _lat < -90 or _lat > 90 or _lng < -180 or _lng > 180 then
    return 'rejected';
  end if;

  v_max_speed := (hn_settings(m.settings)->>'max_speed_mps')::numeric;
  v_max_accuracy := (hn_settings(m.settings)->>'max_accuracy_m')::numeric;

  select * into v_prev from player_positions where match_id = _match and user_id = auth.uid();
  if v_prev.match_id is not null then
    v_dist := haversine_m(v_prev.lat, v_prev.lng, _lat, _lng);
    v_dt := greatest(0, extract(epoch from (now() - v_prev.recorded_at)));
    v_implied_speed := case when v_dt > 1 then v_dist / v_dt else 0 end;
    if v_implied_speed > v_max_speed * 2 then
      return 'rejected';
    elsif v_implied_speed > v_max_speed then
      v_flagged := true;
      v_flag_reason := 'fast_jump:' || round(v_implied_speed::numeric, 1) || 'm/s';
    end if;
  end if;
  if _accuracy is not null and _accuracy > v_max_accuracy then
    v_flagged := true;
    v_flag_reason := coalesce(v_flag_reason || ',', '') || 'low_gps_accuracy:' || coalesce(round(_accuracy::numeric, 0), '?') || 'm';
  end if;

  insert into player_positions (match_id, user_id, lat, lng, accuracy_m, heading, speed_mps, recorded_at, flagged, flag_reason)
  values (_match, auth.uid(), _lat, _lng, _accuracy, _heading, _speed, now(), v_flagged, v_flag_reason)
  on conflict (match_id, user_id) do update set
    lat = excluded.lat, lng = excluded.lng, accuracy_m = excluded.accuracy_m,
    heading = excluded.heading, speed_mps = excluded.speed_mps,
    recorded_at = excluded.recorded_at, flagged = excluded.flagged, flag_reason = excluded.flag_reason;

  update match_participants set last_seen_at = now()
  where match_id = _match and user_id = auth.uid();

  return case when v_flagged then 'flagged' else 'accepted' end;
end $$;

grant execute on function
  public.update_match_settings(uuid, jsonb),
  public.set_participant_role(uuid, uuid, text), public.randomize_roles(uuid),
  public.start_match(uuid, double precision, double precision),
  public.submit_position(uuid, double precision, double precision, double precision, double precision, double precision)
to authenticated;