grant select on public.live_title_history to anon;

drop policy if exists "anon can read live title history" on public.live_title_history;

create policy "anon can read live title history"
  on public.live_title_history for select
  to anon
  using (true);
