-- ============ SETTINGS: add capture keys ============
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
  'max_reports_per_hour', coalesce((_s->>'max_reports_per_hour')::int, 10),
  'capture_radius_m', coalesce((_s->>'capture_radius_m')::int, 25),
  'capture_confirm_seconds', coalesce((_s->>'capture_confirm_seconds')::int, 60)
);
$$;

alter table public.match_participants add column captured_at timestamptz;

-- lock down complete_match: only game functions (owner) may complete a match
revoke execute on function public.complete_match(uuid, text) from authenticated, anon;

-- ============ INTERNAL CAPTURE CONFIRM (owner-only) ============
create or replace function public._capture_confirm_row(r capture_reports)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update capture_reports set status = 'confirmed', resolved_at = now(), resolved_by = r.target_id where id = r.id;
  update match_participants set status = 'captured', captured_at = now()
    where match_id = r.match_id and user_id = r.target_id and status = 'active';
  update match_participants set captures_made = captures_made + 1 where match_id = r.match_id and user_id = r.reporter_id;
  insert into match_events (match_id, event_type, actor_id, payload)
    values (r.match_id, 'capture_confirmed', r.reporter_id, jsonb_build_object('target', r.target_id));
  if not exists (
    select 1 from match_participants where match_id = r.match_id and role = 'shadow' and status = 'active'
  ) then
    perform complete_match(r.match_id, 'hunters');
  end if;
end $$;
revoke execute on function public._capture_confirm_row(capture_reports) from public, anon, authenticated;

-- ============ REPORT CAPTURE (hunter) ============
create or replace function public.report_capture(_match uuid, _target uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  m matches%rowtype;
  v_hunter match_participants%rowtype;
  v_target match_participants%rowtype;
  v_report capture_reports%rowtype;
  v_hunter_pos player_positions%rowtype;
  v_target_pos player_positions%rowtype;
  v_dist double precision;
  v_radius numeric;
  v_max_reports int;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into m from matches where id = _match;
  if m.id is null then raise exception 'Match not found'; end if;
  if m.status <> 'active' then raise exception 'The match is not running'; end if;
  if m.grace_ends_at is not null and now() < m.grace_ends_at then
    raise exception 'Captures unlock when the grace period ends';
  end if;
  select * into v_hunter from match_participants where match_id = _match and user_id = auth.uid();
  if v_hunter.id is null or v_hunter.role <> 'hunter' then raise exception 'Only hunters can report captures'; end if;
  if v_hunter.status <> 'active' then raise exception 'You are not active in this match'; end if;
  select * into v_target from match_participants where match_id = _match and user_id = _target;
  if v_target.id is null or v_target.role <> 'shadow' then raise exception 'That player is not a shadow'; end if;
  if v_target.status <> 'active' then raise exception 'That shadow is already caught or gone'; end if;

  select * into v_report from capture_reports
    where match_id = _match and reporter_id = auth.uid() and target_id = _target and status = 'pending'
    order by reported_at desc limit 1;
  if v_report.id is not null then return v_report.id; end if;

  v_max_reports := coalesce((hn_settings(m.settings)->>'max_reports_per_hour')::int, 10);
  if (select count(*) from capture_reports where match_id = _match and reporter_id = auth.uid()
        and reported_at > now() - interval '1 hour') >= v_max_reports then
    raise exception 'Too many capture reports this hour';
  end if;

  select * into v_hunter_pos from player_positions where match_id = _match and user_id = auth.uid();
  select * into v_target_pos from player_positions where match_id = _match and user_id = _target;
  if v_hunter_pos.match_id is null then raise exception 'Share your location first (enable GPS)'; end if;
  if v_target_pos.match_id is null then raise exception 'Your target has not shared a location yet'; end if;
  if v_target_pos.recorded_at < now() - interval '120 seconds' then
    raise exception 'Your target''s location is stale - get closer and try again';
  end if;
  v_radius := (hn_settings(m.settings)->>'capture_radius_m')::numeric;
  v_dist := haversine_m(v_hunter_pos.lat, v_hunter_pos.lng, v_target_pos.lat, v_target_pos.lng);
  if v_dist > v_radius then
    raise exception 'Too far away - get within %s m (you are %s m away)', v_radius, round(v_dist::numeric, 0);
  end if;

  insert into capture_reports (match_id, reporter_id, target_id)
  values (_match, auth.uid(), _target)
  returning * into v_report;
  insert into match_events (match_id, event_type, actor_id, payload)
  values (_match, 'capture_reported', auth.uid(), jsonb_build_object('target', _target, 'report_id', v_report.id));
  return v_report.id;
end $$;

-- ============ RESOLVE CAPTURE (target shadow) ============
create or replace function public.resolve_capture(_report uuid, _confirm boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r capture_reports%rowtype;
  m matches%rowtype;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into r from capture_reports where id = _report for update;
  if r.id is null then raise exception 'Capture report not found'; end if;
  if r.status <> 'pending' then return; end if;
  select * into m from matches where id = r.match_id;
  if m.status <> 'active' then return; end if;
  if r.target_id <> auth.uid() then raise exception 'Only the reported shadow can respond'; end if;
  if _confirm then
    perform public._capture_confirm_row(r);
  else
    update capture_reports set status = 'denied', resolved_at = now(), resolved_by = auth.uid() where id = r.id;
    insert into match_events (match_id, event_type, actor_id, payload)
    values (r.match_id, 'capture_denied', r.reporter_id, jsonb_build_object('target', r.target_id));
  end if;
end $$;

-- ============ PAUSE / RESUME (host) ============
create or replace function public.pause_match(_match uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m matches%rowtype;
begin
  select * into m from matches where id = _match;
  if m.id is null then raise exception 'Match not found'; end if;
  if m.host_id <> auth.uid() then raise exception 'Only the host can pause the match'; end if;
  if m.status <> 'active' then raise exception 'Only a running match can be paused'; end if;
  update matches set status = 'paused', paused_at = now() where id = _match;
  insert into match_events (match_id, event_type, actor_id) values (_match, 'match_paused', auth.uid());
end $$;

create or replace function public.resume_match(_match uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m matches%rowtype;
  v_pause interval;
begin
  select * into m from matches where id = _match;
  if m.id is null then raise exception 'Match not found'; end if;
  if m.host_id <> auth.uid() then raise exception 'Only the host can resume the match'; end if;
  if m.status <> 'paused' then raise exception 'The match is not paused'; end if;
  v_pause := now() - m.paused_at;
  update matches set
    status = 'active',
    paused_at = null,
    paused_total_seconds = paused_total_seconds + floor(extract(epoch from v_pause))::int,
    ends_at = case when ends_at is not null then ends_at + v_pause end,
    grace_ends_at = case when grace_ends_at is not null and grace_ends_at > now() then grace_ends_at + v_pause end,
    shadow_last_ping_at = case when shadow_last_ping_at is not null then shadow_last_ping_at + v_pause end,
    hunter_last_reveal_at = case when hunter_last_reveal_at is not null then hunter_last_reveal_at + v_pause end,
    zone_last_shrink_at = case when zone_last_shrink_at is not null then zone_last_shrink_at + v_pause end
  where id = _match;
  insert into match_events (match_id, event_type, actor_id) values (_match, 'match_resumed', auth.uid());
end $$;

-- ============ ABORT (host) ============
create or replace function public.abort_match(_match uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m matches%rowtype;
begin
  select * into m from matches where id = _match;
  if m.id is null then raise exception 'Match not found'; end if;
  if m.host_id <> auth.uid() then raise exception 'Only the host can end the match'; end if;
  if m.status in ('completed', 'aborted') then return; end if;
  if m.status = 'lobby' then
    update matches set status = 'aborted', completed_at = now() where id = _match;
    insert into match_events (match_id, event_type, actor_id) values (_match, 'match_aborted', auth.uid());
  else
    perform complete_match(_match, 'none');
  end if;
end $$;

-- ============ TICK (upgraded: capture timeout, disconnect timeout, server time) ============
create or replace function public.tick_match(_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m matches%rowtype;
  v_settings jsonb;
  v_now timestamptz := now();
  v_events jsonb := '[]'::jsonb;
  v_active_shadows int;
  v_active_hunters int;
  v_max_reveals int;
  v_confirm_seconds int;
  v_grace_minutes int;
  v_decrement double precision;
  v_new_radius double precision;
  v_r record;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from match_participants where match_id = _match and user_id = auth.uid()) then
    raise exception 'You are not in this match';
  end if;

  select * into m from matches where id = _match for update;
  if m.id is null then raise exception 'Match not found'; end if;
  if m.status <> 'active' then
    return jsonb_build_object('events', v_events, 'server_now', v_now);
  end if;

  v_settings := hn_settings(m.settings);
  v_confirm_seconds := coalesce((v_settings->>'capture_confirm_seconds')::int, 60);
  v_grace_minutes := coalesce((v_settings->>'reconnect_grace_minutes')::int, 5);

  -- auto-confirm capture reports the shadow never answered in time
  for v_r in
    select * from capture_reports
    where match_id = _match and status = 'pending' and reported_at < v_now - make_interval(secs => v_confirm_seconds)
    for update
  loop
    perform public._capture_confirm_row(v_r);
    v_events := v_events || jsonb_build_array(jsonb_build_object('type', 'capture_confirmed', 'target', v_r.target_id));
  end loop;
  select * into m from matches where id = _match for update;

  -- auto-quit players who stopped sharing position for longer than the reconnect grace
  for v_r in
    select p.user_id from match_participants p
    where p.match_id = _match and p.status = 'active' and p.last_seen_at < v_now - make_interval(mins => v_grace_minutes)
  loop
    update match_participants set status = 'quit' where match_id = _match and user_id = v_r.user_id;
    insert into match_events (match_id, event_type, actor_id, payload)
      values (_match, 'player_timed_out', v_r.user_id, '{}');
    v_events := v_events || jsonb_build_array(jsonb_build_object('type', 'player_timed_out', 'user', v_r.user_id));
  end loop;

  select count(*) into v_active_shadows from match_participants where match_id = _match and role = 'shadow' and status = 'active';
  select count(*) into v_active_hunters from match_participants where match_id = _match and role = 'hunter' and status = 'active';

  if v_active_shadows = 0 and v_active_hunters > 0 then
    perform complete_match(_match, 'hunters');
    return jsonb_build_object('events', v_events || jsonb_build_array(jsonb_build_object('type', 'hunters_win')), 'server_now', v_now);
  end if;
  if v_active_hunters = 0 and v_active_shadows > 0 then
    perform complete_match(_match, 'shadows');
    return jsonb_build_object('events', v_events || jsonb_build_array(jsonb_build_object('type', 'shadows_win')), 'server_now', v_now);
  end if;

  if m.ends_at is not null and v_now >= m.ends_at then
    perform complete_match(_match, case when v_active_shadows > 0 then 'shadows' else 'hunters' end);
    return jsonb_build_object('events', v_events || jsonb_build_array(jsonb_build_object('type', 'match_completed')), 'server_now', v_now);
  end if;

  if v_active_shadows > 0 and (m.shadow_last_ping_at is null or v_now >= m.shadow_last_ping_at + (v_settings->>'shadow_ping_interval_minutes')::int * interval '1 minute') then
    v_max_reveals := coalesce((v_settings->>'max_reveals_per_player')::int, 0);
    for v_r in
      select p.user_id, pp.lat, pp.lng, pp.accuracy_m
      from match_participants p
      left join player_positions pp on pp.match_id = p.match_id and pp.user_id = p.user_id
      where p.match_id = _match and p.role = 'shadow' and p.status = 'active'
    loop
      if v_max_reveals > 0 and (select count(*) from location_reveals where match_id = _match and user_id = v_r.user_id and kind = 'shadow_ping') >= v_max_reveals then
        continue;
      end if;
      insert into location_reveals (match_id, user_id, kind, lat, lng, accuracy_m)
      values (_match, v_r.user_id, 'shadow_ping', v_r.lat, v_r.lng, v_r.accuracy_m);
    end loop;
    m.shadow_last_ping_at := coalesce(m.shadow_last_ping_at, v_now) + (v_settings->>'shadow_ping_interval_minutes')::int * interval '1 minute';
    v_events := v_events || jsonb_build_array(jsonb_build_object('type', 'shadow_ping'));
    insert into match_events (match_id, event_type, payload) values (_match, 'shadow_ping', '{}');
  end if;

  if v_active_hunters > 0 and (m.hunter_last_reveal_at is null or v_now >= m.hunter_last_reveal_at + (v_settings->>'hunter_reveal_interval_minutes')::int * interval '1 minute') then
    v_max_reveals := coalesce((v_settings->>'max_reveals_per_player')::int, 0);
    for v_r in
      select p.user_id, pp.lat, pp.lng, pp.accuracy_m
      from match_participants p
      left join player_positions pp on pp.match_id = p.match_id and pp.user_id = p.user_id
      where p.match_id = _match and p.role = 'hunter' and p.status = 'active'
    loop
      if v_max_reveals > 0 and (select count(*) from location_reveals where match_id = _match and user_id = v_r.user_id and kind = 'hunter_reveal') >= v_max_reveals then
        continue;
      end if;
      insert into location_reveals (match_id, user_id, kind, lat, lng, accuracy_m)
      values (_match, v_r.user_id, 'hunter_reveal', v_r.lat, v_r.lng, v_r.accuracy_m);
    end loop;
    m.hunter_last_reveal_at := coalesce(m.hunter_last_reveal_at, v_now) + (v_settings->>'hunter_reveal_interval_minutes')::int * interval '1 minute';
    v_events := v_events || jsonb_build_array(jsonb_build_object('type', 'hunter_reveal'));
    insert into match_events (match_id, event_type, payload) values (_match, 'hunter_reveal', '{}');
  end if;

  if m.zone_radius_m is not null and (m.zone_last_shrink_at is null or v_now >= m.zone_last_shrink_at + (v_settings->>'zone_shrink_interval_minutes')::int * interval '1 minute') then
    v_decrement := ((v_settings->>'zone_initial_radius_m')::numeric - (v_settings->>'zone_min_radius_m')::numeric)
      / greatest(1, floor((v_settings->>'duration_minutes')::numeric / (v_settings->>'zone_shrink_interval_minutes')::numeric));
    v_new_radius := greatest((v_settings->>'zone_min_radius_m')::numeric, m.zone_radius_m - v_decrement);
    m.zone_last_shrink_at := coalesce(m.zone_last_shrink_at, v_now) + (v_settings->>'zone_shrink_interval_minutes')::int * interval '1 minute';
    if v_new_radius < m.zone_radius_m then
      m.zone_radius_m := v_new_radius;
      v_events := v_events || jsonb_build_array(jsonb_build_object('type', 'zone_shrunk', 'radius_m', v_new_radius));
      insert into match_events (match_id, event_type, payload)
      values (_match, 'zone_shrunk', jsonb_build_object('radius_m', v_new_radius));
    end if;
  end if;

  update matches set
    shadow_last_ping_at = m.shadow_last_ping_at,
    hunter_last_reveal_at = m.hunter_last_reveal_at,
    zone_last_shrink_at = m.zone_last_shrink_at,
    zone_radius_m = m.zone_radius_m
  where id = _match;

  return jsonb_build_object('events', v_events, 'server_now', v_now);
end $$;

grant execute on function
  public.report_capture(uuid, uuid),
  public.resolve_capture(uuid, boolean),
  public.pause_match(uuid),
  public.resume_match(uuid),
  public.abort_match(uuid),
  public.tick_match(uuid)
to authenticated;