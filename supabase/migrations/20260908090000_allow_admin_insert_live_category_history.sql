grant select, insert, update on public.live_category_history to authenticated;

drop policy if exists "admin users can insert live category history" on public.live_category_history;
create policy "admin users can insert live category history"
  on public.live_category_history for insert
  to authenticated
  with check (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));
