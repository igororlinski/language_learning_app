/**
 * Where one study day ends and the next begins, and what that means for a
 * card's due date.
 *
 * Lives on its own because both the daily limits (`src/lib/limits.ts`) and the
 * scheduler (`src/lib/scheduler.ts`) need it, and the scheduler is what limits
 * is built on — putting the rollover in either of them would make the two
 * import each other.
 */

/**
 * Anki rolls the study day over at 4 AM, not at midnight, so a session that
 * runs past midnight still counts against the day it started in.
 */
export const DAY_ROLLOVER_HOUR = 4;

export function studyDayStart(now: Date): Date {
  const start = new Date(now);
  start.setHours(DAY_ROLLOVER_HOUR, 0, 0, 0);
  if (now.getTime() < start.getTime()) start.setDate(start.getDate() - 1);
  return start;
}

/**
 * When a card scheduled `scheduledDays` out should come back.
 *
 * Anything measured in days is due at the **start of that study day**, not at
 * the clock time of the review: answering at 20:00 with a one-day interval
 * brings the card back at 4:00 the next morning, not at 20:00 the next evening.
 * Without this every card drifts to its own hour of the day and the deck never
 * has a moment when it is simply done — which is the whole point of a daily
 * review app, and exactly how Anki behaves.
 *
 * Learning steps are left alone: `10 min` has to mean ten minutes, or the card
 * would vanish from the session that is teaching it.
 *
 * The days are added with `setDate` rather than by multiplying milliseconds, so
 * a clock change in between does not shift the boundary by an hour.
 */
export function dueOnStudyDay(due: Date, scheduledDays: number, reviewedAt: Date): Date {
  if (scheduledDays < 1) return due;

  const target = studyDayStart(reviewedAt);
  target.setDate(target.getDate() + Math.round(scheduledDays));

  return target;
}
