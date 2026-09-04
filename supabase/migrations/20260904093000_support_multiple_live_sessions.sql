alter table public.live_session_state
  add column if not exists id bigint;

create sequence if not exists public.live_session_state_id_seq
  as bigint;

alter sequence public.live_session_state_id_seq
  owned by public.live_session_state.id;

alter table public.live_session_state
  alter column id set default nextval('public.live_session_state_id_seq'::regclass);

update public.live_session_state
set id = nextval('public.live_session_state_id_seq'::regclass)
where id is null;

alter table public.live_session_state
  alter column id set not null;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.live_session_state'::regclass
      and conname = 'live_session_state_pkey'
  ) then
    alter table public.live_session_state drop constraint live_session_state_pkey;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.live_session_state'::regclass
      and contype = 'p'
  ) then
    alter table public.live_session_state add constraint live_session_state_pkey primary key (id);
  end if;
end $$;

create unique index if not exists live_session_state_channel_live_key_idx
  on public.live_session_state (channel_id, live_key)
  where live_key is not null;

create index if not exists live_session_state_channel_live_updated_idx
  on public.live_session_state (channel_id, is_live, updated_at desc);

create index if not exists live_session_state_pending_vod_idx
  on public.live_session_state (channel_id, ended_at asc, updated_at asc)
  where is_live = false and (vod_saved_at is null or vod_url is null);
