alter table public.lol_match_logs
  add column if not exists primary_rune_id integer,
  add column if not exists secondary_style_id integer,
  add column if not exists rune_ids integer[] not null default '{}'::integer[],
  add column if not exists item_ids integer[] not null default '{}'::integer[];
