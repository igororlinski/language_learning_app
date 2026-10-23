import {
  and,
  asc,
  desc,
  eq,
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
  tags,
  type CardField,
  type CardTemplate,
  type DeckFieldSlot,
  type FieldKind,
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
        durationMs:
          durationMs == null || !Number.isFinite(durationMs)
            ? null
            : Math.round(Math.min(Math.max(durationMs, 0), MAX_ANSWER_MS)),
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
