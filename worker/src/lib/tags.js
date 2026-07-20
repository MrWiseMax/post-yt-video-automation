/**
 * Merge channel tags + Claude's video-specific tags into a <=500 character
 * YouTube tag budget.
 *
 * The channel tag list is usually long enough to eat the whole budget on its
 * own, which would leave no room for the tags Claude derived from THIS video's
 * transcript — every upload would end up with an identical tag set. So channel
 * tags only get `channelReserve` characters up front; the video-specific tags
 * are added next, and any leftover budget goes back to the remaining channel
 * tags.
 *
 * Budget model (conservative): each tag costs its length, +2 if it contains a
 * space (YouTube quotes multi-word tags), +1 separator once past the first tag.
 */
export function buildTags(channelTags, videoTags, limit = 500, channelReserve = 180) {
  const seen = new Set();
  const out = [];
  let len = 0;

  /** Add a tag if it is new and fits within `cap`. Returns true if added. */
  const add = (raw, cap) => {
    if (raw == null) return false;
    const t = String(raw).trim().replace(/,/g, ' ').replace(/\s+/g, ' ');
    if (!t) return false;
    const key = t.toLowerCase();
    if (seen.has(key)) return false;
    const cost = t.length + (t.includes(' ') ? 2 : 0) + (out.length ? 1 : 0);
    if (len + cost > cap) return false;
    seen.add(key);
    out.push(t);
    len += cost;
    return true;
  };

  const channel = (channelTags || []).filter(Boolean);
  const video = (videoTags || []).filter(Boolean);

  // 1. Brand/channel tags, capped so they can never crowd out the video tags.
  const reserve = Math.min(channelReserve, limit);
  const leftovers = channel.filter((t) => !add(t, reserve));

  // 2. Video-specific tags (from this video's transcript) get the rest.
  video.forEach((t) => add(t, limit));

  // 3. Any budget still unused goes back to the remaining channel tags.
  leftovers.forEach((t) => add(t, limit));

  return out;
}
