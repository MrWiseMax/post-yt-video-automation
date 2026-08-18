-- ============================================================================
-- Rescheduling support.
-- Run once in: Supabase -> SQL Editor -> New query -> Run. Safe to re-run.
-- Fresh installs get all of this from schema.sql already.
-- ============================================================================

-- The web app writes a requested new publish time here rather than straight
-- into publish_at. publish_at mirrors what YouTube actually has; reschedule_to
-- is a request the worker has not pushed yet. Keeping the two apart is what
-- stops the YouTube -> Supabase sync from instantly reverting an edit made in
-- the web app: a pending request is applied first, and only then does YouTube
-- go back to being the source of truth.
alter table public.post_yt_vido_automation_videos
  add column if not exists reschedule_to timestamptz;

-- ============================================================================
-- Fire the check-live worker as soon as a reschedule is requested, so the
-- change reaches YouTube in about a minute instead of waiting for the next
-- 15-minute tick. Same repository_dispatch mechanism as the schedule button.
-- ============================================================================
create or replace function public.dispatch_sync_videos()
returns trigger
language plpgsql
security definer
set search_path = public, net, extensions
as $$
declare
  cfg public.post_yt_vido_automation_app_config%rowtype;
begin
  select * into cfg from public.post_yt_vido_automation_app_config where id = 1;
  if cfg.github_pat is null or cfg.github_owner is null or cfg.github_repo is null then
    raise warning 'post_yt_vido_automation_app_config not set; skipping GitHub dispatch';
    return new;
  end if;

  perform net.http_post(
    url     := 'https://api.github.com/repos/' || cfg.github_owner || '/' || cfg.github_repo || '/dispatches',
    body    := jsonb_build_object('event_type', 'sync-videos'),
    headers := jsonb_build_object(
                 'Authorization',        'Bearer ' || cfg.github_pat,
                 'Accept',               'application/vnd.github+json',
                 'Content-Type',         'application/json',
                 'User-Agent',           'supabase-yt-automation',
                 'X-GitHub-Api-Version', '2022-11-28'
               )
  );
  return new;
end;
$$;

drop trigger if exists trg_dispatch_sync_videos on public.post_yt_vido_automation_videos;
create trigger trg_dispatch_sync_videos
  after update of reschedule_to on public.post_yt_vido_automation_videos
  for each row
  when (new.reschedule_to is not null and old.reschedule_to is distinct from new.reschedule_to)
  execute function public.dispatch_sync_videos();
