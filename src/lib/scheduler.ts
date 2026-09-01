import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Card as FsrsCard,
  type Grade,
  type RecordLogItem,
  type ReviewLog,
} from 'ts-fsrs';

import {
  DEFAULT_RETENTION,
  type FsrsStateRow,
  type Retention,
  type ReviewLog as ReviewLogRow,
} from '@/db/schema';
import { dueOnStudyDay } from '@/lib/study-day';

export const RETENTION_LABELS: Record<Retention, string> = {
  0.9: 'Rzadkie powtórki',
  0.94: 'Wyważone',
  0.97: 'Częste powtórki',
};

export const RETENTION_HINTS: Record<Retention, string> = {
  0.9: 'Najdłuższe odstępy — mniej pracy dziennie, więcej zapomnianych kart.',
  0.94: 'Domyślne. Pierwsze „Łatwe" wraca po kilku dniach.',
  0.97: 'Najkrótsze odstępy — najwięcej powtórek, najmniej wypadków z pamięci.',
};

const parametersFor = (retention: number) =>
  generatorParameters({
    request_retention: retention,
    enable_fuzz: true,
    // Keeps Anki-style sub-day learning steps (1m / 10m) for new cards.
    enable_short_term: true,
  });

// One engine per retention, built once: `fsrs()` is not free and a session
// asks for the same one on every card.
const engines = new Map<number, ReturnType<typeof fsrs>>();

export function schedulerFor(retention: number = DEFAULT_RETENTION) {
  const existing = engines.get(retention);
  if (existing) return existing;

  const engine = fsrs(parametersFor(retention));
  engines.set(retention, engine);

  return engine;
}

export const GRADES = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as const;

export const GRADE_LABELS: Record<Grade, string> = {
  [Rating.Again]: 'Znowu',
  [Rating.Hard]: 'Trudne',
  [Rating.Good]: 'Dobre',
  [Rating.Easy]: 'Łatwe',
};

export const STATE_LABELS: Record<State, string> = {
  [State.New]: 'Nowa',
  [State.Learning]: 'Nauka',
  [State.Review]: 'Powtórka',
  [State.Relearning]: 'Przypominanie',
};

/** Values for a brand new card, ready to be inserted into `fsrs_state`. */
export function newCardState(now: Date = new Date()) {
  return toStateValues(createEmptyCard(now));
}

export function toFsrsCard(row: Omit<FsrsStateRow, 'cardId'>): FsrsCard {
  return {
    due: row.due,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsedDays,
    scheduled_days: row.scheduledDays,
    learning_steps: row.learningSteps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state as State,
    last_review: row.lastReview ?? undefined,
  };
}

export function toStateValues(card: FsrsCard): Omit<FsrsStateRow, 'cardId'> {
  return {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReview: card.last_review ?? null,
  };
}

/**
 * ts-fsrs hands back `due = now + interval`, so a one-day interval would mean
 * "in twenty four hours" and every card would settle on its own hour of the
 * day. Anything counted in days is moved to the start of that study day
 * instead — see `dueOnStudyDay`. Both the preview and the commit go through
 * here, so the button cannot promise one thing and the save do another.
 */
function onStudyDay(item: RecordLogItem, now: Date): RecordLogItem {
  const due = dueOnStudyDay(item.card.due, item.card.scheduled_days, now);

  return due === item.card.due ? item : { card: { ...item.card, due }, log: item.log };
}

/** The four outcomes shown on the grading buttons, without committing any of them. */
export function previewGrades(
  card: FsrsCard,
  now: Date,
  retention?: number
): Record<Grade, RecordLogItem> {
  const preview = schedulerFor(retention).repeat(card, now);

  return GRADES.reduce(
    (all, grade) => ({ ...all, [grade]: onStudyDay(preview[grade], now) }),
    {} as Record<Grade, RecordLogItem>
  );
}

export function applyGrade(
  card: FsrsCard,
  grade: Grade,
  now: Date,
  retention?: number
): RecordLogItem {
  return onStudyDay(schedulerFor(retention).next(card, now, grade), now);
}

/** Maps a `review_logs` row back onto the ts-fsrs `ReviewLog` shape. */
export function toReviewLog(row: Omit<ReviewLogRow, 'id' | 'cardId'>): ReviewLog {
  return {
    rating: row.rating as Rating,
    state: row.state as State,
    due: row.due,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsedDays,
    last_elapsed_days: row.lastElapsedDays,
    scheduled_days: row.scheduledDays,
    learning_steps: row.learningSteps,
    review: row.reviewedAt,
  };
}

/**
 * Undoes one graded review. Every field returns to what it was except `due`:
 * ts-fsrs restores that exactly only when the log records `State.New`, and
 * otherwise sets it to the moment of the undone review. That is the useful
 * behaviour for an undo button — the card lands back in the queue right away.
 */
export function rollbackGrade(card: FsrsCard, log: ReviewLog): FsrsCard {
  // Undoing reads the log rather than the model, so the retention in force
  // makes no difference here.
  return schedulerFor().rollback(card, log);
}

/** The three Anki-style queue counters. */
export type QueueCounts = {
  newCount: number;
  learningCount: number;
  reviewCount: number;
};

/**
 * Which FSRS states feed each counter. Learning and Relearning share one, just
 * like Anki's red number. This is the single source for both the SQL in
 * `queries.ts` and the in-memory session count, so the two cannot drift apart.
 */
export const QUEUE_STATES: Record<keyof QueueCounts, State[]> = {
  newCount: [State.New],
  learningCount: [State.Learning, State.Relearning],
  reviewCount: [State.Review],
};

const QUEUE_BUCKETS = Object.keys(QUEUE_STATES) as (keyof QueueCounts)[];

/** Counts an in-memory session queue into the same buckets the SQL produces. */
export function countQueueStates(states: State[]): QueueCounts {
  const counts: QueueCounts = { newCount: 0, learningCount: 0, reviewCount: 0 };

  for (const state of states) {
    const bucket = QUEUE_BUCKETS.find((key) => QUEUE_STATES[key].includes(state));
    if (bucket) counts[bucket] += 1;
  }

  return counts;
}

export { Rating, State };
export type { FsrsCard, Grade, RecordLogItem };
