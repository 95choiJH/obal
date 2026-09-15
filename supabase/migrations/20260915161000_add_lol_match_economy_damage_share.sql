alter table public.lol_match_logs
  add column if not exists team_id integer,
  add column if not exists gold_earned integer,
  add column if not exists gold_per_minute numeric(8,2),
  add column if not exists team_damage_to_champions integer,
  add column if not exists team_damage_share numeric(5,2);
