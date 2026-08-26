-- ============================================================================
-- Rescheduling from the web app is gone.
--
-- Publish times are changed in YouTube Studio now, and the check-live worker
-- copies them back down every 15 minutes. Nothing writes reschedule_to any
-- more, so the column, its dispatch trigger and that trigger's function all go.
--
-- Run once in: Supabase -> SQL Editor -> New query -> Run. Safe to re-run.
-- Deploy the worker and web app first; nothing breaks if you do it the other
-- way round, but the Reschedule button would error until the new page loads.
-- ============================================================================

drop trigger if exists trg_dispatch_sync_videos on public.post_yt_vido_automation_videos;
drop function if exists public.dispatch_sync_videos();

alter table public.post_yt_vido_automation_videos
  drop column if exists reschedule_to;
