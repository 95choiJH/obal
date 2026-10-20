begin;
alter table public.live_category_history add column if not exists vod_video_no text;
create index if not exists live_category_history_vod_video_idx
  on public.live_category_history(channel_id, vod_video_no) where vod_video_no is not null;
-- Only migrate an exact, unique broadcast match. Never infer by array order.
with candidates as (
  select h.id, coalesce(nullif(v->>'videoNo',''), substring(v->>'url' from '/video/([0-9]+)')) as video_no
  from public.live_category_history h
  join public.schedule s on s.channel_id=h.channel_id and s.date=h.schedule_date
  cross join lateral jsonb_array_elements(coalesce(s.vods::jsonb,'[]'::jsonb)) v
  where h.vod_video_no is null and h.live_key=v->>'liveKey'
), unique_matches as (
  select id,min(video_no) as video_no from candidates
  group by id having count(*)=count(video_no) and count(distinct video_no)=1
)
update public.live_category_history h set vod_video_no=m.video_no
from unique_matches m where h.id=m.id and m.video_no ~ '^[0-9]+$';
commit;
