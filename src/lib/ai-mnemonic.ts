import { AiError, postToWorker } from '@/lib/ai-worker';
import { parseMnemonicText, type Mnemonic } from '@/lib/mnemonic';

/**
 * Asking the Worker for one keyword-method association.
 *
 * What goes out is four short strings: the foreign word being learned, what it
 * means in the learner's own language, and what each of those languages is —
 * which is exactly what the deck now declares (`src/lib/languages.ts`). The
 * languages are what make the trick possible at all: a sound-alike has to be a
 * word in the language the learner already speaks, and the model cannot know
 * which that is by looking at two words.
 *
 * Sending them empty is allowed and is the fallback, not the plan: the Worker's
 * prompt then says "unknown" and the model guesses from the words themselves.
 */
export type MnemonicRequest = {
  /** The word being learned — the answer side of the card. */
  term: string;
  termLanguages: string[];
  /** What it means, in the learner's language — the question side. */
  meaning: string;
  meaningLanguages: string[];
};

export async function requestMnemonic(
  request: MnemonicRequest,
  workerUrl?: string
): Promise<Mnemonic> {
  // Both halves are the input. A sound-alike needs a word to sound like, and a
  // scene needs a meaning to be about — so this is refused before the network,
  // with the same failure an empty picture prompt gets.
  if (!request.term.trim() || !request.meaning.trim()) throw new AiError('empty-prompt');

  const result = await postToWorker(
    '/mnemonic',
    {
      term: request.term,
      termLanguages: request.termLanguages,
      meaning: request.meaning,
      meaningLanguages: request.meaningLanguages,
    },
    workerUrl
  );

  const text = typeof result.text === 'string' ? result.text : '';
  const mnemonic = parseMnemonicText(text);

  // The model answered, but not with an association. Its own words go into the
  // message: on a phone this alert is the only place to see what it said.
  if (!mnemonic) throw new AiError('malformed', text.trim().slice(0, 120) || undefined);

  return mnemonic;
}
