-- Serialize observations so overlapping 5-second requests cannot duplicate
-- chapters or insert a stale category after a newer observation.
alter table public.live_category_history
  add column if not exists last_observed_at timestamptz;

create or replace function public.record_live_chapter_observation(observation jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous public.live_category_history%rowtype;
  observed_at timestamptz := (observation->>'changed_at')::timestamptz;
  chapter_offset integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    (observation->>'channel_id') || ':' || (observation->>'live_key'), 0));
  select * into previous from public.live_category_history
  where channel_id = observation->>'channel_id'
    and live_key = observation->>'live_key'
  order by changed_at desc, id desc limit 1;

  if previous.id is not null then
    if greatest(previous.changed_at, previous.last_observed_at) >= observed_at then
      return jsonb_build_object('recorded', false, 'reason', 'stale-observation');
    end if;
    if (case
      when coalesce(previous.category_id, '') <> '' and coalesce(observation->>'category_id', '') <> ''
        and coalesce(previous.category_type, '') <> '' and coalesce(observation->>'category_type', '') <> ''
      then previous.category_id = observation->>'category_id'
        and upper(previous.category_type) = upper(observation->>'category_type')
      else lower(trim(previous.category_label)) = lower(trim(observation->>'category_label'))
    end) then
      update public.live_category_history set last_observed_at = observed_at
      where id = previous.id;
      return jsonb_build_object('recorded', false, 'reason', 'unchanged');
    end if;
  end if;

  chapter_offset := case when previous.id is null then 0 else (observation->>'offset_seconds')::integer end;
  insert into public.live_category_history (
    channel_id, live_key, schedule_date, category_label, category_id,
    category_type, category_poster_image_url, previous_category_label,
    previous_category_id, previous_category_type, started_at, changed_at,
    offset_seconds, hidden, last_observed_at
  ) values (
    observation->>'channel_id', observation->>'live_key', (observation->>'schedule_date')::date,
    observation->>'category_label', observation->>'category_id', observation->>'category_type',
    observation->>'category_poster_image_url', previous.category_label,
    previous.category_id, previous.category_type, (observation->>'started_at')::timestamptz,
    observed_at, chapter_offset, coalesce((observation->>'hidden')::boolean, false), observed_at
  );
  return jsonb_build_object('recorded', true,
    'action', case when previous.id is null then 'initial' else 'changed' end,
    'changedAt', observation->>'changed_at', 'offsetSeconds', chapter_offset,
    'liveKey', observation->>'live_key');
end;
$$;

revoke all on function public.record_live_chapter_observation(jsonb) from public, anon, authenticated;
grant execute on function public.record_live_chapter_observation(jsonb) to service_role;
