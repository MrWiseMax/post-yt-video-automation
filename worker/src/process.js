import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getSupabase } from './lib/supabaseClient.js';
import { driveClient, youtubeClient } from './lib/googleAuth.js';
import * as drive from './lib/drive.js';
import { generateContent } from './lib/claude.js';
import { sendTelegram } from './lib/telegram.js';
import { buildTags } from './lib/tags.js';
import { parseSrt, buildTimedTranscript } from './lib/srt.js';
import { buildChapters, assembleDescription } from './lib/description.js';
import { uploadVideo, setThumbnail, uploadCaptions } from './lib/youtube.js';

const VIDEO_ID = process.env.VIDEO_ID;
const CAPTION_LANGUAGE = 'en';
const YOUTUBE_CATEGORY_ID = '27'; // Education
const VIDEO_TYPE = 'How-To';
const VIDEO_TYPE_TAGS = ['education', 'how to', 'tutorial'];
const SETTINGS_TABLE = 'post_yt_vido_automation_settings';
const VIDEOS_TABLE = 'post_yt_vido_automation_videos';
const now = () => new Date().toISOString();

function splitTags(s) {
  if (!s) return [];
  return String(s)
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

async function main() {
  if (!VIDEO_ID) throw new Error('VIDEO_ID not provided');
  const supabase = getSupabase();

  // 1. Load the job.
  const { data: video, error: vErr } = await supabase
    .from(VIDEOS_TABLE)
    .select('*')
    .eq('id', VIDEO_ID)
    .single();
  if (vErr) throw new Error(`Failed to load video row ${VIDEO_ID}: ${vErr.message} (code ${vErr.code || 'n/a'})`);
  if (!video) throw new Error('Video row not found: ' + VIDEO_ID);
  // 'queued' is the normal path; 'failed' allows an explicit retry dispatch.
  if (video.status !== 'queued' && video.status !== 'failed') {
    console.log(`Video ${VIDEO_ID} is '${video.status}', not 'queued'/'failed' — skipping.`);
    return;
  }
  await supabase.from(VIDEOS_TABLE).update({ status: 'processing', updated_at: now() }).eq('id', VIDEO_ID);

  // 2. Settings + Drive folder.
  const { data: settings } = await supabase.from(SETTINGS_TABLE).select('*').eq('id', 1).single();
  const folderId = settings?.drive_folder_id;
  if (!folderId) throw new Error('drive_folder_id is not set in Settings.');

  const d = driveClient();
  const files = await drive.findFiles(d, folderId);
  const title = files.mp4.name.replace(/\.mp4$/i, '').trim();
  await supabase.from(VIDEOS_TABLE).update({ title, updated_at: now() }).eq('id', VIDEO_ID);

  // 3. Re-validate the publish time server-side (>= ~3h out, not in the past).
  const publishAt = new Date(video.publish_at);
  const minTime = Date.now() + 3 * 3600 * 1000 - 90 * 1000; // ~3h with a small slack
  if (isNaN(publishAt.getTime())) throw new Error('publish_at is not a valid timestamp.');
  if (publishAt.getTime() < minTime) {
    throw new Error('Target time must be at least ~3 hours in the future (YouTube needs processing time).');
  }

  // 4. Download the files (skip the big .mp4 when resuming a partial upload).
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-'));
  const mp4Path = path.join(tmp, 'video.mp4');
  const pngPath = path.join(tmp, 'thumb.png');
  const srtPath = path.join(tmp, 'captions.srt');
  await drive.downloadFile(d, files.png.id, pngPath);
  await drive.downloadFile(d, files.srt.id, srtPath);

  const yt = youtubeClient();
  let youtubeVideoId = video.youtube_video_id || null;

  if (!youtubeVideoId) {
    await drive.downloadFile(d, files.mp4.id, mp4Path);

    // 5. Transcript -> Claude -> metadata.
    const cues = parseSrt(fs.readFileSync(srtPath, 'utf8'));
    if (cues.length === 0) throw new Error('Could not parse any cues from the .srt file.');
    const timedTranscript = buildTimedTranscript(cues);

    const channelTags = splitTags(settings.channel_tags);
    const sampleTagsets = Array.isArray(settings.sample_tagsets) ? settings.sample_tagsets : [];

    const ai = await generateContent({ title, timedTranscript, sampleTagsets, videoType: VIDEO_TYPE });

    const chapters = buildChapters(ai.chapters, cues);
    const finalTags = buildTags([...channelTags, ...VIDEO_TYPE_TAGS], ai.tags, 500);
    const description = assembleDescription(ai.description, chapters, settings.description_footer);

    // 6. Upload + schedule on YouTube. Record the id IMMEDIATELY so a later
    // failure (thumbnail, captions) can never orphan the uploaded video —
    // a retry resumes from here instead of uploading a duplicate.
    youtubeVideoId = await uploadVideo(yt, {
      title,
      description,
      tags: finalTags,
      categoryId: YOUTUBE_CATEGORY_ID,
      language: CAPTION_LANGUAGE,
      publishAt: publishAt.toISOString(),
      videoPath: mp4Path,
    });
    await supabase
      .from(VIDEOS_TABLE)
      .update({ youtube_video_id: youtubeVideoId, updated_at: now() })
      .eq('id', VIDEO_ID);
  } else {
    console.log(`Video already uploaded as ${youtubeVideoId} — resuming with thumbnail + captions.`);
  }

  await setThumbnail(yt, youtubeVideoId, pngPath);
  await uploadCaptions(yt, youtubeVideoId, srtPath, CAPTION_LANGUAGE);

  // 7. Record success.
  await supabase
    .from(VIDEOS_TABLE)
    .update({ status: 'scheduled', youtube_video_id: youtubeVideoId, error: null, updated_at: now() })
    .eq('id', VIDEO_ID);

  // Uploaded + scheduled notification.
  await sendTelegram(
    `✅⏰ Video uploaded successfully and scheduled to post: ${title}`
  );

  // 8. Delete Drive files ONLY after confirmed success. Failure here doesn't fail the job.
  for (const f of [files.mp4, files.png, files.srt]) {
    try {
      await drive.deleteFile(d, f.id);
    } catch (e) {
      console.error(`Warning: failed to delete Drive file ${f.name}: ${e.message}`);
    }
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`Done. youtube_video_id=${youtubeVideoId}, publishAt=${publishAt.toISOString()}`);
}

main().catch(async (err) => {
  console.error('process.js failed:', err);
  // Mark the row failed and notify independently, so one failing step
  // can never leave the video silently stuck in 'queued'.
  let title = '';
  try {
    if (VIDEO_ID) {
      const supabase = getSupabase();
      const { data } = await supabase.from(VIDEOS_TABLE).select('title').eq('id', VIDEO_ID).single();
      title = data?.title || '';
      await supabase
        .from(VIDEOS_TABLE)
        .update({ status: 'failed', error: String(err.message || err), updated_at: now() })
        .eq('id', VIDEO_ID);
    }
  } catch (inner) {
    console.error('Failure handler: could not update Supabase row:', inner);
  }
  try {
    await sendTelegram(`❌ Upload failed${title ? ` for "${title}"` : ''}: ${String(err.message || err)}`);
  } catch (inner) {
    console.error('Failure handler: could not send Telegram message:', inner);
  }
  process.exit(1);
});
