import { and, asc, desc, eq, inArray, lte, ne, sql, type SQLWrapper } from 'drizzle-orm';

import {
  remainingAllowance,
  studyDayStart,
  withinAllowance,
  type Allowance,
} from '@/lib/limits';
import { orderNewBacklog, placeNewCards } from '@/lib/queue-order';
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
import {
  cardFields,
  cards,
  deckFields,
  decks,
  DEFAULT_NEW_CARD_ORDER,
  DEFAULT_NEW_CARD_PLACEMENT,
  fsrsState,
  reviewLogs,
  type CardField,
  type DeckField,
  type FieldSide,
  type NewCardOrder,
  type NewCardPlacement,
} from './schema';

/** The transaction handle drizzle hands to a `db.transaction` callback. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

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

/**
 * The deck's template for new cards, in the order the deck editor arranged it.
 * Nothing here binds an existing card — see `newCardFields`.
 */
export function deckFieldsQuery(deckId: number) {
  return db
    .select()
    .from(deckFields)
    .where(eq(deckFields.deckId, deckId))
    .orderBy(asc(deckFields.position), asc(deckFields.id));
}

export function getDeckFields(deckId: number): DeckField[] {
  return deckFieldsQuery(deckId).all();
}

/** A card's own extra fields, in card order. */
export function getCardFields(cardId: number): CardField[] {
  return db
    .select()
    .from(cardFields)
    .where(eq(cardFields.cardId, cardId))
    .orderBy(asc(cardFields.position), asc(cardFields.id))
    .all();
}

/**
 * The rubrics a new card in this deck starts with — the deck's template, with
 * nothing filled in yet. Only a brand new card ever reads it; from then on the
 * fields are the card's own and the deck has no say over them.
 */
export function newCardFields(deckId: number): CardFieldInput[] {
  return getDeckFields(deckId).map((field) => ({
    id: null,
    name: field.name,
    side: field.side,
    value: '',
  }));
}

/** Every deck a card could be moved into: all of them except the one it is in. */
export function otherDecksQuery(deckId: number) {
  return db
    .select({ id: decks.id, name: decks.name })
    .from(decks)
    .where(ne(decks.id, deckId))
    .orderBy(asc(decks.name));
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

/** One filled-in extra field, ready to render under a card's face. */
export type CardFieldContent = { name: string; side: FieldSide; value: string };

export type DueCardRow = {
  cardId: number;
  front: string;
  back: string;
  imagePath: string | null;
  /** Only used to order the new backlog — see `src/lib/queue-order.ts`. */
  createdAt: Date;
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
  /** The deck's extra fields this card actually filled in, in deck order. */
  fields: CardFieldContent[];
};

/**
 * Snapshot of the cards due right now, trimmed to what the deck's daily limits
 * still allow and ordered the way the deck asks for. Doing all three here means
 * the session queue and the counters on the deck screens can never disagree.
 *
 * The three steps run in this order on purpose: the gather order decides *which*
 * new cards exist for today, the trim cuts them to the allowance, and only then
 * does the placement decide where they sit among the reviews.
 *
 * `limit` is a safety net against a runaway snapshot; it applies in due order,
 * so a deck with more than `limit` cards due at once gathers "newest first"
 * from that window rather than from the whole backlog.
 */
export function loadDueCards(
  deckId: number,
  now: Date,
  limit = 500,
  random: () => number = Math.random
): DueCardRow[] {
  const rows = db
    .select({
      cardId: cards.id,
      front: cards.front,
      back: cards.back,
      imagePath: cards.imagePath,
      createdAt: cards.createdAt,
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

  const deck = getDeck(deckId);
  const gathered = orderNewBacklog(rows, deck?.newCardOrder ?? DEFAULT_NEW_CARD_ORDER, random);
  const allowed = withinAllowance(gathered, deckAllowance(deckId, now));
  const placed = placeNewCards(allowed, deck?.newCardPlacement ?? DEFAULT_NEW_CARD_PLACEMENT);

  return withFieldContent(placed);
}

/**
 * Attaches each card's extra fields to the session snapshot — one read for the
 * whole queue rather than one per card. Fields with nothing in them are left
 * out here, so the review screen never has to test for empties.
 */
function withFieldContent<T extends { cardId: number }>(
  rows: T[]
): (T & { fields: CardFieldContent[] })[] {
  if (rows.length === 0) return [];

  const filled = db
    .select()
    .from(cardFields)
    .where(
      inArray(
        cardFields.cardId,
        rows.map((row) => row.cardId)
      )
    )
    .orderBy(asc(cardFields.position), asc(cardFields.id))
    .all();

  const perCard = new Map<number, CardFieldContent[]>();

  for (const field of filled) {
    if (!field.value.trim()) continue;

    const list = perCard.get(field.cardId) ?? [];
    list.push({ name: field.name, side: field.side, value: field.value });
    perCard.set(field.cardId, list);
  }

  return rows.map((row) => ({ ...row, fields: perCard.get(row.cardId) ?? [] }));
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
  newCardPlacement?: NewCardPlacement;
  newCardOrder?: NewCardOrder;
};

/** The columns a deck form writes, with the queue options defaulted. */
function deckValues(input: DeckInput) {
  return {
    name: input.name.trim(),
    description: input.description?.trim() || null,
    newPerDay: input.newPerDay,
    reviewsPerDay: input.reviewsPerDay,
    newCardPlacement: input.newCardPlacement ?? DEFAULT_NEW_CARD_PLACEMENT,
    newCardOrder: input.newCardOrder ?? DEFAULT_NEW_CARD_ORDER,
  };
}

export function createDeck(input: DeckInput) {
  return db.insert(decks).values(deckValues(input)).returning().get();
}

export function updateDeck(deckId: number, patch: DeckInput) {
  return db.update(decks).set(deckValues(patch)).where(eq(decks.id, deckId)).run();
}

export function deleteDeck(deckId: number) {
  return db.delete(decks).where(eq(decks.id, deckId)).run();
}

/** One row of the deck editor's field list; `id` is null for a new field. */
export type DeckFieldInput = { id: number | null; name: string; side: FieldSide };

/**
 * Makes the deck's field definitions match the list the editor holds: fields
 * dropped from it are deleted (their values go with them, by CASCADE), the rest
 * are inserted or renamed, and `position` is rewritten from the list order.
 * Nameless rows are treated as removed — an empty box is not a field.
 */
export function syncDeckFields(deckId: number, fields: DeckFieldInput[]) {
  return db.transaction((tx) => {
    const named = fields.filter((field) => field.name.trim().length > 0);
    const kept = new Set(named.map((field) => field.id));

    for (const row of tx.select().from(deckFields).where(eq(deckFields.deckId, deckId)).all()) {
      if (!kept.has(row.id)) tx.delete(deckFields).where(eq(deckFields.id, row.id)).run();
    }

    named.forEach((field, position) => {
      const values = { name: field.name.trim(), side: field.side, position };

      if (field.id === null) {
        tx.insert(deckFields).values({ deckId, ...values }).run();
      } else {
        tx.update(deckFields).set(values).where(eq(deckFields.id, field.id)).run();
      }
    });
  });
}

/** One row of the card editor's field list; `id` is null for a new field. */
export type CardFieldInput = { id: number | null; name: string; side: FieldSide; value: string };

/**
 * Makes a card's fields match the list the editor holds — the same shape as
 * `syncDeckFields`: rows dropped from the list are deleted, the rest inserted
 * or updated, and `position` rewritten from the list order. A field with no
 * name counts as removed; an empty *value* is kept, because a rubric waiting to
 * be filled in is still a field the card carries.
 */
function writeCardFields(tx: Tx, cardId: number, fields: CardFieldInput[]) {
  const named = fields.filter((field) => field.name.trim().length > 0);
  const kept = new Set(named.map((field) => field.id));

  for (const row of tx.select().from(cardFields).where(eq(cardFields.cardId, cardId)).all()) {
    if (!kept.has(row.id)) tx.delete(cardFields).where(eq(cardFields.id, row.id)).run();
  }

  named.forEach((field, position) => {
    const values = {
      name: field.name.trim(),
      side: field.side,
      value: field.value.trim(),
      position,
    };

    if (field.id === null) {
      tx.insert(cardFields).values({ cardId, ...values }).run();
    } else {
      tx.update(cardFields).set(values).where(eq(cardFields.id, field.id)).run();
    }
  });
}

export function saveCardFields(cardId: number, fields: CardFieldInput[]) {
  return db.transaction((tx) => writeCardFields(tx, cardId, fields));
}

/** Inserts the card together with its initial (New) FSRS state. */
export function createCard(
  deckId: number,
  front: string,
  back: string,
  now = new Date(),
  fields: CardFieldInput[] = []
) {
  return db.transaction((tx) => {
    const card = tx
      .insert(cards)
      .values({ deckId, front: front.trim(), back: back.trim(), createdAt: now })
      .returning()
      .get();

    tx.insert(fsrsState)
      .values({ cardId: card.id, ...newCardState(now) })
      .run();

    writeCardFields(tx, card.id, fields);

    return card;
  });
}

export function updateCard(
  cardId: number,
  patch: { front: string; back: string; fields?: CardFieldInput[] }
) {
  return db.transaction((tx) => {
    tx.update(cards)
      .set({ front: patch.front.trim(), back: patch.back.trim() })
      .where(eq(cards.id, cardId))
      .run();

    if (patch.fields) writeCardFields(tx, cardId, patch.fields);
  });
}

/**
 * Moves a card to another deck. Only `deck_id` changes: the FSRS state, the
 * review log and the card's own extra fields all hang off the card, so they
 * survive the move untouched.
 *
 * Side effect worth knowing: "done today" is counted by joining `review_logs`
 * through `cards.deck_id`, so today's answers move with the card and count
 * against the target deck's daily allowance. Anki does the same.
 */
export function moveCard(cardId: number, targetDeckId: number) {
  return db.update(cards).set({ deckId: targetDeckId }).where(eq(cards.id, cardId)).run();
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
