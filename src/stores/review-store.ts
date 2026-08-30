import { create } from 'zustand';

import { gradeCard, loadDueCards, type DueCardRow } from '@/db/queries';
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

const emptyCounts = (): GradeCounts => ({
  [Rating.Again]: 0,
  [Rating.Hard]: 0,
  [Rating.Good]: 0,
  [Rating.Easy]: 0,
});

type ReviewStore = {
  deckId: number | null;
  queue: ReviewCard[];
  revealed: boolean;
  /** Total answers given, including repeats of the same card. */
  answered: number;
  gradeCounts: GradeCounts;
  start: (deckId: number) => void;
  reveal: () => void;
  answer: (grade: Grade) => void;
  reset: () => void;
};

export const useReviewStore = create<ReviewStore>((set, get) => ({
  deckId: null,
  queue: [],
  revealed: false,
  answered: 0,
  gradeCounts: emptyCounts(),

  start: (deckId) => {
    set({
      deckId,
      queue: loadDueCards(deckId, new Date()).map(toReviewCard),
      revealed: false,
      answered: 0,
      gradeCounts: emptyCounts(),
    });
  },

  reveal: () => set({ revealed: true }),

  answer: (grade) => {
    const { queue, answered, gradeCounts } = get();
    const current = queue[0];
    if (!current) return;

    const now = new Date();
    const next = gradeCard(current.cardId, grade, now);

    const rest = queue.slice(1);
    const dueIn = next.due.getTime() - now.getTime();
    const replayNow =
      (next.state === State.Learning || next.state === State.Relearning) &&
      dueIn < SAME_SESSION_WINDOW_MS;

    set({
      queue: replayNow ? [...rest, { ...current, fsrs: next }] : rest,
      revealed: false,
      answered: answered + 1,
      gradeCounts: { ...gradeCounts, [grade]: gradeCounts[grade] + 1 },
    });
  },

  reset: () =>
    set({ deckId: null, queue: [], revealed: false, answered: 0, gradeCounts: emptyCounts() }),
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
