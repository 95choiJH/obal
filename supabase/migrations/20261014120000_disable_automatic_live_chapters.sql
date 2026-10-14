-- Manual chapter management replaces the 5-second chapter collector.
do $$
declare
  chapter_job record;
begin
  for chapter_job in
    select jobid
    from cron.job
    where jobname = 'sync-live-chapters-5s'
       or command like '%/functions/v1/sync-live-category?mode=chapters%'
  loop
    perform cron.unschedule(chapter_job.jobid);
  end loop;
end;
$$;
