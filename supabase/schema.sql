-- ============================================================================
-- Post YT Video Automation - Supabase schema
-- Run this whole file once in: Supabase -> SQL Editor -> New query -> Run.
-- ============================================================================

-- Extensions ----------------------------------------------------------------
create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists pg_net;     -- net.http_post() for the button trigger

-- ============================================================================
-- post_yt_vido_automation_settings
-- Single row (id = 1) of channel-wide config, edited in the web app.
-- ============================================================================
create table if not exists public.post_yt_vido_automation_settings (
  id                  int primary key default 1 check (id = 1),
  channel_tags        text  default '',
  sample_tagsets      jsonb default '[]'::jsonb,
  description_footer  text  default '',
  drive_folder_id     text  default '',
  youtube_category_id text  default '27', -- 27 = Education
  caption_language    text  default 'en',
  updated_at          timestamptz default now()
);
insert into public.post_yt_vido_automation_settings (id) values (1) on conflict (id) do nothing;

-- ============================================================================
-- post_yt_vido_automation_videos
-- One row per "Process & Schedule" click; the worker updates status.
-- status flow: queued -> processing -> scheduled -> posted (or -> failed)
-- ============================================================================
create table if not exists public.post_yt_vido_automation_videos (
  id                uuid primary key default gen_random_uuid(),
  title             text,
  status            text not null default 'queued',
  publish_at        timestamptz not null,
  youtube_video_id  text,
  error             text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);
create index if not exists post_yt_vido_automation_videos_status_publish_idx
  on public.post_yt_vido_automation_videos (status, publish_at);

-- ============================================================================
-- post_yt_vido_automation_app_config
-- Private. Holds the GitHub token used by the DB trigger.
-- RLS is ON with NO policies, so it is unreachable by anon/authenticated clients.
-- The SECURITY DEFINER trigger below can still read it.
-- ============================================================================
create table if not exists public.post_yt_vido_automation_app_config (
  id            int primary key default 1 check (id = 1),
  github_owner  text,
  github_repo   text,
  github_pat    text
);

-- ============================================================================
-- Button trigger: when a 'queued' video is inserted, fire the GitHub Action
-- via repository_dispatch. Keeps the GitHub token server-side.
-- ============================================================================
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

drop trigger if exists trg_dispatch_process_video on public.post_yt_vido_automation_videos;
create trigger trg_dispatch_process_video
  after insert on public.post_yt_vido_automation_videos
  for each row execute function public.dispatch_process_video();

-- ============================================================================
-- Row Level Security
-- settings/videos: any logged-in magic-link user has full access.
-- app config: RLS on, no policies, locked to service_role/security definer use.
-- ============================================================================
alter table public.post_yt_vido_automation_settings   enable row level security;
alter table public.post_yt_vido_automation_videos     enable row level security;
alter table public.post_yt_vido_automation_app_config enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.post_yt_vido_automation_settings to authenticated;
grant select, insert, update, delete on table public.post_yt_vido_automation_videos to authenticated;

-- The GitHub Actions workers connect with the service_role key. service_role
-- bypasses RLS but still needs plain table privileges (this project does not
-- have Supabase's usual default grants).
grant usage on schema public to service_role;
grant select, insert, update, delete on table public.post_yt_vido_automation_settings to service_role;
grant select, insert, update, delete on table public.post_yt_vido_automation_videos to service_role;

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

-- post_yt_vido_automation_app_config: intentionally no policies.
