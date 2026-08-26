import { getSupabase } from './lib/supabaseClient.js';
import { youtubeClient } from './lib/googleAuth.js';
import { listVideoStatuses, updatePublishAt } from './lib/youtube.js';
import { sendTelegram } from './lib/telegram.js';

const VIDEOS_TABLE = 'post_yt_vido_automation_videos';
const now = () => new Date().toISOString();

// The zone the web app shows every time in (js/config.js). Duplicated rather
// than imported: that module is browser-side and pulls in Supabase config.
const TIMEZONE = 'Asia/Jakarta';
const TIMEZONE_LABEL = 'WIB';
const fmtWhen = (iso) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso)) + ` ${TIMEZONE_LABEL}`;

/**
 * Push publish-time changes requested in the web app up to YouTube.
 *
 * The web app cannot call YouTube itself (the OAuth refresh token is a worker
 * secret), so it parks the requested time in reschedule_to and this runs on the
 * next tick — immediately, in practice, because requesting one fires this
 * workflow via the Supabase trigger.
 *
 * Mutates `rows` in place so the sync and go-live passes below see the result.
 */
async function applyReschedules(yt, supabase, rows) {
  for (const v of rows) {
    if (!v.reschedule_to) continue;

    const target = new Date(v.reschedule_to);
    const from = v.publish_at;
    try {
      if (isNaN(target.getTime())) throw new Error(`reschedule_to is not a valid timestamp: ${v.reschedule_to}`);
      await updatePublishAt(yt, v.youtube_video_id, target.toISOString());
      const { error } = await supabase
        .from(VIDEOS_TABLE)
        .update({ publish_at: v.reschedule_to, reschedule_to: null, updated_at: now() })
        .eq('id', v.id);
      if (error) throw new Error(`YouTube accepted the new time but Supabase did not: ${error.message}`);

      v.publish_at = v.reschedule_to;
      v.reschedule_to = null;
      console.log(`Rescheduled "${v.title}": ${fmtWhen(from)} -> ${fmtWhen(v.publish_at)}`);
    } catch (e) {
      // Drop the request rather than retrying it every 15 minutes: the usual
      // causes (the time already passed, the video is already public) fail
      // identically on the next run. The sync below then puts the row back in
      // step with whatever YouTube really has, so the app stops showing a time
      // that was never accepted.
      await supabase
        .from(VIDEOS_TABLE)
        .update({ reschedule_to: null, updated_at: now() })
        .eq('id', v.id);
      v.reschedule_to = null;
      console.error(`Could not reschedule "${v.title}": ${e.message}`);
      await sendTelegram(`⚠️ Could not reschedule "${v.title}": ${e.message}`);
    }
  }
}

/**
 * Copy publish times down from YouTube, which is the source of truth: the time
 * can be changed in the YouTube Studio app at any point, and this app would
 * otherwise keep showing the original one — and, worse, miss the go-live for a
 * video moved earlier, because it would not look due yet.
 *
 * Mutates `rows` in place.
 */
async function syncPublishTimes(supabase, rows, statuses) {
  for (const v of rows) {
    const status = statuses.get(v.youtube_video_id);
    // No publishAt means the video is already public (YouTube clears it then)
    // or the schedule was removed in Studio. Neither is a new time to copy.
    if (!status || !status.publishAt) continue;

    const ytMs = new Date(status.publishAt).getTime();
    const dbMs = new Date(v.publish_at).getTime();
    if (!Number.isFinite(ytMs) || ytMs === dbMs) continue;

    const { error } = await supabase
      .from(VIDEOS_TABLE)
      .update({ publish_at: status.publishAt, updated_at: now() })
      .eq('id', v.id);
    if (error) {
      console.error(`Could not store YouTube's publish time for "${v.title}": ${error.message}`);
      continue;
    }
    console.log(`Publish time changed on YouTube for "${v.title}": ${fmtWhen(v.publish_at)} -> ${fmtWhen(status.publishAt)}`);
    v.publish_at = status.publishAt;
  }
}

async function main() {
  const supabase = getSupabase();

  // Every scheduled video, not only the ones this app believes are due. The
  // publish time may have been moved in YouTube Studio since the last run, and
  // a video pulled earlier would never appear in a "due" filter at all.
  const { data: rows, error } = await supabase
    .from(VIDEOS_TABLE)
    .select('*')
    .eq('status', 'scheduled')
    .not('youtube_video_id', 'is', null);
  if (error) throw error;

  if (!rows || rows.length === 0) {
    console.log('No scheduled videos to check.');
    return;
  }

  const yt = youtubeClient();

  // Order matters: push our own pending changes first, then read YouTube back
  // as the source of truth.
  await applyReschedules(yt, supabase, rows);
  const statuses = await listVideoStatuses(yt, rows.map((v) => v.youtube_video_id));
  await syncPublishTimes(supabase, rows, statuses);

  for (const v of rows) {
    const status = statuses.get(v.youtube_video_id);
    if (!status) {
      console.warn(`Not found on YouTube (deleted?): ${v.title}`);
      continue;
    }
    if (status.privacyStatus !== 'public') {
      console.log(`Not live yet (${status.privacyStatus}): ${v.title}`);
      continue;
    }
    try {
      await supabase
        .from(VIDEOS_TABLE)
        .update({ status: 'posted', updated_at: now() })
        .eq('id', v.id);

      // Liking and commenting are done by hand. The Data API cannot pin a
      // comment, so that trip to YouTube happens either way — the comment text
      // rides along here ready to copy.
      const comment = (v.first_comment || '').trim();
      await sendTelegram(
        comment
          ? `✅ Video is now live: ${v.title}\n💬 Comment:\n${comment}`
          : `✅ Video is now live: ${v.title}\n⚠️ No comment was saved for this one — write one by hand.`
      );
      console.log(`Posted: ${v.title}`);
    } catch (e) {
      console.error(`Check failed for ${v.id} (${v.title}): ${e.message}`);
    }
  }
}

main().catch((err) => {
  console.error('check-live.js failed:', err);
  process.exit(1);
});
