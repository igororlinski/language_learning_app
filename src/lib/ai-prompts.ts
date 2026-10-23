/**
 * What the language models are asked, word for word.
 *
 * **Moved here from the Worker on 2026-10-20**, when the app started calling
 * providers with the user's own keys. Until then the prompt lived in
 * `worker/src/index.js` so that a rewrite was a five-second `wrangler deploy`;
 * now a rewrite is a new build — in Expo Go, a reload. The text and the
 * comments below are the Worker's, unchanged: they record why each sentence is
 * there, and every one of them was paid for in measured answers (`AI.md`).
 *
 * One prompt, three adapters (`ai-text.ts`): Gemini, Workers AI's llama and
 * LM Studio all get these same words. They must never exist in two drifting
 * copies.
 */

/** One turn of the conversation a prompt is made of. */
export type Turn = { role: 'user' | 'assistant'; content: string };

/** A system instruction and the turns after it — everything a model is told. */
export type Prompt = { system: string; turns: Turn[] };

/**
 * What an answer has to look like and how wild it may be.
 *
 * `schema` is enforced by Gemini (`responseSchema`) only; llama and LM Studio
 * get no schema and are read leniently instead.
 */
export type Shape = {
  schema: object;
  temperature: number;
  /** Room llama gets to answer in — it has no schema holding it to a length. */
  llamaMaxTokens: number;
};

/**
 * The answer's shape, enforced by Gemini instead of hoped for.
 *
 * This is the half of the win that has nothing to do with vocabulary. A schema
 * cannot come back wrapped in a code fence, prefaced with throat-clearing, or
 * repeated ten times over until the tokens run out — llama did all three on
 * 2026-09-07, and the last one threw away the best answer of the batch.
 * `parseMnemonicText` keeps counting braces regardless, because the fallback
 * path still answers in free-form text.
 *
 * `propertyOrdering` is what puts `sounds` first, so the model spells the word
 * out before it commits to a keyword rather than pattern-matching on spelling.
 */
export const MNEMONIC_SCHEMA = {
  type: 'array',
  minItems: 3,
  maxItems: 3,
  items: {
    type: 'object',
    properties: {
      // How many syllables the FOREIGN word has. Nothing reads it.
      //
      // Added on 2026-09-09 to bind the four-syllable threshold the way
      // `sounds` binds the spelling-out step: make the model commit to a number
      // it would then have to contradict.
      //
      // **On its own it bound nothing**, and that measurement is worth keeping:
      // flash-lite counted `janela` 3, `queso` 2, `zapato` 3, `malentendido` 5
      // — every one correct — and split the short ones into pairs regardless.
      // Counting was never the problem, so no amount of making it count harder
      // was ever going to be the fix.
      //
      // What made the threshold hold was **cutting the pair block to half its
      // length** in the same deploy. The two go together and the field stays:
      // a rule that says "obey the number you just wrote" needs the number.
      syllables: { type: 'integer' },
      sounds: { type: 'string' },
      keyword: { type: 'string' },
      // Which of the learner's languages the keyword leans on. Demanded rather
      // than inferred: a model allowed to reach into a second language must say
      // when it did, or the user cannot tell a Polish sound-alike from an
      // English one — and the two are worth different amounts to them.
      //
      // A **list**, because a keyword may be two words side by side and the two
      // may come from two different KNOWN languages — which is the whole point
      // of allowing pairs for a learner who has more than one. One string could
      // only have said "Polish + Spanish", which nothing could look up.
      //
      // No minItems/maxItems here: the prompt says one or two, and every extra
      // schema feature is another way for a request to come back a 400.
      keywordLanguages: { type: 'array', items: { type: 'string' } },
      sentence: { type: 'string' },
      prompt: { type: 'string' },
    },
    required: ['syllables', 'sounds', 'keyword', 'keywordLanguages', 'sentence', 'prompt'],
    propertyOrdering: [
      'syllables',
      'sounds',
      'keyword',
      'keywordLanguages',
      'sentence',
      'prompt',
    ],
  },
} as const;

/**
 * High on purpose. "Inne skojarzenie" has to actually produce another one, and
 * a mnemonic that is merely correct is useless — it has to be strange enough to
 * stick. This is the one call in the app where a boring answer is a failure.
 */
const TEMPERATURE = 0.95;

/**
 * Room for the JSON array and nothing else, on llama — the one provider with
 * no schema to stop it repeating itself until the tokens run out.
 */
const MNEMONIC_LLAMA_MAX_TOKENS = 900;

/** What an association asks for: wild, and in the three-object schema. */
export const MNEMONIC_SHAPE: Shape = {
  schema: MNEMONIC_SCHEMA,
  temperature: TEMPERATURE,
  llamaMaxTokens: MNEMONIC_LLAMA_MAX_TOKENS,
};

/**
 * The same, a little calmer, for a model on the user's own computer.
 *
 * Measured 2026-10-21 on gemma-4-e4b (`LMSTUDIO-EKSPERYMENTY.md`): between 0.1
 * and 0.95 the number of good keywords did not move, and below 0.5 the model
 * started repeating one proposal within an answer, turning three options into
 * two. 0.7 is not better than 0.95 by itself — it is what the one request
 * shape that did work (`SOUNDS LIKE` with a single KNOWN language) was
 * measured at, twice, so it is what ships.
 */
export const LOCAL_MNEMONIC_SHAPE: Shape = { ...MNEMONIC_SHAPE, temperature: 0.7 };

/* ------------------------------------------------- the user's temperature */

/**
 * The temperatures the user set on "Ustawienia AI", one per kind of request.
 * Null is "the default" — and the default is not one number: associations are
 * asked at 0.95 in the cloud and 0.7 on LM Studio, each for its own measured
 * reason. A setting replaces whichever default would have applied.
 */
export type TextTemperatures = { mnemonic: number | null; phonetic: number | null };

export const DEFAULT_TEMPERATURES: TextTemperatures = { mnemonic: null, phonetic: null };

/**
 * What the user may pick. Gemini takes 0–2 and Workers AI more, but above 1.5
 * the answers stop being JSON often enough that the readers would throw most
 * of them away — a setting that mostly produces errors is not a setting.
 */
export const TEMPERATURE_CHOICES: readonly number[] = Array.from({ length: 16 }, (_, i) => i / 10);

const MAX_TEMPERATURE = 1.5;

/** A stored temperature, or null for anything that is not a usable one. */
export function parseTemperature(value: string | null | undefined): number | null {
  if (value == null || value.trim() === '') return null;

  const temperature = Number(value);

  if (!Number.isFinite(temperature) || temperature < 0 || temperature > MAX_TEMPERATURE) return null;

  return Math.round(temperature * 100) / 100;
}

/** The shape at the user's temperature, or untouched when they left the default. */
export const withTemperature = (shape: Shape, temperature: number | null | undefined): Shape =>
  temperature == null ? shape : { ...shape, temperature };

/** `0,7`, `0,95`, `1,0` — the way a Polish screen writes it. */
export const formatTemperature = (temperature: number): string =>
  temperature.toFixed(Math.round(temperature * 100) % 10 === 0 ? 1 : 2).replace('.', ',');

/** One language for the prompt, or an honest "unknown". */
const languagePhrase = (name: string) => name || 'unknown';

/**
 * The learner's languages as a ranking the model can act on.
 *
 * Written as "1. Polish (try this first)  2. English  3. German" rather than
 * "Polish or English", because the order **is** the instruction: these are the
 * languages the learner has, sorted by how readily each comes to mind, and a
 * sound-alike is worth more the higher up it was found.
 */
const languageRanking = (names: readonly string[]) =>
  names.length > 0
    ? names.map((name, index) => `${index + 1}. ${name}`).join('\n')
    : '1. unknown';

/* -------------------------------------------------------------- the prompt */

/**
 * The keyword method, spelled out.
 *
 * The learner knows MEANING in their own language and is trying to remember
 * TERM in a foreign one. The trick is to find a word in the language they
 * already have that *sounds* like the foreign word, then picture that thing
 * doing whatever the foreign word means — so recalling the picture hands back
 * both halves at once. Portuguese `comer` sounds like Polish `komar`, a
 * mosquito; a mosquito eating is `comer`.
 *
 * **The sound-alike is the whole job.** An earlier version of this prompt gave
 * equal billing to the scene and told the model the stranger the better; it
 * chased strangeness and paid for it with the one thing that matters, inventing
 * Polish-looking non-words (`liw`, `kesz`, `trze`) to reach a better picture.
 * So the order here is deliberate: find a REAL word that sounds roughly right,
 * and only then build a plain sentence around it. An approximate match that
 * exists beats a perfect match that does not.
 *
 * The `sounds` field is not read by anything. It is there so the model spells
 * the foreign word out phonetically before it picks a keyword, instead of
 * pattern-matching on how the word is written — the step it silently skipped.
 * `parseMnemonicText` ignores unknown fields, so it costs a few tokens and no
 * contract.
 *
 * The examples are not decoration. Without them a model tends to answer with a
 * translation, an etymology, or a sound-alike in the *wrong* language, all of
 * which are useless and all of which look plausible. They also carry what the
 * rules only assert: `kadet` is a fragment match, `garnek` a loose one, and
 * every sentence in them is plain correct grammar rather than a pile of
 * alliteration.
 *
 * **A keyword may be two words (2026-09-09.)** A single word only works while
 * the foreign word is short: nothing in Polish echoes four syllables of
 * `opinionated`, so the honest answer is two short real words side by side,
 * each carrying half the sound. And when the learner has more than one KNOWN
 * language, the two halves may come from two of them — `opat` + Spanish
 * `nieto` is a real match to somebody who hears both, not a trick played on
 * them.
 *
 * It is a **fallback, and the prompt is built so it reads as one**: the rule
 * says a single word wins any tie, and the pair example sits last, after four
 * single-word ones. Order matters more than instruction here — a pair example
 * placed first would teach pairs as the default, which is the same mistake the
 * old "make it strange" wording made in the other direction.
 *
 * The cost is a contract change: `keywordLanguages` is a list, because one
 * string could only have said "Polish + Spanish" and nothing could look that
 * up. Nothing stored changes — the column keeps keyword, scene and sentence,
 * and never kept the language.
 *
 * **`sounds` adds one line, `SOUNDS LIKE`, and nothing else (2026-10-23).**
 * It is how the foreign word sounds in Polish letters, worked out by the app
 * (`sounds-like.ts`), for a model too small to hear the word itself. The line
 * goes into every example too, from the example's own `sounds` — that is how
 * it was measured, and an example without the line would teach that the line
 * is optional. Without `sounds` the prompt is word for word what it was, which
 * is what Gemini still gets.
 */
export function mnemonicPrompt({
  term,
  termLanguage,
  meaning,
  meaningLanguages,
  sounds,
}: {
  term: string;
  termLanguage: string;
  meaning: string;
  meaningLanguages: readonly string[];
  sounds?: string | null;
}): Prompt {
  const soundsLine = (spelled: string) => (sounds ? `SOUNDS LIKE: ${spelled}\n` : '');

  const system = [
    'You invent keyword-method mnemonics for language learners.',
    '',
    'The learner is memorising a word in FOREIGN. They already speak the',
    'languages listed under KNOWN, in that order: the first is the one they',
    'think in, the rest are languages they read and understand.',
    '',
    'Your one real task: say the FOREIGN word out loud in your head, and find a',
    'word in a KNOWN language that SOUNDS like it. The opening sounds matter most.',
    '',
    'Work down the KNOWN list in order:',
    '- try language 1 first, and stay there if any real word sounds close;',
    '- move to language 2 only when language 1 offers nothing that both sounds',
    '  right and can be pictured; then to language 3 the same way;',
    '- a good match in language 2 beats a poor one in language 1, but an equal',
    '  match in language 1 always wins. The higher up the list, the better.',
    'Name the language of every keyword word in keywordLanguages, spelled as it',
    'appears in the KNOWN list.',
    '',
    'The sound-alike word must:',
    '- be a REAL word of that language, one a dictionary has and an ordinary',
    '  speaker would recognise. Never invent a word, and never bend a real one;',
    '- be spelled the way a dictionary spells it, never spelled out by ear;',
    '- if it helps, be a LONGER word whose beginning carries the sound — the',
    '  whole word still has to be real and picturable;',
    '- name something concrete you could photograph — a thing, an animal, a',
    '  person. A plain noun is best;',
    '- not be a translation of the FOREIGN word, and not be a word of a language',
    '  outside the KNOWN list;',
    '- NEVER be the FOREIGN word itself re-spelled, and never a piece of it cut',
    '  off and dressed up. `janela` does not give you "żanela" or "nela"; those',
    '  are the foreign word wearing a hat. Ask yourself: did this word exist',
    '  before I saw the FOREIGN word, and would a dictionary of that language',
    '  have it? If not, it is not a word, however right it sounds. This is THE',
    '  failure of this task — every other mistake here is survivable.',
    '',
    'A rough sound match is fine and expected. A real word that sounds roughly',
    'right is always better than an invented word that sounds exactly right.',
    '',
    'A PAIR of two short words side by side is the rare exception, not a tool.',
    'Use one ONLY when the FOREIGN word has four or more syllables — you have',
    'just counted them — AND no single word in any KNOWN language comes close.',
    'Under four syllables: one word, always, however good a pair looks.',
    'In a pair the first word carries the opening sounds and the second the',
    'rest. Choose each half separately, walking the KNOWN list again for each:',
    'language 1 being able to supply both is no reason for it to. Every rule',
    'above binds each half, and the two together must make one scene.',
    'Cutting the FOREIGN word in half and re-spelling the halves is NOT a pair.',
    'Both words must have existed before you saw the FOREIGN word.',
    'If all three options are pairs, change BOTH halves each time.',
    '',
    'Then write ONE short sentence containing the sound-alike (BOTH words, when',
    'it is a pair) AND the MEANING — in the language the sound-alike came from:',
    '',
    '- keyword from KNOWN language 1: write the sentence in language 1;',
    '- keyword from a LOWER KNOWN language: write the sentence ENTIRELY in THAT',
    '  language, with the MEANING translated into it as well. Never mix two',
    '  languages in one sentence. The learner declared they read this language,',
    '  so a whole sentence in it is easier than a broken one in another;',
    '- a PAIR whose two words come from ONE language: a sentence in that',
    '  language, exactly as above. Being a pair changes nothing here;',
    '- a PAIR whose two words come from TWO DIFFERENT KNOWN languages, and ONLY',
    '  that case: write NO sentence. Send sentence as an empty string "". No',
    '  language owns such a pair, and picking one of them only produces a',
    '  sentence that is broken in it. There the two words and the picture ARE',
    '  the association.',
    '',
    'A pair from ONE language reads best with its two words next to each other,',
    'in the order they carry the sound. Plain, grammatically correct, present',
    'tense, at most six words — eight when the keyword is a pair, since two of',
    'them are spent on the keyword itself. Do not chase rhyme or alliteration —',
    'a correct ordinary sentence is worth more than a clever broken one.',
    '',
    'Answer with a JSON array of exactly THREE such objects and nothing else.',
    'The three must rest on THREE DIFFERENT sound-alike words — three angles on',
    'the same foreign word, not one idea reworded. When they are pairs, they',
    'must differ in BOTH words: three pairs sharing a half are one idea with',
    'three prefixes, and the learner is choosing between one thing.',
    'Put the one you believe in most first: that is the best sound match, found',
    'as high up the KNOWN list as possible.',
    '',
    '[{"sounds":"…","keyword":"…","keywordLanguages":["…"],"sentence":"…","prompt":"…"}, …]',
    '',
    'syllables — how many syllables the FOREIGN word has. Count them before you',
    '           choose anything; it decides whether a pair is allowed at all.',
    'sounds   — the FOREIGN word written out as it sounds, spelled the way',
    '           KNOWN language 1 spells things.',
    'keyword  — the sound-alike word by itself, or the two words separated by',
    '           one space when a pair was needed.',
    'keywordLanguages — a list saying which KNOWN language each of those words',
    '           belongs to, in the same order: one entry for one word, two for',
    '           a pair, the same name twice when both come from one language.',
    'sentence — the sentence above, or "" when the pair spans two languages.',
    'prompt   — that sentence as a scene in ENGLISH for an image generator:',
    '           name what is physically visible and nothing else, and no text',
    '           in the image. When there is no sentence, describe the keyword',
    '           things together with the MEANING instead — the picture then',
    '           carries the whole association alone, so it matters more.',
    '',
    'Do not explain. Do not add fields. Do not use markdown.',
  ].join('\n');

  const example = (
    foreign: string,
    foreignLang: string,
    native: string,
    known: string[],
    answers: ({ sounds: string } & Record<string, unknown>)[]
  ): Turn[] => [
      {
        role: 'user',
        content:
          `FOREIGN (${foreignLang}): ${foreign}\n` +
          soundsLine(answers[0].sounds) +
          `MEANING: ${native}\n` +
          `KNOWN:\n${languageRanking(known)}`,
      },
      { role: 'assistant', content: JSON.stringify(answers) },
    ];

  // Three examples, three options each. The count is the lesson: an example
  // answering with one object teaches answering with one object, and the whole
  // point of asking three times over is that the user picks. They also carry
  // what the rules only assert — `kadet` is a fragment match, `garnek` a loose
  // one, and every sentence is plain correct grammar rather than word-play.
  const turns: Turn[] = [
    ...example('comer', 'Portuguese', 'jeść', ['Polish'], [
      {
        syllables: 2,
        sounds: 'komer',
        keyword: 'komar',
        keywordLanguages: ['Polish'],
        sentence: 'Komar je kanapkę.',
        prompt: 'a giant mosquito eating a sandwich, simple illustration',
      },
      {
        syllables: 2,
        sounds: 'komer',
        keyword: 'komin',
        keywordLanguages: ['Polish'],
        sentence: 'Komin je węgiel.',
        prompt: 'a brick chimney swallowing lumps of coal, simple illustration',
      },
      {
        syllables: 2,
        sounds: 'komer',
        keyword: 'komoda',
        keywordLanguages: ['Polish'],
        sentence: 'Komoda je talerze.',
        prompt: 'a wooden chest of drawers biting into a stack of plates, simple illustration',
      },
    ]),
    ...example('cadeira', 'Portuguese', 'krzesło', ['Polish'], [
      {
        syllables: 3,
        sounds: 'kadejra',
        keyword: 'kadet',
        keywordLanguages: ['Polish'],
        sentence: 'Kadet siedzi na krześle.',
        prompt: 'a young military cadet sitting on a wooden chair, simple illustration',
      },
      {
        syllables: 3,
        sounds: 'kadejra',
        keyword: 'kadzidło',
        keywordLanguages: ['Polish'],
        sentence: 'Kadzidło dymi na krześle.',
        prompt: 'a smoking incense stick standing on a wooden chair, simple illustration',
      },
      {
        syllables: 3,
        sounds: 'kadejra',
        keyword: 'kadź',
        keywordLanguages: ['Polish'],
        sentence: 'Kadź stoi na krześle.',
        prompt: 'a large wooden vat balanced on a chair, simple illustration',
      },
    ]),
    // The one example with two KNOWN languages, and the only reason it exists:
    // the second option reaches into English because Polish had nothing better,
    // says so in `keywordLanguages`, and writes its whole sentence in English —
    // meaning and all. Everything the ranking rule asserts is demonstrated here
    // rather than only stated above.
    //
    // That sentence used to be Polish with `camel` sitting inside it, which is
    // what the rule used to say. It reads badly: a bare English noun inflected
    // by Polish grammar is a sentence in neither language, and somebody who
    // reached for `camel` can read a line of English.
    ...example('cama', 'Portuguese', 'łóżko', ['Polish', 'English'], [
      {
        syllables: 2,
        sounds: 'kama',
        keyword: 'kamerdyner',
        keywordLanguages: ['Polish'],
        sentence: 'Kamerdyner ściele łóżko.',
        prompt: 'a butler in a tailcoat making a bed, simple illustration',
      },
      {
        syllables: 2,
        sounds: 'kama',
        keyword: 'camel',
        keywordLanguages: ['English'],
        sentence: 'The camel sleeps in a bed.',
        prompt: 'a camel asleep in a human bed, simple illustration',
      },
      {
        syllables: 2,
        sounds: 'kama',
        keyword: 'kamień',
        keywordLanguages: ['Polish'],
        sentence: 'Kamień leży na łóżku.',
        prompt: 'a large grey boulder resting on a bed, simple illustration',
      },
    ]),
    ...example('gato', 'Spanish', 'kot', ['Polish'], [
      {
        syllables: 2,
        sounds: 'gato',
        keyword: 'gacie',
        keywordLanguages: ['Polish'],
        sentence: 'Kot siedzi na gaciach.',
        prompt: 'a cat sitting on a pair of underpants, simple illustration',
      },
      {
        syllables: 2,
        sounds: 'gato',
        keyword: 'garnek',
        keywordLanguages: ['Polish'],
        sentence: 'Kot śpi w garnku.',
        prompt: 'a cat curled up asleep inside a metal cooking pot, simple illustration',
      },
      {
        syllables: 2,
        sounds: 'gato',
        keyword: 'gad',
        keywordLanguages: ['Polish'],
        sentence: 'Gad goni kota.',
        prompt: 'a large lizard chasing a cat across a floor, simple illustration',
      },
    ]),
    // The pair example, and the only one there is. Four syllables of English
    // have no single Polish echo, so each option is two short words carrying
    // half the sound each — and the second reaches into the learner's Spanish
    // for its back half, which is the case a one-language learner never has.
    //
    // It sits **last**, after four single-word examples, because that is the
    // order of the rule: a pair is what you fall back to, not what you reach
    // for. An example is worth more than a sentence of instruction, which cuts
    // both ways — one pair example first would teach pairs as the default.
    ...example('opinionated', 'English', 'mający własne zdanie', ['Polish', 'Spanish'], [
      {
        syllables: 5,
        sounds: 'opinionejtyd',
        keyword: 'opona notes',
        keywordLanguages: ['Polish', 'Polish'],
        sentence: 'Opona i notes mają własne zdanie.',
        prompt:
          'a car tyre and a small notepad standing side by side with folded arms, simple illustration',
      },
      {
        syllables: 5,
        sounds: 'opinionejtyd',
        keyword: 'opat nieto',
        keywordLanguages: ['Polish', 'Spanish'],
        // Half Polish, half Spanish, so no language owns it and there is no
        // sentence to write — the two words and the picture are the whole
        // association. The scene works harder here to make up for it.
        sentence: '',
        prompt:
          'an abbot in a habit and a small grandson arguing face to face, each refusing to ' +
          'give way, simple illustration',
      },
      {
        syllables: 5,
        sounds: 'opinionejtyd',
        keyword: 'opal nietoperz',
        keywordLanguages: ['Polish', 'Polish'],
        sentence: 'Opal i nietoperz mają własne zdanie.',
        prompt:
          'a glowing opal stone and a bat facing each other stubbornly, simple illustration',
      },
    ]),
    {
      role: 'user',
      content:
        `FOREIGN (${languagePhrase(termLanguage)}): ${term}\n` +
        soundsLine(sounds ?? '') +
        `MEANING: ${meaning}\n` +
        `KNOWN:\n${languageRanking(meaningLanguages)}`,
    },
  ];

  return { system, turns };
}

/* --------------------------------------------------------- transcription */

/**
 * A transcription is the opposite of an association: there is one right
 * answer and nothing to gain from a wild one, so the temperature is low and
 * the shape is a single string.
 */
export const PHONETIC_SHAPE: Shape = {
  schema: {
    type: 'object',
    properties: { ipa: { type: 'string' } },
    required: ['ipa'],
  },
  temperature: 0.2,
  llamaMaxTokens: 200,
};

/**
 * Broad IPA, the way a dictionary prints it — `/kuˈmeɾ/` — for the exact
 * variety the deck names. "Portuguese (European)" and "Portuguese (Brazilian)"
 * transcribe differently, which is the reason the language comes from the
 * deck's closed list, in English, rather than being guessed from the word.
 */
export function phoneticPrompt({ text, language }: { text: string; language: string }): Prompt {
  return {
    system: [
      'You write phonetic transcriptions in the International Phonetic Alphabet.',
      'Transcribe how a native speaker of the given language variety pronounces the given text.',
      'Use broad IPA between slashes, as a dictionary prints it, with primary stress marks.',
      'Transcribe the whole text, keeping a space between words.',
      'Do not translate, do not explain, do not add anything else.',
      'Answer as JSON: {"ipa": "/.../"}.',
    ].join('\n'),
    turns: [{ role: 'user', content: `Language: ${language}\nText: ${text}` }],
  };
}
