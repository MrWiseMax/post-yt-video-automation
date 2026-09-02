-- ============================================================================
-- Keep check-live running on a real 15-minute schedule.
--
-- GitHub's own `schedule:` trigger is best-effort: under load it delays or
-- silently drops runs, and in practice this repo sees one every 2-5 hours
-- instead of every 15 minutes. That is the clock for go-live detection, so the
-- Telegram message carrying the first comment can arrive hours after a video
-- actually publishes.
--
-- Supabase runs pg_cron on a real schedule, and the GitHub token already lives
-- here in post_yt_vido_automation_app_config (RLS on, no policies, so the
-- browser cannot reach it). This reuses the same net.http_post dispatch the
-- Process & Schedule button already uses, so no new service holds a token that
-- can write to the repo.
--
-- Run once in: Supabase -> SQL Editor -> New query -> Run. Safe to re-run.
-- If pg_cron is not available on this project the first statement fails and
-- nothing below it is applied.
-- ============================================================================

create extension if not exists pg_cron;

-- ----------------------------------------------------------------------------
-- Fire the check-live workflow via repository_dispatch.
-- ----------------------------------------------------------------------------
create or replace function public.dispatch_check_live()
returns void
language plpgsql
security definer
set search_path = public, net, extensions
as $fn$
declare
  cfg public.post_yt_vido_automation_app_config%rowtype;
begin
  select * into cfg from public.post_yt_vido_automation_app_config where id = 1;
  if cfg.github_pat is null or cfg.github_owner is null or cfg.github_repo is null then
    raise warning 'post_yt_vido_automation_app_config not set; skipping GitHub dispatch';
    return;
  end if;

  perform net.http_post(
    url     := 'https://api.github.com/repos/' || cfg.github_owner || '/' || cfg.github_repo || '/dispatches',
    body    := jsonb_build_object('event_type', 'check-live'),
    headers := jsonb_build_object(
                 'Authorization',        'Bearer ' || cfg.github_pat,
                 'Accept',               'application/vnd.github+json',
                 'Content-Type',         'application/json',
                 'User-Agent',           'supabase-yt-automation',
                 'X-GitHub-Api-Version', '2022-11-28'
               )
  );
end;
$fn$;

-- SECURITY DEFINER functions are executable by PUBLIC by default, and PostgREST
-- publishes public-schema functions as RPC. Without this, anyone holding the
-- anon key — which ships in js/config.js — could POST to /rest/v1/rpc/
-- dispatch_check_live and fire workflow runs at will, burning Actions minutes
-- and YouTube API quota. pg_cron runs as the owner, so it is unaffected.
revoke all on function public.dispatch_check_live() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Schedule it. Unschedule first so this file can be re-run without erroring.
-- ----------------------------------------------------------------------------
do $do$
begin
  perform cron.unschedule('check-live-ping');
exception
  when others then null; -- not scheduled yet, nothing to remove
end;
$do$;

select cron.schedule(
  'check-live-ping',
  '*/15 * * * *',
  $job$select public.dispatch_check_live();$job$
);

-- Check it landed:
--   select jobid, jobname, schedule, active from cron.job;
-- Recent fires:
--   select status, return_message, start_time from cron.job_run_details
--     where jobid = (select jobid from cron.job where jobname = 'check-live-ping')
--     order by start_time desc limit 10;
