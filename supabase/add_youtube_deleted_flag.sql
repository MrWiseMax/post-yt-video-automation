-- ============================================================================
-- Mark published videos that were later deleted on YouTube.
--
-- A video that never published was cancelled, so its row is removed outright —
-- there is nothing to remember about it. A video that was live and has since
-- been taken down keeps its row and is shown as "deleted" in the app instead,
-- because dropping it would quietly erase a video that really did go out.
--
-- Run once in: Supabase -> SQL Editor -> New query -> Run. Safe to re-run.
-- ============================================================================

alter table public.post_yt_vido_automation_videos
  add column if not exists youtube_deleted_at timestamptz;
