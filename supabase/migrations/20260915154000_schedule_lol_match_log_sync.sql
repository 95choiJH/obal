-- Schedule LoL solo-rank match log sync. Reuses the existing function-call
-- credentials from the sync-live-category cron job; do not copy secrets here.
do $$
declare
  source_job record;
  lol_command text;
begin
  select * into strict source_job
  from cron.job
  where active
    and command like '%/functions/v1/sync-live-category%'
  order by case when command like '%mode=maintenance%' then 0 else 1 end, jobid
  limit 1;

  lol_command := source_job.command;
  lol_command := replace(lol_command,
    '/functions/v1/sync-live-category?mode=maintenance',
    '/functions/v1/sync-lol-match-logs');
  lol_command := replace(lol_command,
    '/functions/v1/sync-live-category?mode=chapters',
    '/functions/v1/sync-lol-match-logs');
  lol_command := replace(lol_command,
    '/functions/v1/sync-live-category',
    '/functions/v1/sync-lol-match-logs');

  if position('/functions/v1/sync-lol-match-logs' in lol_command) = 0 then
    raise exception 'Could not derive sync-lol-match-logs cron command';
  end if;

  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'sync-lol-match-logs-2m';

  perform cron.schedule('sync-lol-match-logs-2m', '*/2 * * * *', lol_command);
end;
$$;

