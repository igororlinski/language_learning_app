import { hasCloudflare, hasGemini, hasLmStudio, type AiKeys } from '@/lib/ai-keys';
import type { Prompt, Shape, Turn } from '@/lib/ai-prompts';
import {
  AiError,
  LOCAL_TIMEOUT_MS,
  refusal,
  runCloudflare,
  send,
  type TextSource,
} from '@/lib/ai-transport';
import { recordSpend } from '@/lib/ai-usage';

/**
 * Who writes text — associations and transcriptions — and how each is asked.
 *
 * One prompt (`ai-prompts.ts`) and three adapters: Gemini, llama on Workers AI
 * and LM Studio all get the same words in their own wrapping. What comes back
 * is always **raw text**: reading it belongs in one place with tests around it
 * (`mnemonic.ts`, `ai-phonetic.ts`), whoever wrote it.
 */

/* ----------------------------------------------------------------- gemini */

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * The models to try, best first, and why it is a list rather than a name.
 *
 * Every model on the free tier has its own daily allowance, and they are not
 * alike: measured on 2026-09-07, the Flash models allow **20 requests a day**
 * and `flash-lite` allows **500**. Twenty is enough to evaluate a prompt and
 * not enough to use the feature, so the good model is spent first and the
 * roomy one carries the rest of the day. Running out degrades quality
 * gradually instead of greying the button out.
 *
 * `flash-lite` is far more usable here than its single answers suggested,
 * because the user picks one of three: nine of ten test pairs had a good
 * option among its three.
 */
export const GEMINI_MODELS = ['gemini-3.5-flash', 'gemini-3.5-flash-lite'];

/**
 * Room for the object and for whatever thinking happens on the way to it.
 * Thinking is emitted as output tokens, so a tight ceiling does not save
 * anything — it produces an empty answer.
 */
const GEMINI_MAX_TOKENS = 2048;

/**
 * The prompt in Gemini's shape. Two differences and no more: the system
 * message travels beside the turns rather than inside them, and the assistant
 * is called the model.
 */
export const forGemini = ({ system, turns }: Prompt) => ({
  systemInstruction: { parts: [{ text: system }] },
  contents: turns.map(({ role, content }) => ({
    role: role === 'assistant' ? 'model' : 'user',
    parts: [{ text: content }],
  })),
});

/** One try, at one Gemini model: the answer's text, or the error it ended in. */
async function geminiAsk(
  key: string,
  model: string,
  prompt: Prompt,
  shape: Shape
): Promise<{ text: string } | { error: AiError }> {
  let reply;

  try {
    reply = await send(`${GEMINI_URL}/${model}:generateContent`, {
      headers: { 'x-goog-api-key': key },
      body: {
        ...forGemini(prompt),
        generationConfig: {
          temperature: shape.temperature,
          maxOutputTokens: GEMINI_MAX_TOKENS,
          thinkingConfig: { thinkingLevel: 'low' },
          responseMimeType: 'application/json',
          responseSchema: shape.schema,
        },
      },
    });
  } catch (error) {
    return { error: error instanceof AiError ? error : new AiError('network') };
  }

  if (!reply.ok) return { error: refusal(reply) };

  const answer = reply.body as {
    candidates?: { content?: { parts?: { text?: unknown }[] }; finishReason?: string }[];
  } | null;
  const candidate = answer?.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .map((part) => part?.text)
    .filter((part): part is string => typeof part === 'string')
    .join('');

  if (!text.trim()) {
    return { error: new AiError('malformed', candidate?.finishReason ?? 'pusta odpowiedź') };
  }

  return { text };
}

/* ------------------------------------------------------------------ llama */

/**
 * The biggest instruction-following model Workers AI offers on the free tier,
 * run on the user's own Cloudflare account. It stands behind Gemini: worse at
 * finding real sound-alikes (it invents words — `liw`, `kesz`, measured
 * 2026-09-07), but with no daily request limit, so the button keeps working.
 */
export const LLAMA_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/** The prompt as chat messages — what llama and LM Studio both speak. */
export const forChat = ({ system, turns }: Prompt): ({ role: 'system'; content: string } | Turn)[] => [
  { role: 'system', content: system },
  ...turns,
];

/**
 * llama's answer as text, in whatever shape Workers AI hands it back.
 *
 * Three shapes are live at once: `response` as a string, `response` **already
 * parsed into an object** (Cloudflare parses it when the answer looks like
 * JSON — what llama 3.3 actually returns, checked 2026-09-07), and the
 * OpenAI-style `choices[0].message.content`. The parsed object is serialised
 * back so the one reader with tests reads every answer the same way.
 */
export function textFromWorkersAi(result: Record<string, unknown>): string {
  const response = result.response;

  if (typeof response === 'string') return response;
  if (response && typeof response === 'object') return JSON.stringify(response);

  const choices = result.choices as { message?: { content?: unknown } }[] | undefined;
  const content = choices?.[0]?.message?.content;

  return typeof content === 'string' ? content : '';
}

async function llamaAsk(keys: AiKeys, prompt: Prompt, shape: Shape): Promise<string> {
  const result = await runCloudflare(keys.cloudflareAccount, keys.cloudflareToken, LLAMA_MODEL, {
    messages: forChat(prompt),
    max_tokens: shape.llamaMaxTokens,
    temperature: shape.temperature,
  });

  const text = textFromWorkersAi(result);

  if (!text.trim()) throw new AiError('malformed', 'pusta odpowiedź');

  return text;
}

/* -------------------------------------------------------------- lm studio */

/**
 * LM Studio on the user's own computer, called straight from the phone.
 *
 * At home that is `http://<computer's address>:1234` with "Serve on Local
 * Network" on in LM Studio — no tunnel. Away from home, or on a network that
 * keeps devices apart (the ISTS Wi-Fi does), it needs a tunnel's `https://`
 * address instead; either goes into the same field.
 *
 * **Chosen, never fallen back to.** When the user picked LM Studio it is the
 * only model asked: someone who picked their own computer and got Google's
 * answer without a word would be told nothing true about what happened.
 */
const lmStudioHeaders = (keys: AiKeys): Record<string, string> =>
  keys.lmStudioToken ? { Authorization: `Bearer ${keys.lmStudioToken}` } : {};

/** Long enough for a computer that is awake; short enough that one asleep does not hold the screen. */
const LMSTUDIO_LIST_TIMEOUT_MS = 8000;

/**
 * Room for thinking. Local reasoning models (qwen3, gpt-oss, deepseek-r1)
 * think before they answer, and that thinking spends output tokens — the same
 * trap as `GEMINI_MAX_TOKENS`, with smaller models that think longer.
 */
const LMSTUDIO_MAX_TOKENS = 4096;

/**
 * Embedding models sit in the same list as chat models, and asking one to
 * write an association fails with an error nobody can act on.
 */
const isChatModel = (id: string) => !/embed/i.test(id);

/** What the phone found when it called LM Studio. */
export type LmStudioStatus = { online: boolean; models: string[] };

/** The chat models LM Studio offers — and, by answering at all, whether it is there. */
export async function checkLmStudio(keys: AiKeys): Promise<LmStudioStatus> {
  if (!hasLmStudio(keys)) return { online: false, models: [] };

  let reply;

  try {
    reply = await send(`${keys.lmStudioUrl}/v1/models`, {
      method: 'GET',
      headers: lmStudioHeaders(keys),
      timeoutMs: LMSTUDIO_LIST_TIMEOUT_MS,
    });
  } catch {
    return { online: false, models: [] };
  }

  if (!reply.ok) return { online: false, models: [] };

  const data = (reply.body as { data?: unknown } | null)?.data;
  const models = (Array.isArray(data) ? data : [])
    .map((model) => (model as { id?: unknown } | null)?.id)
    .filter((id): id is string => typeof id === 'string' && id.trim() !== '' && isChatModel(id));

  return { online: true, models };
}

/**
 * A Gemini schema as plain JSON Schema. `propertyOrdering` is Google's own
 * keyword; LM Studio's grammar follows the order `properties` is written in,
 * which is the same order, so the keyword is only noise to it — and noise in a
 * schema is a way for a request to come back a 400.
 */
export function plainSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(plainSchema);
  if (!schema || typeof schema !== 'object') return schema;

  return Object.fromEntries(
    Object.entries(schema)
      .filter(([key]) => key !== 'propertyOrdering')
      .map(([key, value]) => [key, plainSchema(value)])
  );
}

async function lmStudioAsk(
  keys: AiKeys,
  prompt: Prompt,
  shape: Shape,
  requestedModel: string | null
): Promise<string> {
  if (!hasLmStudio(keys)) throw new AiError('no-lmstudio');

  let model = requestedModel;

  // No model chosen: the first chat model LM Studio offers. The same request
  // doubles as the check that the computer is there at all.
  if (!model) {
    const status = await checkLmStudio(keys);

    if (!status.online) throw new AiError('local-offline');

    model = status.models[0] ?? null;

    if (!model) throw new AiError('provider', 'LM Studio nie ma załadowanego modelu');
  }

  let reply;

  try {
    reply = await send(`${keys.lmStudioUrl}/v1/chat/completions`, {
      headers: lmStudioHeaders(keys),
      timeoutMs: LOCAL_TIMEOUT_MS,
      body: {
        model,
        messages: forChat(prompt),
        temperature: shape.temperature,
        max_tokens: LMSTUDIO_MAX_TOKENS,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'answer', strict: true, schema: plainSchema(shape.schema) },
        },
      },
    });
  } catch (error) {
    // No answer in time is still a timeout; no connection at all is the
    // computer, and that has its own sentence.
    if (error instanceof AiError && error.failure === 'timeout') throw error;

    throw new AiError('local-offline');
  }

  // 5xx is a tunnel in front of a computer that is off; 4xx is LM Studio
  // refusing the request itself (an unknown model, a schema it cannot
  // compile), and its own words are the diagnosis.
  if (!reply.ok) {
    if (reply.status >= 500) throw new AiError('local-offline');
    throw refusal(reply);
  }

  const choices = (reply.body as { choices?: { message?: { content?: unknown } }[] } | null)
    ?.choices;

  // A reasoning model that leaks its thinking into the content would put
  // braces in front of the answer, and the readers count braces.
  const text = String(choices?.[0]?.message?.content ?? '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .trim();

  if (!text) throw new AiError('malformed', 'pusta odpowiedź');

  return text;
}

/* ------------------------------------------------------------ the chooser */

/**
 * The answer to one prompt, as raw text, from whoever the user chose.
 *
 * - **LM Studio** when chosen — and nothing behind it.
 * - **The cloud** otherwise: each Gemini model in turn, then llama on
 *   Cloudflare. Any failure moves to the next one — an exhausted allowance,
 *   an overloaded model — **except a rejected key**, which is the user's to
 *   fix and is said at once. Whichever has no key is skipped; with neither,
 *   nothing is sent at all.
 *
 * Only a successful Gemini answer is counted against the day's allowance.
 * llama is what happens once that allowance is spent, not part of it.
 */
export async function writeText(
  prompt: Prompt,
  shape: Shape,
  source: TextSource,
  keys: AiKeys
): Promise<string> {
  if (source.provider === 'lmstudio') return lmStudioAsk(keys, prompt, shape, source.model);

  if (!hasGemini(keys) && !hasCloudflare(keys)) throw new AiError('no-text-key');

  let last: AiError | null = null;

  if (hasGemini(keys)) {
    for (const model of GEMINI_MODELS) {
      const attempt = await geminiAsk(keys.gemini, model, prompt, shape);

      if ('text' in attempt) {
        recordSpend('gemini', 1);
        return attempt.text;
      }

      // A key the user typed wrong is said, not papered over: falling through
      // to llama would make a typo look like a working setup with worse
      // answers, and nobody would ever find out why.
      if (attempt.error.failure === 'unauthorized') throw attempt.error;

      last = attempt.error;
    }
  }

  if (hasCloudflare(keys)) return llamaAsk(keys, prompt, shape);

  // Gemini alone, and it refused: its own reason is the one to give — a
  // spent allowance says so, a bad key says so.
  throw last ?? new AiError('provider');
}
