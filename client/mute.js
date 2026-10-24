// When "X is sharing" notifications are muted: by hand (for a while or until turned back on) or
// by a weekly schedule of quiet hours. Pure functions, so main.js and the tests share them.

/** Minutes since midnight for "HH:MM". */
function minutes(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Whether `date` falls in the quiet hours. `days` are 0 (Sunday) … 6 (Saturday). A range that
 * crosses midnight (22:00–07:00) belongs to the day it starts on, so Friday 22:00–07:00 covers
 * Saturday until 07:00. Equal start and end means the whole day.
 * @param {{ enabled: boolean, days: number[], start: string, end: string }} quiet
 */
export function inQuietHours(quiet, date) {
  if (!quiet?.enabled || !quiet.days?.length) return false;
  const start = minutes(quiet.start);
  const end = minutes(quiet.end);
  const now = date.getHours() * 60 + date.getMinutes();
  const day = date.getDay();
  const yesterday = (day + 6) % 7;
  if (start === end) return quiet.days.includes(day);
  if (start < end) return quiet.days.includes(day) && now >= start && now < end;
  return (quiet.days.includes(day) && now >= start) || (quiet.days.includes(yesterday) && now < end);
}

/** When the current quiet-hours window ends, as a Date (null when not in quiet hours). */
export function quietHoursEnd(quiet, date) {
  if (!inQuietHours(quiet, date)) return null;
  const end = new Date(date);
  end.setSeconds(0, 0);
  end.setHours(0, minutes(quiet.end));
  if (end <= date) end.setDate(end.getDate() + 1);
  return end;
}

/**
 * @param {null | "forever" | number} mutedUntil manual mute: a timestamp, "forever" or null
 * @returns {{ muted: boolean, manual: null | "forever" | number, quietUntil: number | null }}
 */
export function muteState(mutedUntil, quiet, now = new Date()) {
  const manual = mutedUntil === "forever" || (typeof mutedUntil === "number" && mutedUntil > now.getTime()) ? mutedUntil : null;
  const quietEnd = quietHoursEnd(quiet, now);
  return { muted: Boolean(manual || quietEnd), manual, quietUntil: quietEnd ? quietEnd.getTime() : null };
}
