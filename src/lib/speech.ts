/**
 * Reading a word out loud — the half of it that has no device in it.
 *
 * The learner needs to hear `janela`, not read it. Every other way of getting
 * that sound costs something the app cannot pay: a recording has to be made and
 * carried around, and a generated file has to be paid for, stored, copied with
 * the card and deleted with it. **The phone already knows how to speak**, in
 * whatever languages it has installed, offline and for nothing — so a speech
 * field holds no file, generates nothing and works in the middle of a review
 * with the network off. That is not a compromise; it is the only option that
 * obeys the rule that a review must never need the network.
 *
 * What lives here is the two decisions that have to be right no matter which
 * engine speaks: **what** is read and **in which language**. The speaking
 * itself is `expo-speech`, called from the components — a native module has no
 * business in a module the tests import.
 */

import type { DeckLanguages } from '@/lib/languages';

/** Nothing longer is a flashcard word; it is an essay being read at you. */
export const MAX_SPEECH_LENGTH = 300;

/**
 * What a speech field reads: its own text, or the card's answer when it has
 * none.
 *
 * Empty by default and answer-by-default on purpose. The overwhelmingly common
 * case is "say the word I am learning", which is the answer — making that the
 * default means the usual field is added and never touched again. Typing
 * something into it is for the exceptions: a full sentence to hear in context,
 * or a spelling the engine mangles and has to be nudged into ("chorizo" as
 * "cziriso").
 */
export function speechText(value: string, answer: string): string {
  const own = value.trim();

  return (own || answer.trim()).slice(0, MAX_SPEECH_LENGTH);
}

/**
 * Which voice reads it: the language the deck declares for its **answers**.
 *
 * The answer is the word being learned, and the word being learned is the one
 * worth hearing — a Polish learner of Portuguese wants `janela` in Portuguese,
 * not their own question read back at them. A deck that declares nothing gets
 * `null`, and the field then says what is missing instead of guessing: read in
 * the wrong language, `janela` sounds like nothing at all and teaches the
 * learner something false.
 */
export function speechVoice(languages: DeckLanguages): string | null {
  return languages.back;
}

/**
 * Whether the phone can actually say something in this language.
 *
 * - `exact`    — a voice for exactly what the deck declared.
 * - `variant`  — the language is there in another region. `pt-BR` where the
 *                deck asked for `pt-PT` still says the word, and says it with
 *                the wrong accent; worth a sentence, not worth a refusal.
 * - `missing`  — nothing. The engine then reads the foreign word with whatever
 *                voice it defaults to, which for a Polish phone means `janela`
 *                pronounced „janela" — the exact thing this field exists to
 *                prevent.
 * - `unknown`  — the list could not be read, so nothing is claimed.
 */
export type VoiceStatus = 'exact' | 'variant' | 'missing' | 'unknown';

export type VoiceMatch = {
  status: VoiceStatus;
  /** The device tag that matched, for the sentence a `variant` needs. */
  tag: string | null;
};

/** `pt_BR`, `PT-br` and `pt-BR` are one tag; only the first part identifies a language. */
const normalizeTag = (tag: string) => tag.trim().replace(/_/g, '-').toLowerCase();
const primary = (tag: string) => normalizeTag(tag).split('-')[0] ?? '';

/**
 * The tag written the way the catalogue writes it (`pt-BR`), so what comes back
 * can be looked up as a language and shown by name. Engines report every
 * casing there is, and „pt-br" in a sentence meant for a person is a leak of
 * how this works rather than an answer to what happened.
 */
const canonical = (tag: string) => {
  const [language, region] = normalizeTag(tag).split('-');

  return region ? `${language}-${region.toUpperCase()}` : (language ?? '');
};

/**
 * What the phone has against what the deck asked for.
 *
 * `available` is `null` while the list is still being read, and **also** when
 * reading it failed — both mean "do not claim anything". That distinction
 * carries the whole safety of this feature: a device that answers slowly, or an
 * engine that throws on `getAvailableVoicesAsync`, must never end up disabling
 * a button that would have worked. Silence is the failure being guarded
 * against; refusing to speak is not an improvement on it.
 */
export function matchVoice(code: string | null, available: string[] | null): VoiceMatch {
  if (!code) return { status: 'missing', tag: null };
  if (!available) return { status: 'unknown', tag: null };

  const wanted = normalizeTag(code);
  const tags = available.map(normalizeTag);

  // A code with no region asks only about the language, so any region answers
  // it: `pl` is happy with `pl-PL`.
  const exact = tags.find((tag) => tag === wanted || (!wanted.includes('-') && primary(tag) === wanted));

  if (exact) return { status: 'exact', tag: canonical(exact) };

  const variant = tags.find((tag) => primary(tag) === primary(wanted));

  return variant ? { status: 'variant', tag: canonical(variant) } : { status: 'missing', tag: null };
}
