-- ============================================================================
-- "Refresh from YouTube" button.
--
-- The web page cannot call YouTube itself (the OAuth refresh token is a worker
-- secret), so the button asks Supabase to fire the check-live workflow with a
-- refresh-videos event. That run copies publish times down from YouTube and
-- removes scheduled videos that no longer exist there.
--
-- The 15-minute pg_cron ping stays as it is: it only watches for videos going
-- public, and no longer syncs or deletes anything on its own.
--
-- Run once in: Supabase -> SQL Editor -> New query -> Run. Safe to re-run.
-- Needs the GitHub token row from SETUP.md step 4.
-- ============================================================================

create or replace function public.dispatch_refresh_videos()
returns void
language plpgsql
security definer
set search_path = public, net, extensions
as $fn$
declare
  cfg public.post_yt_vido_automation_app_config%rowtype;
begin
  -- Belt and braces alongside the grant below: this is the same allowlist the
  -- row-level security policies use, so a stray authenticated session still
  -- cannot fire workflow runs.
  if lower(coalesce(auth.jwt() ->> 'email', '')) not in (
       'mrwisemikeyt@gmail.com',
       'ahmedzuhairyoutube@gmail.com'
     ) then
    raise exception 'not allowed';
  end if;

  select * into cfg from public.post_yt_vido_automation_app_config where id = 1;
  if cfg.github_pat is null or cfg.github_owner is null or cfg.github_repo is null then
    raise exception 'post_yt_vido_automation_app_config is not filled in';
  end if;

  perform net.http_post(
    url     := 'https://api.github.com/repos/' || cfg.github_owner || '/' || cfg.github_repo || '/dispatches',
    body    := jsonb_build_object('event_type', 'refresh-videos'),
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

-- anon must never reach this: that key ships in js/config.js on a public page.
-- Only a signed-in session may press the button.
revoke all on function public.dispatch_refresh_videos() from public, anon;
grant execute on function public.dispatch_refresh_videos() to authenticated;
