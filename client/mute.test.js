import { describe, expect, test } from "bun:test";
import { inQuietHours, muteState, quietHoursEnd } from "./mute.js";

// 2026-10-19 is a Monday.
const at = (day, hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(2026, 9, 19 + day - 1, h, m);
};
const weekdays = { enabled: true, days: [1, 2, 3, 4, 5], start: "08:00", end: "18:00" };

describe("quiet hours", () => {
  test("Mon–Fri 08–18", () => {
    expect(inQuietHours(weekdays, at(1, "07:59"))).toBe(false);
    expect(inQuietHours(weekdays, at(1, "08:00"))).toBe(true);
    expect(inQuietHours(weekdays, at(5, "17:59"))).toBe(true);
    expect(inQuietHours(weekdays, at(5, "18:00"))).toBe(false);
    expect(inQuietHours(weekdays, at(6, "12:00"))).toBe(false); // Saturday
  });

  test("a night range belongs to the day it starts on", () => {
    const nights = { enabled: true, days: [5], start: "22:00", end: "07:00" }; // Friday night
    expect(inQuietHours(nights, at(5, "23:00"))).toBe(true);
    expect(inQuietHours(nights, at(6, "06:59"))).toBe(true); // Saturday morning
    expect(inQuietHours(nights, at(6, "07:00"))).toBe(false);
    expect(inQuietHours(nights, at(5, "06:00"))).toBe(false); // Friday morning belongs to Thursday
    expect(quietHoursEnd(nights, at(5, "23:00"))).toEqual(at(6, "07:00"));
  });

  test("disabled or without days never mutes", () => {
    expect(inQuietHours({ ...weekdays, enabled: false }, at(1, "10:00"))).toBe(false);
    expect(inQuietHours({ ...weekdays, days: [] }, at(1, "10:00"))).toBe(false);
  });

  test("equal start and end mutes the whole day", () => {
    expect(inQuietHours({ enabled: true, days: [0], start: "00:00", end: "00:00" }, at(7, "15:00"))).toBe(true);
  });
});

describe("muteState", () => {
  const now = at(6, "12:00");
  test("manual mute for a while, until it expires", () => {
    expect(muteState(now.getTime() + 60_000, null, now)).toMatchObject({ muted: true, manual: now.getTime() + 60_000 });
    expect(muteState(now.getTime() - 1, null, now).muted).toBe(false);
  });

  test("manual mute until turned back on", () => {
    expect(muteState("forever", null, now)).toMatchObject({ muted: true, manual: "forever" });
  });

  test("quiet hours report when they end", () => {
    expect(muteState(null, weekdays, at(1, "10:00"))).toMatchObject({ muted: true, manual: null, quietUntil: at(1, "18:00").getTime() });
  });
});
