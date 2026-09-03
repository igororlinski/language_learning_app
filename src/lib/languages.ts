import { fold } from '@/lib/search';

/**
 * Which languages a deck's questions and answers are written in.
 *
 * This is a **declaration, not a rule**: nothing validates a card against it and
 * nothing stops a Polish word landing in a deck that says its questions are
 * English. It exists to be read by things that need to know what they are
 * looking at — the first of them being picture generation from the phonetic and
 * semantic likeness between a question and its answer, which cannot be attempted
 * without knowing which two languages are being compared.
 *
 * The names are typed by the user rather than picked from a closed list, so the
 * rules here are the ones tags already live by: the spelling shown is the user's
 * own, and identity is that spelling with case and diacritics folded away.
 *
 * Kept free of the database so the editor and whatever reads a deck later agree
 * on what a language is — see [[tags]] for the same shape one layer down.
 */

/** Nothing longer is a language name; it is a sentence about one. */
export const MAX_LANGUAGE_LENGTH = 32;

/** What the user sees: their own spelling, trimmed and squeezed to one line. */
export function languageName(input: string): string {
  return input.trim().replace(/\s+/g, ' ').slice(0, MAX_LANGUAGE_LENGTH);
}

/**
 * What uniqueness is checked against. The same folding tags and the search box
 * use, so `Angielski`, `angielski` and `ANGIELSKI` are one language rather than
 * three — and so are `łaciński` and `lacinski`.
 */
export function languageSlug(input: string): string {
  return fold(languageName(input));
}

/** Whether a typed name is worth saving at all. */
export function isUsableLanguage(input: string): boolean {
  return languageSlug(input).length > 0;
}

/** The same list without repeats, keeping the first spelling of each. */
export function dedupeLanguages(names: string[]): string[] {
  const seen = new Set<string>();

  return names.filter((name) => {
    const slug = languageSlug(name);
    if (!slug || seen.has(slug)) return false;

    seen.add(slug);
    return true;
  });
}

/** What a deck declares about its two mandatory fields. */
export type DeckLanguages = {
  /** Languages the question (`cards.front`) may be written in. */
  front: string[];
  /** Languages the answer (`cards.back`) may be written in. */
  back: string[];
};

export const NO_LANGUAGES: DeckLanguages = { front: [], back: [] };

/**
 * The names out of one deck column, which holds them as a JSON array.
 *
 * Anything unreadable comes back as an empty list rather than as an error: a
 * deck that cannot say what language it is in is exactly a deck that has not
 * said, and a row written by some future version must not be able to break the
 * editor. Same reasoning as `parseWeights`, different empty value — there is no
 * "default set of languages" to fall back on.
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

  return dedupeLanguages(
    parsed.filter((name): name is string => typeof name === 'string').map(languageName)
  );
}

/**
 * The column value for a list of names, or `null` when there are none — so
 * "this deck says nothing about its languages" is one value in the database
 * rather than two (`null` and `[]`) that would have to mean the same thing.
 */
export function languagesJson(names: string[]): string | null {
  const clean = dedupeLanguages(names.map(languageName)).filter((name) => name.length > 0);

  return clean.length > 0 ? JSON.stringify(clean) : null;
}

/** Every language named by either side, once, in the order they appear. */
export function allLanguages(languages: DeckLanguages): string[] {
  return dedupeLanguages([...languages.front, ...languages.back]);
}
