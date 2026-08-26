-- ============================================================================
-- Liking and commenting are manual now.
--
-- The worker no longer likes the video or posts the first comment; it sends the
-- comment text to Telegram and you post and pin it by hand (the YouTube Data
-- API cannot pin a comment, so that step was always manual anyway). Nothing
-- reads or writes liked_at / comment_posted_at any more.
--
-- ORDER MATTERS: deploy the worker change FIRST, let one check-live run finish
-- cleanly, and only then run this. The previous worker writes both columns in
-- the same UPDATE that marks a video 'posted' — drop them while that code is
-- still live and the write fails silently, leaving videos stuck as 'scheduled'.
--
-- first_comment stays: it is what gets sent to Telegram.
-- ============================================================================

alter table public.post_yt_vido_automation_videos
  drop column if exists liked_at,
  drop column if exists comment_posted_at;
