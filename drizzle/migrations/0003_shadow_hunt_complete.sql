create or replace function public.complete_match(_match uuid, _winner text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m matches%rowtype;
  v_players jsonb;
  v_stats jsonb;
begin
  select * into m from matches where id = _match for update;
  if m.id is null or m.status in ('completed', 'aborted') then return; end if;

  update match_participants
  set survival_seconds = case
    when status = 'active' and m.ends_at is not null then greatest(0, extract(epoch from (m.ends_at - m.started_at))::int)
    when m.started_at is not null then greatest(0, extract(epoch from (now() - m.started_at))::int)
    else null end
  where match_id = _match and status in ('captured', 'active', 'quit');

  update matches set status = 'completed', winner = _winner, completed_at = now() where id = _match;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_players
  from (
    select p.user_id, pr.username, p.role, p.status, p.captures_made, p.survival_seconds
    from match_participants p join profiles pr on pr.id = p.user_id
    where p.match_id = _match
  ) x;

  v_stats := jsonb_build_object(
    'winner', _winner,
    'duration_seconds', case when m.started_at is not null then greatest(0, extract(epoch from (coalesce(m.ends_at, now()) - m.started_at))::int) end,
    'zone_final_radius_m', m.zone_radius_m,
    'players', v_players
  );

  insert into match_results (match_id, winner, stats)
  values (_match, _winner, v_stats)
  on conflict (match_id) do update set winner = excluded.winner, stats = excluded.stats;

  insert into match_events (match_id, event_type, payload)
  values (_match, 'match_completed', jsonb_build_object('winner', _winner));
end $$;

grant execute on function public.complete_match(uuid, text) to authenticated;