-- ============================================================================
-- Let the web app know when a YouTube check has actually finished.
--
-- The page fires the check on load and then had to guess how long to wait, so
-- "Checking YouTube…" sat on screen well after the work was done. The worker
-- now stamps this column when a refresh run completes, and the page watches for
-- it to change instead of counting seconds.
--
-- Run once in: Supabase -> SQL Editor -> New query -> Run. Safe to re-run.
-- ============================================================================

alter table public.post_yt_vido_automation_settings
  add column if not exists last_checked_at timestamptz;
