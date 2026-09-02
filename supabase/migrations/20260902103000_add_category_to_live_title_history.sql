alter table public.live_title_history
  add column if not exists category_label text,
  add column if not exists category_id text,
  add column if not exists category_type text,
  add column if not exists category_poster_image_url text;

create index if not exists live_title_history_channel_category_changed_idx
  on public.live_title_history (channel_id, category_type, category_id, changed_at desc, id desc);
