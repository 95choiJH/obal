alter table public.live_title_history
  add column if not exists hidden boolean not null default false,
  add column if not exists category_hidden boolean not null default false;

grant update on public.live_title_history to authenticated;

drop policy if exists "admin users can update live title history" on public.live_title_history;
create policy "admin users can update live title history"
  on public.live_title_history for update
  to authenticated
  using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()))
  with check (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));
