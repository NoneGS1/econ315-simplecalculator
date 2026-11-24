// Dates in the group's time zone (TIMEZONE in wrangler.toml, Asia/Tashkent by default).

import { InputError } from "../public/calc.js";

function offsetMs(tz, utcMs) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

// Local wall-clock time in `tz` -> UTC milliseconds.
export function zonedToUtc(tz, y, mo, d, h, mi) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const first = guess - offsetMs(tz, guess);
  return guess - offsetMs(tz, first);
}

function zonedParts(tz, ms) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric" })
      .formatToParts(new Date(ms)).map((x) => [x.type, x.value]),
  );
  return { y: +p.year, mo: +p.month, d: +p.day };
}

const DATE_RE = /^(?:(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?)$/;
const TIME_RE = /^(\d{1,2})[:.](\d{2})$/;

export const DEADLINE_USAGE =
  "Usage: /deadline date [time] title\n" +
  "Examples:\n" +
  "/deadline 05.12 23:59 Game Theory HW3\n" +
  "/deadline 2026-12-10 Midterm review session\n" +
  "Date: DD.MM, DD.MM.YYYY or YYYY-MM-DD. Time is optional (23:59 if left out).";

// "05.12 18:00 Game Theory HW3" -> { due, title }
export function parseDeadline(text, tz, now = Date.now()) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const dm = DATE_RE.exec(words[0] ?? "");
  if (!dm) throw new InputError(DEADLINE_USAGE);
  let y, mo, d;
  if (dm[1]) [y, mo, d] = [+dm[1], +dm[2], +dm[3]];
  else {
    [d, mo] = [+dm[4], +dm[5]];
    y = dm[6] ? +(dm[6].length === 2 ? "20" + dm[6] : dm[6]) : zonedParts(tz, now).y;
  }
  let h = 23, mi = 59, rest = words.slice(1);
  const tm = TIME_RE.exec(rest[0] ?? "");
  if (tm) {
    [h, mi] = [+tm[1], +tm[2]];
    rest = rest.slice(1);
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) throw new InputError("That date or time doesn't exist.");
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCDate() !== d) throw new InputError("That date doesn't exist.");
  let due = zonedToUtc(tz, y, mo, d, h, mi);
  // "05.12" without a year means the next 5 December.
  if (!dm[1] && !dm[6] && due <= now) due = zonedToUtc(tz, y + 1, mo, d, h, mi);
  const title = rest.join(" ").trim();
  if (!title) throw new InputError("Add a title after the date, e.g. /deadline 05.12 Game Theory HW3");
  if (title.length > 200) throw new InputError("Please keep the title under 200 characters.");
  if (due <= now) throw new InputError("That time is already in the past.");
  return { due, title };
}

export const formatDate = (tz, ms) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(ms));

export function timeLeft(ms, now = Date.now()) {
  const min = Math.max(0, Math.round((ms - now) / 60000));
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  if (d) return `${d}d ${h}h left`;
  if (h) return `${h}h ${m}m left`;
  return `${m}m left`;
}
