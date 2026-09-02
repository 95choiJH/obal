create table if not exists public.live_title_history (
  id bigserial primary key,
  channel_id text not null,
  live_key text not null,
  schedule_date date not null,
  title text not null,
  previous_title text,
  category_label text,
  category_id text,
  category_type text,
  category_poster_image_url text,
  started_at timestamptz,
  changed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.live_title_history
  add column if not exists category_label text,
  add column if not exists category_id text,
  add column if not exists category_type text,
  add column if not exists category_poster_image_url text;

create index if not exists live_title_history_channel_live_changed_idx
  on public.live_title_history (channel_id, live_key, changed_at desc, id desc);

create index if not exists live_title_history_channel_date_changed_idx
  on public.live_title_history (channel_id, schedule_date, changed_at desc, id desc);

create index if not exists live_title_history_channel_category_changed_idx
  on public.live_title_history (channel_id, category_type, category_id, changed_at desc, id desc);

alter table public.live_title_history enable row level security;

revoke all on public.live_title_history from anon;
grant select on public.live_title_history to authenticated;
grant all on public.live_title_history to service_role;

drop policy if exists "admin users can read live title history" on public.live_title_history;

create policy "admin users can read live title history"
  on public.live_title_history for select
  to authenticated
  using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));
