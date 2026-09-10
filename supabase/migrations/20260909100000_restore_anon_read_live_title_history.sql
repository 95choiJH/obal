grant usage on schema public to anon;
grant select on public.live_title_history to anon;

alter table public.live_title_history enable row level security;

drop policy if exists "anon can read live title history" on public.live_title_history;

create policy "anon can read live title history"
  on public.live_title_history for select
  to anon
  using (true);
