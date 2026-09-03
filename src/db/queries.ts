import { and, asc, desc, eq, inArray, lt, lte, ne, or, sql, type SQLWrapper } from 'drizzle-orm';

import { cardPieces, sideLines, type CardLine, type CardPlacement } from '@/lib/card-layout';
import { isMediaKind, type MediaKind } from '@/lib/media';
import { DEFAULT_SCHEDULING, parseWeights, type DeckScheduling } from '@/lib/fsrs-options';
import {
  allLanguages,
  dedupeLanguages,
  languagesJson,
  NO_LANGUAGES,
  parseLanguages,
  type DeckLanguages,
} from '@/lib/languages';
import { type StabilitySample } from '@/lib/fsrs-optimizer';
import { dedupeTags, tagName, tagSlug } from '@/lib/tags';

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
  cardTags,
  deckFieldSlots,
  decks,
  DEFAULT_NEW_CARD_ORDER,
  DEFAULT_NEW_CARD_PLACEMENT,
  fsrsState,
  reviewLogs,
  tags,
  type CardField,
  type DeckFieldSlot,
  type FieldKind,
  type FieldSide,
  type NewCardOrder,
  type NewCardPlacement,
} from './schema';

/** The transaction handle drizzle hands to a `db.transaction` callback. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/* ------------------------------------------------------------------ reads */

/**
 * Where the two mandatory fields ended up. Both the side and the position are
 * free: the question may sit on the back, and a face may hold nothing at all.
 */
export type CardLayout = {
  frontSide: FieldSide;
  frontPosition: number;
  backSide: FieldSide;
  backPosition: number;
};

const DEFAULT_CARD_LAYOUT: CardLayout = {
  frontSide: 'front',
  frontPosition: 0,
  backSide: 'back',
  backPosition: 0,
};

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

/**
 * When a card is on offer.
 *
 * Its time having come is the obvious half. The other half is what Anki calls
 * learning ahead: a card part-way through its **sub-day steps stays in the
 * queue** — answering "za 10 minut" and stepping out of the session must not
 * make the card unreachable for ten minutes, with the deck claiming there is
 * nothing to study. It keeps coming back until an answer finally sends it a day
 * or more out, which is the moment it has actually been learned.
 *
 * `scheduled_days < 1` is what "sub-day" means here, and it is the same number
 * the grading buttons show. New cards match it too, but they are already due by
 * the first half anyway.
 */
function isDue(nowMs: number) {
  return or(lte(fsrsState.due, new Date(nowMs)), lt(fsrsState.scheduledDays, 1));
}

/** The same rule inline, for aggregates that count every card of a deck. */
const DUE_SQL = (nowMs: number) =>
  sql`(${fsrsState.due} <= ${nowMs} or ${fsrsState.scheduledDays} < 1)`;

/** Same buckets, applying the due cut-off inline — for aggregates over every card. */
function dueInStates(nowMs: number, states: State[]) {
  return sql<number>`coalesce(sum(case
    when ${DUE_SQL(nowMs)} and ${fsrsState.state} in (${stateList(states)})
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

/**
 * Every extra field of one card, glued into a single string for the search.
 * Cards in a deck may carry different numbers of fields, so this collapses the
 * lot rather than adding columns nobody can name in advance.
 *
 * The inner column is written as literal text on purpose — see pitfall 7 in
 * CONTEXT.md: drizzle drops the table qualifier from an embedded column
 * depending on the shape of the outer query.
 */
const fieldText = sql<string>`(
  select coalesce(group_concat(cfs.value, ' '), '')
  from ${cardFields} as cfs
  where cfs.card_id = ${cards.id})`;

/**
 * How many extra fields a card carries — one of the orders the card list can be
 * sorted by. The two mandatory fields are not counted: every card has both, so
 * they would shift each number by two and change nothing about the ordering.
 *
 * Written the same way as `fieldText`, and for the same reason — see pitfall 7.
 */
const fieldCount = sql<number>`(
  select count(*)
  from ${cardFields} as cfn
  where cfn.card_id = ${cards.id})`;

/**
 * The tag ids of one card, glued together for the deck list's tag filter. Same
 * shape — and same literal-text discipline — as `fieldText`; see pitfall 7.
 */
const tagIds = sql<string>`(
  select coalesce(group_concat(ctg.tag_id, ','), '')
  from ${cardTags} as ctg
  where ctg.card_id = ${cards.id})`;

export function cardsInDeckQuery(deckId: number) {
  return db
    .select({
      id: cards.id,
      front: cards.front,
      back: cards.back,
      /** Only the search reads this; the list itself shows front and back. */
      fields: fieldText,
      /** Only the sort reads this. */
      fieldCount,
      /** Only the tag filter reads this. */
      tagIds,
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
    .where(and(eq(cards.deckId, deckId), isDue(nowMs)));
}

/**
 * One card's two faces, laid out the same way the session lays out a whole
 * queue. The review screen re-reads a card through this after the editor has
 * been open on it.
 */
export function getCardLines(cardId: number): { front: CardLine[]; back: CardLine[] } | null {
  const card = getCard(cardId);
  if (!card) return null;

  const pieces = cardPieces(card, getCardFields(cardId));

  return { front: sideLines(pieces, 'front'), back: sideLines(pieces, 'back') };
}

/**
 * The faces of several cards at once, in the order the ids were given — what
 * the preview of a hand-picked selection walks through. Reads nothing but the
 * cards: a preview never touches the schedule.
 */
export function cardsLines(
  cardIds: number[]
): { cardId: number; front: CardLine[]; back: CardLine[] }[] {
  if (cardIds.length === 0) return [];

  const rows = db
    .select({
      cardId: cards.id,
      front: cards.front,
      back: cards.back,
      frontSide: cards.frontSide,
      frontPosition: cards.frontPosition,
      backSide: cards.backSide,
      backPosition: cards.backPosition,
    })
    .from(cards)
    .where(inArray(cards.id, cardIds))
    .all();

  const laidOut = new Map(withCardLines(rows).map((row) => [row.cardId, row]));

  return cardIds.flatMap((cardId) => {
    const row = laidOut.get(cardId);
    // A card deleted between picking and previewing simply drops out.
    return row ? [{ cardId, front: row.frontLines, back: row.backLines }] : [];
  });
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
 * Where a new card in this deck puts its two mandatory fields. Only a brand new
 * card ever reads this; from then on the layout is the card's own and the deck
 * has no say over it.
 */
export function newCardLayout(deckId: number): CardLayout {
  const deck = getDeck(deckId);
  if (!deck) return DEFAULT_CARD_LAYOUT;

  return {
    frontSide: deck.newFrontSide,
    frontPosition: deck.newFrontPosition,
    backSide: deck.newBackSide,
    backPosition: deck.newBackPosition,
  };
}

/**
 * The empty extra fields a new card starts with. Each slot carries its own side,
 * position and kind, because a text box and an audio slot are not the same
 * thing — a card cannot swap one for the other after the fact.
 */
export function newCardFields(deckId: number): CardFieldInput[] {
  return getDeckSlots(deckId).map((slot) => ({
    id: null,
    side: slot.side,
    position: slot.position,
    kind: slot.kind,
    value: '',
    mediaPath: null,
  }));
}

/** The deck's empty slots, in the order the deck editor arranged them. */
export function getDeckSlots(deckId: number): DeckFieldSlot[] {
  return db
    .select()
    .from(deckFieldSlots)
    .where(eq(deckFieldSlots.deckId, deckId))
    .orderBy(asc(deckFieldSlots.position), asc(deckFieldSlots.id))
    .all();
}

/** One row of the deck editor's list; slots hold no content, only a shape. */
export type DeckSlotInput = { side: FieldSide; position: number; kind: FieldKind };

/**
 * Replaces the deck's slots with the list the editor holds. They carry nothing
 * worth preserving, so this is a delete-and-insert rather than a diff.
 */
export function syncDeckSlots(deckId: number, slots: DeckSlotInput[]) {
  return db.transaction((tx) => {
    tx.delete(deckFieldSlots).where(eq(deckFieldSlots.deckId, deckId)).run();

    for (const slot of slots) {
      tx.insert(deckFieldSlots).values({ deckId, ...slot }).run();
    }
  });
}

/** One stored file, with the kind that says which directory it lives in. */
export type MediaFile = { kind: MediaKind; fileName: string };

function toMediaFiles(rows: { kind: FieldKind; mediaPath: string | null }[]): MediaFile[] {
  return rows
    .filter((row) => isMediaKind(row.kind) && Boolean(row.mediaPath))
    .map((row) => ({ kind: row.kind as MediaKind, fileName: row.mediaPath as string }));
}

/**
 * The files one card points at. Copies live in the app's own directory, not in
 * the database, so whatever deletes a card or a field has to clear them
 * separately — see `deleteMedia` in `src/lib/media-files.ts`.
 */
export function cardMediaFiles(cardId: number): MediaFile[] {
  return toMediaFiles(
    db
      .select({ kind: cardFields.kind, mediaPath: cardFields.mediaPath })
      .from(cardFields)
      .where(eq(cardFields.cardId, cardId))
      .all()
  );
}

/** The same, for every card in a deck — a deck delete cascades through them. */
export function deckMediaFiles(deckId: number): MediaFile[] {
  return toMediaFiles(
    db
      .select({ kind: cardFields.kind, mediaPath: cardFields.mediaPath })
      .from(cardFields)
      .innerJoin(cards, eq(cards.id, cardFields.cardId))
      .where(eq(cards.deckId, deckId))
      .all()
  );
}

/**
 * The same, for a set of cards — what a bulk delete has to clear afterwards.
 * One query rather than one per card, because a selection can be the whole deck.
 */
export function cardsMediaFiles(cardIds: number[]): MediaFile[] {
  if (cardIds.length === 0) return [];

  return toMediaFiles(
    db
      .select({ kind: cardFields.kind, mediaPath: cardFields.mediaPath })
      .from(cardFields)
      .where(inArray(cardFields.cardId, cardIds))
      .all()
  );
}

/** Every tag ever created, for the picker in the card editor. */
export function allTagsQuery() {
  return db.select().from(tags).orderBy(asc(tags.name));
}

/**
 * The tags actually used in one deck, with how many of its cards carry each —
 * what the deck list offers to filter by. A tag used only in another deck would
 * filter this list down to nothing, so it is not offered here.
 */
export function deckTagsQuery(deckId: number) {
  return db
    .select({
      id: tags.id,
      name: tags.name,
      cardCount: sql<number>`count(${cardTags.cardId})`,
    })
    .from(tags)
    .innerJoin(cardTags, eq(cardTags.tagId, tags.id))
    .innerJoin(cards, eq(cards.id, cardTags.cardId))
    .where(eq(cards.deckId, deckId))
    .groupBy(tags.id)
    .orderBy(asc(tags.name));
}

/** The tags on one card, in the order they are shown. */
export function getCardTagNames(cardId: number): string[] {
  return db
    .select({ name: tags.name })
    .from(cardTags)
    .innerJoin(tags, eq(tags.id, cardTags.tagId))
    .where(eq(cardTags.cardId, cardId))
    .orderBy(asc(tags.name))
    .all()
    .map((row) => row.name);
}

/**
 * Makes a card's tags match the list the editor holds, creating whatever does
 * not exist yet. The editor works in **names**, not ids: a tag typed into it
 * may not have a row until the card is saved, and resolving that here is what
 * keeps a tag from being created for a card that is then abandoned.
 *
 * Tags left on no card at all are deleted. Every tag is born attached to a
 * card, so one that has just lost its last card is a typo or a change of mind,
 * not a category waiting to be used.
 */
export function setCardTagNames(cardId: number, names: string[]) {
  return db.transaction((tx) => {
    tx.delete(cardTags).where(eq(cardTags.cardId, cardId)).run();

    for (const name of dedupeTags(names)) {
      const slug = tagSlug(name);
      const existing = tx.select().from(tags).where(eq(tags.slug, slug)).get();

      const tag =
        existing ??
        tx.insert(tags).values({ name: tagName(name), slug }).returning().get();

      tx.insert(cardTags).values({ cardId, tagId: tag.id }).run();
    }

    pruneTags(tx);
  });
}

/** Drops tags nothing points at any more. */
function pruneTags(tx: Tx) {
  const used = tx.selectDistinct({ tagId: cardTags.tagId }).from(cardTags).all();
  const keep = new Set(used.map((row) => row.tagId));

  for (const tag of tx.select({ id: tags.id }).from(tags).all()) {
    if (!keep.has(tag.id)) tx.delete(tags).where(eq(tags.id, tag.id)).run();
  }
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
  /** The two faces as the review screen shows them, in the card's own order. */
  frontLines: CardLine[];
  backLines: CardLine[];
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
      frontSide: cards.frontSide,
      frontPosition: cards.frontPosition,
      backSide: cards.backSide,
      backPosition: cards.backPosition,
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
    .where(and(eq(cards.deckId, deckId), isDue(now.getTime())))
    .orderBy(asc(fsrsState.due))
    .limit(limit)
    .all();

  const deck = getDeck(deckId);
  const gathered = orderNewBacklog(rows, deck?.newCardOrder ?? DEFAULT_NEW_CARD_ORDER, random);
  const allowed = withinAllowance(gathered, deckAllowance(deckId, now));
  const placed = placeNewCards(allowed, deck?.newCardPlacement ?? DEFAULT_NEW_CARD_PLACEMENT);

  return withCardLines(placed);
}

/** Everything `withCardLines` needs from a card row to lay its faces out. */
type LayoutSource = CardPlacement & { cardId: number };

/**
 * Turns each card into the two ordered faces the review screen renders — one
 * read for the whole queue rather than one per card. The merge itself lives in
 * `src/lib/card-layout.ts`, so the editor and the session cannot disagree about
 * what order a card reads in.
 */
function withCardLines<T extends LayoutSource>(
  rows: T[]
): (T & { frontLines: CardLine[]; backLines: CardLine[] })[] {
  if (rows.length === 0) return [];

  const extras = db
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

  return rows.map((row) => {
    const pieces = cardPieces(
      row,
      extras.filter((field) => field.cardId === row.cardId)
    );

    return {
      ...row,
      frontLines: sideLines(pieces, 'front'),
      backLines: sideLines(pieces, 'back'),
    };
  });
}

/**
 * The columns a deck's scheduling is stored in. Named once so a query that
 * needs them cannot quietly ask for a subset — leaving `fsrs_weights` out of
 * the read in `gradeCard` is exactly what made the grading buttons promise an
 * interval the answer then did not write.
 */
const SCHEDULING_COLUMNS = {
  desiredRetention: decks.desiredRetention,
  maximumInterval: decks.maximumInterval,
  learningSteps: decks.learningSteps,
  relearningSteps: decks.relearningSteps,
  fsrsWeights: decks.fsrsWeights,
};

/** Those columns as the scheduler wants them — one mapping, every reader. */
function toScheduling(row: {
  desiredRetention: number;
  maximumInterval: number;
  learningSteps: string;
  relearningSteps: string;
  fsrsWeights: string | null;
}): DeckScheduling {
  return {
    desiredRetention: row.desiredRetention,
    maximumInterval: row.maximumInterval,
    learningSteps: row.learningSteps,
    relearningSteps: row.relearningSteps,
    weights: parseWeights(row.fsrsWeights),
  };
}

/** What the deck tells FSRS — read once per session for the interval preview. */
export function deckScheduling(deckId: number): DeckScheduling {
  const deck = getDeck(deckId);
  if (!deck) return DEFAULT_SCHEDULING;

  return toScheduling(deck);
}

/** Those two columns as a pair — one mapping, every reader. */
function toLanguages(row: {
  frontLanguages: string | null;
  backLanguages: string | null;
}): DeckLanguages {
  return {
    front: parseLanguages(row.frontLanguages),
    back: parseLanguages(row.backLanguages),
  };
}

/**
 * What languages a deck declares for its question and answer.
 *
 * Nothing schedules or validates on this — it is here for whatever needs to
 * know what it is reading, the first of those being picture generation from
 * the likeness between a card's two texts.
 */
export function deckLanguages(deckId: number): DeckLanguages {
  const deck = getDeck(deckId);
  if (!deck) return NO_LANGUAGES;

  return toLanguages(deck);
}

/**
 * Every language any deck already names, so one can be reused rather than
 * retyped — the same courtesy tags get, without a table of their own: a
 * language is only ever a name, so the deck rows already hold the whole set.
 */
export function usedLanguages(): string[] {
  const rows = db
    .select({ frontLanguages: decks.frontLanguages, backLanguages: decks.backLanguages })
    .from(decks)
    .all();

  return dedupeLanguages(rows.flatMap((row) => allLanguages(toLanguages(row))));
}

/**
 * What the optimiser learns from: one row per card that finished a first study
 * day and came back on a later one.
 *
 * Read whole rather than aggregated in SQL — the grouping is by **study day**
 * (which starts at 4:00, not midnight) and by what a card's first day *ended*
 * on, neither of which SQLite knows about. A deck's history is thousands of
 * rows at most, and this runs when a button is pressed, not on every render.
 */
export function stabilitySamples(deckId: number, dayStart: (now: Date) => Date): StabilitySample[] {
  const rows = db
    .select({
      cardId: reviewLogs.cardId,
      rating: reviewLogs.rating,
      reviewedAt: reviewLogs.reviewedAt,
    })
    .from(reviewLogs)
    .innerJoin(cards, eq(cards.id, reviewLogs.cardId))
    .where(eq(cards.deckId, deckId))
    .orderBy(asc(reviewLogs.cardId), asc(reviewLogs.reviewedAt))
    .all();

  const byCard = new Map<number, typeof rows>();
  for (const row of rows) {
    const own = byCard.get(row.cardId);
    if (own) own.push(row);
    else byCard.set(row.cardId, [row]);
  }

  const samples: StabilitySample[] = [];

  for (const history of byCard.values()) {
    const firstDay = dayStart(history[0].reviewedAt).getTime();

    // Where the card's first study day ends and the next review begins.
    const next = history.findIndex((row) => dayStart(row.reviewedAt).getTime() !== firstDay);
    if (next < 1) continue;

    const last = history[next - 1];
    const after = history[next];
    const deltaDays = Math.round(
      (dayStart(after.reviewedAt).getTime() - firstDay) / (24 * 60 * 60 * 1000)
    );

    if (deltaDays < 1) continue;

    samples.push({
      rating: last.rating as StabilitySample['rating'],
      deltaDays,
      recalled: after.rating !== 1,
    });
  }

  return samples;
}

/** How fitted weights are stored: JSON, or nothing at all for the defaults. */
function weightsJson(weights: number[] | null | undefined): string | null {
  return weights && weights.length > 0 ? JSON.stringify(weights) : null;
}

/** Stores fitted weights, or clears them back to the FSRS defaults. */
export function setDeckWeights(deckId: number, weights: number[] | null) {
  return db
    .update(decks)
    .set({ fsrsWeights: weightsJson(weights) })
    .where(eq(decks.id, deckId))
    .run();
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
  scheduling?: DeckScheduling;
  /** What the question and the answer are written in. Declarative only. */
  languages?: DeckLanguages;
  /** The layout every new card in this deck starts from. */
  newCardLayout?: CardLayout;
};

/** The columns a deck form writes, with the queue options defaulted. */
function deckValues(input: DeckInput) {
  const scheduling = input.scheduling ?? DEFAULT_SCHEDULING;
  const layout = input.newCardLayout ?? DEFAULT_CARD_LAYOUT;
  const languages = input.languages ?? NO_LANGUAGES;

  return {
    name: input.name.trim(),
    description: input.description?.trim() || null,
    newPerDay: input.newPerDay,
    reviewsPerDay: input.reviewsPerDay,
    newCardPlacement: input.newCardPlacement ?? DEFAULT_NEW_CARD_PLACEMENT,
    newCardOrder: input.newCardOrder ?? DEFAULT_NEW_CARD_ORDER,
    desiredRetention: scheduling.desiredRetention,
    maximumInterval: scheduling.maximumInterval,
    learningSteps: scheduling.learningSteps,
    relearningSteps: scheduling.relearningSteps,
    // Written column by column rather than spread: `weights` is not a column
    // (the deck holds them as JSON in `fsrs_weights`), and drizzle silently
    // ignores a key that names no column — which is how a whole optimiser run
    // used to vanish on save, with neither `tsc` nor a test noticing.
    fsrsWeights: weightsJson(scheduling.weights),
    newFrontSide: layout.frontSide,
    newFrontPosition: layout.frontPosition,
    newBackSide: layout.backSide,
    newBackPosition: layout.backPosition,
    // Named columns again, for the reason spelled out above `fsrsWeights`:
    // `front` and `back` are not column names, and a spread would drop them
    // in silence.
    frontLanguages: languagesJson(languages.front),
    backLanguages: languagesJson(languages.back),
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

/**
 * One row of the card editor's field list; `id` is null for a new field.
 * `position` is the field's place within its own side, counted together with
 * the mandatory field — the editor works that out, because it is the only place
 * that knows the order the user arranged.
 */
export type CardFieldInput = {
  id: number | null;
  side: FieldSide;
  position: number;
  /** Typed text, or one attached file — see `src/lib/media-files.ts`. */
  kind: FieldKind;
  value: string;
  mediaPath: string | null;
};

/**
 * Makes a card's fields match the list the editor holds: rows dropped from it
 * are deleted, the rest inserted or updated, and `position` rewritten from the
 * list order.
 *
 * An empty field is **kept**. It exists on the card, holds its place in the
 * order and simply contributes nothing during review — `sideLines` filters it
 * out there. Removing a field is an explicit action in the editor, never a side
 * effect of clearing its text.
 */
function writeCardFields(tx: Tx, cardId: number, fields: CardFieldInput[]) {
  const kept = new Set(fields.map((field) => field.id));

  for (const row of tx.select().from(cardFields).where(eq(cardFields.cardId, cardId)).all()) {
    if (!kept.has(row.id)) tx.delete(cardFields).where(eq(cardFields.id, row.id)).run();
  }

  for (const field of fields) {
    const values = {
      side: field.side,
      position: field.position,
      kind: field.kind,
      value: field.value.trim(),
      mediaPath: field.mediaPath,
    };

    if (field.id === null) {
      tx.insert(cardFields).values({ cardId, ...values }).run();
    } else {
      tx.update(cardFields).set(values).where(eq(cardFields.id, field.id)).run();
    }
  }
}

export function saveCardFields(cardId: number, fields: CardFieldInput[], layout?: CardLayout) {
  return db.transaction((tx) => {
    if (layout) tx.update(cards).set(layout).where(eq(cards.id, cardId)).run();
    writeCardFields(tx, cardId, fields);
  });
}

/** Inserts the card together with its initial (New) FSRS state. */
export function createCard(
  deckId: number,
  front: string,
  back: string,
  now = new Date(),
  fields: CardFieldInput[] = [],
  layout: CardLayout = DEFAULT_CARD_LAYOUT
) {
  return db.transaction((tx) => {
    const card = tx
      .insert(cards)
      .values({
        deckId,
        front: front.trim(),
        back: back.trim(),
        createdAt: now,
        ...layout,
      })
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
  patch: { front: string; back: string; fields?: CardFieldInput[]; layout?: CardLayout }
) {
  return db.transaction((tx) => {
    tx.update(cards)
      .set({
        front: patch.front.trim(),
        back: patch.back.trim(),
        ...(patch.layout ?? {}),
      })
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
export function moveCards(cardIds: number[], targetDeckId: number) {
  if (cardIds.length === 0) return;

  return db.update(cards).set({ deckId: targetDeckId }).where(inArray(cards.id, cardIds)).run();
}

/**
 * How a copied card's files are duplicated. Passed in rather than imported,
 * because the copying itself needs the file system and this module must stay
 * runnable in the tests, which have none — the real one is `duplicateMedia`
 * in `src/lib/media-files.ts`.
 */
export type MediaCopier = (kind: MediaKind, fileName: string) => string;

/**
 * Copies whole cards into a deck — the one they are already in included, which
 * is how a card gets duplicated for editing into a variant.
 *
 * A copy is a **new card**: same content, same layout, same fields, but its own
 * files, a fresh (New) schedule and no history. Nothing about the original
 * changes. Returns the new ids, in the order the originals were given.
 *
 * Each attached file is duplicated rather than shared. Two cards pointing at
 * one file would look right until either was deleted, and `deleteMedia` would
 * then clear the file out from under the other one.
 */
export function copyCards(
  cardIds: number[],
  targetDeckId: number,
  copyMedia: MediaCopier,
  now = new Date()
): number[] {
  if (cardIds.length === 0) return [];

  return db.transaction((tx) => {
    const made: number[] = [];

    for (const cardId of cardIds) {
      const source = tx.select().from(cards).where(eq(cards.id, cardId)).get();
      if (!source) continue;

      const fields = tx
        .select()
        .from(cardFields)
        .where(eq(cardFields.cardId, cardId))
        .orderBy(asc(cardFields.position), asc(cardFields.id))
        .all();

      // The AI-image columns are left at their defaults on purpose: nothing
      // writes them yet, and `image_path` would be a second shared file.
      const copy = tx
        .insert(cards)
        .values({
          deckId: targetDeckId,
          front: source.front,
          back: source.back,
          frontSide: source.frontSide,
          frontPosition: source.frontPosition,
          backSide: source.backSide,
          backPosition: source.backPosition,
          createdAt: now,
        })
        .returning()
        .get();

      tx.insert(fsrsState)
        .values({ cardId: copy.id, ...newCardState(now) })
        .run();

      for (const field of fields) {
        tx.insert(cardFields)
          .values({
            cardId: copy.id,
            side: field.side,
            position: field.position,
            kind: field.kind,
            value: field.value,
            mediaPath:
              isMediaKind(field.kind) && field.mediaPath
                ? copyMedia(field.kind, field.mediaPath)
                : null,
          })
          .run();
      }

      made.push(copy.id);
    }

    return made;
  });
}

/**
 * Deletes a whole selection in one transaction — all of it or none. The files
 * are not rows, so the caller clears them separately; `cardsMediaFiles` has to
 * be read **before** this runs, while the rows still exist.
 */
export function deleteCards(cardIds: number[]) {
  if (cardIds.length === 0) return;

  return db.transaction((tx) => {
    tx.delete(cards).where(inArray(cards.id, cardIds)).run();
  });
}

export function deleteCard(cardId: number) {
  return db.delete(cards).where(eq(cards.id, cardId)).run();
}

/** Resets a card back to New without deleting its review history. */
/**
 * Back to square one: the schedule is replaced with a fresh New state. The
 * review log is deliberately left alone — the card starts over, but what
 * actually happened to it stays on the record.
 */
export function resetCards(cardIds: number[], now = new Date()) {
  if (cardIds.length === 0) return;

  return db
    .update(fsrsState)
    .set(newCardState(now))
    .where(inArray(fsrsState.cardId, cardIds))
    .run();
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

    // Read here rather than passed in: the caller would have to carry it
    // through the whole session, and a deck edited mid-session would be stale.
    // The whole set of columns, never a hand-picked subset — the review screen
    // previews with all of them, and an answer that committed with fewer would
    // write an interval the button never showed.
    const deck = tx
      .select(SCHEDULING_COLUMNS)
      .from(cards)
      .innerJoin(decks, eq(decks.id, cards.deckId))
      .where(eq(cards.id, cardId))
      .get();

    const { card: next, log } = applyGrade(
      toFsrsCard(row),
      grade,
      now,
      deck ? toScheduling(deck) : undefined
    );

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
