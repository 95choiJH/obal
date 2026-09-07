-- Automatically saved replays use a neutral label. When a schedule has more
-- than one replay, number every item in its existing display order.
update public.schedule as schedule_row
set vods = (
  select jsonb_agg(
    vod_item || jsonb_build_object(
      'label',
      case
        when jsonb_array_length(schedule_row.vods) > 1
          then '방송 다시보기' || vod_position::text
        else '방송 다시보기'
      end
    )
    order by vod_position
  )
  from jsonb_array_elements(schedule_row.vods) with ordinality as items(vod_item, vod_position)
)
where jsonb_typeof(schedule_row.vods) = 'array'
  and jsonb_array_length(schedule_row.vods) > 0
  and exists (
    select 1
    from jsonb_array_elements(schedule_row.vods) as existing_vod
    where coalesce(existing_vod->>'liveKey', '') <> ''
       or coalesce(existing_vod->>'videoNo', '') <> ''
  );
