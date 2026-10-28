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
  if m.status <> 'active' then return jsonb_build_object('events', v_events); end if;

  v_settings := hn_settings(m.settings);
  select count(*) into v_active_shadows from match_participants where match_id = _match and role = 'shadow' and status = 'active';
  select count(*) into v_active_hunters from match_participants where match_id = _match and role = 'hunter' and status = 'active';

  if v_active_shadows = 0 and v_active_hunters > 0 then
    perform complete_match(_match, 'hunters');
    return jsonb_build_object('events', jsonb_build_array(jsonb_build_object('type', 'hunters_win')));
  end if;

  if m.ends_at is not null and v_now >= m.ends_at then
    perform complete_match(_match, case when v_active_shadows > 0 then 'shadows' else 'hunters' end);
    return jsonb_build_object('events', jsonb_build_array(jsonb_build_object('type', 'match_completed')));
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

  return jsonb_build_object('events', v_events);
end $$;

grant execute on function public.tick_match(uuid) to authenticated;