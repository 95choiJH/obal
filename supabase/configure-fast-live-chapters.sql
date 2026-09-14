-- Apply AFTER deploying sync-live-category with chapters/maintenance modes.
-- Reuse existing credentials in cron.job; never copy secrets into this file.
do $$
declare
  source_job record;
  chapter_command text;
  maintenance_command text;
begin
  select * into strict source_job
  from cron.job
  where active
    and command like '%/functions/v1/sync-live-category%'
    and jobname <> 'sync-live-chapters-5s';

  -- Support reapplying this configuration, but fail on an unexpected URL
  -- instead of accidentally scheduling the full replay workload every 5s.
  maintenance_command := replace(source_job.command,
    '/functions/v1/sync-live-category?mode=maintenance''',
    '/functions/v1/sync-live-category''');
  if position('/functions/v1/sync-live-category''' in maintenance_command) = 0 then
    raise exception 'Expected one literal sync-live-category URL without query parameters';
  end if;
  chapter_command := replace(maintenance_command,
    '/functions/v1/sync-live-category''',
    '/functions/v1/sync-live-category?mode=chapters''');
  maintenance_command := replace(maintenance_command,
    '/functions/v1/sync-live-category''',
    '/functions/v1/sync-live-category?mode=maintenance''');

  perform cron.alter_job(source_job.jobid, command := maintenance_command);
  perform cron.schedule('sync-live-chapters-5s', '5 seconds', chapter_command);
end;
$$;

select jobid, jobname, schedule, active
from cron.job
where command like '%/functions/v1/sync-live-category%'
order by jobid;
