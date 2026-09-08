-- Allow the extension's anon Supabase client to read the global target-streamer notification switch.

alter table public.admin_settings enable row level security;

grant select on public.admin_settings to anon;

drop policy if exists "anon can read public target live notification settings" on public.admin_settings;

create policy "anon can read public target live notification settings"
  on public.admin_settings for select
  to anon
  using (key in ('target_live_notifications', 'target_live_notifications_public'));