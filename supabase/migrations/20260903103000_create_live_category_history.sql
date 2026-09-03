create table if not exists public.live_category_history (
  id bigserial primary key,
  channel_id text not null,
  live_key text not null,
  schedule_date date not null,
  category_label text not null,
  category_id text,
  category_type text,
  category_poster_image_url text,
  previous_category_label text,
  previous_category_id text,
  previous_category_type text,
  started_at timestamptz,
  changed_at timestamptz not null default now(),
  offset_seconds integer,
  created_at timestamptz not null default now()
);

create index if not exists live_category_history_channel_live_changed_idx
  on public.live_category_history (channel_id, live_key, changed_at desc, id desc);

create index if not exists live_category_history_channel_date_changed_idx
  on public.live_category_history (channel_id, schedule_date, changed_at asc, id asc);

create index if not exists live_category_history_channel_category_changed_idx
  on public.live_category_history (channel_id, category_type, category_id, changed_at desc, id desc);

alter table public.live_category_history enable row level security;

grant select on public.live_category_history to anon, authenticated;
grant all on public.live_category_history to service_role;

drop policy if exists "anon can read live category history" on public.live_category_history;
drop policy if exists "authenticated can read live category history" on public.live_category_history;

create policy "anon can read live category history"
  on public.live_category_history for select
  to anon
  using (true);

create policy "authenticated can read live category history"
  on public.live_category_history for select
  to authenticated
  using (true);
