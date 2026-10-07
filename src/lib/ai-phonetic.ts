import { AiError, postToWorker } from '@/lib/ai-worker';
import { languageEnglish } from '@/lib/languages';
import { MAX_SPEECH_LENGTH } from '@/lib/speech';

/**
 * A text's pronunciation, written out in IPA — `/kuˈmeɾ/` under `comer`.
 *
 * Made the way an association is made: in the card editor, on request, by a
 * language model behind our own Worker, and then **stored on the card**. The
 * review screen only ever reads what was saved, because a review must never
 * need a network. The phone's own speech engine can say a word but cannot spell
 * out how it said it, so this is the one part of pronunciation that has to come
 * from a model.
 */

/**
 * Asks for the transcription of one text in one language.
 *
 * The language is a code from the deck's closed list and goes out as its
 * English name, the way the mnemonic prompt names languages: „Portuguese
 * (European)" is worth more to the model than `pt-PT`, and the region matters —
 * European and Brazilian Portuguese transcribe differently.
 */
export async function requestPhonetic(
  text: string,
  language: string,
  workerUrl?: string
): Promise<string> {
  const said = text.trim().replace(/\s+/g, ' ').slice(0, MAX_SPEECH_LENGTH);

  if (!said) throw new AiError('empty-prompt');

  const result = await postToWorker(
    '/phonetic',
    { text: said, language: languageEnglish(language) },
    workerUrl
  );

  const phonetic = parsePhonetic(typeof result.text === 'string' ? result.text : '');

  if (!phonetic) throw new AiError('malformed');

  return phonetic;
}

/**
 * The transcription out of what the model said, or null when there is none.
 *
 * Lenient about the wrapping and strict about the content, like the mnemonic
 * reader: Gemini answers `{"ipa": "/.../"}` because a schema makes it, but the
 * fallback model answers in free text — fenced, quoted, or prefaced with a
 * sentence. What comes back is always one line between slashes, because that is
 * how a dictionary prints it and how the card shows it.
 */
export function parsePhonetic(answer: string): string | null {
  let text = answer.trim();

  if (!text) return null;

  // A fence around the whole answer, with or without a language tag.
  text = text.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '').trim();

  const json = text.match(/\{[\s\S]*\}/);

  if (json) {
    try {
      const parsed: unknown = JSON.parse(json[0]);
      const ipa = (parsed as { ipa?: unknown } | null)?.ipa;

      if (typeof ipa === 'string') text = ipa;
    } catch {
      // Not JSON after all; read it as plain text below.
    }
  }

  // The transcription itself, if the model put one between slashes or
  // brackets inside a longer sentence.
  const marked = text.match(/[/[][^/[\]\n]+[/\]]/);

  if (marked) text = marked[0];

  const core = text
    .replace(/^["'„“”]+|["'„“”]+$/g, '')
    .replace(/^[/[]|[/\]]$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return core ? `/${core}/` : null;
}
