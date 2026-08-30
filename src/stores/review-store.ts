import { create } from 'zustand';

import { gradeCard, loadDueCards, rollbackCard, type DueCardRow } from '@/db/queries';
import { Rating, State, toFsrsCard, type FsrsCard, type Grade } from '@/lib/scheduler';

/**
 * Cards rescheduled within this window come back in the same session, the way
 * Anki replays a card you answered "Again". Anything further out is done for
 * today and only the database keeps it.
 */
const SAME_SESSION_WINDOW_MS = 20 * 60_000;

export type ReviewCard = {
  cardId: number;
  front: string;
  back: string;
  imagePath: string | null;
  fsrs: FsrsCard;
};

export type GradeCounts = Record<Grade, number>;

/** One reversible answer — enough to put the card back exactly where it was. */
type AnsweredStep = {
  /** The card as it stood *before* grading. */
  card: ReviewCard;
  grade: Grade;
  /** Whether grading appended the card back onto the end of the queue. */
  replayed: boolean;
};

const emptyCounts = (): GradeCounts => ({
  [Rating.Again]: 0,
  [Rating.Hard]: 0,
  [Rating.Good]: 0,
  [Rating.Easy]: 0,
});

const emptySession = () => ({
  queue: [] as ReviewCard[],
  revealed: false,
  answered: 0,
  gradeCounts: emptyCounts(),
  history: [] as AnsweredStep[],
});

type ReviewStore = {
  deckId: number | null;
  queue: ReviewCard[];
  revealed: boolean;
  /** Total answers given, including repeats of the same card. */
  answered: number;
  gradeCounts: GradeCounts;
  /** Answers that can still be undone, oldest first. */
  history: AnsweredStep[];
  start: (deckId: number) => void;
  reveal: () => void;
  answer: (grade: Grade) => void;
  undo: () => void;
  reset: () => void;
};

export const useReviewStore = create<ReviewStore>((set, get) => ({
  deckId: null,
  ...emptySession(),

  start: (deckId) => {
    set({
      deckId,
      ...emptySession(),
      queue: loadDueCards(deckId, new Date()).map(toReviewCard),
    });
  },

  reveal: () => set({ revealed: true }),

  answer: (grade) => {
    const { queue, answered, gradeCounts, history } = get();
    const current = queue[0];
    if (!current) return;

    const now = new Date();
    const next = gradeCard(current.cardId, grade, now);

    const rest = queue.slice(1);
    const dueIn = next.due.getTime() - now.getTime();
    const replayed =
      (next.state === State.Learning || next.state === State.Relearning) &&
      dueIn < SAME_SESSION_WINDOW_MS;

    set({
      queue: replayed ? [...rest, { ...current, fsrs: next }] : rest,
      revealed: false,
      answered: answered + 1,
      gradeCounts: { ...gradeCounts, [grade]: gradeCounts[grade] + 1 },
      history: [...history, { card: current, grade, replayed }],
    });
  },

  /**
   * Reverses the last answer, in the database and in the queue. Steps come off
   * in reverse order, so each undo exactly mirrors the `answer` that made it.
   */
  undo: () => {
    const { queue, answered, gradeCounts, history } = get();
    const step = history[history.length - 1];
    if (!step) return;

    rollbackCard(step.card.cardId);

    // Grading either dropped the card or pushed it onto the end of the queue.
    const rest = step.replayed ? queue.slice(0, -1) : queue;

    set({
      // Back to the front with its answer showing, ready to be regraded.
      queue: [step.card, ...rest],
      revealed: true,
      answered: answered - 1,
      gradeCounts: { ...gradeCounts, [step.grade]: gradeCounts[step.grade] - 1 },
      history: history.slice(0, -1),
    });
  },

  reset: () => set({ deckId: null, ...emptySession() }),
}));

function toReviewCard(row: DueCardRow): ReviewCard {
  return {
    cardId: row.cardId,
    front: row.front,
    back: row.back,
    imagePath: row.imagePath,
    fsrs: toFsrsCard(row),
  };
}
