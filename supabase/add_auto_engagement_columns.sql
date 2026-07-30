-- Auto-engagement: like the video and post my first comment once it goes public.
--
-- The comment is written by Claude at UPLOAD time (process.js), while the
-- transcript is still in the Drive folder, and stored here. check-live.js posts
-- it later, when YouTube flips the video to public — by then the Drive folder
-- has usually been cleared for the next video, so the text must already be saved.
--
-- Run once in: Supabase -> SQL Editor -> New query -> Run.

alter table public.post_yt_vido_automation_videos
  add column if not exists first_comment     text,        -- Claude's comment, written at upload time
  add column if not exists liked_at          timestamptz, -- set once the like succeeds
  add column if not exists comment_posted_at timestamptz; -- set once the comment is posted
