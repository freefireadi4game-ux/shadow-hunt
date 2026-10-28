-- collision-safe profile creation (replaces v1)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text;
  v_username text;
begin
  v_base := coalesce(
    nullif(new.raw_user_meta_data->>'username', ''),
    split_part(coalesce(new.email, ''), '@', 1),
    'player'
  );
  v_username := v_base;
  while exists (select 1 from public.profiles where username = v_username) loop
    v_username := v_base || '_' || substr(md5(random()::text), 1, 4);
  end loop;
  insert into public.profiles (id, username)
  values (new.id, v_username)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- normalized settings
create or replace function public.hn_settings(_s jsonb)
returns jsonb
language sql
immutable
as $$
select jsonb_build_object(
  'duration_minutes', coalesce((_s->>'duration_minutes')::int, 60),
  'shadow_ping_interval_minutes', coalesce((_s->>'shadow_ping_interval_minutes')::int, 3),
  'hunter_reveal_interval_minutes', coalesce((_s->>'hunter_reveal_interval_minutes')::int, 5),
  'zone_shrink_interval_minutes', coalesce((_s->>'zone_shrink_interval_minutes')::int, 10),
  'zone_initial_radius_m', coalesce((_s->>'zone_initial_radius_m')::int, 300),
  'zone_min_radius_m', coalesce((_s->>'zone_min_radius_m')::int, 60),
  'num_hunters', coalesce((_s->>'num_hunters')::int, 1),
  'num_shadows', coalesce((_s->>'num_shadows')::int, 2),
  'capture_mode', coalesce(_s->>'capture_mode', 'shadow_confirm'),
  'start_countdown_seconds', coalesce((_s->>'start_countdown_seconds')::int, 10),
  'grace_period_minutes', coalesce((_s->>'grace_period_minutes')::int, 2),
  'fair_start', coalesce((_s->>'fair_start')::bool, true),
  'zone_warning_seconds', coalesce((_s->>'zone_warning_seconds')::int, 60),
  'max_reveals_per_player', (case when _s ? 'max_reveals_per_player' and _s->>'max_reveals_per_player' is not null then (_s->>'max_reveals_per_player')::int end),
  'reconnect_grace_minutes', coalesce((_s->>'reconnect_grace_minutes')::int, 5),
  'mid_match_adjustments', coalesce((_s->>'mid_match_adjustments')::bool, false),
  'out_of_zone_penalty', coalesce(_s->>'out_of_zone_penalty', 'none'),
  'max_speed_mps', coalesce((_s->>'max_speed_mps')::numeric, 12),
  'max_accuracy_m', coalesce((_s->>'max_accuracy_m')::int, 50),
  'max_reports_per_hour', coalesce((_s->>'max_reports_per_hour')::int, 10)
);
$$;

create or replace function public.haversine_m(_lat1 double precision, _lng1 double precision, _lat2 double precision, _lng2 double precision)
returns double precision
language sql
immutable
as $$
select 6371000 * 2 * asin(
  sqrt(
    power(sin(radians(_lat2 - _lat1) / 2), 2) +
    cos(radians(_lat1)) * cos(radians(_lat2)) * power(sin(radians(_lng2 - _lng1) / 2), 2)
  )
);
$$;

-- ============ CREATE MATCH ============
create or replace function public.create_match(_settings jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_code text;
  v_settings jsonb := hn_settings(_settings);
  v_total int := (coalesce((_settings->>'num_hunters')::int, 1) + coalesce((_settings->>'num_shadows')::int, 2));
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if v_total < 2 then raise exception 'A match needs at least 2 players (1 hunter and 1 shadow)'; end if;
  if (v_settings->>'zone_min_radius_m')::int >= (v_settings->>'zone_initial_radius_m')::int then
    raise exception 'Minimum zone radius must be smaller than the initial radius';
  end if;
  loop
    v_code := array_to_string(
      array(select substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', floor(random() * 31)::int + 1, 1) from generate_series(1, 6)),
      ''
    );
    begin
      insert into matches (code, host_id, settings)
      values (v_code, auth.uid(), v_settings)
      returning id into v_id;
      exit;
    exception when unique_violation then
      continue;
    end;
  end loop;
  insert into match_participants (match_id, user_id, role, status)
  values (v_id, auth.uid(), null, 'lobby');
  insert into match_events (match_id, event_type, actor_id, payload)
  values (v_id, 'match_created', auth.uid(), jsonb_build_object('code', v_code));
  return jsonb_build_object('id', v_id, 'code', v_code);
end $$;

-- ============ JOIN MATCH ============
create or replace function public.join_match(_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match matches%rowtype;
  v_count int;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into v_match from matches where upper(code) = upper(_code);
  if v_match.id is null then raise exception 'Match not found - check the room code'; end if;
  if v_match.status <> 'lobby' then raise exception 'This match has already started'; end if;
  select count(*) into v_count from match_participants where match_id = v_match.id;
  if v_count >= (v_match.settings->>'num_hunters')::int + (v_match.settings->>'num_shadows')::int then
    raise exception 'This match is full';
  end if;
  insert into match_participants (match_id, user_id, role, status)
  values (v_match.id, auth.uid(), null, 'lobby')
  on conflict (match_id, user_id) do nothing;
  insert into match_events (match_id, event_type, actor_id)
  values (v_match.id, 'player_joined', auth.uid());
  return v_match.id;
end $$;

-- ============ READY / LEAVE ============
create or replace function public.set_ready(_match uuid, _ready bool)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update match_participants set ready = _ready
  where match_id = _match and user_id = auth.uid() and status = 'lobby';
end $$;

create or replace function public.leave_match(_match uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status from matches where id = _match;
  if v_status = 'lobby' then
    delete from match_participants where match_id = _match and user_id = auth.uid();
  else
    update match_participants set status = 'quit'
    where match_id = _match and user_id = auth.uid() and status in ('lobby', 'active');
  end if;
  insert into match_events (match_id, event_type, actor_id)
  values (_match, 'player_left', auth.uid());
end $$;