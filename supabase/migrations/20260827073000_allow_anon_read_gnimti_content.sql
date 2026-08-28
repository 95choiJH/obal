alter table public.admin_settings enable row level security;
grant select on public.admin_settings to anon;

drop policy if exists "anon can read public gnimti settings" on public.admin_settings;

create policy "anon can read public gnimti settings"
  on public.admin_settings for select
  to anon
  using (key = 'gnimti_content');