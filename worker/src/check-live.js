import { getSupabase } from './lib/supabaseClient.js';
import { youtubeClient } from './lib/googleAuth.js';
import { getPrivacyStatus, likeVideo, postComment } from './lib/youtube.js';
import { sendTelegram } from './lib/telegram.js';

const VIDEOS_TABLE = 'post_yt_vido_automation_videos';
const now = () => new Date().toISOString();

/**
 * Like the video and post the comment Claude wrote back at upload time.
 *
 * Deliberately never throws. Going live is the real event here; if the like or
 * the comment fails, the row must still be marked 'posted' and the "video is
 * live" Telegram message must still go out. Problems are reported in that same
 * message instead, so they can be handled by hand.
 *
 * The liked_at / comment_posted_at guards make a retry safe: if the row update
 * below ever fails after the comment lands, the next run will not comment twice.
 *
 * @returns {Promise<{patch:Object, notes:string[]}>} columns to persist + warnings
 */
async function runEngagement(yt, v) {
  const patch = {};
  const notes = [];

  if (!v.liked_at) {
    try {
      await likeVideo(yt, v.youtube_video_id);
      patch.liked_at = now();
      console.log(`Liked: ${v.title}`);
    } catch (e) {
      notes.push(`could not like the video (${e.message})`);
    }
  }

  if (!v.comment_posted_at) {
    const text = (v.first_comment || '').trim();
    if (!text) {
      notes.push('no first comment was saved at upload time — post one by hand');
    } else {
      try {
        await postComment(yt, v.youtube_video_id, text);
        patch.comment_posted_at = now();
        console.log(`Commented on: ${v.title}`);
      } catch (e) {
        notes.push(`could not post the first comment (${e.message})`);
      }
    }
  }

  return { patch, notes };
}

async function main() {
  const supabase = getSupabase();

  // Scheduled videos whose target time has passed.
  const { data: rows, error } = await supabase
    .from(VIDEOS_TABLE)
    .select('*')
    .eq('status', 'scheduled')
    .lte('publish_at', now());
  if (error) throw error;

  if (!rows || rows.length === 0) {
    console.log('No scheduled videos are due.');
    return;
  }

  const yt = youtubeClient();
  for (const v of rows) {
    if (!v.youtube_video_id) continue;
    try {
      const status = await getPrivacyStatus(yt, v.youtube_video_id);
      if (status === 'public') {
        const { patch, notes } = await runEngagement(yt, v);
        await supabase
          .from(VIDEOS_TABLE)
          .update({ status: 'posted', ...patch, updated_at: now() })
          .eq('id', v.id);
        const warning = notes.length ? `\n⚠️ ${notes.join('; ')}` : '';
        await sendTelegram(`✅ Video is now live: ${v.title}${warning}`);
        console.log(`Posted: ${v.title}`);
      } else {
        console.log(`Not live yet (${status}): ${v.title}`);
      }
    } catch (e) {
      console.error(`Check failed for ${v.id} (${v.title}): ${e.message}`);
    }
  }
}

main().catch((err) => {
  console.error('check-live.js failed:', err);
  process.exit(1);
});
