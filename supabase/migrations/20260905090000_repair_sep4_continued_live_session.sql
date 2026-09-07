-- The 2026-09-05 00:33:57 CHZZK session restarted about 90 seconds after
-- the 2026-09-04 session ended, so it belongs to the 2026-09-04 schedule.
update public.live_session_state
set schedule_date = '2026-09-04'
where channel_id = '0dad8baf12a436f722faa8e5001c5011'
  and live_key = '2026-09-05 00:33:57';

update public.live_title_history
set schedule_date = '2026-09-04'
where channel_id = '0dad8baf12a436f722faa8e5001c5011'
  and live_key = '2026-09-05 00:33:57';

update public.live_category_history
set schedule_date = '2026-09-04'
where channel_id = '0dad8baf12a436f722faa8e5001c5011'
  and live_key = '2026-09-05 00:33:57';

-- This row was created automatically only because the continued session was
-- assigned to the wrong date. Guard every identifying field before removal.
delete from public.schedule
where id = 320
  and channel_id = '0dad8baf12a436f722faa8e5001c5011'
  and date = '2026-09-05'
  and coalesce(jsonb_array_length(parts), 0) = 1
  and coalesce(parts->0->>'autoCategory', 'false') = 'true'
  and coalesce(parts->0->>'categoryId', '') = 'StarCraft_Remastered';
