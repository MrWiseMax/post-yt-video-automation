import { getSupabase } from './lib/supabaseClient.js';
import { youtubeClient } from './lib/googleAuth.js';
import { listVideoStatuses } from './lib/youtube.js';
import { sendTelegram } from './lib/telegram.js';

const VIDEOS_TABLE = 'post_yt_vido_automation_videos';
const now = () => new Date().toISOString();

// One videos.list call covers 50 ids, and the app only ever shows the most
// recent handful, so there is no reason to walk the whole table.
const CHECK_LIMIT = 50;

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
 * Reconcile rows whose video is no longer on YouTube. videos.list simply omits
 * ids it cannot return, so an id missing from the batch is the signal.
 *
 * A scheduled video that is gone was cancelled before it ever published, so its
 * row is removed outright. A posted one is a video that existed and was taken
 * down later, so the row is kept and flagged instead — the app shows it as
 * "deleted" rather than quietly dropping a video that really did go out.
 *
 * Guarded against the one dangerous case: if EVERY video comes back missing and
 * there was more than one, that is far more likely a credentials or API problem
 * than everything being deleted at once, so nothing is touched.
 *
 * @returns {Promise<Array>} the rows whose video still exists
 */
async function reconcileMissing(supabase, rows, statuses) {
  const missing = rows.filter((v) => !statuses.has(v.youtube_video_id));
  if (missing.length === 0) return rows;

  if (missing.length === rows.length && rows.length > 1) {
    console.error(
      `All ${rows.length} videos came back missing from YouTube. Treating that as an API or ` +
        'credentials problem rather than as deletions, so nothing was changed.'
    );
    return rows;
  }

  for (const v of missing) {
    if (v.status === 'scheduled') {
      const { error } = await supabase.from(VIDEOS_TABLE).delete().eq('id', v.id);
      if (error) {
        console.error(`Could not remove "${v.title}" from the list: ${error.message}`);
        continue;
      }
      console.log(`Never published and now gone from YouTube, row removed: ${v.title}`);
      await sendTelegram(`🗑️ Removed from the list — no longer on YouTube: ${v.title}`);
      continue;
    }

    // Posted. Flag it once; leave it flagged.
    if (v.youtube_deleted_at) continue;
    const { error } = await supabase
      .from(VIDEOS_TABLE)
      .update({ youtube_deleted_at: now(), updated_at: now() })
      .eq('id', v.id);
    if (error) {
      console.error(`Could not flag "${v.title}" as deleted: ${error.message}`);
      continue;
    }
    console.log(`Was live and has been deleted on YouTube, row flagged: ${v.title}`);
    await sendTelegram(`🗑️ Deleted on YouTube: ${v.title}`);
  }

  return rows.filter((v) => statuses.has(v.youtube_video_id));
}

/**
 * Copy publish times down from YouTube, which is the source of truth: the time
 * is changed in YouTube Studio, and this app would otherwise keep showing the
 * one it was given when the video was first scheduled.
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

  // Scheduled videos are watched for going public; posted ones are only checked
  // for having been taken down since.
  const { data: rows, error } = await supabase
    .from(VIDEOS_TABLE)
    .select('*')
    .in('status', ['scheduled', 'posted'])
    .not('youtube_video_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(CHECK_LIMIT);
  if (error) throw error;

  if (!rows || rows.length === 0) {
    console.log('Nothing to check.');
    return;
  }

  const yt = youtubeClient();
  const statuses = await listVideoStatuses(yt, rows.map((v) => v.youtube_video_id));

  const live = await reconcileMissing(supabase, rows, statuses);
  await syncPublishTimes(supabase, live, statuses);

  for (const v of live) {
    if (v.status !== 'scheduled') continue;
    const status = statuses.get(v.youtube_video_id);
    if (!status) continue;
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
