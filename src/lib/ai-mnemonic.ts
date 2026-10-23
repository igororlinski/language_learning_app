import type { AiKeys } from '@/lib/ai-keys';
import { LOCAL_MNEMONIC_SHAPE, MNEMONIC_SHAPE, mnemonicPrompt } from '@/lib/ai-prompts';
import { writeText } from '@/lib/ai-text';
import { AiError, type TextSource } from '@/lib/ai-transport';
import { languageByEnglish } from '@/lib/languages';
import { parseMnemonicList, type Mnemonic } from '@/lib/mnemonic';
import { soundsLike } from '@/lib/sounds-like';

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
  /**
   * The card's stored IPA of `term`, if it has one. Read only for LM Studio,
   * and only for a language without spelling rules (`sounds-like.ts`).
   */
  termPhonetic?: string | null;
};

/**
 * What a model on the user's own computer is asked instead — the same prompt,
 * three switches (measured 2026-10-21 on gemma-4-e4b, `LMSTUDIO-EKSPERYMENTY.md`):
 *
 * - **only the first KNOWN language.** Given "Polish, English", the small model
 *   took an English word about one time in three (`janitor`, `key`, `cave`),
 *   ranking or no ranking. Asked in Polish alone it stays in Polish;
 * - **`SOUNDS LIKE`**, the word's sound in Polish letters, worked out here —
 *   the model reads spelling instead of hearing (`chave` → `kawa`). The two
 *   only work together: 8–11 good Polish keywords on nine words instead of
 *   1–2, each alone about 3. The sound is Polish spelling, so it goes only
 *   when that first language is Polish;
 * - **temperature 0.7**, which is what that shape was measured at.
 *
 * The cost is the ranking: LM Studio no longer reaches into a second language
 * on its own. "Przegeneruj w: …" still asks in that one language — with no
 * sound line, since Polish spelling tells English nothing.
 *
 * Gemini gets none of this: it hears the word, and the ranking works for it.
 */
function forLocalModel(languages: string[], term: string, request: MnemonicRequest) {
  const known = languages.slice(0, 1);
  const polish = known.length > 0 && languageByEnglish(known[0]) === 'pl';

  return {
    known,
    sounds: polish
      ? soundsLike({
          term,
          language: languageByEnglish(request.termLanguage),
          ipa: request.termPhonetic,
        })
      : null,
  };
}

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

  const languages = request.meaningLanguages
    .map((name) => clip(name, MAX_LANGUAGE))
    .filter(Boolean)
    .slice(0, MAX_LANGUAGES);
  const local = source.provider === 'lmstudio' ? forLocalModel(languages, term, request) : null;

  const prompt = mnemonicPrompt({
    term,
    termLanguage: clip(request.termLanguage, MAX_LANGUAGE),
    meaning,
    meaningLanguages: local?.known ?? languages,
    sounds: local?.sounds,
  });

  const text = await writeText(prompt, local ? LOCAL_MNEMONIC_SHAPE : MNEMONIC_SHAPE, source, keys);
  const mnemonics = parseMnemonicList(text);

  // The model answered, but not with an association. Its own words go into the
  // message: on a phone this alert is the only place to see what it said.
  if (mnemonics.length === 0) {
    throw new AiError('malformed', text.trim().slice(0, 120) || undefined);
  }

  return mnemonics;
}
