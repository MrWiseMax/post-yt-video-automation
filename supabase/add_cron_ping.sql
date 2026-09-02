-- ============================================================================
-- Keep the go-live notification working when the web app is closed.
--
-- The app checks YouTube when its page loads, but a video usually publishes
-- while nobody is looking — and the Telegram carrying the first comment is the
-- reminder to go and post it. So a small ping runs on a schedule purely to
-- catch videos going public.
--
-- It fires the SAME workflow, without the refresh-videos event type, so the run
-- only detects go-live: publish times and deleted videos are still reconciled
-- only when the page is opened.
--
-- GitHub's own `schedule:` is best effort — this repo saw a */15 cron fire once
-- every 2-5 hours — so pg_cron drives it instead, reusing the GitHub token
-- already in post_yt_vido_automation_app_config. No new service, no new secret.
--
-- Run once in: Supabase -> SQL Editor -> New query -> Run. Safe to re-run.
-- If pg_cron is unavailable on this project the first statement fails and
-- nothing below it is applied.
-- ============================================================================

create extension if not exists pg_cron;

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
-- anon key — which ships in js/config.js — could fire workflow runs at will.
-- pg_cron runs as the owner, so it is unaffected.
revoke all on function public.dispatch_check_live() from public, anon, authenticated;

-- Replace the job rather than stacking a second copy when this file is re-run.
do $do$
begin
  perform cron.unschedule('check-live-ping');
exception
  when others then null;
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
