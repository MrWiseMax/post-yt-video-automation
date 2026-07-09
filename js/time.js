import { TIMEZONE } from './config.js';

// Offset (ms) between the wall-clock reading of `date` in `tz` and true UTC.
function getOffsetMs(tz, date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(date).reduce((a, p) => {
    a[p.type] = p.value;
    return a;
  }, {});
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUTC - date.getTime();
}

// Convert a wall-clock time in TIMEZONE to a true UTC Date. Handles DST,
// including the two annual transition edges, via a one-step refinement.
function wallTimeToUtc(y, mo, d, h, mi) {
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi, 0));
  const off1 = getOffsetMs(TIMEZONE, guess);
  let utc = new Date(guess.getTime() - off1);
  const off2 = getOffsetMs(TIMEZONE, utc);
  if (off2 !== off1) utc = new Date(guess.getTime() - off2);
  return utc;
}

// "2026-07-10T18:00" (from <input type="datetime-local">) interpreted as ET -> UTC Date.
export function etInputToUtc(value) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  return wallTimeToUtc(+m[1], +m[2], +m[3], +m[4], +m[5]);
}

export function formatEt(date) {
  return (
    new Intl.DateTimeFormat('en-US', {
      timeZone: TIMEZONE,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date) + ' ET'
  );
}

// Returns an error string, or null if valid.
export function validatePublish(utcDate) {
  if (!utcDate || isNaN(utcDate.getTime())) return 'Please pick a valid date and time.';
  const nowMs = Date.now();
  if (utcDate.getTime() <= nowMs) return 'That time is in the past.';
  if (utcDate.getTime() < nowMs + 3 * 3600 * 1000) {
    return 'Target time must be at least 3 hours from now (YouTube needs processing time).';
  }
  return null;
}
