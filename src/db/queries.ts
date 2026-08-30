import { and, asc, desc, eq, lte, sql, type SQLWrapper } from 'drizzle-orm';

import {
  remainingAllowance,
  studyDayStart,
  withinAllowance,
  type Allowance,
} from '@/lib/limits';
import {
  applyGrade,
  newCardState,
  QUEUE_STATES,
  rollbackGrade,
  State,
  toFsrsCard,
  toReviewLog,
  toStateValues,
  type Grade,
} from '@/lib/scheduler';

import { db } from './client';
import { cards, decks, fsrsState, reviewLogs } from './schema';

/* ------------------------------------------------------------------ reads */

/** Comma-separated bind params for a `state in (...)` test. */
function stateList(states: State[]) {
  return sql.join(
    states.map((state) => sql`${state}`),
    sql`, `
  );
}

/** Counts rows in the given FSRS states, for a query already filtered to due cards. */
function inStates(states: State[]) {
  return sql<number>`coalesce(sum(case
    when ${fsrsState.state} in (${stateList(states)}) then 1 else 0 end), 0)`;
}

/** Same buckets, applying the due cut-off inline — for aggregates over every card. */
function dueInStates(nowMs: number, states: State[]) {
  return sql<number>`coalesce(sum(case
    when ${fsrsState.due} <= ${nowMs} and ${fsrsState.state} in (${stateList(states)})
    then 1 else 0 end), 0)`;
}

/**
 * Correlated count of today's answers of one kind. `review_logs.state` holds the
 * state the card had *before* that answer, so `State.New` counts cards
 * introduced today and `State.Review` counts genuine reviews. Learning steps
 * match neither, which is exactly what keeps them free of the daily cap.
 *
 * A join instead of a subquery would multiply the outer rows and corrupt
 * `cardCount`, hence the correlated form.
 *
 * The inner columns are written as literal text on purpose: drizzle drops the
 * table qualifier from an embedded column when the *outer* query has no join,
 * which turned `dc.id` into a bare `id` and made the whole statement ambiguous.
 */
function doneToday(state: State, deckRef: SQLWrapper | number, dayStartMs: number) {
  return sql<number>`(
    select count(*) from ${reviewLogs} as dl
    join ${cards} as dc on dc.id = dl.card_id
    where dc.deck_id = ${deckRef}
      and dl.state = ${state}
      and dl.reviewed_at >= ${dayStartMs})`;
}

/**
 * Decks with their card totals. `nowMs` is passed in (rather than read inside
 * SQL) so callers control when the "due" cut-off is recomputed.
 *
 * Returns the query builder, not the rows — pass it to `useLiveQuery`.
 */
export function decksWithStatsQuery(nowMs: number, dayStartMs: number) {
  return db
    .select({
      id: decks.id,
      name: decks.name,
      description: decks.description,
      createdAt: decks.createdAt,
      newPerDay: decks.newPerDay,
      reviewsPerDay: decks.reviewsPerDay,
      cardCount: sql<number>`count(${cards.id})`,
      newCount: dueInStates(nowMs, QUEUE_STATES.newCount),
      learningCount: dueInStates(nowMs, QUEUE_STATES.learningCount),
      reviewCount: dueInStates(nowMs, QUEUE_STATES.reviewCount),
      newDoneToday: doneToday(State.New, decks.id, dayStartMs),
      reviewsDoneToday: doneToday(State.Review, decks.id, dayStartMs),
    })
    .from(decks)
    .leftJoin(cards, eq(cards.deckId, decks.id))
    .leftJoin(fsrsState, eq(fsrsState.cardId, cards.id))
    .groupBy(decks.id)
    .orderBy(asc(decks.name));
}

export function deckQuery(deckId: number) {
  return db.select().from(decks).where(eq(decks.id, deckId)).limit(1);
}

export function cardsInDeckQuery(deckId: number) {
  return db
    .select({
      id: cards.id,
      front: cards.front,
      back: cards.back,
      imageStatus: cards.imageStatus,
      createdAt: cards.createdAt,
      due: fsrsState.due,
      state: fsrsState.state,
      reps: fsrsState.reps,
      lapses: fsrsState.lapses,
    })
    .from(cards)
    .leftJoin(fsrsState, eq(fsrsState.cardId, cards.id))
    .where(eq(cards.deckId, deckId))
    .orderBy(desc(cards.createdAt));
}

/**
 * Raw counters for one deck plus what has already been answered today — every
 * number the caller needs to apply the deck's daily limits. Capping happens in
 * `cappedCounts`, never here, so one rule serves every screen.
 */
export function deckDueBreakdownQuery(deckId: number, nowMs: number, dayStartMs: number) {
  return db
    .select({
      newCount: inStates(QUEUE_STATES.newCount),
      learningCount: inStates(QUEUE_STATES.learningCount),
      reviewCount: inStates(QUEUE_STATES.reviewCount),
      newDoneToday: doneToday(State.New, deckId, dayStartMs),
      reviewsDoneToday: doneToday(State.Review, deckId, dayStartMs),
    })
    .from(cards)
    .innerJoin(fsrsState, eq(fsrsState.cardId, cards.id))
    .where(and(eq(cards.deckId, deckId), lte(fsrsState.due, new Date(nowMs))));
}

export function deckDoneTodayQuery(deckId: number, dayStartMs: number) {
  return db
    .select({
      newDoneToday: doneToday(State.New, deckId, dayStartMs),
      reviewsDoneToday: doneToday(State.Review, deckId, dayStartMs),
    })
    .from(decks)
    .where(eq(decks.id, deckId));
}

export type DueCardRow = {
  cardId: number;
  front: string;
  back: string;
  imagePath: string | null;
  due: Date;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: number;
  lastReview: Date | null;
};

/** Snapshot of the cards due right now — read once when a session starts. */
/**
 * Snapshot of the cards due right now, already trimmed to what the deck's daily
 * limits still allow. Doing the trim here means the session queue and the
 * counters on the deck screens can never disagree.
 */
export function loadDueCards(deckId: number, now: Date, limit = 500): DueCardRow[] {
  const rows = db
    .select({
      cardId: cards.id,
      front: cards.front,
      back: cards.back,
      imagePath: cards.imagePath,
      due: fsrsState.due,
      stability: fsrsState.stability,
      difficulty: fsrsState.difficulty,
      elapsedDays: fsrsState.elapsedDays,
      scheduledDays: fsrsState.scheduledDays,
      learningSteps: fsrsState.learningSteps,
      reps: fsrsState.reps,
      lapses: fsrsState.lapses,
      state: fsrsState.state,
      lastReview: fsrsState.lastReview,
    })
    .from(cards)
    .innerJoin(fsrsState, eq(fsrsState.cardId, cards.id))
    .where(and(eq(cards.deckId, deckId), lte(fsrsState.due, now)))
    .orderBy(asc(fsrsState.due))
    .limit(limit)
    .all();

  return withinAllowance(rows, deckAllowance(deckId, now));
}

/** What the deck may still hand out in the study day containing `now`. */
export function deckAllowance(deckId: number, now: Date): Allowance {
  const dayStartMs = studyDayStart(now).getTime();

  const limits = db
    .select({ newPerDay: decks.newPerDay, reviewsPerDay: decks.reviewsPerDay })
    .from(decks)
    .where(eq(decks.id, deckId))
    .get();

  const done = deckDoneTodayQuery(deckId, dayStartMs).get();

  return remainingAllowance(
    limits ?? { newPerDay: 0, reviewsPerDay: 0 },
    done ?? { newDoneToday: 0, reviewsDoneToday: 0 }
  );
}

export function getDeck(deckId: number) {
  return db.select().from(decks).where(eq(decks.id, deckId)).get();
}

export function getCard(cardId: number) {
  return db.select().from(cards).where(eq(cards.id, cardId)).get();
}

/* -------------------------------------------------------------- mutations */

export type DeckInput = {
  name: string;
  description?: string | null;
  newPerDay: number;
  reviewsPerDay: number;
};

export function createDeck(input: DeckInput) {
  return db
    .insert(decks)
    .values({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      newPerDay: input.newPerDay,
      reviewsPerDay: input.reviewsPerDay,
    })
    .returning()
    .get();
}

export function updateDeck(deckId: number, patch: DeckInput) {
  return db
    .update(decks)
    .set({
      name: patch.name.trim(),
      description: patch.description?.trim() || null,
      newPerDay: patch.newPerDay,
      reviewsPerDay: patch.reviewsPerDay,
    })
    .where(eq(decks.id, deckId))
    .run();
}

export function deleteDeck(deckId: number) {
  return db.delete(decks).where(eq(decks.id, deckId)).run();
}

/** Inserts the card together with its initial (New) FSRS state. */
export function createCard(deckId: number, front: string, back: string, now = new Date()) {
  return db.transaction((tx) => {
    const card = tx
      .insert(cards)
      .values({ deckId, front: front.trim(), back: back.trim() })
      .returning()
      .get();

    tx.insert(fsrsState)
      .values({ cardId: card.id, ...newCardState(now) })
      .run();

    return card;
  });
}

export function updateCard(cardId: number, patch: { front: string; back: string }) {
  return db
    .update(cards)
    .set({ front: patch.front.trim(), back: patch.back.trim() })
    .where(eq(cards.id, cardId))
    .run();
}

export function deleteCard(cardId: number) {
  return db.delete(cards).where(eq(cards.id, cardId)).run();
}

/** Resets a card back to New without deleting its review history. */
export function resetCard(cardId: number, now = new Date()) {
  return db.update(fsrsState).set(newCardState(now)).where(eq(fsrsState.cardId, cardId)).run();
}

/**
 * Runs the card through FSRS and persists both the new state and the review
 * log. Re-reads the state inside the transaction so a stale in-memory copy
 * can never overwrite a newer one.
 */
export function gradeCard(cardId: number, grade: Grade, now = new Date()) {
  return db.transaction((tx) => {
    const row = tx.select().from(fsrsState).where(eq(fsrsState.cardId, cardId)).get();
    if (!row) throw new Error(`Brak stanu FSRS dla karty ${cardId}`);

    const { card: next, log } = applyGrade(toFsrsCard(row), grade, now);

    tx.update(fsrsState).set(toStateValues(next)).where(eq(fsrsState.cardId, cardId)).run();

    tx.insert(reviewLogs)
      .values({
        cardId,
        rating: log.rating,
        state: log.state,
        due: log.due,
        stability: log.stability,
        difficulty: log.difficulty,
        elapsedDays: log.elapsed_days,
        lastElapsedDays: log.last_elapsed_days,
        scheduledDays: log.scheduled_days,
        learningSteps: log.learning_steps,
        reviewedAt: log.review,
      })
      .run();

    return next;
  });
}

/**
 * Undoes the most recent review of a card: restores the FSRS state it had
 * before that answer and drops the log entry, so `review_logs` never describes
 * a review that no longer counts. Ordered by `id`, which is the only reliable
 * "most recent" when several reviews share a timestamp.
 */
export function rollbackCard(cardId: number) {
  return db.transaction((tx) => {
    const stateRow = tx.select().from(fsrsState).where(eq(fsrsState.cardId, cardId)).get();
    if (!stateRow) throw new Error(`Brak stanu FSRS dla karty ${cardId}`);

    const logRow = tx
      .select()
      .from(reviewLogs)
      .where(eq(reviewLogs.cardId, cardId))
      .orderBy(desc(reviewLogs.id))
      .limit(1)
      .get();
    if (!logRow) throw new Error(`Brak historii powtórek dla karty ${cardId}`);

    const previous = rollbackGrade(toFsrsCard(stateRow), toReviewLog(logRow));

    tx.update(fsrsState).set(toStateValues(previous)).where(eq(fsrsState.cardId, cardId)).run();
    tx.delete(reviewLogs).where(eq(reviewLogs.id, logRow.id)).run();

    return previous;
  });
}
