import { getSupabase } from './lib/supabaseClient.js';
import { youtubeClient } from './lib/googleAuth.js';
import { listVideoStatuses } from './lib/youtube.js';
import { sendTelegram } from './lib/telegram.js';

const VIDEOS_TABLE = 'post_yt_vido_automation_videos';
// Set only when the run came from the "Refresh from YouTube" button. The
// scheduled runs just watch for videos going public; copying publish times down
// and clearing out deleted videos happens when asked for, not on a timer.
const REFRESH_FROM_YOUTUBE = process.env.REFRESH_FROM_YOUTUBE === '1';
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
 * Drop rows whose video is no longer on YouTube — deleted in Studio, or an
 * upload cancelled before it ever went public. videos.list simply omits ids it
 * cannot return, so an id missing from the batch is the signal.
 *
 * Guarded against the one dangerous case: if EVERY video comes back missing and
 * there was more than one, that is far more likely a credentials or API problem
 * than the whole schedule being deleted at once, so nothing is removed.
 *
 * @returns {Promise<Array>} the rows whose video still exists
 */
async function dropDeletedVideos(supabase, rows, statuses) {
  const missing = rows.filter((v) => !statuses.has(v.youtube_video_id));
  if (missing.length === 0) return rows;

  if (missing.length === rows.length && rows.length > 1) {
    console.error(
      `All ${rows.length} scheduled videos came back missing from YouTube. Treating that as an API ` +
        'or credentials problem rather than as deletions, so nothing was removed.'
    );
    return rows;
  }

  for (const v of missing) {
    const { error } = await supabase.from(VIDEOS_TABLE).delete().eq('id', v.id);
    if (error) {
      console.error(`Could not remove "${v.title}" from the list: ${error.message}`);
      continue;
    }
    console.log(`No longer on YouTube, removed from the list: ${v.title}`);
    await sendTelegram(`🗑️ Removed from the list — no longer on YouTube: ${v.title}`);
  }

  return rows.filter((v) => statuses.has(v.youtube_video_id));
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

  const statuses = await listVideoStatuses(yt, rows.map((v) => v.youtube_video_id));
  let live = rows;
  if (REFRESH_FROM_YOUTUBE) {
    live = await dropDeletedVideos(supabase, rows, statuses);
    await syncPublishTimes(supabase, live, statuses);
  }

  for (const v of live) {
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

      // Two messages on purpose: the comment arrives on its own so it can be
      // copied whole with one long-press, with no header text to trim off.
      const comment = (v.first_comment || '').trim();
      await sendTelegram(
        comment
          ? `✅ Video is now live: ${v.title}\n💬 Comment below ↓`
          : `✅ Video is now live: ${v.title}\n⚠️ No comment was saved for this one — write one by hand.`
      );
      if (comment) await sendTelegram(comment);
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
