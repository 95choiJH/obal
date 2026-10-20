-- Older collectors sent CHZZK's timezone-free Korean wall clock directly to
-- timestamptz. Correct only rows whose timestamp exactly matches that mistaken
-- UTC interpretation of their CHZZK live key; already-correct rows are untouched.
begin;
update public.live_session_state
set started_at = (live_key::timestamp at time zone 'Asia/Seoul'),
    vod_checked_at = case when vod_saved_at is null then null else vod_checked_at end,
    updated_at = now()
where live_key ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$'
  and started_at = (live_key::timestamp at time zone 'UTC');
commit;
