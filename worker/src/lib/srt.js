/** Parse SRT text into cues: [{ start, end, text }] with times in seconds. */
export function parseSrt(text) {
  const clean = String(text).replace(/\r/g, '');
  const blocks = clean.split(/\n{2,}/);
  const cues = [];
  const timeRe =
    /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/;

  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    if (lines.length < 2) continue;

    let idx = 0;
    if (/^\d+$/.test(lines[0].trim())) idx = 1; // optional sequence number
    const m = lines[idx] ? lines[idx].match(timeRe) : null;
    if (!m) continue;

    const start = +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
    const end = +m[5] * 3600 + +m[6] * 60 + +m[7] + +m[8] / 1000;
    const body = lines
      .slice(idx + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '') // strip formatting tags
      .replace(/\s+/g, ' ')
      .trim();
    if (body) cues.push({ start, end, text: body });
  }
  return cues;
}

/** Seconds -> "M:SS" or "H:MM:SS" (YouTube chapter format). */
export function fmtTimestamp(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** One line per cue: "[m:ss] text" — fed to Claude for chapter alignment. */
export function buildTimedTranscript(cues) {
  return cues.map((c) => `[${fmtTimestamp(c.start)}] ${c.text}`).join('\n');
}
