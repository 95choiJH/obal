create table if not exists public.lol_match_logs (
  id bigserial primary key,
  channel_id text not null,
  live_key text,
  schedule_date date not null,
  match_id text not null,
  queue_id integer,
  queue_label text,
  game_start_at timestamptz,
  game_end_at timestamptz,
  team_position text,
  champion_name text,
  champion_id integer,
  kills integer not null default 0,
  deaths integer not null default 0,
  assists integer not null default 0,
  win boolean,
  lp_before integer,
  lp_after integer,
  lp_delta integer,
  tier_before text,
  rank_before text,
  tier_after text,
  rank_after text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, match_id)
);

create index if not exists lol_match_logs_channel_date_start_idx
  on public.lol_match_logs (channel_id, schedule_date desc, game_start_at desc, id desc);

create index if not exists lol_match_logs_channel_live_start_idx
  on public.lol_match_logs (channel_id, live_key, game_start_at desc, id desc);

alter table public.lol_match_logs enable row level security;

grant select on public.lol_match_logs to anon, authenticated;
grant select, insert, update, delete on public.lol_match_logs to authenticated;
grant usage, select on sequence public.lol_match_logs_id_seq to authenticated;
grant all on public.lol_match_logs to service_role;
grant all on sequence public.lol_match_logs_id_seq to service_role;

drop policy if exists "anon can read lol match logs" on public.lol_match_logs;
drop policy if exists "authenticated can read lol match logs" on public.lol_match_logs;
drop policy if exists "admin users can insert lol match logs" on public.lol_match_logs;
drop policy if exists "admin users can update lol match logs" on public.lol_match_logs;
drop policy if exists "admin users can delete lol match logs" on public.lol_match_logs;

create policy "anon can read lol match logs"
  on public.lol_match_logs for select
  to anon
  using (true);

create policy "authenticated can read lol match logs"
  on public.lol_match_logs for select
  to authenticated
  using (true);

create policy "admin users can insert lol match logs"
  on public.lol_match_logs for insert
  to authenticated
  with check (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));

create policy "admin users can update lol match logs"
  on public.lol_match_logs for update
  to authenticated
  using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()))
  with check (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));

create policy "admin users can delete lol match logs"
  on public.lol_match_logs for delete
  to authenticated
  using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));
