import { QUEUE_STATES, State, type QueueCounts } from '@/lib/scheduler';

// The day boundary itself lives in its own module: the scheduler needs it too,
// and it is what this one is built on.
export { DAY_ROLLOVER_HOUR, studyDayStart } from '@/lib/study-day';

export type DailyLimits = { newPerDay: number; reviewsPerDay: number };
export type DoneToday = { newDoneToday: number; reviewsDoneToday: number };

/** What the deck may still hand out today. */
export type Allowance = { newLeft: number; reviewsLeft: number };

export function remainingAllowance(limits: DailyLimits, done: DoneToday): Allowance {
  return {
    newLeft: Math.max(0, limits.newPerDay - done.newDoneToday),
    reviewsLeft: Math.max(0, limits.reviewsPerDay - done.reviewsDoneToday),
  };
}

/**
 * Caps raw counters against the allowance. Learning passes through untouched:
 * a card part-way through its learning steps always comes back, no matter how
 * much of the day's quota is already spent — exactly as Anki behaves.
 */
export function capCounts(raw: QueueCounts, allowance: Allowance): QueueCounts {
  return {
    newCount: Math.min(raw.newCount, allowance.newLeft),
    learningCount: raw.learningCount,
    reviewCount: Math.min(raw.reviewCount, allowance.reviewsLeft),
  };
}

export function totalDue(counts: QueueCounts): number {
  return counts.newCount + counts.learningCount + counts.reviewCount;
}

/** One aggregate row: raw counts plus everything needed to cap them. */
export type CountableRow = QueueCounts & DailyLimits & DoneToday;

/** The single place that turns a query row into the numbers a screen shows. */
export function cappedCounts(row: CountableRow): QueueCounts {
  return capCounts(row, remainingAllowance(row, row));
}

/**
 * Trims a due-card snapshot to the allowance, preserving order so the queue
 * still leads with the longest-overdue cards.
 */
export function withinAllowance<T extends { state: number }>(
  rows: T[],
  allowance: Allowance
): T[] {
  let newLeft = allowance.newLeft;
  let reviewsLeft = allowance.reviewsLeft;

  return rows.filter((row) => {
    const state = row.state as State;

    if (QUEUE_STATES.newCount.includes(state)) {
      if (newLeft <= 0) return false;
      newLeft -= 1;
      return true;
    }

    if (QUEUE_STATES.reviewCount.includes(state)) {
      if (reviewsLeft <= 0) return false;
      reviewsLeft -= 1;
      return true;
    }

    return true;
  });
}
