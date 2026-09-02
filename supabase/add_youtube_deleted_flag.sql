-- ============================================================================
-- On-load refresh: flag posted videos that were deleted, and stop the ping.
--
-- The web app now asks for a YouTube check when the page loads, instead of a
-- button or a schedule. Two changes go with that:
--
--   1. A posted video that gets deleted on YouTube keeps its row and is shown
--      as "deleted" in the list. Only videos that never published are removed
--      outright, since there is nothing to remember about them.
--   2. The 15-minute pg_cron ping is no longer wanted, so it is unscheduled.
--
-- Run once in: Supabase -> SQL Editor -> New query -> Run. Safe to re-run, and
-- safe whether or not add_cron_ping.sql was ever applied.
-- ============================================================================

alter table public.post_yt_vido_automation_videos
  add column if not exists youtube_deleted_at timestamptz;

-- Drop the ping if it was installed. Wrapped because cron.unschedule raises
-- when the job is absent, and the whole cron schema is missing on a project
-- where pg_cron was never enabled.
do $do$
begin
  perform cron.unschedule('check-live-ping');
exception
  when others then null;
end;
$do$;

drop function if exists public.dispatch_check_live();
