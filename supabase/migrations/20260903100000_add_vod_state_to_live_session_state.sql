alter table public.live_session_state
  add column if not exists title text,
  add column if not exists vod_url text,
  add column if not exists vod_video_no text,
  add column if not exists vod_saved_at timestamptz,
  add column if not exists vod_checked_at timestamptz;
