import fs from 'node:fs';
import sharp from 'sharp';

const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024; // YouTube rejects custom thumbnails over 2 MB

/**
 * Upload the video as PRIVATE with publishAt set to the target time. YouTube
 * auto-publishes (makes it public) at publishAt. Returns the new video id.
 */
export async function uploadVideo(yt, { title, description, tags, categoryId, language, publishAt, videoPath }) {
  const res = await yt.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title,
        description,
        tags,
        categoryId: categoryId || '27',
        defaultLanguage: language || 'en',
        defaultAudioLanguage: language || 'en',
      },
      status: {
        privacyStatus: 'private', // required when publishAt is set
        publishAt, // RFC3339 UTC, e.g. 2026-07-10T18:00:00.000Z
        selfDeclaredMadeForKids: false,
      },
    },
    media: { mimeType: 'video/*', body: fs.createReadStream(videoPath) },
  });
  if (!res.data.id) throw new Error('YouTube upload returned no video id');
  return res.data.id;
}

/**
 * Re-encode the thumbnail as a 1280x720 JPEG when the source PNG exceeds
 * YouTube's 2 MB limit (a 1080p+ PNG easily does).
 * Returns { path, mimeType } of the file to upload.
 */
async function prepareThumbnail(pngPath) {
  if (fs.statSync(pngPath).size <= THUMBNAIL_MAX_BYTES) {
    return { path: pngPath, mimeType: 'image/png' };
  }
  const jpgPath = pngPath.replace(/\.png$/i, '') + '.thumb.jpg';
  for (const quality of [90, 80, 70]) {
    await sharp(pngPath).resize(1280, 720, { fit: 'cover' }).jpeg({ quality }).toFile(jpgPath);
    if (fs.statSync(jpgPath).size <= THUMBNAIL_MAX_BYTES) break;
  }
  console.log(`Thumbnail over 2 MB; re-encoded to ${jpgPath} (${fs.statSync(jpgPath).size} bytes).`);
  return { path: jpgPath, mimeType: 'image/jpeg' };
}

export async function setThumbnail(yt, videoId, pngPath) {
  const thumb = await prepareThumbnail(pngPath);
  await yt.thumbnails.set({
    videoId,
    media: { mimeType: thumb.mimeType, body: fs.createReadStream(thumb.path) },
  });
}

export async function uploadCaptions(yt, videoId, srtPath, language) {
  await yt.captions.insert({
    part: ['snippet'],
    requestBody: {
      snippet: { videoId, language: language || 'en', name: '', isDraft: false },
    },
    media: { mimeType: 'application/octet-stream', body: fs.createReadStream(srtPath) },
  });
}

/** 'public' | 'private' | 'unlisted' | null (video missing). */
export async function getPrivacyStatus(yt, videoId) {
  const res = await yt.videos.list({ part: ['status'], id: [videoId] });
  return res.data.items?.[0]?.status?.privacyStatus || null;
}
