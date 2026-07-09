import fs from 'node:fs';

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

export async function setThumbnail(yt, videoId, pngPath) {
  await yt.thumbnails.set({
    videoId,
    media: { mimeType: 'image/png', body: fs.createReadStream(pngPath) },
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
