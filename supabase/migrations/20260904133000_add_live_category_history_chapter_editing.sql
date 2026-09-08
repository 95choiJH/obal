alter table public.live_category_history
  add column if not exists hidden boolean not null default false;

grant select, insert, update on public.live_category_history to authenticated;

drop policy if exists "admin users can insert live category history" on public.live_category_history;
drop policy if exists "admin users can update live category history" on public.live_category_history;
create policy "admin users can insert live category history"
  on public.live_category_history for insert
  to authenticated
  with check (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));

create policy "admin users can update live category history"
  on public.live_category_history for update
  to authenticated
  using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()))
  with check (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));
