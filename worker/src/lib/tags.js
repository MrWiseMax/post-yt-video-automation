/**
 * Merge channel tags (priority) + Claude's video tags, dedup case-insensitively,
 * and trim to a conservative <=500 character YouTube budget.
 *
 * Budget model (conservative): each tag costs its length, +2 if it contains a
 * space (YouTube quotes multi-word tags), +1 separator once past the first tag.
 */
export function buildTags(channelTags, videoTags, limit = 500) {
  const seen = new Set();
  const out = [];
  let len = 0;

  const add = (raw) => {
    if (raw == null) return;
    const t = String(raw).trim().replace(/,/g, ' ').replace(/\s+/g, ' ');
    if (!t) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    const cost = t.length + (t.includes(' ') ? 2 : 0) + (out.length ? 1 : 0);
    if (len + cost > limit) return;
    seen.add(key);
    out.push(t);
    len += cost;
  };

  (channelTags || []).forEach(add);
  (videoTags || []).forEach(add);
  return out;
}
