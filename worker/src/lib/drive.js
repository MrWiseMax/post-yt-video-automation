import fs from 'node:fs';

/**
 * Find the .mp4 / .png / .srt in a folder. Throws with a clear message if any is missing.
 * Returns { mp4, png, srt } file resources ({ id, name, ... }).
 */
export async function findFiles(drive, folderId) {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType, size)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    pageSize: 200,
  });
  const files = res.data.files || [];
  const mp4 = files.find((f) => /\.mp4$/i.test(f.name) || f.mimeType === 'video/mp4');
  const png = files.find((f) => /\.png$/i.test(f.name) || f.mimeType === 'image/png');
  const srt = files.find((f) => /\.srt$/i.test(f.name));

  if (!mp4) throw new Error('No .mp4 file found in the Drive folder.');
  if (!png) throw new Error('No .png thumbnail found in the Drive folder.');
  if (!srt) throw new Error('No .srt captions file found in the Drive folder.');
  return { mp4, png, srt };
}

/** Stream a Drive file to a local path. */
export async function downloadFile(drive, fileId, destPath) {
  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'stream' }
  );
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(destPath);
    res.data
      .on('error', reject)
      .pipe(out)
      .on('error', reject)
      .on('finish', resolve);
  });
}

export async function deleteFile(drive, fileId) {
  await drive.files.delete({ fileId, supportsAllDrives: true });
}
