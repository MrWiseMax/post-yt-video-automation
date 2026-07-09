-- ============================================================================
-- YouTube Automation — Supabase schema
-- Run this whole file once in: Supabase → SQL Editor → New query → Run.
-- ============================================================================

-- Extensions ----------------------------------------------------------------
create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists pg_net;      -- net.http_post() for the button trigger

-- ============================================================================
-- settings : single row (id = 1) of channel-wide config, edited in the web app
-- ============================================================================
create table if not exists public.settings (
  id                  int primary key default 1 check (id = 1),
  channel_tags        text  default '',              -- comma/newline separated, always included
  sample_tagsets      jsonb default '[]'::jsonb,     -- array of 3 strings (style reference for Claude)
  description_footer  text  default '',              -- appended to every description
  drive_folder_id     text  default '',              -- Google Drive folder to read
  youtube_category_id text  default '27',            -- 27 = Education
  caption_language    text  default 'en',
  updated_at          timestamptz default now()
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- ============================================================================
-- videos : one row per "Process & Schedule" click; the worker updates status
--   status flow: queued -> processing -> scheduled -> posted   (or -> failed)
-- ============================================================================
create table if not exists public.videos (
  id                uuid primary key default gen_random_uuid(),
  title             text,
  status            text not null default 'queued',
  publish_at        timestamptz not null,
  youtube_video_id  text,
  error             text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);
create index if not exists videos_status_publish_idx on public.videos (status, publish_at);

-- ============================================================================
-- app_config : private. Holds the GitHub token used by the DB trigger.
--   RLS is ON with NO policies -> unreachable by anon/authenticated clients.
--   The SECURITY DEFINER trigger below (owned by postgres) can still read it.
-- ============================================================================
create table if not exists public.app_config (
  id           int primary key default 1 check (id = 1),
  github_owner text,
  github_repo  text,
  github_pat   text
);
-- NOTE: insert your GitHub owner/repo/token via the SQL editor — see SETUP.md step 3.4.

-- ============================================================================
-- Button trigger: when a 'queued' video is inserted, fire the GitHub Action
--   via repository_dispatch. Keeps the GitHub token server-side.
-- ============================================================================
create or replace function public.dispatch_process_video()
returns trigger
language plpgsql
security definer
set search_path = public, net, extensions
as $$
declare
  cfg public.app_config%rowtype;
begin
  if new.status is distinct from 'queued' then
    return new;
  end if;

  select * into cfg from public.app_config where id = 1;
  if cfg.github_pat is null or cfg.github_owner is null or cfg.github_repo is null then
    raise warning 'app_config not set; skipping GitHub dispatch';
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

drop trigger if exists trg_dispatch_process_video on public.videos;
create trigger trg_dispatch_process_video
  after insert on public.videos
  for each row execute function public.dispatch_process_video();

-- ============================================================================
-- Row Level Security
--   settings / videos : any logged-in (magic-link) user has full access.
--   app_config        : RLS on, no policies -> locked to service_role only.
-- ============================================================================
alter table public.settings   enable row level security;
alter table public.videos     enable row level security;
alter table public.app_config enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.settings to authenticated;
grant select, insert, update, delete on table public.videos to authenticated;

drop policy if exists "authenticated settings" on public.settings;
create policy "authenticated settings" on public.settings
  for all to authenticated using (true) with check (true);

drop policy if exists "authenticated videos" on public.videos;
create policy "authenticated videos" on public.videos
  for all to authenticated using (true) with check (true);

-- app_config: intentionally no policies.
