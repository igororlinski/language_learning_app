import { Rating, State } from '@/lib/scheduler';
import { studyDayStart } from '@/lib/study-day';

/**
 * The numbers on "Statystyki", worked out from rows the screen already holds.
 *
 * Pure on purpose, like `limits.ts`: the queries (`statsLogsQuery`,
 * `statsCardsQuery`) only fetch, and everything that can be wrong about a
 * statistic — where a day ends, what counts as remembering, how few answers
 * are too few — is decided here, where tests can reach it.
 *
 * Days are **study days**, starting at 4:00, through the same `studyDayStart`
 * the daily limits use. A statistic with its own idea of midnight would count
 * a 1:00 session into a different day than the session itself did.
 */

/** One answer, as the stats need it. */
export type StatsLog = {
  cardId: number;
  rating: number;
  /** The card's state *before* this answer, as `review_logs` stores it. */
  state: number;
  reviewedAt: number;
  /** How long the card was on screen; null for answers from before it was timed. */
  durationMs: number | null;
  /** The target retention of the deck the card is in now. */
  targetRetention: number;
};

/** One card's current schedule. */
export type StatsCard = {
  cardId: number;
  state: number;
  due: number;
  scheduledDays: number;
};

/**
 * Fewer answers than this and a percentage says more about luck than about
 * memory: two misses in ten is 80%, three is 70%. Twenty is still rough, and
 * the screen shows the count next to every percentage so nobody mistakes it
 * for more than it is.
 */
export const MIN_ANSWERS = 20;

/** Anki's line between a young and a mature card: three weeks. */
export const MATURE_DAYS = 21;

/** How far back "recent" retention looks. */
export const RETENTION_WINDOW_DAYS = 30;

export const FORECAST_DAYS = 7;

/** Remembered means anything but "Znowu". */
const remembered = (log: StatsLog) => log.rating !== Rating.Again;

const isLearning = (state: number) => state === State.Learning || state === State.Relearning;

/** A study day as a key: the date its 4:00 falls on. */
function dayKey(ms: number): string {
  const day = studyDayStart(new Date(ms));

  return `${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}`;
}

/** The start of the study day `offset` days after the one `now` is in. */
function shiftedDay(now: number, offset: number): Date {
  const day = studyDayStart(new Date(now));
  day.setDate(day.getDate() + offset);

  return day;
}

/* ------------------------------------------------------------------ today */

export type TodayStats = {
  answers: number;
  /** Cards seen for the first time today — answers given while still new. */
  new: number;
  learning: number;
  review: number;
  /** Share of today's answers that were not "Znowu"; null with none. */
  correct: number | null;
};

export function todayStats(logs: readonly StatsLog[], now: number): TodayStats {
  const start = studyDayStart(new Date(now)).getTime();
  const today = logs.filter((log) => log.reviewedAt >= start && log.reviewedAt <= now);

  return {
    answers: today.length,
    new: today.filter((log) => log.state === State.New).length,
    learning: today.filter((log) => isLearning(log.state)).length,
    review: today.filter((log) => log.state === State.Review).length,
    correct: today.length > 0 ? today.filter(remembered).length / today.length : null,
  };
}

/* ----------------------------------------------------------------- streak */

export type StreakStats = { current: number; longest: number };

/**
 * Days in a row with at least one answer.
 *
 * Today without an answer **does not break** the streak yet — the day is not
 * over, and a streak that reads 0 every morning until the first card is a
 * streak that scolds. It counts back from yesterday then, and breaks only once
 * a whole day has gone by empty.
 */
export function streakStats(logs: readonly StatsLog[], now: number): StreakStats {
  const days = new Set(logs.filter((log) => log.reviewedAt <= now).map((log) => dayKey(log.reviewedAt)));

  let current = 0;
  let offset = days.has(dayKey(now)) ? 0 : -1;

  while (days.has(dayKey(shiftedDay(now, offset).getTime()))) {
    current += 1;
    offset -= 1;
  }

  // The longest run: walk the days that have answers, oldest first, and count
  // how many follow one another. "Follows" is `setDate(+1)` rather than 24
  // hours, so a clock change does not break a run.
  const starts = [...new Set(logs.map((log) => studyDayStart(new Date(log.reviewedAt)).getTime()))]
    .filter((start) => start <= now)
    .sort((a, b) => a - b);

  let longest = 0;
  let run = 0;
  let previous: Date | null = null;

  for (const start of starts) {
    const day = new Date(start);

    if (previous) {
      const expected = new Date(previous);
      expected.setDate(expected.getDate() + 1);
      run = expected.getTime() === day.getTime() ? run + 1 : 1;
    } else {
      run = 1;
    }

    longest = Math.max(longest, run);
    previous = day;
  }

  return { current, longest };
}

/* --------------------------------------------------------------- forecast */

export type ForecastDay = { start: number; count: number };

/**
 * How many cards fall due on each of the next seven study days, today first.
 *
 * Today's bar holds everything already due, overdue ones and cards still in
 * learning steps included — that is what today's session will actually show.
 * New cards are left out: they arrive by the deck's daily allowance, not by a
 * date, so counting them would make every day look like a wall.
 *
 * No daily cap is applied either. A forecast that already trimmed tomorrow to
 * the limit would hide the one thing it is for: seeing the pile coming.
 */
export function forecast(cards: readonly StatsCard[], now: number): ForecastDay[] {
  const days = Array.from({ length: FORECAST_DAYS }, (_, offset) => ({
    start: shiftedDay(now, offset).getTime(),
    count: 0,
  }));
  const end = shiftedDay(now, FORECAST_DAYS).getTime();

  for (const card of cards) {
    if (card.state === State.New) continue;

    // The same "due" as everywhere else (`DUE_SQL`): a card in steps shorter
    // than a day stays in today's session whatever its clock says.
    if (card.due <= now || card.scheduledDays < 1) {
      days[0].count += 1;
      continue;
    }

    if (card.due >= end) continue;

    // The last day whose start is not after the due date.
    for (let index = days.length - 1; index >= 0; index -= 1) {
      if (card.due >= days[index].start) {
        days[index].count += 1;
        break;
      }
    }
  }

  return days;
}

/* ------------------------------------------------------------- study time */

export const STUDY_TIME_DAYS = 7;

export type StudyTime = {
  /** Null when nothing today was timed — not zero, which would be a claim. */
  today: number | null;
  /** The last `STUDY_TIME_DAYS` study days, today included. */
  week: number | null;
  /** The average timed answer over the same week. */
  perAnswer: number | null;
};

/**
 * Time spent answering, from `review_logs.duration_ms` (each answer already
 * capped at a minute when it was saved).
 *
 * Answers from before the column existed are **left out, not counted as
 * zero**: the history before 2026-10-23 was never timed, and a week that
 * straddles the change shows only the part that was.
 */
export function studyTime(logs: readonly StatsLog[], now: number): StudyTime {
  const todayStart = studyDayStart(new Date(now)).getTime();
  const weekStart = shiftedDay(now, 1 - STUDY_TIME_DAYS).getTime();
  const timed = logs.filter(
    (log): log is StatsLog & { durationMs: number } =>
      log.durationMs != null && log.reviewedAt >= weekStart && log.reviewedAt <= now
  );
  const sum = (list: readonly { durationMs: number }[]) =>
    list.reduce((total, log) => total + log.durationMs, 0);
  const today = timed.filter((log) => log.reviewedAt >= todayStart);

  return {
    today: today.length > 0 ? sum(today) : null,
    week: timed.length > 0 ? sum(timed) : null,
    perAnswer: timed.length > 0 ? sum(timed) / timed.length : null,
  };
}

/** `45 s`, `12 min`, `1 h 20 min` — rounded to what is worth reading. */
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);

  if (seconds < 60) return `${seconds} s`;

  const minutes = Math.round(seconds / 60);

  if (minutes < 60) return `${minutes} min`;

  const rest = minutes % 60;

  return rest === 0 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 60)} h ${rest} min`;
}

/* -------------------------------------------------------------- retention */

export type RetentionStats = {
  /** Answers it is worked out from — shown beside it, always. */
  answers: number;
  /** Share remembered; null when there are fewer than `MIN_ANSWERS`. */
  rate: number | null;
  /**
   * What the decks are aiming at, weighted by where the answers came from:
   * a review in a 0.94 deck is held to 0.94 and one in a 0.90 deck to 0.90,
   * so "Wszystkie talie" compares like with like.
   */
  target: number | null;
};

/**
 * Of the answers to cards in review, the share remembered — Anki's "true
 * retention". Learning steps are left out: an answer ten minutes after the
 * card was shown says nothing about memory.
 *
 * This is the one number that can say whether the deck's FSRS settings and
 * the optimised weights do what they promise: if retention sits well below
 * the target, the intervals are too long.
 */
export function retention(logs: readonly StatsLog[]): RetentionStats {
  const reviews = logs.filter((log) => log.state === State.Review);

  if (reviews.length === 0) return { answers: 0, rate: null, target: null };

  return {
    answers: reviews.length,
    rate: reviews.length >= MIN_ANSWERS ? reviews.filter(remembered).length / reviews.length : null,
    target: reviews.reduce((sum, log) => sum + log.targetRetention, 0) / reviews.length,
  };
}

/** Retention over the last `RETENTION_WINDOW_DAYS` study days, today included. */
export function recentRetention(logs: readonly StatsLog[], now: number): RetentionStats {
  const since = shiftedDay(now, 1 - RETENTION_WINDOW_DAYS).getTime();

  return retention(logs.filter((log) => log.reviewedAt >= since && log.reviewedAt <= now));
}

/* ---------------------------------------------------------- associations */

export type MnemonicComparison = { with: RetentionStats; without: RetentionStats };

/**
 * Retention of cards that carry an association against cards that do not —
 * the only real test of the feature this app is built around, and the one
 * number Anki cannot show.
 *
 * Over the whole history, not the last thirty days: associations are new and
 * the samples small, and every answer counts. The honest caveat is that a card
 * counts as "with" for answers given before its association was added — fields
 * carry no date. Both groups are also not alike (associations go to the words
 * that were hard), so a gap is a hint, not a proof.
 */
export function mnemonicComparison(
  logs: readonly StatsLog[],
  withMnemonic: ReadonlySet<number>
): MnemonicComparison {
  return {
    with: retention(logs.filter((log) => withMnemonic.has(log.cardId))),
    without: retention(logs.filter((log) => !withMnemonic.has(log.cardId))),
  };
}

/* ------------------------------------------------------------ card states */

export type CardStates = { new: number; learning: number; young: number; mature: number };

export function cardStates(cards: readonly StatsCard[]): CardStates {
  const counts: CardStates = { new: 0, learning: 0, young: 0, mature: 0 };

  for (const card of cards) {
    if (card.state === State.New) counts.new += 1;
    else if (isLearning(card.state)) counts.learning += 1;
    else if (card.scheduledDays >= MATURE_DAYS) counts.mature += 1;
    else counts.young += 1;
  }

  return counts;
}

/* ------------------------------------------------------------- labelling */

const WEEKDAYS = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb'];

/** „Dziś", „Jutro", then the short weekday: what a bar in the forecast is called. */
export function forecastLabel(index: number, start: number): string {
  if (index === 0) return 'Dziś';
  if (index === 1) return 'Jutro';

  return WEEKDAYS[new Date(start).getDay()];
}

/** `87%` — rounded to a whole percent, which is all twenty answers can carry. */
export const formatPercent = (share: number): string => `${Math.round(share * 100)}%`;
