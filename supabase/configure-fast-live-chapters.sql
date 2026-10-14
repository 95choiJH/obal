-- Deprecated cleanup script. Automatic chapter collection is no longer used.
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

select jobid, jobname, schedule, active
from cron.job
where command like '%/functions/v1/sync-live-category%'
order by jobid;
