alter table public.lol_match_logs
  add column if not exists team_kills integer,
  add column if not exists kill_participation numeric(5,2),
  add column if not exists vision_score integer,
  add column if not exists vision_score_per_minute numeric(8,2),
  add column if not exists wards_killed integer;
