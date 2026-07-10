import { getSupabase } from './lib/supabaseClient.js';
import { youtubeClient } from './lib/googleAuth.js';
import { getPrivacyStatus } from './lib/youtube.js';
import { sendTelegram } from './lib/telegram.js';

const VIDEOS_TABLE = 'post_yt_vido_automation_videos';
const now = () => new Date().toISOString();

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
        await supabase.from(VIDEOS_TABLE).update({ status: 'posted', updated_at: now() }).eq('id', v.id);
        await sendTelegram(`✅ Video is now live: ${v.title}`);
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
