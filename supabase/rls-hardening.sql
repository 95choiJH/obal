-- Supabase RLS hardening for the extension/admin split.
-- Run this in the Supabase SQL editor with an owner/service role.
-- After creating your admin auth user, insert that user's UUID into public.admin_users.

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);


-- Ensure optional columns used by current extension/admin code exist before policies reference them.
alter table public.schedule add column if not exists game_images jsonb;
alter table public.feedback add column if not exists related_link text;
alter table public.feedback add column if not exists status text not null default 'new';
alter table public.feedback add column if not exists contact text;
alter table public.feedback add column if not exists extension_version text;
alter table public.upcoming_content add column if not exists hidden boolean not null default false;
alter table public.schedule enable row level security;
alter table public.upcoming_content enable row level security;
alter table public.feedback enable row level security;
alter table public.admin_users enable row level security;


-- Game image uploads used by the admin page.
insert into storage.buckets (id, name, public)
values ('game-images', 'game-images', true)
on conflict (id) do update set public = true;

drop policy if exists "anon can read game images" on storage.objects;
drop policy if exists "admin users can upload game images" on storage.objects;
drop policy if exists "admin users can update game images" on storage.objects;
drop policy if exists "admin users can delete game images" on storage.objects;

create policy "anon can read game images"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'game-images');

create policy "admin users can upload game images"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'game-images'
    and exists (select 1 from public.admin_users au where au.user_id = auth.uid())
  );

create policy "admin users can update game images"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'game-images'
    and exists (select 1 from public.admin_users au where au.user_id = auth.uid())
  )
  with check (
    bucket_id = 'game-images'
    and exists (select 1 from public.admin_users au where au.user_id = auth.uid())
  );

create policy "admin users can delete game images"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'game-images'
    and exists (select 1 from public.admin_users au where au.user_id = auth.uid())
  );
-- Replace broad policies from older setup docs, if they exist.
drop policy if exists "anon can read schedule" on public.schedule;
drop policy if exists "authenticated can read schedule" on public.schedule;
drop policy if exists "authenticated can manage schedule" on public.schedule;
drop policy if exists "anon can read upcoming_content" on public.upcoming_content;
drop policy if exists "authenticated can read upcoming_content" on public.upcoming_content;
drop policy if exists "authenticated can manage upcoming_content" on public.upcoming_content;
drop policy if exists "anon can insert feedback" on public.feedback;
drop policy if exists "authenticated can read feedback" on public.feedback;
drop policy if exists "authenticated can update feedback" on public.feedback;
drop policy if exists "admin users can manage schedule" on public.schedule;
drop policy if exists "admin users can manage upcoming_content" on public.upcoming_content;
drop policy if exists "admin users can read feedback" on public.feedback;
drop policy if exists "admin users can update feedback status" on public.feedback;
drop policy if exists "admin users can delete feedback" on public.feedback;
drop policy if exists "admin users can read admin_users" on public.admin_users;

create policy "anon can read schedule"
  on public.schedule for select
  to anon
  using (true);

create policy "authenticated can read schedule"
  on public.schedule for select
  to authenticated
  using (true);

create policy "admin users can manage schedule"
  on public.schedule for all
  to authenticated
  using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()))
  with check (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));

create policy "anon can read upcoming_content"
  on public.upcoming_content for select
  to anon
  using (true);

create policy "authenticated can read upcoming_content"
  on public.upcoming_content for select
  to authenticated
  using (true);

create policy "admin users can manage upcoming_content"
  on public.upcoming_content for all
  to authenticated
  using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()))
  with check (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));

-- Anonymous clients must not write feedback directly. Public submissions go through
-- supabase/functions/submit-feedback, which validates and rate-limits before inserting
-- with the service role key.

create policy "admin users can read feedback"
  on public.feedback for select
  to authenticated
  using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));

create policy "admin users can update feedback status"
  on public.feedback for update
  to authenticated
  using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()))
  with check (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));


create policy "admin users can delete feedback"
  on public.feedback for delete
  to authenticated
  using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));

create policy "admin users can read admin_users"
  on public.admin_users for select
  to authenticated
  using (user_id = auth.uid());

-- Durable rate-limit counters for public Edge Functions. The table is not
-- directly accessible to browser clients; only the service-role-only RPC below
-- can update it.
create table if not exists public.edge_rate_limits (
  scope text not null,
  client_key text not null,
  window_start timestamptz not null,
  request_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (scope, client_key)
);

create index if not exists edge_rate_limits_updated_at_idx
  on public.edge_rate_limits (updated_at);

alter table public.edge_rate_limits enable row level security;
revoke all on public.edge_rate_limits from anon, authenticated;

create or replace function public.check_edge_rate_limit(
  p_scope text,
  p_client_key text,
  p_window_seconds integer,
  p_max_requests integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window_start timestamptz;
  v_request_count integer;
begin
  if coalesce(length(p_scope), 0) < 1
    or coalesce(length(p_client_key), 0) < 1
    or p_window_seconds < 1
    or p_window_seconds > 86400
    or p_max_requests < 1
    or p_max_requests > 10000 then
    return false;
  end if;

  v_window_start := pg_catalog.to_timestamp(
    pg_catalog.floor(extract(epoch from pg_catalog.clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.edge_rate_limits as limits (
    scope, client_key, window_start, request_count, updated_at
  ) values (
    left(p_scope, 80), left(p_client_key, 128), v_window_start, 1, pg_catalog.now()
  )
  on conflict (scope, client_key) do update
  set window_start = case
        when limits.window_start < v_window_start then v_window_start
        else limits.window_start
      end,
      request_count = case
        when limits.window_start < v_window_start then 1
        else limits.request_count + 1
      end,
      updated_at = pg_catalog.now()
  returning request_count into v_request_count;

  -- Opportunistic cleanup keeps abandoned client counters bounded without a
  -- separate scheduled job.
  if pg_catalog.random() < 0.01 then
    delete from public.edge_rate_limits
    where updated_at < pg_catalog.now() - interval '1 day';
  end if;

  return v_request_count <= p_max_requests;
end;
$$;

revoke all on function public.check_edge_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_edge_rate_limit(text, text, integer, integer) to service_role;

-- Example, replace with the UUID from Supabase Auth > Users:
-- insert into public.admin_users (user_id) values ('24e50812-e5aa-4636-8aa0-a6e15d3b7322');







