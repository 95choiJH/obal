create table if not exists public.lol_streamer_accounts (
  id bigserial primary key,
  channel_id text not null unique,
  riot_puuid text not null,
  riot_game_name text,
  riot_tag_line text,
  platform_region text not null default 'kr',
  regional_routing text not null default 'asia',
  enabled boolean not null default true,
  latest_tier text,
  latest_rank text,
  latest_league_points integer,
  latest_wins integer,
  latest_losses integer,
  latest_rank_updated_at timestamptz,
  last_scanned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lol_streamer_accounts_enabled_idx
  on public.lol_streamer_accounts (enabled, channel_id);

alter table public.lol_streamer_accounts enable row level security;

grant select, insert, update, delete on public.lol_streamer_accounts to authenticated;
grant usage, select on sequence public.lol_streamer_accounts_id_seq to authenticated;
grant all on public.lol_streamer_accounts to service_role;
grant all on sequence public.lol_streamer_accounts_id_seq to service_role;

drop policy if exists "admin users can read lol streamer accounts" on public.lol_streamer_accounts;
drop policy if exists "admin users can insert lol streamer accounts" on public.lol_streamer_accounts;
drop policy if exists "admin users can update lol streamer accounts" on public.lol_streamer_accounts;
drop policy if exists "admin users can delete lol streamer accounts" on public.lol_streamer_accounts;

create policy "admin users can read lol streamer accounts"
  on public.lol_streamer_accounts for select
  to authenticated
  using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));

create policy "admin users can insert lol streamer accounts"
  on public.lol_streamer_accounts for insert
  to authenticated
  with check (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));

create policy "admin users can update lol streamer accounts"
  on public.lol_streamer_accounts for update
  to authenticated
  using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()))
  with check (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));

create policy "admin users can delete lol streamer accounts"
  on public.lol_streamer_accounts for delete
  to authenticated
  using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));

create or replace view public.lol_streamer_rank_public as
select
  channel_id,
  riot_game_name,
  riot_tag_line,
  platform_region,
  latest_tier,
  latest_rank,
  latest_league_points,
  latest_wins,
  latest_losses,
  latest_rank_updated_at
from public.lol_streamer_accounts
where enabled = true;

grant select on public.lol_streamer_rank_public to anon, authenticated;
