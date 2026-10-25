import { strFromU8, strToU8 } from 'fflate';

import {
  FIELD_KINDS,
  FIELD_SIDES,
  NEW_CARD_ORDERS,
  NEW_CARD_PLACEMENTS,
  PICTURE_QUALITIES,
  type FieldKind,
  type FieldSide,
  type NewCardOrder,
  type NewCardPlacement,
  type PictureQuality,
} from '@/db/schema';
import { fold } from '@/lib/search';

/**
 * One deck as a file — to hand to someone else, or to carry to another phone
 * without replacing everything there the way a backup does.
 *
 * ```
 * talia-portugalski-2026-10-23.zip
 * ├ manifest.json   what this is, the deck's name, how many cards
 * ├ deck.json       the deck: settings, templates, cards, fields, tags
 * │                 and — when exported with it — schedules and history
 * └ media/card-images/…   the files its fields point at
 * ```
 *
 * The same zip as a backup (`archive.ts` writes and reads both), and the same
 * first entry, so one look at `manifest.json` tells an import which of the
 * two it has been given.
 *
 * **JSON, not the database.** A backup can be a copy of the SQLite file
 * because it replaces the database whole; a deck *joins* one, row by row, and
 * every row has to be checked on the way in — a file from somewhere is not
 * trusted to name only real sides, kinds and states. Every column is written
 * out by name (pitfall 11), and `parseDeckPackage` refuses the whole file
 * over one bad value rather than importing most of a deck.
 *
 * **Identity is `uid`** (migration 0025). Importing a deck whose uid is already
 * here adds the cards that are not, and leaves alone the ones that are —
 * importing the same file twice changes nothing, and importing a newer export
 * of a shared deck brings in only what was added since.
 */

export const DECK_FORMAT = 'fiszki-deck';
/** Raised when the layout of `deck.json` changes in a way an older app cannot read. */
export const DECK_VERSION = 1;
export const DECK_ENTRY = 'deck.json';

export type DeckManifest = {
  format: typeof DECK_FORMAT;
  version: number;
  createdAt: string;
  name: string;
  cards: number;
  withProgress: boolean;
};

export type PackageDeck = {
  uid: string;
  name: string;
  description: string | null;
  newPerDay: number;
  reviewsPerDay: number;
  newCardPlacement: NewCardPlacement;
  newCardOrder: NewCardOrder;
  desiredRetention: number;
  maximumInterval: number;
  learningSteps: string;
  relearningSteps: string;
  /** The columns as stored — their readers already shrug off anything odd. */
  fsrsWeights: string | null;
  frontLanguages: string | null;
  backLanguages: string | null;
  imageQuality: PictureQuality;
};

export type PackageSlot = {
  side: FieldSide;
  position: number;
  kind: FieldKind;
  speech: string | null;
  phoneticLanguage: string | null;
};

export type PackageTemplate = {
  name: string;
  frontSide: FieldSide;
  frontPosition: number;
  backSide: FieldSide;
  backPosition: number;
  frontSpeech: string | null;
  backSpeech: string | null;
  frontPhoneticLanguage: string | null;
  backPhoneticLanguage: string | null;
  slots: PackageSlot[];
};

export type PackageField = {
  side: FieldSide;
  position: number;
  kind: FieldKind;
  value: string;
  /** The file's name under `media/<directory of kind>/`, or null. */
  mediaPath: string | null;
  mnemonic: string | null;
  hideValue: boolean;
  hideMedia: boolean;
  speech: string | null;
  phonetic: string | null;
};

export type PackageSchedule = {
  due: number;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: number;
  lastReview: number | null;
};

export type PackageReview = {
  uid: string;
  rating: number;
  state: number;
  due: number;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  lastElapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reviewedAt: number;
  durationMs: number | null;
};

export type PackageCard = {
  uid: string;
  front: string;
  back: string;
  frontSide: FieldSide;
  frontPosition: number;
  backSide: FieldSide;
  backPosition: number;
  frontSpeech: string | null;
  backSpeech: string | null;
  frontPhonetic: string | null;
  backPhonetic: string | null;
  createdAt: number;
  tags: string[];
  fields: PackageField[];
  /** Present only in an export made with progress. */
  schedule: PackageSchedule | null;
  reviews: PackageReview[];
};

export type DeckPackage = {
  format: typeof DECK_FORMAT;
  version: number;
  createdAt: string;
  withProgress: boolean;
  deck: PackageDeck;
  templates: PackageTemplate[];
  cards: PackageCard[];
};

export function deckManifest(pkg: DeckPackage): DeckManifest {
  return {
    format: DECK_FORMAT,
    version: pkg.version,
    createdAt: pkg.createdAt,
    name: pkg.deck.name,
    cards: pkg.cards.length,
    withProgress: pkg.withProgress,
  };
}

export const jsonBytes = (value: unknown) => strToU8(JSON.stringify(value));

/* ------------------------------------------------------------------ read */

/** Thrown inside the readers below; `parseDeckPackage` turns it into null. */
class Invalid extends Error {}

type Obj = Record<string, unknown>;

function object(value: unknown): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Invalid();
  return value as Obj;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Invalid();
  return value;
}

function string(value: unknown): string {
  if (typeof value !== 'string') throw new Invalid();
  return value;
}

function stringOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : string(value);
}

function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Invalid();
  return value;
}

function numberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : number(value);
}

function integer(value: unknown): number {
  const n = number(value);
  if (!Number.isInteger(n)) throw new Invalid();
  return n;
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Invalid();
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (!allowed.includes(value as T)) throw new Invalid();
  return value as T;
}

/** 32 lowercase hex characters, the shape `randomblob(16)` gives. */
function uid(value: unknown): string {
  const text = string(value);
  if (!/^[0-9a-f]{32}$/.test(text)) throw new Invalid();
  return text;
}

/** A file name with no way out of its directory — the archive's own rule. */
function mediaName(value: unknown): string | null {
  const name = stringOrNull(value);
  if (name === null || name === '') return null;
  if (name === '.' || name === '..' || /[\\/:]/.test(name)) throw new Invalid();
  return name;
}

function readDeck(value: unknown): PackageDeck {
  const deck = object(value);

  return {
    uid: uid(deck.uid),
    name: string(deck.name).trim() || 'Talia',
    description: stringOrNull(deck.description),
    newPerDay: integer(deck.newPerDay),
    reviewsPerDay: integer(deck.reviewsPerDay),
    newCardPlacement: oneOf(deck.newCardPlacement, NEW_CARD_PLACEMENTS),
    newCardOrder: oneOf(deck.newCardOrder, NEW_CARD_ORDERS),
    desiredRetention: number(deck.desiredRetention),
    maximumInterval: integer(deck.maximumInterval),
    learningSteps: string(deck.learningSteps),
    relearningSteps: string(deck.relearningSteps),
    fsrsWeights: stringOrNull(deck.fsrsWeights),
    frontLanguages: stringOrNull(deck.frontLanguages),
    backLanguages: stringOrNull(deck.backLanguages),
    imageQuality: oneOf(deck.imageQuality, PICTURE_QUALITIES),
  };
}

function readSlot(value: unknown): PackageSlot {
  const slot = object(value);

  return {
    side: oneOf(slot.side, FIELD_SIDES),
    position: integer(slot.position),
    kind: oneOf(slot.kind, FIELD_KINDS),
    speech: stringOrNull(slot.speech),
    phoneticLanguage: stringOrNull(slot.phoneticLanguage),
  };
}

function readTemplate(value: unknown): PackageTemplate {
  const template = object(value);

  return {
    name: string(template.name),
    frontSide: oneOf(template.frontSide, FIELD_SIDES),
    frontPosition: integer(template.frontPosition),
    backSide: oneOf(template.backSide, FIELD_SIDES),
    backPosition: integer(template.backPosition),
    frontSpeech: stringOrNull(template.frontSpeech),
    backSpeech: stringOrNull(template.backSpeech),
    frontPhoneticLanguage: stringOrNull(template.frontPhoneticLanguage),
    backPhoneticLanguage: stringOrNull(template.backPhoneticLanguage),
    slots: array(template.slots).map(readSlot),
  };
}

function readField(value: unknown): PackageField {
  const field = object(value);

  return {
    side: oneOf(field.side, FIELD_SIDES),
    position: integer(field.position),
    kind: oneOf(field.kind, FIELD_KINDS),
    value: string(field.value),
    mediaPath: mediaName(field.mediaPath),
    mnemonic: stringOrNull(field.mnemonic),
    hideValue: boolean(field.hideValue),
    hideMedia: boolean(field.hideMedia),
    speech: stringOrNull(field.speech),
    phonetic: stringOrNull(field.phonetic),
  };
}

/** ts-fsrs `State`: 0 New, 1 Learning, 2 Review, 3 Relearning. */
function state(value: unknown): number {
  const n = integer(value);
  if (n < 0 || n > 3) throw new Invalid();
  return n;
}

function readSchedule(value: unknown): PackageSchedule | null {
  if (value === null || value === undefined) return null;

  const schedule = object(value);

  return {
    due: integer(schedule.due),
    stability: number(schedule.stability),
    difficulty: number(schedule.difficulty),
    elapsedDays: number(schedule.elapsedDays),
    scheduledDays: number(schedule.scheduledDays),
    learningSteps: integer(schedule.learningSteps),
    reps: integer(schedule.reps),
    lapses: integer(schedule.lapses),
    state: state(schedule.state),
    lastReview: numberOrNull(schedule.lastReview),
  };
}

function readReview(value: unknown): PackageReview {
  const review = object(value);
  const rating = integer(review.rating);

  if (rating < 1 || rating > 4) throw new Invalid();

  return {
    uid: uid(review.uid),
    rating,
    state: state(review.state),
    due: integer(review.due),
    stability: number(review.stability),
    difficulty: number(review.difficulty),
    elapsedDays: number(review.elapsedDays),
    lastElapsedDays: number(review.lastElapsedDays),
    scheduledDays: number(review.scheduledDays),
    learningSteps: integer(review.learningSteps),
    reviewedAt: integer(review.reviewedAt),
    durationMs: numberOrNull(review.durationMs),
  };
}

function readCard(value: unknown, withProgress: boolean): PackageCard {
  const card = object(value);

  return {
    uid: uid(card.uid),
    front: string(card.front),
    back: string(card.back),
    frontSide: oneOf(card.frontSide, FIELD_SIDES),
    frontPosition: integer(card.frontPosition),
    backSide: oneOf(card.backSide, FIELD_SIDES),
    backPosition: integer(card.backPosition),
    frontSpeech: stringOrNull(card.frontSpeech),
    backSpeech: stringOrNull(card.backSpeech),
    frontPhonetic: stringOrNull(card.frontPhonetic),
    backPhonetic: stringOrNull(card.backPhonetic),
    createdAt: integer(card.createdAt),
    tags: array(card.tags).map(string),
    fields: array(card.fields).map(readField),
    // An export without progress carries none, whatever the file claims.
    schedule: withProgress ? readSchedule(card.schedule) : null,
    reviews: withProgress ? array(card.reviews ?? []).map(readReview) : [],
  };
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(strFromU8(bytes));
  } catch {
    return null;
  }
}

/** The manifest of a deck file, or null for anything that is not one. */
export function parseDeckManifest(bytes: Uint8Array): DeckManifest | null {
  try {
    const data = object(parseJson(bytes));

    if (data.format !== DECK_FORMAT) return null;

    return {
      format: DECK_FORMAT,
      version: integer(data.version),
      createdAt: string(data.createdAt),
      name: string(data.name),
      cards: integer(data.cards),
      withProgress: boolean(data.withProgress),
    };
  } catch {
    return null;
  }
}

/**
 * `deck.json` back into a package — all of it valid, or null. Cards sharing a
 * uid, or reviews sharing one, make the file invalid too: the import keys on
 * them, and two rows claiming one identity is a file nobody should trust.
 */
export function parseDeckPackage(bytes: Uint8Array): DeckPackage | null {
  try {
    const data = object(parseJson(bytes));

    if (data.format !== DECK_FORMAT) return null;

    const version = integer(data.version);
    if (version > DECK_VERSION) return null;

    const withProgress = boolean(data.withProgress);
    const cards = array(data.cards).map((card) => readCard(card, withProgress));

    const cardUids = new Set(cards.map((card) => card.uid));
    const reviewUids = new Set(cards.flatMap((card) => card.reviews.map((review) => review.uid)));
    const reviewCount = cards.reduce((sum, card) => sum + card.reviews.length, 0);

    if (cardUids.size !== cards.length || reviewUids.size !== reviewCount) return null;

    return {
      format: DECK_FORMAT,
      version,
      createdAt: string(data.createdAt),
      withProgress,
      deck: readDeck(data.deck),
      templates: array(data.templates).map(readTemplate),
      cards,
    };
  } catch {
    return null;
  }
}

/** `talia-portugalski-2026-10-23.zip` — the deck's name, folded to what any file system takes. */
export function deckFileName(name: string, now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const slug =
    fold(name)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'talia';

  return `talia-${slug}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.zip`;
}
