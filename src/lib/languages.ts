/**
 * Which languages a deck's questions and answers are written in.
 *
 * This is a **declaration, not a rule**: nothing validates a card against it and
 * nothing stops a Polish word landing in a deck that says its questions are
 * English. It exists to be read by things that need to know what they are
 * looking at — the phonetic association (which cannot compare two languages
 * without knowing which two) and, since 2026-09-08, reading a word aloud.
 *
 * **Languages are picked from this list, not typed** (changed 2026-09-08; they
 * were free text from 09-03). Speech is what settled it: a phone is asked to
 * read in `pt-PT`, and no amount of folding turns „brazylijski" into that. The
 * identity of a language is now a BCP-47 code and nothing else, so the same
 * deck says the same thing to the image model, to the language model and to the
 * speech engine.
 *
 * The English name is here for a second reason: the mnemonic prompt is written
 * in English, and telling it "Portuguese" is worth more than telling it
 * "portugalski" — see `src/lib/ai-mnemonic.ts`.
 */

import { fold } from '@/lib/search';

export type Language = {
  /** BCP-47, and the identity of the language everywhere in the app. */
  code: string;
  /** What the user sees, in Polish. */
  name: string;
  /** What the language model is told, because its prompt is English. */
  english: string;
};

/**
 * The catalogue.
 *
 * Sorted by the Polish name, because that is the order somebody scanning the
 * list expects. Regional entries exist only where they change how a word is
 * *said* — `pt-PT` against `pt-BR` is two different pronunciations of the same
 * word, which is the whole point of the speech field, while `de-AT` is not.
 *
 * A language with no speech voice on the phone stays on the list: the deck can
 * still declare it, associations still work, and only the reading falls away
 * with a reason (`łacina` is the obvious one).
 */
export const LANGUAGES: readonly Language[] = [
  { code: 'en-US', name: 'angielski (amerykański)', english: 'English (American)' },
  { code: 'en-GB', name: 'angielski (brytyjski)', english: 'English (British)' },
  { code: 'ar', name: 'arabski', english: 'Arabic' },
  { code: 'bg', name: 'bułgarski', english: 'Bulgarian' },
  { code: 'zh-CN', name: 'chiński (uproszczony)', english: 'Mandarin Chinese (Simplified)' },
  { code: 'zh-TW', name: 'chiński (tradycyjny)', english: 'Mandarin Chinese (Traditional)' },
  { code: 'hr', name: 'chorwacki', english: 'Croatian' },
  { code: 'cs', name: 'czeski', english: 'Czech' },
  { code: 'da', name: 'duński', english: 'Danish' },
  { code: 'et', name: 'estoński', english: 'Estonian' },
  { code: 'fi', name: 'fiński', english: 'Finnish' },
  { code: 'fr', name: 'francuski', english: 'French' },
  { code: 'el', name: 'grecki', english: 'Greek' },
  { code: 'es', name: 'hiszpański', english: 'Spanish' },
  { code: 'es-MX', name: 'hiszpański (Meksyk)', english: 'Spanish (Mexican)' },
  { code: 'he', name: 'hebrajski', english: 'Hebrew' },
  { code: 'hi', name: 'hindi', english: 'Hindi' },
  { code: 'id', name: 'indonezyjski', english: 'Indonesian' },
  { code: 'ja', name: 'japoński', english: 'Japanese' },
  { code: 'ko', name: 'koreański', english: 'Korean' },
  { code: 'lt', name: 'litewski', english: 'Lithuanian' },
  { code: 'la', name: 'łacina', english: 'Latin' },
  { code: 'lv', name: 'łotewski', english: 'Latvian' },
  { code: 'nl', name: 'niderlandzki', english: 'Dutch' },
  { code: 'de', name: 'niemiecki', english: 'German' },
  { code: 'no', name: 'norweski', english: 'Norwegian' },
  { code: 'fa', name: 'perski', english: 'Persian' },
  { code: 'pl', name: 'polski', english: 'Polish' },
  { code: 'pt-PT', name: 'portugalski', english: 'Portuguese (European)' },
  { code: 'pt-BR', name: 'portugalski (Brazylia)', english: 'Portuguese (Brazilian)' },
  { code: 'ru', name: 'rosyjski', english: 'Russian' },
  { code: 'ro', name: 'rumuński', english: 'Romanian' },
  { code: 'sr', name: 'serbski', english: 'Serbian' },
  { code: 'sk', name: 'słowacki', english: 'Slovak' },
  { code: 'sl', name: 'słoweński', english: 'Slovenian' },
  { code: 'sv', name: 'szwedzki', english: 'Swedish' },
  { code: 'th', name: 'tajski', english: 'Thai' },
  { code: 'tr', name: 'turecki', english: 'Turkish' },
  { code: 'uk', name: 'ukraiński', english: 'Ukrainian' },
  { code: 'hu', name: 'węgierski', english: 'Hungarian' },
  { code: 'vi', name: 'wietnamski', english: 'Vietnamese' },
  { code: 'it', name: 'włoski', english: 'Italian' },
];

const BY_CODE = new Map(LANGUAGES.map((language) => [language.code, language]));

/**
 * What decks written before the list existed said, folded, and where it lands.
 *
 * Those rows hold typed names — „polski", „portugalski", „angielski" — and
 * throwing them away would quietly empty the one thing that makes associations
 * work. Every catalogue name maps itself; the entries below are the bare names
 * that no longer exist verbatim because the list splits them by region.
 *
 * Anything else is dropped: a deck saying „brazylijski" cannot be turned into a
 * code by guessing, and guessing wrong is worse than the deck saying nothing.
 */
const LEGACY_NAMES: Record<string, string> = {
  angielski: 'en-US',
  chinski: 'zh-CN',
  portugalski: 'pt-PT',
  brazylijski: 'pt-BR',
  hiszpanski: 'es',
  norweski: 'no',
  grecki: 'el',
};

const BY_NAME = new Map<string, string>([
  ...LANGUAGES.map((language) => [fold(language.name), language.code] as const),
  ...Object.entries(LEGACY_NAMES).map(([name, code]) => [fold(name), code] as const),
]);

/** Whether this is a code the app knows how to show and speak. */
export function isKnownLanguage(code: string): boolean {
  return BY_CODE.has(code);
}

/** What the user sees for a code — or the code itself, which beats nothing. */
export function languageLabel(code: string): string {
  return BY_CODE.get(code)?.name ?? code;
}

/** What the language model is told about a code. */
export function languageEnglish(code: string): string {
  return BY_CODE.get(code)?.english ?? code;
}

/**
 * The way back: an English name the model answered with, turned into a code.
 *
 * Needed because the model says which of the learner's languages a sound-alike
 * came from, and it says it in the English it was given. Matching is folded and
 * also accepts the bare language ("English" for "English (British)"), because a
 * model repeating a name is not a model quoting a catalogue.
 */
export function languageByEnglish(name: string): string | null {
  const wanted = fold(name);

  if (!wanted) return null;

  const exact = LANGUAGES.find((language) => fold(language.english) === wanted);

  if (exact) return exact.code;

  return LANGUAGES.find((language) => fold(language.english).startsWith(wanted))?.code ?? null;
}

/** The same list without repeats, in the order given. */
export function dedupeLanguages(codes: string[]): string[] {
  return [...new Set(codes.filter(isKnownLanguage))];
}

/**
 * What a deck declares about its two mandatory fields — and the two sides are
 * **not symmetrical**, which is the whole point (2026-09-08).
 *
 * The answer is **one language**: it is the language being learned, the one the
 * phone reads aloud and the one a sound-alike has to sound like. Two would mean
 * two answers to "which voice?" and "which word am I matching?", and both
 * questions have exactly one useful answer.
 *
 * The question side is **a list in priority order**: these are the languages
 * the learner already has. A Pole who also speaks English can be helped by an
 * English sound-alike when Polish offers none — so the model tries the first,
 * then the second, then the third, and the order is the user's ranking of how
 * readily each one comes to mind.
 */
export type DeckLanguages = {
  /** Languages the learner knows, best first. Used to hunt for a sound-alike. */
  front: string[];
  /** The single language being learned, or null when the deck says nothing. */
  back: string | null;
};

export const NO_LANGUAGES: DeckLanguages = { front: [], back: null };

/**
 * The codes out of one deck column, which holds them as a JSON array.
 *
 * Forgiving in exactly one direction: an entry that is not a code is looked up
 * as a name first, so decks written before 09-08 keep what they declared. What
 * matches neither is dropped, and unreadable JSON comes back as an empty list —
 * a deck that cannot say what language it is in is exactly a deck that has not
 * said, and a row from some future version must not break the editor.
 */
export function parseLanguages(json: string | null | undefined): string[] {
  if (!json) return [];

  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const codes = parsed
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => (isKnownLanguage(entry) ? entry : (BY_NAME.get(fold(entry)) ?? '')))
    .filter(Boolean);

  return dedupeLanguages(codes);
}

/**
 * The column value for a list of codes, or `null` when there are none — so
 * "this deck says nothing about its languages" is one value in the database
 * rather than two (`null` and `[]`) that would have to mean the same thing.
 */
export function languagesJson(codes: string[]): string | null {
  const clean = dedupeLanguages(codes);

  return clean.length > 0 ? JSON.stringify(clean) : null;
}

/**
 * The one language out of a column that may still hold several.
 *
 * Decks written before the answer side became single-valued kept a list, and
 * the first entry is the closest thing to what they meant — it is the one the
 * editor showed first and the one everything already used for the voice.
 */
export function parseLanguage(json: string | null | undefined): string | null {
  return parseLanguages(json)[0] ?? null;
}

/** The column value for a single language, in the array shape the column keeps. */
export function languageJson(code: string | null): string | null {
  return code && isKnownLanguage(code) ? JSON.stringify([code]) : null;
}

/** Every language named by either side, once, in the order they appear. */
export function allLanguages(languages: DeckLanguages): string[] {
  return dedupeLanguages([...languages.front, ...(languages.back ? [languages.back] : [])]);
}

/** The first usable code in a list, or null — how a priority list is read. */
export function speechLanguage(codes: string[]): string | null {
  return codes.find(isKnownLanguage) ?? null;
}
