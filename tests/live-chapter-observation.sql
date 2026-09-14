-- Run against a database with the migration installed. All fixtures roll back.
begin;
do $$
declare
  sample jsonb := jsonb_build_object(
    'channel_id', '__chapter_test__' || txid_current()::text,
    'live_key', 'test-session', 'schedule_date', '2026-09-14',
    'category_label', 'A', 'category_id', 'a', 'category_type', 'GAME',
    'started_at', '2026-09-14T12:00:00Z',
    'changed_at', '2026-09-14T12:00:05Z', 'offset_seconds', 5);
  result jsonb;
  count_rows integer;
begin
  result := public.record_live_chapter_observation(sample);
  assert (result->>'recorded')::boolean and (result->>'offsetSeconds')::integer = 0,
    'First chapter must start at zero';
  result := public.record_live_chapter_observation(sample || '{"changed_at":"2026-09-14T12:00:10Z"}'::jsonb);
  assert result->>'reason' = 'unchanged', 'Unchanged category must not add a chapter';
  sample := sample || '{"category_label":"B","category_id":"b","changed_at":"2026-09-14T12:00:15Z","offset_seconds":15}'::jsonb;
  result := public.record_live_chapter_observation(sample);
  assert (result->>'recorded')::boolean and (result->>'offsetSeconds')::integer = 15,
    'Changed chapter must preserve observed offset';
  result := public.record_live_chapter_observation(sample);
  assert result->>'reason' = 'stale-observation', 'Repeated observation must be ignored';
  result := public.record_live_chapter_observation(sample || '{"category_id":"a","changed_at":"2026-09-14T12:00:12Z"}'::jsonb);
  assert result->>'reason' = 'stale-observation', 'Late older response must be ignored';
  result := public.record_live_chapter_observation(sample || '{"changed_at":"2026-09-14T12:00:19Z"}'::jsonb);
  assert result->>'reason' = 'unchanged', 'Unchanged observations still advance the watermark';
  result := public.record_live_chapter_observation(sample || '{"category_id":"a","changed_at":"2026-09-14T12:00:18Z"}'::jsonb);
  assert result->>'reason' = 'stale-observation', 'A response older than the latest unchanged observation must be ignored';
  sample := sample || '{"category_label":"A","category_id":"a","changed_at":"2026-09-14T12:00:20Z","offset_seconds":20}'::jsonb;
  result := public.record_live_chapter_observation(sample);
  assert (result->>'recorded')::boolean, 'Returning to an earlier category must add a chapter';
  select count(*) into count_rows from public.live_category_history
    where channel_id = sample->>'channel_id';
  assert count_rows = 3, 'Only A, B, A should be saved';
  assert not has_function_privilege('anon', 'public.record_live_chapter_observation(jsonb)', 'execute'),
    'Public clients must not write observations';
end;
$$;
rollback;
