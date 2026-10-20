import type { AiKeys } from '@/lib/ai-keys';
import { MNEMONIC_SHAPE, mnemonicPrompt } from '@/lib/ai-prompts';
import { writeText } from '@/lib/ai-text';
import { AiError, type TextSource } from '@/lib/ai-transport';
import { parseMnemonicList, type Mnemonic } from '@/lib/mnemonic';

/**
 * Asking a language model for keyword-method associations.
 *
 * What goes out is four short strings: the foreign word being learned, what it
 * means in the learner's own language, and what each of those languages is —
 * which is exactly what the deck now declares (`src/lib/languages.ts`). The
 * languages are what make the trick possible at all: a sound-alike has to be a
 * word in the language the learner already speaks, and the model cannot know
 * which that is by looking at two words.
 *
 * Sending them empty is allowed and is the fallback, not the plan: the prompt
 * then says "unknown" and the model guesses from the words themselves.
 */
/** A word plus its language. Longer than this is not a flashcard term. */
const MAX_TERM = 200;
const MAX_LANGUAGE = 32;
/** More known languages than this is a list, not a ranking. */
const MAX_LANGUAGES = 6;

const clip = (value: string, max: number) => value.trim().slice(0, max);

export type MnemonicRequest = {
  /** The word being learned — the answer side of the card. */
  term: string;
  /** The one language it is written in. A word has one pronunciation. */
  termLanguage: string;
  /** What it means, in a language the learner has — the question side. */
  meaning: string;
  /**
   * Every language the learner already speaks, **best first**.
   *
   * The list is a ranking, not a set: the model hunts for a sound-alike in the
   * first, and only moves to the second when the first has no real word close
   * enough. A Pole who also reads English gets `janela` matched against Polish
   * first and English second — which is exactly how the trick works in a head
   * that holds two languages.
   */
  meaningLanguages: string[];
};

/**
 * Three associations, best first — or fewer, when the model managed fewer.
 *
 * Three rather than one because the choice is the feature: the model is at
 * its most useful when it is allowed to miss twice, and picking between three
 * sound-alikes costs one call, one wait and no extra neurons — they arrive in
 * a single answer, not three.
 *
 * `source` is who writes them — the setting on the "Ustawienia AI" screen —
 * and `keys` are the user's own.
 */
export async function requestMnemonics(
  request: MnemonicRequest,
  source: TextSource,
  keys: AiKeys
): Promise<Mnemonic[]> {
  // Both halves are the input. A sound-alike needs a word to sound like, and a
  // scene needs a meaning to be about — so this is refused before the network,
  // with the same failure an empty picture prompt gets.
  const term = clip(request.term, MAX_TERM);
  const meaning = clip(request.meaning, MAX_TERM);

  if (!term || !meaning) throw new AiError('empty-prompt');

  const prompt = mnemonicPrompt({
    term,
    termLanguage: clip(request.termLanguage, MAX_LANGUAGE),
    meaning,
    meaningLanguages: request.meaningLanguages
      .map((name) => clip(name, MAX_LANGUAGE))
      .filter(Boolean)
      .slice(0, MAX_LANGUAGES),
  });

  const text = await writeText(prompt, MNEMONIC_SHAPE, source, keys);
  const mnemonics = parseMnemonicList(text);

  // The model answered, but not with an association. Its own words go into the
  // message: on a phone this alert is the only place to see what it said.
  if (mnemonics.length === 0) {
    throw new AiError('malformed', text.trim().slice(0, 120) || undefined);
  }

  return mnemonics;
}
