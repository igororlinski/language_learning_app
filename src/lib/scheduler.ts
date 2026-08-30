import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Card as FsrsCard,
  type Grade,
  type RecordLogItem,
} from 'ts-fsrs';

import type { FsrsStateRow } from '@/db/schema';

export const fsrsParameters = generatorParameters({
  // Target probability of recall when a card comes up again.
  request_retention: 0.9,
  enable_fuzz: true,
  // Keeps Anki-style sub-day learning steps (1m / 10m) for new cards.
  enable_short_term: true,
});

export const scheduler = fsrs(fsrsParameters);

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

/** The four outcomes shown on the grading buttons, without committing any of them. */
export function previewGrades(card: FsrsCard, now: Date): Record<Grade, RecordLogItem> {
  return scheduler.repeat(card, now);
}

export function applyGrade(card: FsrsCard, grade: Grade, now: Date): RecordLogItem {
  return scheduler.next(card, now, grade);
}

export { Rating, State };
export type { FsrsCard, Grade, RecordLogItem };
