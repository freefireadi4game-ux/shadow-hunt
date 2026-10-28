-- ============ PROFILES ============
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data->>'username', ''),
      split_part(coalesce(new.email, ''), '@', 1),
      'player_' || left(new.id::text, 6)
    )
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ============ MATCHES ============
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  host_id uuid not null,
  status text not null default 'lobby',
  settings jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  grace_ends_at timestamptz,
  ends_at timestamptz,
  paused_at timestamptz,
  paused_total_seconds integer not null default 0,
  zone_center_lat double precision,
  zone_center_lng double precision,
  zone_radius_m double precision,
  zone_initial_radius_m double precision,
  zone_min_radius_m double precision,
  zone_last_shrink_at timestamptz,
  shadow_last_ping_at timestamptz,
  hunter_last_reveal_at timestamptz,
  winner text,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============ PARTICIPANTS ============
create table public.match_participants (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null,
  role text,
  status text not null default 'lobby',
  ready boolean not null default false,
  captures_made integer not null default 0,
  survival_seconds integer,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (match_id, user_id)
);
create index idx_participants_match on public.match_participants(match_id);

-- ============ PRIVATE GPS POSITIONS ============
create table public.player_positions (
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null,
  lat double precision not null,
  lng double precision not null,
  accuracy_m double precision,
  heading double precision,
  speed_mps double precision,
  recorded_at timestamptz not null default now(),
  flagged boolean not null default false,
  flag_reason text,
  primary key (match_id, user_id)
);

-- ============ PUBLIC REVEALED LOCATIONS ============
create table public.location_reveals (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null,
  kind text not null,
  lat double precision,
  lng double precision,
  accuracy_m double precision,
  revealed_at timestamptz not null default now()
);
create index idx_reveals_match on public.location_reveals(match_id);

-- ============ CAPTURE REPORTS ============
create table public.capture_reports (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  reporter_id uuid not null,
  target_id uuid not null,
  status text not null default 'pending',
  reported_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid
);
create index idx_reports_match on public.capture_reports(match_id);

-- ============ MATCH EVENT LOG ============
create table public.match_events (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.matches(id) on delete cascade,
  event_type text not null,
  actor_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index idx_events_match on public.match_events(match_id);

-- ============ MATCH RESULTS ============
create table public.match_results (
  match_id uuid primary key references public.matches(id) on delete cascade,
  winner text not null,
  stats jsonb not null default '{}'::jsonb,
  completed_at timestamptz not null default now()
);

-- ============ GRANTS ============
grant select, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
grant select on public.matches to authenticated;
grant all on public.matches to service_role;
grant select on public.match_participants to authenticated;
grant all on public.match_participants to service_role;
grant select, insert, update on public.player_positions to authenticated;
grant all on public.player_positions to service_role;
grant select on public.location_reveals to authenticated;
grant all on public.location_reveals to service_role;
grant select on public.capture_reports to authenticated;
grant all on public.capture_reports to service_role;
grant select on public.match_events to authenticated;
grant all on public.match_events to service_role;
grant select on public.match_results to authenticated;
grant all on public.match_results to service_role;

-- ============ RLS ============
alter table public.profiles enable row level security;
create policy "Profiles readable by signed-in users" on public.profiles for select to authenticated using (true);
create policy "Own profile update" on public.profiles for update to authenticated using (id = auth.uid());

alter table public.matches enable row level security;
create policy "Matches readable by signed-in users" on public.matches for select to authenticated using (true);

alter table public.match_participants enable row level security;
create policy "Participants of own matches" on public.match_participants for select to authenticated
  using (exists (select 1 from public.match_participants me where me.match_id = match_participants.match_id and me.user_id = auth.uid()));

alter table public.player_positions enable row level security;
create policy "Own positions only" on public.player_positions for select to authenticated
  using (user_id = auth.uid());
create policy "Own position insert" on public.player_positions for insert to authenticated
  with check (user_id = auth.uid());
create policy "Own position update" on public.player_positions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.location_reveals enable row level security;
create policy "Role-scoped reveals" on public.location_reveals for select to authenticated
  using (
    exists (
      select 1 from public.match_participants me
      where me.match_id = location_reveals.match_id
        and me.user_id = auth.uid()
        and (
          me.user_id = location_reveals.user_id
          or (me.role = 'hunter' and location_reveals.kind = 'shadow_ping')
          or (me.role = 'shadow' and location_reveals.kind = 'hunter_reveal')
        )
    )
  );

alter table public.capture_reports enable row level security;
create policy "Capture reports visible to involved parties and hunters" on public.capture_reports for select to authenticated
  using (
    reporter_id = auth.uid()
    or target_id = auth.uid()
    or exists (
      select 1 from public.match_participants me
      where me.match_id = capture_reports.match_id
        and me.user_id = auth.uid()
        and me.role = 'hunter'
    )
  );

alter table public.match_events enable row level security;
create policy "Events visible to participants" on public.match_events for select to authenticated
  using (exists (select 1 from public.match_participants me where me.match_id = match_events.match_id and me.user_id = auth.uid()));

alter table public.match_results enable row level security;
create policy "Results visible to participants" on public.match_results for select to authenticated
  using (exists (select 1 from public.match_participants me where me.match_id = match_results.match_id and me.user_id = auth.uid()));

-- ============ REALTIME ============
alter publication supabase_realtime add table public.matches;
alter publication supabase_realtime add table public.match_participants;
alter publication supabase_realtime add table public.location_reveals;
alter publication supabase_realtime add table public.capture_reports;
alter publication supabase_realtime add table public.match_events;

grant execute on function public.handle_new_user() to supabase_auth_admin;
