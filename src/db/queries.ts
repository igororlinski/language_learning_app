import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQLWrapper,
} from 'drizzle-orm';

import { cardPieces, sideLines, type CardLine, type CardPlacement } from '@/lib/card-layout';
import { isMediaKind, type MediaKind } from '@/lib/media';
import { parseTemperature, type TextTemperatures } from '@/lib/ai-prompts';
import { parseTextSource, type TextSource } from '@/lib/ai-transport';
import type { UsageMetric } from '@/lib/ai-usage';
import { DEFAULT_SCHEDULING, parseWeights, type DeckScheduling } from '@/lib/fsrs-options';
import {
  languageJson,
  languagesJson,
  NO_LANGUAGES,
  parseLanguage,
  parseLanguages,
  type DeckLanguages,
} from '@/lib/languages';
import { type StabilitySample } from '@/lib/fsrs-optimizer';
import { dedupeTags, tagName, tagSlug } from '@/lib/tags';
import {
  DECK_FORMAT,
  DECK_VERSION,
  type DeckPackage,
  type PackageCard,
  type PackageReview,
  type PackageTemplate,
} from '@/lib/deck-package';
import type { CsvCard } from '@/lib/csv-import';
import { dayKey, parseDailyGoal } from '@/lib/goals';
import { dayProgress, newlyEarned, type BadgeProgress } from '@/lib/badges';
import { MATURE_DAYS } from '@/lib/stats';

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
  type FsrsCard,
  type Grade,
} from '@/lib/scheduler';

import { db } from './client';
import {
  aiUsage,
  appSettings,
  badges,
  cardFields,
  cards,
  cardTags,
  cardTemplates,
  deckFieldSlots,
  decks,
  DEFAULT_NEW_CARD_ORDER,
  DEFAULT_NEW_CARD_PLACEMENT,
  DEFAULT_PICTURE_QUALITY,
  fsrsState,
  reviewLogs,
  studyDays,
  tags,
  type CardField,
  type CardTemplate,
  type DeckFieldSlot,
  type FieldKind,
  type FsrsStateRow,
  type ReviewLog,
  type FieldSide,
  type NewCardOrder,
  type NewCardPlacement,
  type PictureQuality,
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

/**
 * Whether the two mandatory fields are read out loud, and in which language.
 *
 * Kept apart from `CardLayout` because that type does double duty as the shape
 * of a **deck's** default layout, and a deck has nothing to say about this: it
 * arranges empty fields for future cards, and there is no text there yet to be
 * read.
 */
export type CardSpeech = { frontSpeech: string | null; backSpeech: string | null };

const NO_SPEECH: CardSpeech = { frontSpeech: null, backSpeech: null };

/**
 * How the two mandatory fields are pronounced, in IPA, or null for none. Apart
 * from `CardSpeech` because they are made and dropped separately: a card can
 * be read aloud with no transcription under it, and the other way round.
 */
export type CardPhonetic = { frontPhonetic: string | null; backPhonetic: string | null };

const NO_PHONETIC: CardPhonetic = { frontPhonetic: null, backPhonetic: null };

/**
 * Which language a new card's two mandatory fields are transcribed in when it
 * is saved — the deck's template, not anything stored on a card.
 */
export type PhoneticLanguages = { front: string | null; back: string | null };

const NO_PHONETIC_LANGUAGES: PhoneticLanguages = { front: null, back: null };

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
      frontSpeech: cards.frontSpeech,
      backSpeech: cards.backSpeech,
      frontPhonetic: cards.frontPhonetic,
      backPhonetic: cards.backPhonetic,
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

/* -------------------------------------------------------------- templates */

/**
 * The ways a new card in this deck can start, in the deck editor's order — the
 * first one is the default. Every deck has at least one: `createDeck` makes it,
 * and migration 0022 made one for every deck there was.
 */
export function deckTemplates(deckId: number): CardTemplate[] {
  return db
    .select()
    .from(cardTemplates)
    .where(eq(cardTemplates.deckId, deckId))
    .orderBy(asc(cardTemplates.position), asc(cardTemplates.id))
    .all();
}

/**
 * The template a new card starts from: the one asked for, or the deck's first.
 * Undefined only for a deck that does not exist.
 */
function resolveTemplate(deckId: number, templateId?: number | null): CardTemplate | undefined {
  if (templateId != null) {
    const asked = db.select().from(cardTemplates).where(eq(cardTemplates.id, templateId)).get();

    if (asked) return asked;
  }

  return deckTemplates(deckId)[0];
}

/**
 * Where a new card puts its two mandatory fields. Only a brand new card ever
 * reads this; from then on the layout is the card's own and neither the deck
 * nor the template has any say over it.
 */
export function newCardLayout(deckId: number, templateId?: number | null): CardLayout {
  const template = resolveTemplate(deckId, templateId);
  if (!template) return DEFAULT_CARD_LAYOUT;

  return {
    frontSide: template.frontSide,
    frontPosition: template.frontPosition,
    backSide: template.backSide,
    backPosition: template.backPosition,
  };
}

/**
 * The empty extra fields a new card starts with. Each slot carries its own side,
 * position and kind, because a text box and an audio slot are not the same
 * thing — a card cannot swap one for the other after the fact.
 *
 * A slot holds no text, but it can still hold a **voice**: "every card in this
 * deck reads its example sentence in Portuguese" is a property of the deck, and
 * setting it on each card by hand is a chore nobody keeps up. The language
 * travels; the words arrive later.
 */
export function newCardFields(deckId: number, templateId?: number | null): CardFieldInput[] {
  return getDeckSlots(deckId, templateId).map((slot) => ({
    id: null,
    side: slot.side,
    position: slot.position,
    kind: slot.kind,
    value: '',
    mediaPath: null,
    mnemonic: null,
    speech: slot.speech,
    phonetic: null,
    phoneticLanguage: slot.phoneticLanguage,
  }));
}

/**
 * What a new card's two mandatory fields start out reading aloud in.
 *
 * Kept apart from `newCardLayout` for the reason `CardSpeech` is kept apart
 * from `CardLayout`: that one is read by the deck editor as the shape of a
 * **template**, and this is not part of a shape. Only a brand new card reads
 * either; from then on both belong to the card.
 */
export function newCardSpeech(deckId: number, templateId?: number | null): CardSpeech {
  const template = resolveTemplate(deckId, templateId);

  if (!template) return NO_SPEECH;

  return { frontSpeech: template.frontSpeech, backSpeech: template.backSpeech };
}

/** Which language a new card's mandatory fields are transcribed in, if any. */
export function newCardPhoneticLanguages(
  deckId: number,
  templateId?: number | null
): PhoneticLanguages {
  const template = resolveTemplate(deckId, templateId);

  if (!template) return NO_PHONETIC_LANGUAGES;

  return { front: template.frontPhoneticLanguage, back: template.backPhoneticLanguage };
}

/** A template's empty slots, in the order the deck editor arranged them. */
export function getDeckSlots(deckId: number, templateId?: number | null): DeckFieldSlot[] {
  const template = resolveTemplate(deckId, templateId);

  if (!template) return [];

  return db
    .select()
    .from(deckFieldSlots)
    .where(eq(deckFieldSlots.templateId, template.id))
    .orderBy(asc(deckFieldSlots.position), asc(deckFieldSlots.id))
    .all();
}

/**
 * One row of the deck editor's list. Slots hold no content, only a shape — and
 * a voice, which is a property of the deck rather than of any text: see
 * `newCardFields`.
 */
export type DeckSlotInput = {
  side: FieldSide;
  position: number;
  kind: FieldKind;
  speech: string | null;
  phoneticLanguage?: string | null;
};

/** Everything one template holds, as the deck editor hands it over. */
export type TemplateInput = {
  name: string;
  layout: CardLayout;
  speech: CardSpeech;
  phoneticLanguages: PhoneticLanguages;
  slots: DeckSlotInput[];
};

/** The name a deck's first template gets when nobody has named it. */
export const DEFAULT_TEMPLATE_NAME = 'Podstawowy';

/** A template's own columns, named one by one — pitfall 11. */
function templateValues(input: Omit<TemplateInput, 'name' | 'slots'>) {
  return {
    frontSide: input.layout.frontSide,
    frontPosition: input.layout.frontPosition,
    backSide: input.layout.backSide,
    backPosition: input.layout.backPosition,
    frontSpeech: input.speech.frontSpeech,
    backSpeech: input.speech.backSpeech,
    frontPhoneticLanguage: input.phoneticLanguages.front,
    backPhoneticLanguage: input.phoneticLanguages.back,
  };
}

function insertSlots(tx: Tx, deckId: number, templateId: number, slots: DeckSlotInput[]) {
  for (const slot of slots) {
    tx.insert(deckFieldSlots)
      .values({
        deckId,
        templateId,
        side: slot.side,
        position: slot.position,
        kind: slot.kind,
        speech: slot.speech,
        phoneticLanguage: slot.phoneticLanguage ?? null,
      })
      .run();
  }
}

/**
 * Replaces a deck's templates with the list the deck editor holds, slots and
 * all. Delete-and-insert rather than a diff, for the reason the slots always
 * were: nothing points at a template — a card remembers none — so there is
 * nothing an id has to survive for.
 *
 * A deck is never left without one: an empty list writes the default.
 */
export function syncDeckTemplates(deckId: number, templates: TemplateInput[]) {
  const list: TemplateInput[] =
    templates.length > 0
      ? templates
      : [
          {
            name: DEFAULT_TEMPLATE_NAME,
            layout: DEFAULT_CARD_LAYOUT,
            speech: NO_SPEECH,
            phoneticLanguages: NO_PHONETIC_LANGUAGES,
            slots: [],
          },
        ];

  return db.transaction((tx) => {
    // The slots go with their templates (ON DELETE CASCADE).
    tx.delete(cardTemplates).where(eq(cardTemplates.deckId, deckId)).run();

    list.forEach((template, position) => {
      const row = tx
        .insert(cardTemplates)
        .values({
          deckId,
          name: template.name.trim() || DEFAULT_TEMPLATE_NAME,
          position,
          ...templateValues(template),
        })
        .returning()
        .get();

      insertSlots(tx, deckId, row.id, template.slots);
    });
  });
}

/**
 * Replaces one template's slots — the deck's first, unless another is named.
 * What the deck editor did before a deck could have several, and still the
 * shortest way to set up a deck with one.
 */
export function syncDeckSlots(deckId: number, slots: DeckSlotInput[], templateId?: number | null) {
  const template = resolveTemplate(deckId, templateId);

  if (!template) return;

  return db.transaction((tx) => {
    tx.delete(deckFieldSlots).where(eq(deckFieldSlots.templateId, template.id)).run();
    insertSlots(tx, deckId, template.id, slots);
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

/* ------------------------------------------------------------- app settings */

const TEXT_PROVIDER_KEY = 'ai.text-provider';
const LMSTUDIO_MODEL_KEY = 'ai.lmstudio-model';

/** Every app-wide setting, for `useLiveQuery` on the settings screen. */
export function appSettingsQuery() {
  return db.select().from(appSettings);
}

/** Who writes associations and transcriptions, out of the settings rows. */
export function textSourceFrom(rows: readonly { key: string; value: string }[]): TextSource {
  const value = (key: string) => rows.find((row) => row.key === key)?.value;

  return parseTextSource(value(TEXT_PROVIDER_KEY), value(LMSTUDIO_MODEL_KEY));
}

/**
 * The same, read at the moment of asking. The card editor calls this right
 * before each request rather than holding a copy, so a change made on the
 * settings screen applies to the very next one.
 */
export function getTextSource(): TextSource {
  return textSourceFrom(appSettingsQuery().all());
}

/**
 * Stores the choice. A model is kept only alongside LM Studio, and an empty one
 * is a missing row rather than an empty string — one way to say "none".
 */
export function setTextSource(source: TextSource): void {
  const upsert = (key: string, value: string) =>
    db
      .insert(appSettings)
      .values({ key, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value } })
      .run();

  db.transaction(() => {
    upsert(TEXT_PROVIDER_KEY, source.provider);

    const model = source.provider === 'lmstudio' ? source.model?.trim() : '';

    if (model) upsert(LMSTUDIO_MODEL_KEY, model);
    else db.delete(appSettings).where(eq(appSettings.key, LMSTUDIO_MODEL_KEY)).run();
  });
}

const TEMPERATURE_KEYS: Record<keyof TextTemperatures, string> = {
  mnemonic: 'ai.temperature.mnemonic',
  phonetic: 'ai.temperature.phonetic',
};

/** The temperatures the user set, out of the settings rows; null is the default. */
export function textTemperaturesFrom(
  rows: readonly { key: string; value: string }[]
): TextTemperatures {
  const value = (key: string) => rows.find((row) => row.key === key)?.value;

  return {
    mnemonic: parseTemperature(value(TEMPERATURE_KEYS.mnemonic)),
    phonetic: parseTemperature(value(TEMPERATURE_KEYS.phonetic)),
  };
}

/** The same, read at the moment of asking. */
export function getTextTemperatures(): TextTemperatures {
  return textTemperaturesFrom(appSettingsQuery().all());
}

/**
 * Stores one temperature. Null — "the default" — is a missing row, as with
 * the LM Studio model: one way to say "none", and a default that moves with
 * the provider instead of a number frozen on the day it was picked.
 */
export function setTextTemperature(kind: keyof TextTemperatures, temperature: number | null): void {
  const key = TEMPERATURE_KEYS[kind];
  const value = temperature == null ? null : parseTemperature(String(temperature));

  if (value == null) {
    db.delete(appSettings).where(eq(appSettings.key, key)).run();
    return;
  }

  db.insert(appSettings)
    .values({ key, value: String(value) })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: String(value) } })
    .run();
}

/** Every stored usage counter, for the meters (`usageFrom` picks today's). */
export function aiUsageQuery() {
  return db.select().from(aiUsage);
}

/**
 * Adds to today's counter for one metric — the sink `recordSpend` writes to.
 * Older days of the same metric are dropped in the same transaction: a counter
 * only ever matters for the day it resets on, so nothing piles up.
 */
export function addAiUsage(metric: UsageMetric, day: string, amount: number): void {
  db.transaction(() => {
    db.delete(aiUsage)
      .where(and(eq(aiUsage.metric, metric), ne(aiUsage.day, day)))
      .run();

    db.insert(aiUsage)
      .values({ metric, day, amount })
      .onConflictDoUpdate({
        target: [aiUsage.metric, aiUsage.day],
        set: { amount: sql`${aiUsage.amount} + ${amount}` },
      })
      .run();
  });
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
      frontSpeech: cards.frontSpeech,
      backSpeech: cards.backSpeech,
      frontPhonetic: cards.frontPhonetic,
      backPhonetic: cards.backPhonetic,
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

/**
 * Where a card stands in FSRS right now — or, for a card that does not exist
 * yet, where a brand new one would. What the editor's preview needs to show the
 * grading buttons with the intervals a real review would offer.
 */
export function cardSchedule(cardId: number | null, now = new Date()): FsrsCard {
  const row = cardId
    ? db.select().from(fsrsState).where(eq(fsrsState.cardId, cardId)).get()
    : undefined;

  return toFsrsCard(row ?? newCardState(now));
}

/** Those two columns as a pair — one mapping, every reader. */
function toLanguages(row: {
  frontLanguages: string | null;
  backLanguages: string | null;
}): DeckLanguages {
  return {
    front: parseLanguages(row.frontLanguages),
    // One language, read out of a column that may still hold a list: decks
    // written before the answer side became single-valued keep their first.
    back: parseLanguage(row.backLanguages),
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
 * Which way this deck's pictures lean, for the field that is about to draw one.
 *
 * Read from the deck rather than remembered by the editor: it is a standing
 * preference, not a choice being made again on every card. What the editor's
 * gear does with it afterwards belongs to that one run and is never written
 * back — otherwise "just this once, quickly" would quietly become the deck's
 * new default.
 */
export function deckPictureQuality(deckId: number): PictureQuality {
  return getDeck(deckId)?.imageQuality ?? DEFAULT_PICTURE_QUALITY;
}

/* `usedLanguages()` lived here until 2026-09-08: it gathered every language any
 * deck had typed, so a spelling could be reused instead of invented twice. The
 * closed list in `src/lib/languages.ts` made it pointless — there is nothing to
 * reuse when there is nothing to invent. */

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

/* ------------------------------------------------------------- statistics */

/**
 * The reads behind "Statystyki". They only fetch: what a statistic means is
 * decided in `src/lib/stats.ts`, where it has tests. `deckId` null is every
 * deck.
 */

/** Every deck by name, for the deck picker on the statistics screen. */
export function deckNamesQuery() {
  return db.select({ id: decks.id, name: decks.name }).from(decks).orderBy(asc(decks.name));
}

/**
 * Every answer, with the retention its card's deck aims at — the deck the card
 * is in **now**, the same rule "done today" follows after a move.
 *
 * Reset cards keep their answers: `resetCards` clears the schedule, not the
 * history, and what was remembered was remembered.
 */
export function statsLogsQuery(deckId: number | null) {
  return db
    .select({
      cardId: reviewLogs.cardId,
      rating: reviewLogs.rating,
      state: reviewLogs.state,
      reviewedAt: reviewLogs.reviewedAt,
      durationMs: reviewLogs.durationMs,
      targetRetention: decks.desiredRetention,
    })
    .from(reviewLogs)
    .innerJoin(cards, eq(cards.id, reviewLogs.cardId))
    .innerJoin(decks, eq(decks.id, cards.deckId))
    .where(deckId == null ? undefined : eq(cards.deckId, deckId));
}

/** Every card's current schedule, for the forecast and the card states. */
export function statsCardsQuery(deckId: number | null) {
  return db
    .select({
      cardId: fsrsState.cardId,
      state: fsrsState.state,
      due: fsrsState.due,
      scheduledDays: fsrsState.scheduledDays,
    })
    .from(fsrsState)
    .innerJoin(cards, eq(cards.id, fsrsState.cardId))
    .where(deckId == null ? undefined : eq(cards.deckId, deckId));
}

/**
 * Cards that show the learner an association: a `mnemonic` field with
 * something in it, and not both halves hidden. A field nobody sees during
 * review cannot help anybody remember, so it does not count.
 */
export function mnemonicCardsQuery(deckId: number | null) {
  return db
    .selectDistinct({ cardId: cardFields.cardId })
    .from(cardFields)
    .innerJoin(cards, eq(cards.id, cardFields.cardId))
    .where(
      and(
        eq(cardFields.kind, 'mnemonic'),
        or(ne(cardFields.value, ''), isNotNull(cardFields.mediaPath)),
        or(eq(cardFields.hideValue, false), eq(cardFields.hideMedia, false)),
        deckId == null ? undefined : eq(cards.deckId, deckId)
      )
    );
}

/* --------------------------------------------------- daily goal and badges */

const DAILY_GOAL_KEY = 'goal.answers';

/** The daily goal, out of the settings rows (`appSettingsQuery`). */
export function dailyGoalFrom(rows: readonly { key: string; value: string }[]): number {
  return parseDailyGoal(rows.find((row) => row.key === DAILY_GOAL_KEY)?.value);
}

export function getDailyGoal(): number {
  return dailyGoalFrom(appSettingsQuery().all());
}

/**
 * Sets the daily goal from today on. Today's row, if there is one, takes the
 * new goal at once — today is measured by what is set now — and every earlier
 * day keeps the goal it had.
 */
export function setDailyGoal(goal: number, now = Date.now()): void {
  const value = parseDailyGoal(String(goal));

  db.transaction((tx) => {
    tx.insert(appSettings)
      .values({ key: DAILY_GOAL_KEY, value: String(value) })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: String(value) } })
      .run();
    tx.update(studyDays).set({ goal: value }).where(eq(studyDays.day, dayKey(now))).run();
  });
}

/** Every study day with an answer, for the streak and the goal (`src/lib/goals.ts`). */
export function studyDaysQuery() {
  return db.select().from(studyDays);
}

/** Badges earned so far, oldest first. */
export function badgesQuery() {
  return db.select().from(badges).orderBy(asc(badges.earnedAt), asc(badges.id));
}

/** Where every badge ladder stands now, across all decks. */
export function badgeProgress(now = Date.now()): BadgeProgress {
  const mature = db
    .select({ count: sql<number>`count(*)` })
    .from(fsrsState)
    .where(and(eq(fsrsState.state, State.Review), gte(fsrsState.scheduledDays, MATURE_DAYS)))
    .get();

  return {
    ...dayProgress(studyDaysQuery().all(), getDailyGoal(), now),
    mature: mature?.count ?? 0,
    mnemonics: mnemonicCardsQuery(null).all().length,
  };
}

/**
 * Stores every badge the numbers have reached and that is not stored yet, and
 * says which ones those were — the session summary announces them. Called when
 * a session ends and when "Statystyki" opens, not on every write: a badge for
 * an association made in the card editor can wait for the next of the two.
 */
export function awardBadges(now = Date.now()): string[] {
  return db.transaction((tx) => {
    const earned = new Set(tx.select({ id: badges.id }).from(badges).all().map((row) => row.id));
    const fresh = newlyEarned(badgeProgress(now), earned);

    if (fresh.length > 0) {
      tx.insert(badges)
        .values(fresh.map((id) => ({ id, earnedAt: new Date(now) })))
        .run();
    }

    return fresh;
  });
}

/* ----------------------------------------------------------------- backup */

/** How much a backup holds, for its manifest — and for the question before a restore. */
export function backupCounts(): { decks: number; cards: number; reviews: number } {
  const count = (table: typeof decks | typeof cards | typeof reviewLogs) =>
    db.select({ n: sql<number>`count(*)` }).from(table).get()?.n ?? 0;

  return { decks: count(decks), cards: count(cards), reviews: count(reviewLogs) };
}

const LAST_BACKUP_KEY = 'backup.last-at';
const BACKUP_FOLDER_KEY = 'backup.folder';

/** When the last backup was saved on this phone, out of the settings rows. */
export function lastBackupFrom(rows: readonly { key: string; value: string }[]): Date | null {
  const value = rows.find((row) => row.key === LAST_BACKUP_KEY)?.value;
  const time = value ? Date.parse(value) : NaN;

  return Number.isNaN(time) ? null : new Date(time);
}

/** The folder the last backup was saved into — where the picker opens next time. */
export function backupFolderFrom(rows: readonly { key: string; value: string }[]): string | null {
  return rows.find((row) => row.key === BACKUP_FOLDER_KEY)?.value || null;
}

export function setLastBackup(at: Date, folder?: string): void {
  const rows = [{ key: LAST_BACKUP_KEY, value: at.toISOString() }];
  if (folder) rows.push({ key: BACKUP_FOLDER_KEY, value: folder });

  db.transaction((tx) => {
    for (const row of rows) {
      tx.insert(appSettings)
        .values(row)
        .onConflictDoUpdate({ target: appSettings.key, set: { value: row.value } })
        .run();
    }
  });
}

/* ---------------------------------------------------------- deck packages */

/** A row's uid, which migration 0025 gave every row there was and every insert gets since. */
function uidOf(row: { uid: string | null }): string {
  if (!row.uid) throw new Error('Wiersz bez uid — migracja 0025 nie przeszła?');
  return row.uid;
}

const scheduleOut = (row: FsrsStateRow) => ({
  due: row.due.getTime(),
  stability: row.stability,
  difficulty: row.difficulty,
  elapsedDays: row.elapsedDays,
  scheduledDays: row.scheduledDays,
  learningSteps: row.learningSteps,
  reps: row.reps,
  lapses: row.lapses,
  state: row.state,
  lastReview: row.lastReview?.getTime() ?? null,
});

const reviewOut = (row: ReviewLog): PackageReview => ({
  uid: uidOf(row),
  rating: row.rating,
  state: row.state,
  due: row.due.getTime(),
  stability: row.stability,
  difficulty: row.difficulty,
  elapsedDays: row.elapsedDays,
  lastElapsedDays: row.lastElapsedDays,
  scheduledDays: row.scheduledDays,
  learningSteps: row.learningSteps,
  reviewedAt: row.reviewedAt.getTime(),
  durationMs: row.durationMs,
});

/** Groups rows by card id, keeping their order. */
function byCard<T>(rows: { cardId: number; row: T }[]): Map<number, T[]> {
  const map = new Map<number, T[]>();

  for (const { cardId, row } of rows) {
    const list = map.get(cardId);
    if (list) list.push(row);
    else map.set(cardId, [row]);
  }

  return map;
}

/**
 * One deck as a package (`src/lib/deck-package.ts`): settings, templates,
 * cards, fields and tags — and, with `withProgress`, every card's schedule
 * and history too. Null for a deck that does not exist.
 *
 * Every column by name, never a spread of a row (pitfall 11): what goes into
 * the file is what an import on another phone has to know how to put back.
 */
export function exportDeckPackage(deckId: number, withProgress: boolean, now = new Date()): DeckPackage | null {
  const deck = db.select().from(decks).where(eq(decks.id, deckId)).get();
  if (!deck) return null;

  const templates: PackageTemplate[] = deckTemplates(deckId).map((template) => ({
    name: template.name,
    frontSide: template.frontSide,
    frontPosition: template.frontPosition,
    backSide: template.backSide,
    backPosition: template.backPosition,
    frontSpeech: template.frontSpeech,
    backSpeech: template.backSpeech,
    frontPhoneticLanguage: template.frontPhoneticLanguage,
    backPhoneticLanguage: template.backPhoneticLanguage,
    slots: db
      .select()
      .from(deckFieldSlots)
      .where(eq(deckFieldSlots.templateId, template.id))
      .orderBy(asc(deckFieldSlots.position), asc(deckFieldSlots.id))
      .all()
      .map((slot) => ({
        side: slot.side,
        position: slot.position,
        kind: slot.kind,
        speech: slot.speech,
        phoneticLanguage: slot.phoneticLanguage,
      })),
  }));

  const inDeck = eq(cards.deckId, deckId);

  const fields = byCard(
    db
      .select({ cardId: cardFields.cardId, row: cardFields })
      .from(cardFields)
      .innerJoin(cards, eq(cards.id, cardFields.cardId))
      .where(inDeck)
      .orderBy(asc(cardFields.position), asc(cardFields.id))
      .all()
  );

  const tagNames = byCard(
    db
      .select({ cardId: cardTags.cardId, row: tags.name })
      .from(cardTags)
      .innerJoin(tags, eq(tags.id, cardTags.tagId))
      .innerJoin(cards, eq(cards.id, cardTags.cardId))
      .where(inDeck)
      .orderBy(asc(tags.name))
      .all()
  );

  const schedules = new Map(
    withProgress
      ? db
          .select({ cardId: fsrsState.cardId, row: fsrsState })
          .from(fsrsState)
          .innerJoin(cards, eq(cards.id, fsrsState.cardId))
          .where(inDeck)
          .all()
          .map(({ cardId, row }) => [cardId, row] as const)
      : []
  );

  const reviews = withProgress
    ? byCard(
        db
          .select({ cardId: reviewLogs.cardId, row: reviewLogs })
          .from(reviewLogs)
          .innerJoin(cards, eq(cards.id, reviewLogs.cardId))
          .where(inDeck)
          .orderBy(asc(reviewLogs.reviewedAt), asc(reviewLogs.id))
          .all()
      )
    : new Map<number, ReviewLog[]>();

  const cardRows = db.select().from(cards).where(inDeck).orderBy(asc(cards.createdAt), asc(cards.id)).all();

  return {
    format: DECK_FORMAT,
    version: DECK_VERSION,
    createdAt: now.toISOString(),
    withProgress,
    deck: {
      uid: uidOf(deck),
      name: deck.name,
      description: deck.description,
      newPerDay: deck.newPerDay,
      reviewsPerDay: deck.reviewsPerDay,
      newCardPlacement: deck.newCardPlacement,
      newCardOrder: deck.newCardOrder,
      desiredRetention: deck.desiredRetention,
      maximumInterval: deck.maximumInterval,
      learningSteps: deck.learningSteps,
      relearningSteps: deck.relearningSteps,
      fsrsWeights: deck.fsrsWeights,
      frontLanguages: deck.frontLanguages,
      backLanguages: deck.backLanguages,
      imageQuality: deck.imageQuality,
    },
    templates,
    cards: cardRows.map((card): PackageCard => {
      const schedule = schedules.get(card.id);

      return {
        uid: uidOf(card),
        front: card.front,
        back: card.back,
        frontSide: card.frontSide,
        frontPosition: card.frontPosition,
        backSide: card.backSide,
        backPosition: card.backPosition,
        frontSpeech: card.frontSpeech,
        backSpeech: card.backSpeech,
        frontPhonetic: card.frontPhonetic,
        backPhonetic: card.backPhonetic,
        createdAt: card.createdAt.getTime(),
        tags: tagNames.get(card.id) ?? [],
        fields: (fields.get(card.id) ?? []).map((field) => ({
          side: field.side,
          position: field.position,
          kind: field.kind,
          value: field.value,
          mediaPath: isMediaKind(field.kind) ? field.mediaPath : null,
          mnemonic: field.mnemonic,
          hideValue: field.hideValue,
          hideMedia: field.hideMedia,
          speech: field.speech,
          phonetic: field.phonetic,
        })),
        schedule: schedule ? scheduleOut(schedule) : null,
        reviews: (reviews.get(card.id) ?? []).map(reviewOut),
      };
    }),
  };
}

/**
 * Tag ids by name for an import: found by slug, the way the editor finds them,
 * or made — each one looked up once however many cards carry it.
 */
function tagResolver(tx: Tx): (name: string) => number {
  const ids = new Map<string, number>();

  return (name) => {
    const slug = tagSlug(name);
    const known = ids.get(slug);
    if (known !== undefined) return known;

    const id = (
      tx.select({ id: tags.id }).from(tags).where(eq(tags.slug, slug)).get() ??
      tx.insert(tags).values({ name: tagName(name), slug }).returning({ id: tags.id }).get()
    ).id;

    ids.set(slug, id);
    return id;
  };
}

/** One file an import needs moved into place: its name in the package, and the one it gets here. */
export type ImportedMedia = { kind: MediaKind; from: string; to: string };

export type DeckImportResult = {
  deckId: number;
  /** False when the deck was here already and the cards joined it. */
  created: boolean;
  added: number;
  /** Cards whose uid is here already — left exactly as they are. */
  skipped: number;
  media: ImportedMedia[];
};

/**
 * Puts a package into the database — **joining** it, never replacing.
 *
 * - A deck whose uid is here already keeps its own settings and templates;
 *   only its cards are looked at. Otherwise the deck is made as it was.
 * - A card whose uid is here already is **skipped**, schedule and all — the
 *   one on this phone is the one being learned, and nothing says the file's
 *   copy is newer. Everything else is added, with its schedule and history
 *   when the package carries them, and as New when it does not.
 * - Tags are matched by slug, the way the editor matches them.
 * - Every file gets a **fresh name** (`nameMedia`, which is `storedFileName`
 *   on the phone): two cards must never share a file, and a name from another
 *   phone may be taken here. The caller moves the files after this returns —
 *   the transaction is synchronous and the moves need not be in it.
 *
 * All or nothing: one failing row rolls the whole import back.
 */
export function importDeckPackage(
  pkg: DeckPackage,
  nameMedia: (kind: MediaKind, fileName: string) => string,
  now = new Date()
): DeckImportResult {
  return db.transaction((tx) => {
    const found = tx.select({ id: decks.id }).from(decks).where(eq(decks.uid, pkg.deck.uid)).get();
    const deckId = found?.id ?? createPackageDeck(tx, pkg, now);

    const here = new Set<string>();
    const uids = pkg.cards.map((card) => card.uid);

    // In slices: SQLite caps the number of bound parameters per statement.
    for (let start = 0; start < uids.length; start += 500) {
      const slice = uids.slice(start, start + 500);

      for (const row of tx.select({ uid: cards.uid }).from(cards).where(inArray(cards.uid, slice)).all()) {
        if (row.uid) here.add(row.uid);
      }
    }

    const tagId = tagResolver(tx);

    const media: ImportedMedia[] = [];
    let added = 0;

    for (const card of pkg.cards) {
      if (here.has(card.uid)) continue;

      const row = tx
        .insert(cards)
        .values({
          uid: card.uid,
          deckId,
          front: card.front,
          back: card.back,
          frontSide: card.frontSide,
          frontPosition: card.frontPosition,
          backSide: card.backSide,
          backPosition: card.backPosition,
          frontSpeech: card.frontSpeech,
          backSpeech: card.backSpeech,
          frontPhonetic: card.frontPhonetic,
          backPhonetic: card.backPhonetic,
          createdAt: new Date(card.createdAt),
        })
        .returning({ id: cards.id })
        .get();

      const schedule = card.schedule;

      tx.insert(fsrsState)
        .values(
          schedule
            ? {
                cardId: row.id,
                due: new Date(schedule.due),
                stability: schedule.stability,
                difficulty: schedule.difficulty,
                elapsedDays: schedule.elapsedDays,
                scheduledDays: schedule.scheduledDays,
                learningSteps: schedule.learningSteps,
                reps: schedule.reps,
                lapses: schedule.lapses,
                state: schedule.state,
                lastReview: schedule.lastReview === null ? null : new Date(schedule.lastReview),
              }
            : { cardId: row.id, ...newCardState(now) }
        )
        .run();

      for (const field of card.fields) {
        let mediaPath: string | null = null;

        if (isMediaKind(field.kind) && field.mediaPath) {
          mediaPath = nameMedia(field.kind, field.mediaPath);
          media.push({ kind: field.kind, from: field.mediaPath, to: mediaPath });
        }

        tx.insert(cardFields)
          .values({
            cardId: row.id,
            side: field.side,
            position: field.position,
            kind: field.kind,
            value: field.value,
            mediaPath,
            mnemonic: field.mnemonic,
            hideValue: field.hideValue,
            hideMedia: field.hideMedia,
            speech: field.speech,
            phonetic: field.phonetic,
          })
          .run();
      }

      for (const name of dedupeTags(card.tags)) {
        tx.insert(cardTags).values({ cardId: row.id, tagId: tagId(name) }).run();
      }

      for (const review of card.reviews) {
        tx.insert(reviewLogs)
          .values({
            uid: review.uid,
            cardId: row.id,
            rating: review.rating,
            state: review.state,
            due: new Date(review.due),
            stability: review.stability,
            difficulty: review.difficulty,
            elapsedDays: review.elapsedDays,
            lastElapsedDays: review.lastElapsedDays,
            scheduledDays: review.scheduledDays,
            learningSteps: review.learningSteps,
            reviewedAt: new Date(review.reviewedAt),
            durationMs: review.durationMs,
          })
          .run();
      }

      added += 1;
    }

    return { deckId, created: !found, added, skipped: pkg.cards.length - added, media };
  });
}

/** The deck of a package that is not here yet, with its templates — or the default one. */
function createPackageDeck(tx: Tx, pkg: DeckPackage, now: Date): number {
  const deck = pkg.deck;

  const row = tx
    .insert(decks)
    .values({
      uid: deck.uid,
      name: deck.name,
      description: deck.description,
      newPerDay: deck.newPerDay,
      reviewsPerDay: deck.reviewsPerDay,
      newCardPlacement: deck.newCardPlacement,
      newCardOrder: deck.newCardOrder,
      desiredRetention: deck.desiredRetention,
      maximumInterval: deck.maximumInterval,
      learningSteps: deck.learningSteps,
      relearningSteps: deck.relearningSteps,
      fsrsWeights: deck.fsrsWeights,
      frontLanguages: deck.frontLanguages,
      backLanguages: deck.backLanguages,
      imageQuality: deck.imageQuality,
      createdAt: now,
    })
    .returning({ id: decks.id })
    .get();

  const templates: PackageTemplate[] =
    pkg.templates.length > 0
      ? pkg.templates
      : [
          {
            name: DEFAULT_TEMPLATE_NAME,
            ...DEFAULT_CARD_LAYOUT,
            ...NO_SPEECH,
            frontPhoneticLanguage: null,
            backPhoneticLanguage: null,
            slots: [],
          },
        ];

  templates.forEach((template, position) => {
    const made = tx
      .insert(cardTemplates)
      .values({
        deckId: row.id,
        name: template.name.trim() || DEFAULT_TEMPLATE_NAME,
        position,
        frontSide: template.frontSide,
        frontPosition: template.frontPosition,
        backSide: template.backSide,
        backPosition: template.backPosition,
        frontSpeech: template.frontSpeech,
        backSpeech: template.backSpeech,
        frontPhoneticLanguage: template.frontPhoneticLanguage,
        backPhoneticLanguage: template.backPhoneticLanguage,
      })
      .returning({ id: cardTemplates.id })
      .get();

    insertSlots(tx, row.id, made.id, template.slots);
  });

  return row.id;
}

export type CsvImportResult = { added: number; skipped: number };

/**
 * Cards from a spreadsheet (`src/lib/csv-import.ts`) into one deck, each made
 * the way the editor makes a new card from the deck's first template: its
 * layout, its voices, its empty fields. Columns after the answer fill the
 * template's **text** fields in order; what is left over goes on the back,
 * one text field a column.
 *
 * A row whose question and answer this deck already has — or that came
 * earlier in the same file — is skipped: importing a file twice must not
 * double a deck. Tags are matched by slug, the way the editor matches them.
 *
 * Not transcribed even when the template asks for IPA: that is one model call
 * a card, and a file of five hundred rows would spend a day's allowance
 * without anyone having pressed anything.
 */
export function importCsvCards(deckId: number, rows: CsvCard[], now = new Date()): CsvImportResult {
  const layout = newCardLayout(deckId);
  const speech = newCardSpeech(deckId);
  const slots = newCardFields(deckId);

  const key = (front: string, back: string) => `${front.trim()}\u0000${back.trim()}`;

  return db.transaction((tx) => {
    const seen = new Set(
      tx
        .select({ front: cards.front, back: cards.back })
        .from(cards)
        .where(eq(cards.deckId, deckId))
        .all()
        .map((card) => key(card.front, card.back))
    );

    const tagId = tagResolver(tx);

    // Where leftover columns go: after everything already on the back.
    const lastOnBack = Math.max(
      -1,
      ...(layout.frontSide === 'back' ? [layout.frontPosition] : []),
      ...(layout.backSide === 'back' ? [layout.backPosition] : []),
      ...slots.filter((slot) => slot.side === 'back').map((slot) => slot.position)
    );

    let added = 0;

    for (const row of rows) {
      const id = key(row.front, row.back);
      if (seen.has(id)) continue;
      seen.add(id);

      const extra = [...row.extra];
      const fields = slots.map((slot) => (slot.kind === 'text' ? { ...slot, value: extra.shift() ?? '' } : slot));

      extra.forEach((value, index) => {
        fields.push({
          id: null,
          side: 'back',
          position: lastOnBack + 1 + index,
          kind: 'text',
          value,
          mediaPath: null,
        });
      });

      const card = tx
        .insert(cards)
        .values({
          deckId,
          front: row.front.trim(),
          back: row.back.trim(),
          createdAt: now,
          frontSide: layout.frontSide,
          frontPosition: layout.frontPosition,
          backSide: layout.backSide,
          backPosition: layout.backPosition,
          frontSpeech: speech.frontSpeech,
          backSpeech: speech.backSpeech,
        })
        .returning({ id: cards.id })
        .get();

      tx.insert(fsrsState)
        .values({ cardId: card.id, ...newCardState(now) })
        .run();

      writeCardFields(tx, card.id, fields);

      for (const name of dedupeTags(row.tags)) {
        tx.insert(cardTags).values({ cardId: card.id, tagId: tagId(name) }).run();
      }

      added += 1;
    }

    return { added, skipped: rows.length - added };
  });
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
  /**
   * The deck's **first** template, for a caller that deals in one: a deck
   * created with these gets them, and an update that names any of them
   * rewrites that template (the rest default). The deck editor sends the whole
   * list through `syncDeckTemplates` instead.
   */
  newCardLayout?: CardLayout;
  /** Which of its mandatory fields a new card starts reading aloud, and in what. */
  newCardSpeech?: CardSpeech;
  /** Which of them a new card gets transcribed, and in what. */
  newCardPhoneticLanguages?: PhoneticLanguages;
  /** Which way generated pictures lean here — a default, overridable per run. */
  imageQuality?: PictureQuality;
};

/** The columns a deck form writes, with the queue options defaulted. */
function deckValues(input: DeckInput) {
  const scheduling = input.scheduling ?? DEFAULT_SCHEDULING;
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
    // The deck's `new_*` columns are no longer written: what a new card starts
    // as lives in `card_templates` since migration 0022.
    // Named columns again, for the reason spelled out above `fsrsWeights`:
    // `front` and `back` are not column names, and a spread would drop them
    // in silence.
    frontLanguages: languagesJson(languages.front),
    backLanguages: languageJson(languages.back),
    imageQuality: input.imageQuality ?? DEFAULT_PICTURE_QUALITY,
  };
}

/** The first-template part of a `DeckInput`, with everything left out defaulted. */
function firstTemplateValues(input: DeckInput) {
  return templateValues({
    layout: input.newCardLayout ?? DEFAULT_CARD_LAYOUT,
    speech: input.newCardSpeech ?? NO_SPEECH,
    phoneticLanguages: input.newCardPhoneticLanguages ?? NO_PHONETIC_LANGUAGES,
  });
}

/** Whether a `DeckInput` says anything about the first template at all. */
const namesTemplate = (input: DeckInput) =>
  input.newCardLayout !== undefined ||
  input.newCardSpeech !== undefined ||
  input.newCardPhoneticLanguages !== undefined;

/** Creates the deck together with its first template — no deck is without one. */
export function createDeck(input: DeckInput) {
  return db.transaction((tx) => {
    const deck = tx.insert(decks).values(deckValues(input)).returning().get();

    tx.insert(cardTemplates)
      .values({
        deckId: deck.id,
        name: DEFAULT_TEMPLATE_NAME,
        position: 0,
        ...firstTemplateValues(input),
      })
      .run();

    return deck;
  });
}

export function updateDeck(deckId: number, patch: DeckInput) {
  return db.transaction((tx) => {
    tx.update(decks).set(deckValues(patch)).where(eq(decks.id, deckId)).run();

    // Only when asked: the deck editor saves its templates on their own, and an
    // update that says nothing about them must not reset the first one.
    if (!namesTemplate(patch)) return;

    const first = tx
      .select()
      .from(cardTemplates)
      .where(eq(cardTemplates.deckId, deckId))
      .orderBy(asc(cardTemplates.position), asc(cardTemplates.id))
      .get();

    if (first) {
      tx.update(cardTemplates)
        .set(firstTemplateValues(patch))
        .where(eq(cardTemplates.id, first.id))
        .run();
    }
  });
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
  /**
   * A `mnemonic` field only: its keyword and English scene, as the JSON the
   * column holds. Carried through as raw text rather than parsed, exactly
   * like `mediaPath` is carried as a file name — `src/lib/mnemonic.ts` reads
   * it in the one place that needs its parts.
   */
  mnemonic?: string | null;
  /** Kept on the card, not shown to the learner — see `sideLines`. */
  hideValue?: boolean;
  hideMedia?: boolean;
  /** Read out loud in this language, or null for a field that stays silent. */
  speech?: string | null;
  /** Its pronunciation in IPA, or null for none. */
  phonetic?: string | null;
  /**
   * A new card only: which language the deck's template asks this field to be
   * transcribed in at save time. Not a column — nothing stores it on a card.
   */
  phoneticLanguage?: string | null;
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
      mnemonic: field.mnemonic ?? null,
      hideValue: field.hideValue ?? false,
      hideMedia: field.hideMedia ?? false,
      speech: field.speech ?? null,
      phonetic: field.phonetic?.trim() || null,
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
  layout: CardLayout = DEFAULT_CARD_LAYOUT,
  speech: CardSpeech = NO_SPEECH,
  phonetic: CardPhonetic = NO_PHONETIC
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
        ...speech,
        // Named, not spread — pitfall 11.
        frontPhonetic: phonetic.frontPhonetic?.trim() || null,
        backPhonetic: phonetic.backPhonetic?.trim() || null,
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
  patch: {
    front: string;
    back: string;
    fields?: CardFieldInput[];
    layout?: CardLayout;
    speech?: CardSpeech;
    phonetic?: CardPhonetic;
  }
) {
  return db.transaction((tx) => {
    tx.update(cards)
      .set({
        front: patch.front.trim(),
        back: patch.back.trim(),
        ...(patch.layout ?? {}),
        ...(patch.speech ?? {}),
        ...(patch.phonetic
          ? {
              frontPhonetic: patch.phonetic.frontPhonetic?.trim() || null,
              backPhonetic: patch.phonetic.backPhonetic?.trim() || null,
            }
          : {}),
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
          // Reading aloud costs nothing and needs no file, so it travels with
          // the copy exactly as the layout does.
          frontSpeech: source.frontSpeech,
          backSpeech: source.backSpeech,
          // A transcription cost a model call and needs no file, so it
          // travels too.
          frontPhonetic: source.frontPhonetic,
          backPhonetic: source.backPhonetic,
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
            // The association travels with the copy. It cost a model call to
            // invent, and a copy that kept the picture but forgot how to
            // redraw it would be worse than one that kept neither.
            mnemonic: field.mnemonic,
            hideValue: field.hideValue,
            hideMedia: field.hideMedia,
            speech: field.speech,
            phonetic: field.phonetic,
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
 * The longest an answer is allowed to count for. A card left on screen while
 * the phone sat on the table is not ten minutes of study; Anki caps it at a
 * minute too ("maximum answer seconds"), so the two read alike.
 */
export const MAX_ANSWER_MS = 60_000;

/**
 * Runs the card through FSRS and persists both the new state and the review
 * log. Re-reads the state inside the transaction so a stale in-memory copy
 * can never overwrite a newer one.
 *
 * `durationMs` is how long the card was on screen; it is clipped to
 * `MAX_ANSWER_MS`, and left NULL when the caller did not time the answer.
 */
export function gradeCard(
  cardId: number,
  grade: Grade,
  now = new Date(),
  durationMs: number | null = null
) {
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

    const duration =
      durationMs == null || !Number.isFinite(durationMs)
        ? null
        : Math.round(Math.min(Math.max(durationMs, 0), MAX_ANSWER_MS));

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
        durationMs: duration,
      })
      .run();

    // The day's count, held to the goal set now — so a goal changed later in
    // the day is what today is measured by, and earlier days keep theirs.
    const goal = dailyGoalFrom(
      tx.select().from(appSettings).where(eq(appSettings.key, DAILY_GOAL_KEY)).all()
    );

    tx.insert(studyDays)
      .values({ day: dayKey(log.review), answers: 1, goal, studyMs: duration ?? 0 })
      .onConflictDoUpdate({
        target: studyDays.day,
        set: {
          answers: sql`${studyDays.answers} + 1`,
          goal,
          studyMs: sql`${studyDays.studyMs} + ${duration ?? 0}`,
        },
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

    // Taken back from the day the answer was given, which after midnight may
    // no longer be today. The goal stays as it was.
    tx.update(studyDays)
      .set({
        answers: sql`max(${studyDays.answers} - 1, 0)`,
        studyMs: sql`max(${studyDays.studyMs} - ${logRow.durationMs ?? 0}, 0)`,
      })
      .where(eq(studyDays.day, dayKey(logRow.reviewedAt)))
      .run();

    return previous;
  });
}
