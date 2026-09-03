create table if not exists public.live_session_state (
  channel_id text primary key,
  live_key text,
  schedule_date date,
  started_at timestamptz,
  last_seen_at timestamptz,
  ended_at timestamptz,
  is_live boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.live_session_state enable row level security;

grant all on public.live_session_state to service_role;

create index if not exists live_session_state_updated_idx
  on public.live_session_state (updated_at desc);
