-- Rename existing Supabase tables for the Post YT Video Automation app.
-- This preserves existing data and rewires the trigger/policies to the new names.

begin;

do $$
begin
  if to_regclass('public.videos') is not null then
    drop trigger if exists trg_dispatch_process_video on public.videos;
  end if;

  if to_regclass('public.post_yt_vido_automation_videos') is not null then
    drop trigger if exists trg_dispatch_process_video on public.post_yt_vido_automation_videos;
  end if;
end $$;

do $$
begin
  if to_regclass('public.post_yt_vido_automation_settings') is null
     and to_regclass('public.settings') is not null then
    alter table public.settings rename to post_yt_vido_automation_settings;
  end if;

  if to_regclass('public.post_yt_vido_automation_videos') is null
     and to_regclass('public.videos') is not null then
    alter table public.videos rename to post_yt_vido_automation_videos;
  end if;

  if to_regclass('public.post_yt_vido_automation_app_config') is null
     and to_regclass('public.app_config') is not null then
    alter table public.app_config rename to post_yt_vido_automation_app_config;
  end if;

  if to_regclass('public.post_yt_vido_automation_videos_status_publish_idx') is null
     and to_regclass('public.videos_status_publish_idx') is not null then
    alter index public.videos_status_publish_idx rename to post_yt_vido_automation_videos_status_publish_idx;
  end if;
end $$;

create or replace function public.dispatch_process_video()
returns trigger
language plpgsql
security definer
set search_path = public, net, extensions
as $$
declare
  cfg public.post_yt_vido_automation_app_config%rowtype;
begin
  if new.status is distinct from 'queued' then
    return new;
  end if;

  select * into cfg from public.post_yt_vido_automation_app_config where id = 1;
  if cfg.github_pat is null or cfg.github_owner is null or cfg.github_repo is null then
    raise warning 'post_yt_vido_automation_app_config not set; skipping GitHub dispatch';
    return new;
  end if;

  perform net.http_post(
    url     := 'https://api.github.com/repos/' || cfg.github_owner || '/' || cfg.github_repo || '/dispatches',
    body    := jsonb_build_object(
                 'event_type', 'process-video',
                 'client_payload', jsonb_build_object('video_id', new.id::text)
               ),
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

create trigger trg_dispatch_process_video
  after insert on public.post_yt_vido_automation_videos
  for each row execute function public.dispatch_process_video();

alter table public.post_yt_vido_automation_settings   enable row level security;
alter table public.post_yt_vido_automation_videos     enable row level security;
alter table public.post_yt_vido_automation_app_config enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.post_yt_vido_automation_settings to authenticated;
grant select, insert, update, delete on table public.post_yt_vido_automation_videos to authenticated;

drop policy if exists "authenticated settings" on public.post_yt_vido_automation_settings;
create policy "authenticated settings" on public.post_yt_vido_automation_settings
  for all to authenticated
  using (
    lower(coalesce(auth.jwt() ->> 'email', '')) in (
      'mrwisemikeyt@gmail.com',
      'ahmedzuhairyoutube@gmail.com'
    )
  )
  with check (
    lower(coalesce(auth.jwt() ->> 'email', '')) in (
      'mrwisemikeyt@gmail.com',
      'ahmedzuhairyoutube@gmail.com'
    )
  );

drop policy if exists "authenticated videos" on public.post_yt_vido_automation_videos;
create policy "authenticated videos" on public.post_yt_vido_automation_videos
  for all to authenticated
  using (
    lower(coalesce(auth.jwt() ->> 'email', '')) in (
      'mrwisemikeyt@gmail.com',
      'ahmedzuhairyoutube@gmail.com'
    )
  )
  with check (
    lower(coalesce(auth.jwt() ->> 'email', '')) in (
      'mrwisemikeyt@gmail.com',
      'ahmedzuhairyoutube@gmail.com'
    )
  );

commit;
