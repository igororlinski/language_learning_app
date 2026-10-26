/**
 * Everything the phone sends, checked before it touches the database. A request
 * with one bad value is refused whole: half-accepted stats are worse than none,
 * because nobody would know which half.
 */

export const MAX_NAME_LENGTH = 30;

/** How far back an upload may reach — two weeks covers the current one and the last. */
export const UPLOAD_DAYS = 14;

/** How long the server keeps a day: the monthly ranking needs a month, this is slack. */
export const KEEP_DAYS = 35;

const MAX_GOAL = 1000;
const MAX_ANSWERS = 100_000;
const DAY_MS = 86_400_000;
const MAX_BADGES = 100;
const MAX_POINTS = 1_000_000_000;
const MAX_STUDY_MS = 1_000_000_000_000;

const isInt = (value: unknown, min: number, max: number): value is number =>
  Number.isInteger(value) && (value as number) >= min && (value as number) <= max;

/** A name for friends to see: trimmed, single-spaced, no control characters. */
export function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const name = value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();

  return name.length >= 1 && [...name].length <= MAX_NAME_LENGTH ? name : null;
}

/* ------------------------------------------------------------------- days */

/**
 * A study day as the phone keys it, `YYYY-MM-DD`. The phone's own local date —
 * the server never turns it into a moment, only counts days between keys.
 */
export function isDayKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** The key `offset` days away. Calendar arithmetic in UTC, where no day is 23 hours. */
export function shiftDay(key: string, offset: number): string {
  const [year, month, day] = key.split('-').map(Number);

  return new Date(Date.UTC(year, month - 1, day) + offset * DAY_MS).toISOString().slice(0, 10);
}

/** The Monday of the week a day is in: weeks start on Monday, as in Poland. */
export function weekStart(key: string): string {
  const [year, month, day] = key.split('-').map(Number);

  return shiftDay(key, -((new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7));
}

/** The first day of the month a day is in. */
export const monthStart = (key: string): string => `${key.slice(0, 8)}01`;

/** Today's UTC date, for the daily limits — not anyone's study day. */
export const utcDay = (now: number): string => new Date(now).toISOString().slice(0, 10);

/* ------------------------------------------------------------------ stats */

export type DayStats = { day: string; answers: number; goal: number; studyMs: number };

export type Stats = {
  today: string;
  goal: number;
  streak: number;
  badges: string[];
  days: DayStats[];
  /** All-time totals; null from a phone that does not send them yet. */
  points: number | null;
  studyMs: number | null;
};

/**
 * `PUT /v1/me/stats`: the phone's day, goal, streak and badges, and its last
 * `UPLOAD_DAYS` study days. Days must lie in that window and appear once each.
 */
export function parseStats(body: unknown): Stats | null {
  if (typeof body !== 'object' || body === null) return null;

  const { today, goal, streak, badges, days, points, studyMs } = body as Record<string, unknown>;

  if (!isDayKey(today) || !isInt(goal, 1, MAX_GOAL) || !isInt(streak, 0, 100_000)) return null;

  if (points !== undefined && !isInt(points, 0, MAX_POINTS)) return null;
  if (studyMs !== undefined && !isInt(studyMs, 0, MAX_STUDY_MS)) return null;

  if (
    !Array.isArray(badges) ||
    badges.length > MAX_BADGES ||
    !badges.every((id) => typeof id === 'string' && /^[a-zA-Z]{1,20}-\d{1,6}$/.test(id))
  ) {
    return null;
  }

  if (!Array.isArray(days) || days.length > UPLOAD_DAYS) return null;

  const oldest = shiftDay(today, 1 - UPLOAD_DAYS);
  const parsed: DayStats[] = [];

  for (const row of days) {
    if (typeof row !== 'object' || row === null) return null;

    const { day, answers, goal: dayGoal, studyMs } = row as Record<string, unknown>;

    if (
      !isDayKey(day) ||
      day < oldest ||
      day > today ||
      !isInt(answers, 0, MAX_ANSWERS) ||
      !isInt(dayGoal, 1, MAX_GOAL) ||
      !isInt(studyMs, 0, DAY_MS) ||
      parsed.some((seen) => seen.day === day)
    ) {
      return null;
    }

    parsed.push({ day, answers, goal: dayGoal, studyMs });
  }

  return {
    today,
    goal,
    streak,
    badges: [...new Set(badges as string[])],
    days: parsed,
    points: (points as number | undefined) ?? null,
    studyMs: (studyMs as number | undefined) ?? null,
  };
}
