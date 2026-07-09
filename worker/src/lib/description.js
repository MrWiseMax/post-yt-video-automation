import { fmtTimestamp } from './srt.js';

/**
 * Normalize Claude's chapters against the real transcript:
 *  - drop invalid / out-of-range entries
 *  - sort, force the first chapter to 0:00
 *  - enforce YouTube's >=10s spacing between consecutive chapters
 */
export function buildChapters(aiChapters, cues) {
  const maxTime = cues.length ? cues[cues.length - 1].end : 0;
  let ch = (aiChapters || [])
    .filter((c) => c && typeof c.time_seconds === 'number' && c.title)
    .map((c) => ({ time: Math.max(0, Math.round(c.time_seconds)), title: String(c.title).trim() }))
    .filter((c) => c.title && c.time <= maxTime + 1)
    .sort((a, b) => a.time - b.time);

  if (ch.length === 0) return [];
  ch[0] = { ...ch[0], time: 0 };

  const out = [];
  for (const c of ch) {
    if (out.length === 0 || c.time - out[out.length - 1].time >= 10) out.push(c);
  }
  return out;
}

/** YouTube renders chapters only with >=3 timestamps and a leading 0:00. */
export function chaptersToText(chapters) {
  if (!chapters || chapters.length < 3) return '';
  return 'Chapters:\n' + chapters.map((c) => `${fmtTimestamp(c.time)} ${c.title}`).join('\n');
}

/**
 * Final description = Claude's description + chapters + footer, capped at `limit`
 * (YouTube = 5000). Chapters and footer are preserved; the AI description is
 * trimmed first if the total would overflow.
 */
export function assembleDescription(aiDescription, chapters, footer, limit = 5000) {
  const chaptersBlock = chaptersToText(chapters);
  const desc = (aiDescription || '').trim();
  const foot = (footer || '').trim();

  const tail = [chaptersBlock, foot].filter(Boolean).join('\n\n');
  const reserve = tail ? tail.length + 2 : 0;

  let d = desc;
  const available = limit - reserve;
  if (available <= 0) return tail.slice(0, limit);
  if (d.length > available) d = d.slice(0, available - 1).trim();

  return [d, chaptersBlock, foot].filter(Boolean).join('\n\n').slice(0, limit);
}
