/**
 * The app's two AI errands, moved off the phone.
 *
 *   POST /          → a picture, from a prompt the app wrote     (also /image)
 *   POST /mnemonic  → a keyword-method association, as raw text
 *
 * The app used to call Cloudflare directly, which meant every installation
 * carried an API token — and a token inside a mobile bundle is a token anybody
 * can unzip out of it. This Worker exists so that no key is shipped at all:
 * Workers AI is reached here through the `AI` **binding**, which Cloudflare
 * wires up at deploy time. There is no secret in this file, none in the app,
 * and nothing to leak. If the address is ever abused, one `wrangler deploy`
 * replaces it — where a leaked token would have meant a new release for
 * everybody.
 *
 * Both answers use Cloudflare's own REST envelope
 * (`{ success, result: { … }, errors }`), because that is what the app already
 * knows how to read.
 *
 * **Why the mnemonic prompt lives here and the picture prompt does not.** The
 * picture prompt is fixed decoration around one word, so the app writes it and
 * tests it. The mnemonic prompt is the opposite: it is the whole feature, it
 * will be rewritten many times as its output is judged, and every rewrite is a
 * `wrangler deploy` rather than a new build of the app on a phone. Keeping it
 * here also means this endpoint takes four short strings instead of arbitrary
 * messages, so the address is not a general-purpose language model for whoever
 * finds it.
 *
 * Deploying it:
 *
 *   cd worker
 *   npx wrangler login      # opens a browser, once
 *   npx wrangler deploy
 *
 * The address it prints goes into `WORKER_URL` in `src/lib/ai-worker.ts`.
 */

/**
 * The image models this endpoint will run, by the short name a caller asks for.
 *
 * An allowlist rather than a passthrough, for the same reason `/mnemonic` takes
 * four strings instead of messages: the address is public, and a Worker that
 * runs whatever model it is handed is a Worker somebody else will run.
 *
 * **Measured 2026-09-08** against the 10 000 neurons that are free each day —
 * per 1024x1024 picture, and per association, which draws three at once:
 *
 *   schnell     57,6   →   173 per association   ~57 a day
 *   klein-4b   104,0   →   312 per association   ~32 a day
 *
 * Two models were compared here and then deliberately dropped, which is worth
 * more than their names: **`flux-2-dev` cost ~8000 neurons for a single
 * picture** — four fifths of the day, from one request, where the pricing page's
 * per-tile arithmetic predicted 150 — and `flux-2-klein-9b` is quoted at
 * 1363,64 per megapixel, which is the same order of magnitude. Neither is
 * reachable any more: the app never asked for them, and leaving them here meant
 * a public address where one POST could burn the day. Their prices are written
 * down so nobody re-adds them from the cennik alone.
 */
const IMAGE_MODELS = {
  schnell: '@cf/black-forest-labs/flux-1-schnell',
  'klein-4b': '@cf/black-forest-labs/flux-2-klein-4b',
};

/**
 * The two speeds the app knows about, and why each is a list.
 *
 * The app asks for an **outcome** — careful or quick — never for a model, the
 * same way it asks `/mnemonic` for an association and never learns who wrote
 * it. Which model that is stays here, where changing it costs a deploy instead
 * of a new build on somebody's phone.
 *
 * Measured 2026-09-08 on the same scene, three pictures in parallel:
 * schnell 3,9 s, klein-4b 20,8 s. Quick is five times faster; careful fills
 * the frame instead of leaving a doodle in a field of white.
 *
 * The second entry is what happens when the first refuses, and it is not
 * theoretical: schnell turned down "a young military cadet sitting on a wooden
 * chair" as NSFW (`8007`) — one of the very examples our own mnemonic prompt
 * teaches — where klein drew it without complaint. A slow picture beats a
 * baffling refusal, so quick falls back to careful and careful to quick.
 */
const QUALITY_MODELS = {
  fast: ['schnell', 'klein-4b'],
  accurate: ['klein-4b', 'schnell'],
};

/** What a caller that asks for neither a speed nor a model gets. */
const DEFAULT_QUALITY = 'fast';

/**
 * The biggest instruction-following model Workers AI offers on the free tier.
 * The task needs real knowledge of how two languages *sound*, which is exactly
 * where small models produce confident nonsense — so this is the one place in
 * the app where model size is worth its neurons.
 */
const TEXT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/**
 * Gemini, and why a second provider earns its keep.
 *
 * What was measured on 2026-09-07 is not a comprehension problem. Llama 3.3
 * spells the foreign word out correctly every single time — `żanela`,
 * `kaszoru`, `brydż`, even Spanish `ventana` as `bentana` — and then fails to
 * retrieve a Polish word anywhere near that sound, inventing `liw`, `kesz` and
 * `try` instead. That is a vocabulary problem, and no rewriting of the prompt
 * fixes a vocabulary problem; a model that actually knows the language does.
 *
 * The key is a Cloudflare secret (`wrangler secret put GEMINI_KEY`), so it sits
 * exactly where the `AI` binding sits: inside the Worker, never in the app, and
 * replaceable without shipping a new build to anybody. Nothing about the "no
 * secret on the phone" design changes by adding it.
 */
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * The models to try, best first, and why it is a list rather than a name.
 *
 * Every model on the free tier has its own daily allowance, and they are not
 * alike: measured against this key on 2026-09-07, the Flash models allow
 * **20 requests a day** and `flash-lite` allows **500**. Twenty is enough to
 * evaluate a prompt and not enough to use the feature, so the good model is
 * spent first and the roomy one carries the rest of the day.
 *
 * The ordering is a quality ordering, so running out degrades gradually
 * instead of falling off a cliff — and `flash-lite` is far more usable here
 * than its single answers suggested, because the user picks one of three:
 * nine of ten test pairs had a good option among its three, where judging it
 * on one answer had put it barely above llama.
 *
 * Anything left over falls through to Workers AI, which has no daily limit
 * at all — it is simply worse.
 */
const GEMINI_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
];

/**
 * Room for the object and for whatever thinking happens on the way to it.
 *
 * Thinking is emitted as output tokens, so a tight ceiling here does not save
 * money — it produces an empty answer. That is precisely how the reasoning
 * models on Workers AI (gpt-oss, qwen3.8, gemma-4) came back with nothing at
 * all in the bake-off, burning their neurons to say it.
 */
const GEMINI_MAX_TOKENS = 2048;

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
const MNEMONIC_SCHEMA = {
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
};

/** Cloudflare's own cap on the image prompt; the app trims to this too. */
const MAX_PROMPT = 2048;

/** A word plus its language. Longer than this is not a flashcard term. */
const MAX_TERM = 200;

/** The image model's ceiling. The app asks for fewer; see its STEPS. */
const MAX_STEPS = 8;

/**
 * The square every picture comes back as. Schnell draws 1024x1024 without being
 * asked; the FLUX 2 models want to be told, and telling them the same number is
 * what makes the comparison a comparison. It is also what the neuron price is
 * quoted against — four 512x512 tiles.
 */
const IMAGE_SIZE = 1024;

/** Room for the JSON object and nothing else. */
const MAX_TOKENS = 900;

/**
 * High on purpose. "Inne skojarzenie" has to actually produce another one, and
 * a mnemonic that is merely correct is useless — it has to be strange enough to
 * stick. This is the one call in the app where a boring answer is a failure.
 */
const TEMPERATURE = 0.95;

/** A reply in Cloudflare's envelope, so the app reads every answer the same way. */
const envelope = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // The app is React Native and needs none of this, but `expo start --web`
      // is a browser and would otherwise fail the preflight.
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, X-App-Secret',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  });

const failed = (message, status) => envelope({ success: false, errors: [{ message }] }, status);

const ok = (result) => envelope({ success: true, result, errors: [] });

/**
 * Whether a Workers AI failure was the daily free allowance running out.
 *
 * The binding throws rather than handing back a status code, so the only thing
 * to go on is its message — a heuristic, deliberately. Guessing wrong costs the
 * user a less exact sentence, not a broken feature.
 */
const looksLikeLimit = (message) =>
  /\b(429|4006|neuron|quota|rate.?limit|capacity|exceeded)\b/i.test(message);

/** Runs a model and turns anything it throws into an envelope. */
async function run(env, model, input) {
  try {
    return { result: await env.AI.run(model, input) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { failure: failed(message, looksLikeLimit(message) ? 429 : 502) };
  }
}

/** A trimmed string from the body, or '' when it is not one. */
const str = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/**
 * The model's answer as text, in whatever shape Workers AI hands it back.
 *
 * Three shapes are live at once, and only the first was handled: `response` as
 * a string (what the docs show), `response` **already parsed into an object**
 * (Cloudflare parses it itself when the answer looks like JSON), and the
 * OpenAI-style `choices[0].message.content`. Checked against the real binding
 * 2026-09-07: llama 3.3 returns the parsed object, so every mnemonic came back
 * as "the model returned nothing" while the model was in fact answering.
 *
 * Re-serialising the parsed object is deliberate. Reading the answer belongs in
 * one place with tests around it — `src/lib/mnemonic.ts` — so this endpoint
 * keeps handing over text and stays the transport it was.
 */
const textFrom = (result) => {
  const response = result?.response;

  if (typeof response === 'string') return response;
  if (response && typeof response === 'object') return JSON.stringify(response);

  const content = result?.choices?.[0]?.message?.content;

  return typeof content === 'string' ? content : '';
};

/** A list of language names, as the deck declared them. */
const langs = (value) =>
  Array.isArray(value)
    ? value
        .filter((name) => typeof name === 'string')
        .map((name) => name.trim().slice(0, 32))
        .filter(Boolean)
        .slice(0, 6)
    : [];

/** One language for the prompt, or an honest "unknown". */
const languagePhrase = (name) => name || 'unknown';

/**
 * The learner's languages as a ranking the model can act on.
 *
 * Written as "1. Polish (try this first)  2. English  3. German" rather than
 * "Polish or English", because the order **is** the instruction: these are the
 * languages the learner has, sorted by how readily each comes to mind, and a
 * sound-alike is worth more the higher up it was found.
 */
const languageRanking = (names) =>
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
 */
function mnemonicPrompt({ term, termLanguage, meaning, meaningLanguages }) {
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

  const example = (foreign, foreignLang, native, known, answers) =>
    [
      {
        role: 'user',
        content:
          `FOREIGN (${foreignLang}): ${foreign}\n` +
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
  const turns = [
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
        `MEANING: ${meaning}\n` +
        `KNOWN:\n${languageRanking(meaningLanguages)}`,
    },
  ];

  return { system, turns };
}

/** The same prompt in Workers AI's shape: the system message, then the turns. */
const forWorkersAi = ({ system, turns }) => [{ role: 'system', content: system }, ...turns];

/**
 * The same prompt in Gemini's shape.
 *
 * Two differences and no more: the system message travels beside the turns
 * rather than inside them, and what everyone else calls the assistant is called
 * the model here. Keeping one prompt and two adapters is the point — the words
 * that decide whether this feature works get rewritten often, and they must not
 * exist in two drifting copies.
 */
const forGemini = ({ system, turns }) => ({
  systemInstruction: { parts: [{ text: system }] },
  contents: turns.map(({ role, content }) => ({
    role: role === 'assistant' ? 'model' : 'user',
    parts: [{ text: content }],
  })),
});

/**
 * One association from Gemini as raw text, or the reason there is none.
 *
 * Nothing here throws and nothing here is fatal: every outcome comes back as
 * something the caller can fall back from.
 */
/**
 * One association from the first model that will answer.
 *
 * Any failure moves to the next model, not just an exhausted allowance: a
 * refused key or a bad request fails the same way on all of them and costs
 * one extra round trip to find out, while a model that is merely out of
 * quota is the case this exists for.
 */
async function geminiMnemonic(env, prompt) {
  let last = { error: 'no model tried' };

  for (const model of GEMINI_MODELS) {
    last = await geminiAsk(env, prompt, model);

    if (last.text) return { ...last, model };
  }

  return last;
}

/** One try, at one model. */
async function geminiAsk(env, prompt, model) {
  const { systemInstruction, contents } = forGemini(prompt);

  let response;

  try {
    response = await fetch(`${GEMINI_URL}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_KEY },
      body: JSON.stringify({
        systemInstruction,
        contents,
        generationConfig: {
          temperature: TEMPERATURE,
          maxOutputTokens: GEMINI_MAX_TOKENS,
          thinkingConfig: { thinkingLevel: 'low' },
          responseMimeType: 'application/json',
          responseSchema: MNEMONIC_SCHEMA,
        },
      }),
    });
  } catch (error) {
    return { error: `network — ${error instanceof Error ? error.message : String(error)}` };
  }

  const answer = await response.json().catch(() => null);

  // Google says which allowance ran out and why a key was refused, in a status
  // code and a sentence. Workers AI does neither, which is why the binding's
  // exhausted allowance is still guessed at from its message (`looksLikeLimit`).
  if (!response.ok) {
    return { error: `${model}: HTTP ${response.status} — ${answer?.error?.message ?? 'no explanation given'}` };
  }

  const text = (answer?.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part?.text)
    .filter((part) => typeof part === 'string')
    .join('');

  if (!text.trim()) {
    return { error: `empty answer (${answer?.candidates?.[0]?.finishReason ?? 'no reason given'})` };
  }

  return { text };
}

/* ------------------------------------------------------------------ routes */

/**
 * What each model wants on its input — which is not the same thing twice.
 *
 * `schnell` takes plain JSON and prices itself by `steps`: it is the distilled
 * model whose whole bill is how many you ask for.
 *
 * The FLUX 2 models take a **multipart form** instead, and refuse anything else
 * (`5006: required properties at '/' are 'multipart'`). That door exists
 * because they also accept reference images to work from — `input_image_0`
 * upwards — so even a bare prompt has to arrive through it. Nothing here sends
 * one, but that is why the shape is what it is.
 */
function imageInput(wanted, prompt, steps) {
  if (wanted === 'schnell') return { prompt, steps };

  const form = new FormData();

  form.append('prompt', prompt);
  form.append('width', String(IMAGE_SIZE));
  form.append('height', String(IMAGE_SIZE));

  // `Response` is the shortest way to a stream and its boundary header; the
  // binding wants both, and the boundary cannot be written by hand.
  const carrier = new Response(form);

  return {
    multipart: { body: carrier.body, contentType: carrier.headers.get('content-type') },
  };
}

async function handleImage(request, env) {
  let body;

  try {
    body = await request.json();
  } catch {
    return failed('Body is not JSON.', 400);
  }

  const prompt = str(body?.prompt, MAX_PROMPT);

  if (!prompt) return failed('No prompt.', 400);

  const asked = Number(body?.steps);
  const steps = Number.isFinite(asked)
    ? Math.min(Math.max(Math.trunc(asked), 1), MAX_STEPS)
    : MAX_STEPS;

  // `Object.hasOwn`, not a bare lookup: `{"model":"constructor"}` would
  // otherwise hand `env.AI.run` a function off the prototype.
  const named = str(body?.model, 32);

  if (named && !Object.hasOwn(IMAGE_MODELS, named)) {
    return failed(
      `No image model called "${named}". Have: ${Object.keys(IMAGE_MODELS).join(', ')}.`,
      400
    );
  }

  const quality = str(body?.quality, 16);

  // Naming a model is the terminal's door: one model and no fallback, so that
  // a comparison compares what it says it compares. The app names a speed.
  const chain = named
    ? [named]
    : QUALITY_MODELS[Object.hasOwn(QUALITY_MODELS, quality) ? quality : DEFAULT_QUALITY];

  let refusal = null;

  for (const name of chain) {
    const attempt = await run(env, IMAGE_MODELS[name], imageInput(name, prompt, steps));
    const image = attempt.result?.image;

    // Which model drew it, the way `/mnemonic` says who wrote the association:
    // the app ignores the field, and from a terminal it is the only way to know
    // that what you asked for is what you got.
    if (typeof image === 'string' && image.length > 0) {
      return ok({ image, source: IMAGE_MODELS[name] });
    }

    // A model answering without a picture has failed exactly as much as one
    // that threw — the app writes this straight into a file, so `undefined`
    // inside a success envelope must never be one of the shapes it can get.
    refusal = attempt.failure ?? failed('The model returned no image.', 502);
  }

  return refusal;
}

async function handleMnemonic(request, env) {
  let body;

  try {
    body = await request.json();
  } catch {
    return failed('Body is not JSON.', 400);
  }

  const term = str(body?.term, MAX_TERM);
  const meaning = str(body?.meaning, MAX_TERM);

  // Both halves are the whole input: a sound-alike needs a word to sound like,
  // and a scene needs a meaning to be about.
  if (!term) return failed('No term.', 400);
  if (!meaning) return failed('No meaning.', 400);

  const prompt = mnemonicPrompt({
    term,
    // One language, since 2026-09-08 — a word has one pronunciation. The old
    // list is still read so that an app built before that day keeps working:
    // its first entry was always the one that mattered.
    termLanguage: str(body?.termLanguage, 32) || langs(body?.termLanguages)[0] || '',
    meaning,
    meaningLanguages: langs(body?.meaningLanguages),
  });

  // Gemini first, Workers AI behind it. That fallback is the whole reason a
  // second provider is safe to add here: a bad key, an exhausted daily
  // allowance or a Google outage costs a weaker association, never a dead
  // button — and the app never learns that anything happened.
  if (env.GEMINI_KEY) {
    const attempt = await geminiMnemonic(env, prompt);

    if (attempt.text) return ok({ text: attempt.text, source: attempt.model });

    console.log(`Gemini unavailable, falling back to Workers AI: ${attempt.error}`);
  }

  const { result, failure } = await run(env, TEXT_MODEL, {
    messages: forWorkersAi(prompt),
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
  });

  if (failure) return failure;

  // Handed over as raw text on purpose: reading the model's answer is the half
  // that breaks silently when a model starts wrapping its JSON in prose, and it
  // belongs where there are tests for it — `src/lib/mnemonic.ts`.
  const text = textFrom(result);

  if (!text.trim()) return failed('The model returned nothing.', 502);

  return ok({ text, source: TEXT_MODEL });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return envelope({ success: true }, 204);
    if (request.method !== 'POST') return failed('Only POST is accepted here.', 405);

    // Optional lock, and off until it exists: `wrangler secret put APP_SECRET`
    // turns it on without touching this code. It is not real security — the
    // app has to carry the value, so it can be read out of the bundle like any
    // other constant — but unlike a provider token it is ours, it grants
    // nothing but this one endpoint, and replacing it is a redeploy.
    if (env.APP_SECRET && request.headers.get('X-App-Secret') !== env.APP_SECRET) {
      return failed('Bad app secret.', 403);
    }

    const { pathname } = new URL(request.url);

    // The root is the picture endpoint as well as `/image`: the first version
    // of this Worker had no paths at all, and an app still pointing at the bare
    // address must not break the moment this one is deployed.
    if (pathname === '/mnemonic') return handleMnemonic(request, env);
    if (pathname === '/' || pathname === '/image') return handleImage(request, env);

    return failed(`No endpoint at ${pathname}.`, 404);
  },
};
