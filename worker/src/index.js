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

const IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';

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
 * Not the newest Flash, and that is the finding rather than an oversight.
 *
 * Measured against this key on 2026-09-07: `gemini-3.8-flash`, `3.7` and
 * `3.6` share a free-tier allowance of **20 requests a day** — enough to
 * evaluate, not enough to use. `gemini-3.5-flash` has real headroom and
 * answered all ten test pairs without inventing a single word, including the
 * two that llama never solved in any run: `ventana` → `wentylator` and
 * `livro` → `lewar`. Flash-Lite was tried too and sits barely above llama, so
 * the full Flash is where the quality is.
 */
const GEMINI_MODEL = 'gemini-3.5-flash';

/**
 * Room for the object and for whatever thinking happens on the way to it.
 *
 * Thinking is emitted as output tokens, so a tight ceiling here does not save
 * money — it produces an empty answer. That is precisely how the reasoning
 * models on Workers AI (gpt-oss, qwen3.8, gemma-4) came back with nothing at
 * all in the bake-off, burning their neurons to say it.
 */
const GEMINI_MAX_TOKENS = 1024;

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
  type: 'object',
  properties: {
    sounds: { type: 'string' },
    keyword: { type: 'string' },
    sentence: { type: 'string' },
    prompt: { type: 'string' },
  },
  required: ['sounds', 'keyword', 'sentence', 'prompt'],
  propertyOrdering: ['sounds', 'keyword', 'sentence', 'prompt'],
};

/** Cloudflare's own cap on the image prompt; the app trims to this too. */
const MAX_PROMPT = 2048;

/** A word plus its language. Longer than this is not a flashcard term. */
const MAX_TERM = 200;

/** The image model's ceiling. The app asks for fewer; see its STEPS. */
const MAX_STEPS = 8;

/** Room for the JSON object and nothing else. */
const MAX_TOKENS = 300;

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

/** "portugalski" / "portugalski lub hiszpański" / "nieznany" — for the prompt. */
const languagePhrase = (names) => (names.length > 0 ? names.join(' or ') : 'unknown');

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
 * rules only assert: `Buch` → `buk` is an approximate match to a real word, and
 * every sentence in them is plain correct grammar rather than a pile of
 * alliteration.
 */
function mnemonicPrompt({ term, termLanguages, meaning, meaningLanguages }) {
  const system = [
    'You invent keyword-method mnemonics for language learners.',
    '',
    'The learner speaks NATIVE and is memorising a word in FOREIGN.',
    '',
    'Your one real task: say the FOREIGN word out loud in your head, and find a',
    'word in NATIVE that SOUNDS like it. The opening sounds matter most.',
    '',
    'The sound-alike word must:',
    '- be a REAL word of NATIVE, one a dictionary has and an ordinary speaker',
    '  would recognise. Never invent a word, and never bend a real one;',
    '- be spelled the way a dictionary spells it, never spelled out by ear;',
    '- if it helps, be a LONGER word whose beginning carries the sound — the',
    '  whole word still has to be real and picturable;',
    '- name something concrete you could photograph — a thing, an animal, a',
    '  person. A plain noun is best;',
    '- not be a translation of the FOREIGN word, and not be a word of any',
    '  other language.',
    '',
    'A rough sound match is fine and expected. A real word that sounds roughly',
    'right is always better than an invented word that sounds exactly right.',
    '',
    'Then write ONE short sentence in NATIVE that contains BOTH the sound-alike',
    'word AND the MEANING. Plain, grammatically correct, present tense, at most',
    'six words. Do not chase rhyme or alliteration — a correct ordinary sentence',
    'is worth more than a clever broken one.',
    '',
    'Answer with a single JSON object and nothing else:',
    '{"sounds":"…","keyword":"…","sentence":"…","prompt":"…"}',
    '',
    'sounds   — the FOREIGN word written out as it sounds, in NATIVE spelling.',
    'keyword  — the NATIVE sound-alike word, by itself.',
    'sentence — the sentence above.',
    'prompt   — exactly that sentence as a scene in ENGLISH for an image',
    '           generator: name what is physically visible and nothing else.',
    '           It must show the same things the sentence names. No text in',
    '           the image.',
    '',
    'Do not explain. Do not add fields. Do not use markdown.',
  ].join('\n');

  const example = (foreign, foreignLang, native, nativeLang, answer) =>
    [
      { role: 'user', content: `FOREIGN (${foreignLang}): ${foreign}\nNATIVE (${nativeLang}): ${native}` },
      { role: 'assistant', content: JSON.stringify(answer) },
    ];

  const turns = [
    ...example('comer', 'Portuguese', 'jeść', 'Polish', {
      sounds: 'komer',
      keyword: 'komar',
      sentence: 'Komar je kanapkę.',
      prompt: 'a giant mosquito eating a sandwich, simple illustration',
    }),
    ...example('Buch', 'German', 'książka', 'Polish', {
      sounds: 'buch',
      keyword: 'buk',
      sentence: 'Buk czyta książkę.',
      prompt: 'a beech tree holding an open book, simple illustration',
    }),
    ...example('key', 'English', 'klucz', 'Polish', {
      sounds: 'ki',
      keyword: 'kij',
      sentence: 'Kij przekręca klucz.',
      prompt: 'a wooden stick turning a key in a lock, simple illustration',
    }),
    ...example('cadeira', 'Portuguese', 'krzesło', 'Polish', {
      sounds: 'kadejra',
      keyword: 'kadet',
      sentence: 'Kadet siedzi na krześle.',
      prompt: 'a young military cadet sitting on a wooden chair, simple illustration',
    }),
    ...example('gato', 'Spanish', 'kot', 'Polish', {
      sounds: 'gato',
      keyword: 'gacie',
      sentence: 'Kot siedzi na gaciach.',
      prompt: 'a cat sitting on a pair of underpants, simple illustration',
    }),
    {
      role: 'user',
      content:
        `FOREIGN (${languagePhrase(termLanguages)}): ${term}\n` +
        `NATIVE (${languagePhrase(meaningLanguages)}): ${meaning}`,
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
async function geminiMnemonic(env, prompt) {
  const { systemInstruction, contents } = forGemini(prompt);

  let response;

  try {
    response = await fetch(`${GEMINI_URL}/${GEMINI_MODEL}:generateContent`, {
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
    return { error: `HTTP ${response.status} — ${answer?.error?.message ?? 'no explanation given'}` };
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

  const { result, failure } = await run(env, IMAGE_MODEL, { prompt, steps });
  if (failure) return failure;

  // The app writes this straight into a file, so an absent image must arrive
  // as a failure rather than as `undefined` in a success envelope.
  if (typeof result?.image !== 'string' || result.image.length === 0) {
    return failed('The model returned no image.', 502);
  }

  return ok({ image: result.image });
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
    termLanguages: langs(body?.termLanguages),
    meaning,
    meaningLanguages: langs(body?.meaningLanguages),
  });

  // Gemini first, Workers AI behind it. That fallback is the whole reason a
  // second provider is safe to add here: a bad key, an exhausted daily
  // allowance or a Google outage costs a weaker association, never a dead
  // button — and the app never learns that anything happened.
  if (env.GEMINI_KEY) {
    const attempt = await geminiMnemonic(env, prompt);

    if (attempt.text) return ok({ text: attempt.text, source: GEMINI_MODEL });

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
