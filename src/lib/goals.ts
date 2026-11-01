import { studyDayStart } from '@/lib/study-day';

/**
 * The daily goal and the streak it keeps alive.
 *
 * Pure, like `stats.ts`: `study_days` is read by the queries, and everything
 * that decides whether a day counted — where it ends, which goal it is held
 * to — is decided here, where tests can reach it.
 */

/** Answers a day, for anyone who has not picked a goal. */
export const DEFAULT_DAILY_GOAL = 20;

/** The most a goal can be typed as — what the friends server accepts too. */
export const MAX_DAILY_GOAL = 1000;

/** The stored goal, or the default for anything that is not a sensible one. */
export function parseDailyGoal(value: string | null | undefined): number {
  return parseGoal(value) ?? DEFAULT_DAILY_GOAL;
}

function parseGoal(value: string | null | undefined): number | null {
  const goal = Number(value);

  return value != null && Number.isInteger(goal) && goal >= 1 && goal <= MAX_DAILY_GOAL
    ? goal
    : null;
}

/* ------------------------------------------------------------- light days */

/**
 * The goal as it is set: one number for every day, and a smaller one for the
 * weekdays picked as lighter (0 for Sunday … 6 for Saturday, like `weekday`).
 * `lightGoal` is null until one is picked.
 */
export type GoalPlan = { goal: number; lightDays: readonly number[]; lightGoal: number | null };

/** The stored weekdays — a JSON list — or none for anything else. */
export function parseLightDays(value: string | null | undefined): number[] {
  try {
    const parsed: unknown = JSON.parse(value ?? '[]');

    if (!Array.isArray(parsed)) return [];

    const days = parsed.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6);

    return [...new Set(days)].sort();
  } catch {
    return [];
  }
}

/** The stored lighter goal, or null when none was picked. */
export const parseLightGoal = (value: string | null | undefined): number | null => parseGoal(value);

/** Half the goal, rounded down, until a lighter goal is typed in. */
export const defaultLightGoal = (goal: number): number => Math.max(1, Math.floor(goal / 2));

/** Whether a day is one of the lighter ones. */
export const isLightDay = (plan: GoalPlan, day: string): boolean =>
  plan.lightDays.includes(weekday(day));

/**
 * The goal a day is held to. A lighter day never asks for more than the rest:
 * a lighter goal left above a goal lowered later is the goal.
 */
export function goalOn(plan: GoalPlan, day: string): number {
  if (!isLightDay(plan, day)) return plan.goal;

  return Math.min(plan.goal, plan.lightGoal ?? defaultLightGoal(plan.goal));
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
};

/**
 * Days in a row with the daily goal met.
 *
 * Every past day is held to **its own** goal, the one stored with it; today is
 * held to the goal set now, so changing it changes today and nothing before.
 * Today short of the goal **does not break** the streak — the day is not over.
 * Any earlier day short of its goal does.
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

  if (first) {
    for (let day = first; day < today; day = shiftDay(day, 1)) {
      const row = byDay.get(day);

      run = row && row.answers > 0 && row.answers >= row.goal ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
  }

  if (met) run += 1;

  return { current: run, longest: Math.max(longest, run), today: { answers, goal, met } };
}

/**
 * Points for the ranking: a day's goal for every day the goal was met — each
 * past day by its own goal, today by the one it is held to now, as with the
 * streak. A bigger goal is worth more; a day short of it is worth nothing.
 */
export function totalPoints(days: readonly StudyDay[], goal: number, now: number): number {
  const today = dayKey(now);

  return days.reduce((sum, row) => {
    if (row.day === today) return row.answers >= goal ? sum + goal : sum;

    return row.day < today && row.answers > 0 && row.answers >= row.goal ? sum + row.goal : sum;
  }, 0);
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
