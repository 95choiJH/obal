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

-- Example, replace with the UUID from Supabase Auth > Users:
-- insert into public.admin_users (user_id) values ('24e50812-e5aa-4636-8aa0-a6e15d3b7322');







