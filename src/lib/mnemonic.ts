/**
 * Keyword-method associations: the half that has no network in it.
 *
 * The idea is old and it works. A learner who already speaks Polish and is
 * memorising Portuguese `comer` ("to eat") is not helped by being told the
 * translation again — but is helped enormously by noticing that `comer` sounds
 * like `komar`, a mosquito, and then picturing a mosquito eating. Recalling the
 * picture hands back the sound and the meaning together.
 *
 * The association itself is invented by a language model, prompted in
 * `worker/src/index.js` — the prompt lives there because it gets rewritten every
 * time its output is judged, and a redeploy is cheaper than a new app build.
 * What lives here is everything that has to be right no matter what the model
 * says: reading its answer, refusing a broken one, and turning the scene into a
 * picture prompt.
 *
 * Storage note: the **sentence is the field's `value`**, exactly like every
 * other field's label and search material — it is the thing the learner reads.
 * The keyword and the English scene go in the `mnemonic` column, because they
 * are what "another picture, same association" needs and nothing else reads.
 */

/** Nothing longer is a sound-alike word. */
const MAX_KEYWORD = 64;

/** The sentence is meant to be six words; this is the hard stop. */
const MAX_SENTENCE = 160;

/** Room for a scene, not a paragraph. */
const MAX_SCENE = 400;

/** One association, whole. */
export type Mnemonic = {
  /** The native word that sounds like the foreign one — "komar". */
  keyword: string;
  /** The scene in the learner's own language — "Komar je kanapkę." */
  sentence: string;
  /** The same scene in English, for the image model. */
  prompt: string;
};

/** What the `mnemonic` column keeps: the sentence is `value`, so it is not here. */
export type StoredMnemonic = Pick<Mnemonic, 'keyword' | 'prompt'>;

const clean = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';

/**
 * Where the object that starts at `from` closes, or -1 when it never does.
 *
 * Braces inside strings are skipped, so a sentence is free to contain one.
 */
const closingBrace = (raw: string, from: number): number => {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let at = from; at < raw.length; at += 1) {
    const character = raw[at];

    if (escaped) {
      escaped = false;
    } else if (inString) {
      if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
    } else if (character === '"') {
      inString = true;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;

      if (depth === 0) return at;
    }
  }

  return -1;
};

/**
 * Every complete JSON object in the text, in order, up to `wanted`.
 *
 * Counting braces rather than cutting from the first brace to the last is what
 * makes this work on everything a model actually sends: a bare array of three,
 * three objects back to back, any of it wrapped in a code fence or trailed by a
 * sentence of commentary. The array's own brackets need no special handling —
 * the objects inside are found either way.
 *
 * An object that never closes ends the scan: the model ran out of tokens
 * mid-answer, and everything after that point is a guess.
 */
const objectsIn = (raw: string, wanted: number): string[] => {
  const found: string[] = [];
  let at = 0;

  while (found.length < wanted) {
    const start = raw.indexOf('{', at);

    if (start < 0) break;

    const end = closingBrace(raw, start);

    if (end < 0) break;

    found.push(raw.slice(start, end + 1));
    at = end + 1;
  }

  return found;
};

/** One association out of one JSON object, or null when a piece is missing. */
const oneFrom = (source: string): Mnemonic | null => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(source);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const object = parsed as Record<string, unknown>;

  const mnemonic: Mnemonic = {
    keyword: clean(object.keyword, MAX_KEYWORD),
    sentence: clean(object.sentence, MAX_SENTENCE),
    prompt: clean(object.prompt, MAX_SCENE),
  };

  // All three or nothing. Two out of three is a field that looks filled in and
  // cannot be rerolled, which is worse than one that plainly failed.
  if (!mnemonic.keyword || !mnemonic.sentence || !mnemonic.prompt) return null;

  return mnemonic;
};

/**
 * The associations out of whatever the language model actually said.
 *
 * Deliberately forgiving about the wrapping and strict about the contents. The
 * model is asked for three so that the user picks rather than takes what they
 * are given — but fewer is not a failure worth throwing away: two good options
 * beat an error message, and one is what the whole feature used to be.
 *
 * Unknown fields are ignored on purpose. The prompt asks the model to write out
 * how the foreign word sounds before it picks a keyword, and that working-out
 * arrives as a field nothing here needs.
 */
export function parseMnemonicList(raw: string, wanted = 3): Mnemonic[] {
  // Scanned wider than asked for: a malformed object in the middle should cost
  // its own slot, not the ones after it.
  return objectsIn(raw, wanted + 3)
    .map(oneFrom)
    .filter((mnemonic): mnemonic is Mnemonic => mnemonic !== null)
    .slice(0, wanted);
}

/** The single best association, for callers that want one. */
export function parseMnemonicText(raw: string): Mnemonic | null {
  return parseMnemonicList(raw, 1)[0] ?? null;
}

/**
 * What the picture asks for.
 *
 * Not the same decoration as a plain `ai-image` field, and the difference
 * matters: that one asks for a *single subject*, which is right for one word and
 * wrong here, where the whole point is two things meeting — the sound-alike and
 * the meaning. Asking for a single subject would quietly drop half of every
 * mnemonic. The scene arrives in English already, because the model that
 * invented it was asked for English.
 */
export function buildScenePrompt(scene: string): string {
  const subject = scene.trim().replace(/\s+/g, ' ');

  return (
    `Simple, clear illustration: ${subject}. ` +
    'Bold and memorable, plain light background, legible at small size. ' +
    'No text, no letters, no numbers, no watermark.'
  ).slice(0, 2048);
}

/** The column value for an association, or null when there is nothing to keep. */
export function mnemonicJson(mnemonic: StoredMnemonic | null): string | null {
  if (!mnemonic) return null;

  const keyword = clean(mnemonic.keyword, MAX_KEYWORD);
  const prompt = clean(mnemonic.prompt, MAX_SCENE);

  if (!keyword || !prompt) return null;

  return JSON.stringify({ keyword, prompt });
}

/**
 * What the column holds, or null when it holds nothing usable.
 *
 * Anything unreadable is treated as absent rather than as an error: a row
 * written by some future version must not be able to break the editor. The
 * field then still shows its sentence and its picture — only "another picture,
 * same association" stops being possible, which is the honest consequence.
 */
export function parseMnemonicColumn(json: string | null | undefined): StoredMnemonic | null {
  if (!json) return null;

  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const object = parsed as Record<string, unknown>;
  const keyword = clean(object.keyword, MAX_KEYWORD);
  const prompt = clean(object.prompt, MAX_SCENE);

  return keyword && prompt ? { keyword, prompt } : null;
}
