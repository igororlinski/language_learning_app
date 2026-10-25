import { studyDayStart } from '@/lib/study-day';

/**
 * The daily goal and the streak it keeps alive.
 *
 * Pure, like `stats.ts`: `study_days` is read by the queries, and everything
 * that decides whether a day counted — where it ends, which goal it is held
 * to, when a freeze covers it — is decided here, where tests can reach it.
 */

/** Answers a day, for anyone who has not picked a goal. */
export const DEFAULT_DAILY_GOAL = 20;

/** The goals on offer. A list rather than a number field: nobody needs 37. */
export const DAILY_GOALS = [10, 20, 30, 50, 75, 100, 150, 200] as const;

const MAX_DAILY_GOAL = 1000;

/** The stored goal, or the default for anything that is not a sensible one. */
export function parseDailyGoal(value: string | null | undefined): number {
  const goal = Number(value);

  return Number.isInteger(goal) && goal >= 1 && goal <= MAX_DAILY_GOAL ? goal : DEFAULT_DAILY_GOAL;
}

/* ------------------------------------------------------------------- days */

const pad = (value: number) => String(value).padStart(2, '0');

const keyOf = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/**
 * The study day a moment belongs to, as `study_days.day`: the local date its
 * 4:00 falls on. Zero-padded, so the keys sort as dates.
 *
 * Migration 0026 computes the same key in SQL (`date(..., 'localtime',
 * '-4 hours')`); the data-layer tests check that the two agree.
 */
export function dayKey(at: number | Date): string {
  return keyOf(studyDayStart(new Date(at)));
}

/** A key back to the 4:00 it stands for. */
function dayStart(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);

  return new Date(year, month - 1, day, 4);
}

/** The key `offset` days after `key` — `setDate`, so a clock change is no day. */
export function shiftDay(key: string, offset: number): string {
  const date = dayStart(key);
  date.setDate(date.getDate() + offset);

  return keyOf(date);
}

/** The Monday of the week a day is in: weeks start on Monday, as in Poland. */
export function weekKey(key: string): string {
  return shiftDay(key, -((dayStart(key).getDay() + 6) % 7));
}

/** 0 for Sunday … 6 for Saturday, like `Date.getDay`. */
export const weekday = (key: string): number => dayStart(key).getDay();

/* ----------------------------------------------------------------- streak */

/** One row of `study_days`. */
export type StudyDay = { day: string; answers: number; goal: number };

export type Streak = {
  /** Days in a row with the goal met, today included once it is. */
  current: number;
  longest: number;
  today: { answers: number; goal: number; met: boolean };
  /** The day this week's freeze went on, or null while it is still there. */
  freezeUsedOn: string | null;
};

/**
 * Days in a row with the daily goal met.
 *
 * Every past day is held to **its own** goal, the one stored with it; today is
 * held to the goal set now, so changing it changes today and nothing before.
 * Today short of the goal **does not break** the streak — the day is not over.
 *
 * **One freeze a week** (Monday to Sunday): the first missed day of a week,
 * while there is a streak to save, is covered instead of ending it. A covered
 * day keeps the streak but does not add to it. Freezes are not saved up — an
 * unused one is gone on Monday — and none is spent with no streak running.
 * The week's freeze is spent even if a second miss ends the streak anyway.
 */
export function streak(days: readonly StudyDay[], goal: number, now: number): Streak {
  const today = dayKey(now);
  const byDay = new Map(days.map((row) => [row.day, row]));
  const answers = byDay.get(today)?.answers ?? 0;
  const met = answers >= goal;

  const first = days
    .map((row) => row.day)
    .filter((day) => day < today)
    .sort()[0];

  let run = 0;
  let longest = 0;
  const spent = new Map<string, string>();

  if (first) {
    for (let day = first; day < today; day = shiftDay(day, 1)) {
      const row = byDay.get(day);
      const week = weekKey(day);

      if (row && row.answers > 0 && row.answers >= row.goal) {
        run += 1;
      } else if (run > 0 && !spent.has(week)) {
        spent.set(week, day);
      } else {
        run = 0;
      }

      longest = Math.max(longest, run);
    }
  }

  if (met) run += 1;

  return {
    current: run,
    longest: Math.max(longest, run),
    today: { answers, goal, met },
    freezeUsedOn: spent.get(weekKey(today)) ?? null,
  };
}

/** Days on which the goal was met, today included once it is. */
export function goalDays(days: readonly StudyDay[], goal: number, now: number): number {
  const today = dayKey(now);

  return days.filter((row) =>
    row.day === today ? row.answers >= goal : row.day < today && row.answers > 0 && row.answers >= row.goal
  ).length;
}

/** Share of today's goal done, 0–1, for the bars. */
export const goalShare = ({ answers, goal }: { answers: number; goal: number }): number =>
  Math.min(1, answers / goal);
