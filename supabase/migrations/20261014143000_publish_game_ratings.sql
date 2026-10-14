drop policy if exists "anon can read public game ratings" on public.admin_settings;

create policy "anon can read public game ratings"
  on public.admin_settings for select
  to anon
  using (key = 'game_ratings');
