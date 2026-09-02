-- ============================================================================
-- Remove the deleted-video flag.
--
-- The worker only looks at scheduled videos now. A posted one is finished with,
-- and is never taken down, so there is nothing left to mark. Nothing reads or
-- writes youtube_deleted_at any more.
--
-- Run once in: Supabase -> SQL Editor -> New query -> Run. Safe to re-run.
-- Deploy the worker and web app first — dropping the column while the previous
-- code is live would make its update fail.
-- ============================================================================

alter table public.post_yt_vido_automation_videos
  drop column if exists youtube_deleted_at;
