import { and, asc, desc, eq, lte, sql } from 'drizzle-orm';

import { applyGrade, newCardState, toFsrsCard, toStateValues, type Grade } from '@/lib/scheduler';

import { db } from './client';
import { cards, decks, fsrsState, reviewLogs } from './schema';

/* ------------------------------------------------------------------ reads */

/**
 * Decks with their card totals. `nowMs` is passed in (rather than read inside
 * SQL) so callers control when the "due" cut-off is recomputed.
 *
 * Returns the query builder, not the rows — pass it to `useLiveQuery`.
 */
export function decksWithStatsQuery(nowMs: number) {
  return db
    .select({
      id: decks.id,
      name: decks.name,
      description: decks.description,
      createdAt: decks.createdAt,
      cardCount: sql<number>`count(${cards.id})`,
      dueCount: sql<number>`coalesce(sum(case when ${fsrsState.due} <= ${nowMs} then 1 else 0 end), 0)`,
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

export function deckDueCountQuery(deckId: number, nowMs: number) {
  return db
    .select({ dueCount: sql<number>`count(*)` })
    .from(cards)
    .innerJoin(fsrsState, eq(fsrsState.cardId, cards.id))
    .where(and(eq(cards.deckId, deckId), lte(fsrsState.due, new Date(nowMs))));
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
export function loadDueCards(deckId: number, now: Date, limit = 500): DueCardRow[] {
  return db
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
}

export function getDeck(deckId: number) {
  return db.select().from(decks).where(eq(decks.id, deckId)).get();
}

export function getCard(cardId: number) {
  return db.select().from(cards).where(eq(cards.id, cardId)).get();
}

/* -------------------------------------------------------------- mutations */

export function createDeck(name: string, description?: string | null) {
  return db
    .insert(decks)
    .values({ name: name.trim(), description: description?.trim() || null })
    .returning()
    .get();
}

export function updateDeck(deckId: number, patch: { name: string; description?: string | null }) {
  return db
    .update(decks)
    .set({ name: patch.name.trim(), description: patch.description?.trim() || null })
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
