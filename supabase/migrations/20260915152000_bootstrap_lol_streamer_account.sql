alter table public.lol_streamer_accounts
  alter column riot_puuid drop not null;

insert into public.lol_streamer_accounts (
  channel_id,
  riot_puuid,
  riot_game_name,
  riot_tag_line,
  platform_region,
  regional_routing,
  enabled
) values (
  '0dad8baf12a436f722faa8e5001c5011',
  null,
  U&'\C0BC\B77C\B9CC\C0C1\D604',
  'kr2',
  'kr',
  'asia',
  true
)
on conflict (channel_id) do update
set riot_game_name = excluded.riot_game_name,
    riot_tag_line = excluded.riot_tag_line,
    platform_region = excluded.platform_region,
    regional_routing = excluded.regional_routing,
    enabled = excluded.enabled,
    updated_at = now();
