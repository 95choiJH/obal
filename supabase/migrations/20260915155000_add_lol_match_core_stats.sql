alter table public.lol_match_logs
  add column if not exists damage_to_champions integer,
  add column if not exists total_cs integer,
  add column if not exists cs_per_minute numeric(5,1),
  add column if not exists game_duration_seconds integer;
