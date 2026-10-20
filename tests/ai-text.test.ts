/**
 * Who writes text, and how each is asked: Gemini first, llama on Cloudflare
 * behind it, or LM Studio alone when the user chose it. All against a stubbed
 * `fetch` — the contract, not the models.
 */
import { NO_KEYS } from '@/lib/ai-keys';
import { MNEMONIC_SHAPE, PHONETIC_SHAPE, type Prompt } from '@/lib/ai-prompts';
import { checkLmStudio, GEMINI_MODELS, LLAMA_MODEL, plainSchema, writeText } from '@/lib/ai-text';
import { CLOUD_TEXT } from '@/lib/ai-transport';
import { setSpendSink } from '@/lib/ai-usage';

import { bodyOf, headersOf, withStub } from './ai-transport.test';
import { check, group } from './harness';

const PROMPT: Prompt = {
  system: 'SYSTEM',
  turns: [
    { role: 'user', content: 'pytanie' },
    { role: 'assistant', content: 'odpowiedz' },
    { role: 'user', content: 'teraz' },
  ],
};

const GEMINI = { ...NO_KEYS, gemini: 'GKEY' };
const BOTH = { ...GEMINI, cloudflareAccount: 'ACC', cloudflareToken: 'CFT' };
const LOCAL = { provider: 'lmstudio', model: null } as const;

const geminiSays = (text: string) => ({
  status: 200,
  body: { candidates: [{ content: { parts: [{ text }] } }] },
});

let spent: string[] = [];

setSpendSink((metric, _day, amount) => spent.push(`${metric}:${amount}`));

group('Gemini na kluczu uzytkownika');

const asked = await withStub(geminiSays('[{"keyword":"komar"}]'), () =>
  writeText(PROMPT, MNEMONIC_SHAPE, CLOUD_TEXT, GEMINI)
);

check('odpowiedz wraca jako tekst', asked.outcome, '[{"keyword":"komar"}]');
check(
  'najlepszy model pierwszy',
  asked.sent?.url,
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODELS[0]}:generateContent`
);
check('klucz w naglowku, nie w adresie', headersOf(asked.sent)['x-goog-api-key'], 'GKEY');

const geminiBody = bodyOf(asked.sent) as {
  systemInstruction?: { parts?: { text?: string }[] };
  contents?: { role?: string }[];
  generationConfig?: { responseSchema?: unknown; temperature?: unknown };
};

check('instrukcja obok rozmowy', geminiBody.systemInstruction?.parts?.[0]?.text, 'SYSTEM');
// Gemini calls the assistant the model.
check('asystent nazywa sie model', geminiBody.contents?.map((turn) => turn.role), ['user', 'model', 'user']);
check('schemat wymuszony', geminiBody.generationConfig?.responseSchema, MNEMONIC_SHAPE.schema);
check('udana odpowiedz liczy sie do limitu', spent, ['gemini:1']);

group('Gemini sie konczy: kolejne modele, potem llama');

spent = [];

const fallen = await withStub(
  (url) =>
    url.includes(GEMINI_MODELS[0])
      ? { status: 429, body: { error: { message: 'quota' } } }
      : url.includes('generativelanguage')
        ? { status: 500, body: {} }
        : { status: 200, body: { success: true, result: { response: { keyword: 'kesz' } } } },
  () => writeText(PROMPT, MNEMONIC_SHAPE, CLOUD_TEXT, BOTH)
);

check('trzy proby po kolei', fallen.calls.length, 3);
check(
  'ostatnia na koncie Cloudflare uzytkownika',
  fallen.calls[2]?.url,
  `https://api.cloudflare.com/client/v4/accounts/ACC/ai/run/${LLAMA_MODEL}`
);
check('z jego tokenem', headersOf(fallen.calls[2]).Authorization, 'Bearer CFT');
// Cloudflare parses an answer that looks like JSON; it goes back to text.
check('odpowiedz llamy wraca jako tekst', fallen.outcome, '{"keyword":"kesz"}');
check('llama nie liczy sie do limitu Gemini', spent, []);

const llamaBody = bodyOf(fallen.calls[2]) as { messages?: { role: string }[]; max_tokens?: number };

check('llama dostaje rozmowe z instrukcja na poczatku', llamaBody.messages?.[0]?.role, 'system');
check('i wlasny sufit tokenow', llamaBody.max_tokens, MNEMONIC_SHAPE.llamaMaxTokens);

const spentOut = await withStub({ status: 429, body: { error: { message: 'quota' } } }, () =>
  writeText(PROMPT, PHONETIC_SHAPE, CLOUD_TEXT, GEMINI)
);

check('sam Gemini bez Cloudflare mowi, czemu odmowil', spentOut.outcome, 'rate-limited');

// Google answers a bad key with 400 "API key not valid", checked live.
const badKey = await withStub(
  { status: 400, body: { error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } } },
  () => writeText(PROMPT, MNEMONIC_SHAPE, CLOUD_TEXT, BOTH)
);

check('zly klucz Gemini to odrzucony klucz', badKey.outcome, 'unauthorized');
// A typo must not look like a working setup with worse answers.
check('i nie chowa sie za llama', badKey.calls.length, 1);

const cloudflareOnly = await withStub(
  { status: 200, body: { success: true, result: { response: '/kuˈmeɾ/' } } },
  () => writeText(PROMPT, PHONETIC_SHAPE, CLOUD_TEXT, { ...BOTH, gemini: '' })
);

check('bez Gemini od razu llama', cloudflareOnly.calls.length, 1);
check('i odpowiada', cloudflareOnly.outcome, '/kuˈmeɾ/');

const none = await withStub({ status: 200, body: {} }, () =>
  writeText(PROMPT, MNEMONIC_SHAPE, CLOUD_TEXT, NO_KEYS)
);

check('bez kluczy nic nie wychodzi', none.calls.length, 0);
check('a odmowa mowi, co dodac', none.outcome, 'no-text-key');

group('LM Studio wprost z telefonu');

const lmKeys = { ...BOTH, lmStudioUrl: 'http://192.168.1.20:1234', lmStudioToken: 'LMT' };
const models = {
  status: 200,
  body: { data: [{ id: 'text-embedding-nomic' }, { id: 'qwen3-14b' }, { id: 'gemma-3-12b' }] },
};
const chat = (content: string) => ({ status: 200, body: { choices: [{ message: { content } }] } });

const studio = await withStub(
  (url) => (url.endsWith('/v1/models') ? models : chat('<think>{hmm}</think>[{"keyword":"komar"}]')),
  () => writeText(PROMPT, MNEMONIC_SHAPE, LOCAL, lmKeys)
);

const completion = studio.calls.find((call) => call.url.endsWith('/v1/chat/completions'));
const completionBody = bodyOf(completion) as {
  model?: string;
  response_format?: { json_schema?: { schema?: unknown } };
};

check('pierwszy model czatu, nie embeddingow', completionBody.model, 'qwen3-14b');
check('myslenie wyciete z odpowiedzi', studio.outcome, '[{"keyword":"komar"}]');
check('token LM Studio w naglowku', headersOf(completion).Authorization, 'Bearer LMT');
check(
  'schemat bez googlowego propertyOrdering',
  JSON.stringify(completionBody.response_format).includes('propertyOrdering'),
  false
);
check('ale ten sam w reszcie', completionBody.response_format?.json_schema?.schema, plainSchema(MNEMONIC_SHAPE.schema));
check('Gemini nawet nie pytany', studio.calls.some((call) => call.url.includes('google')), false);

const chosen = await withStub(chat('{"ipa":"/x/"}'), () =>
  writeText(PROMPT, PHONETIC_SHAPE, { provider: 'lmstudio', model: 'gemma-3-12b' }, lmKeys)
);

check('wybrany model bez pytania o liste', chosen.calls.length, 1);
check('i to on jedzie w zadaniu', bodyOf(chosen.sent).model, 'gemma-3-12b');

const off = await withStub(
  () => {
    throw new Error('Network request failed');
  },
  () => writeText(PROMPT, MNEMONIC_SHAPE, { provider: 'lmstudio', model: 'm' }, lmKeys)
);

// Chosen, never fallen back to: an off computer is said, not covered by Gemini.
check('wylaczony komputer ma wlasne zdanie', off.outcome, 'local-offline');
check('i nikt inny nie jest pytany', off.calls.length, 1);

const tunnel = await withStub({ status: 530, body: null }, () =>
  writeText(PROMPT, MNEMONIC_SHAPE, { provider: 'lmstudio', model: 'm' }, lmKeys)
);

check('martwy tunel to tez wylaczony komputer', tunnel.outcome, 'local-offline');

const refused = await withStub({ status: 400, body: { error: 'model not found' } }, () =>
  writeText(PROMPT, MNEMONIC_SHAPE, { provider: 'lmstudio', model: 'm' }, lmKeys)
);

check('odmowa samego LM Studio to zwykly blad', refused.outcome, 'provider');

const noAddress = await withStub(chat('x'), () =>
  writeText(PROMPT, MNEMONIC_SHAPE, LOCAL, BOTH)
);

check('bez adresu LM Studio nic nie wychodzi', noAddress.calls.length, 0);
check('a odmowa mowi, czego brak', noAddress.outcome, 'no-lmstudio');

const status = await withStub(models, () =>
  checkLmStudio(lmKeys).then((found) => JSON.stringify(found))
);

check('stan: odpowiada, z modelami czatu', status.outcome, '{"online":true,"models":["qwen3-14b","gemma-3-12b"]}');
check('lista pytana pod /v1/models', status.sent?.url, 'http://192.168.1.20:1234/v1/models');
check('metoda GET', status.sent?.init.method, 'GET');

setSpendSink(null);
