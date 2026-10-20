/**
 * The one door out of the app: every request to a model provider goes through
 * `send` here, and every way it can fail becomes an `AiError` with something
 * sayable in it.
 *
 * **The keys are the user's own** (2026-10-20). Until then every request went
 * through our Cloudflare Worker, which held one Gemini key and one Cloudflare
 * account for everybody. Now each user pastes their own keys on the "Ustawienia
 * AI" screen (`src/lib/ai-keys.ts`), they are kept in the phone's secure
 * storage, and the phone talks to Google, Cloudflare and LM Studio directly.
 * Nobody else's allowance is spent, and there is no shared address to abuse.
 *
 * Who is asked for what lives next door: `ai-text.ts` (Gemini, Workers AI's
 * llama, LM Studio), `ai-image.ts` (FLUX on Workers AI). This file knows only
 * HTTP, time limits and error shapes.
 */

/** Why a request failed — each one becomes a different thing to tell the user. */
export type AiFailure =
  | 'no-text-key'
  | 'no-image-key'
  | 'no-lmstudio'
  | 'empty-prompt'
  | 'unauthorized'
  | 'rate-limited'
  | 'provider'
  | 'network'
  | 'timeout'
  | 'malformed'
  | 'local-offline';

const MESSAGES: Record<AiFailure, string> = {
  // A fresh install has no keys at all, and AI stays off until the user adds
  // theirs. The screens grey the buttons out first; these are the safety net.
  'no-text-key': 'Dodaj klucz Gemini albo Cloudflare w Ustawieniach AI.',
  'no-image-key': 'Obrazy wymagają klucza Cloudflare — dodaj go w Ustawieniach AI.',
  'no-lmstudio': 'Wpisz adres LM Studio w Ustawieniach AI.',
  'empty-prompt': 'Nie ma z czego to zrobić — pole jest puste.',
  unauthorized: 'Klucz został odrzucony. Sprawdź go w Ustawieniach AI.',
  'rate-limited': 'Dzienny darmowy limit się wyczerpał. Spróbuj jutro.',
  provider: 'Nie udało się.',
  network: 'Brak połączenia z generatorem.',
  timeout: 'Generator nie odpowiedział w porę. Spróbuj jeszcze raz.',
  malformed: 'Generator odpowiedział czymś, czego nie rozumiem.',
  // The user picked LM Studio, so a quiet switch to the cloud would overrule
  // them; this says what is missing instead.
  'local-offline':
    'LM Studio nie odpowiada. Sprawdź, czy serwer działa i telefon jest w tej samej sieci.',
};

export class AiError extends Error {
  constructor(
    readonly failure: AiFailure,
    detail?: string
  ) {
    // The provider's own words are worth keeping: "prompt blocked", "account
    // suspended" and "model overloaded" all arrive this way, and on a phone
    // there is no console to find them in.
    super(detail ? `${MESSAGES[failure]} (${detail})` : MESSAGES[failure]);
    this.name = 'AiError';
  }
}

/* --------------------------------------------------------- text providers */

/**
 * Who writes associations and transcriptions: the cloud chain (Gemini, then
 * Workers AI's llama behind it) or LM Studio on the user's own computer.
 *
 * Pictures are not part of this — LM Studio runs language models only, so
 * every picture comes from Workers AI whatever is chosen here.
 */
export type TextProvider = 'cloud' | 'lmstudio';

export type TextSource = {
  provider: TextProvider;
  /**
   * Which LM Studio model, by the id LM Studio lists it under. Null means "the
   * first one it offers" — and means nothing at all for the cloud.
   */
  model: string | null;
};

export const CLOUD_TEXT: TextSource = { provider: 'cloud', model: null };

/** A source out of stored text; anything unrecognised is the cloud, the default. */
export function parseTextSource(provider: unknown, model: unknown): TextSource {
  if (provider !== 'lmstudio') return CLOUD_TEXT;

  const id = typeof model === 'string' ? model.trim() : '';

  return { provider: 'lmstudio', model: id || null };
}

/* ------------------------------------------------------------- the request */

/**
 * How long one request may take before the app stops waiting for it.
 *
 * Without a limit a request that never answered left the spinner turning for
 * good. A careful picture measured ~21 s (2026-09-08), and one that falls back
 * to the second model takes about twice that, so a minute lets every honest
 * answer through. Giving up only stops the wait: whatever the provider was
 * doing is still done, and still billed.
 */
export const REQUEST_TIMEOUT_MS = 60_000;

/**
 * The same limit for a model on the user's own computer. The mnemonic prompt
 * alone is a few thousand tokens to read before the first one is written, and
 * home hardware is slower than Gemini by a wide margin.
 */
export const LOCAL_TIMEOUT_MS = 120_000;

/** What came back: the status, and the body parsed as JSON (or null). */
export type Reply = { ok: boolean; status: number; body: unknown };

/**
 * Sends one request and hands back the reply, whatever its status.
 *
 * Only the two failures that leave no reply at all are thrown here — no
 * network and no answer in time. Reading a status is left to the caller,
 * because a 429 from Gemini means "try the next model" and from Cloudflare
 * means "say the allowance is gone".
 *
 * A `FormData` body goes out as-is: `fetch` writes its multipart boundary into
 * the content type itself, and setting that header by hand breaks it.
 */
export async function send(
  url: string,
  {
    method = 'POST',
    headers = {},
    body,
    timeoutMs = REQUEST_TIMEOUT_MS,
  }: {
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: unknown;
    timeoutMs?: number;
  } = {}
): Promise<Reply> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const allHeaders: Record<string, string> =
    body === undefined || isForm ? { ...headers } : { 'Content-Type': 'application/json', ...headers };

  try {
    let response: Response;

    try {
      response = await fetch(url, {
        method,
        headers: allHeaders,
        body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw new AiError('timeout');

      throw new AiError('network', error instanceof Error ? error.message : undefined);
    }

    // Read the body either way: a failing status still carries the provider's
    // explanation, and that explanation is the only diagnosis there is on a
    // phone. Still under the same limit — three pictures are most of a megabyte.
    const parsed: unknown = await response.json().catch(() => null);

    if (controller.signal.aborted) throw new AiError('timeout');

    return { ok: response.ok, status: response.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The provider's own explanation, whichever of the three shapes it uses:
 * Cloudflare's `errors: [{ message }]`, Google's `error: { message }`, and
 * LM Studio's `error` as either of the last two.
 */
export function errorDetail(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;

  const { errors, error } = body as { errors?: unknown; error?: unknown };

  if (Array.isArray(errors) && errors.length > 0) {
    const first: unknown = errors[0];

    if (typeof first === 'string') return first;
    if (first && typeof first === 'object' && 'message' in first) {
      const message = (first as { message: unknown }).message;
      if (typeof message === 'string') return message;
    }
  }

  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === 'string') return message;
  }

  return undefined;
}

/**
 * Whether a refusal was a daily allowance running out.
 *
 * Google says so with 429. Cloudflare's neuron allowance does not always come
 * back as a 429, so its message is read too — a heuristic, deliberately:
 * guessing wrong costs a less exact sentence, not a broken feature.
 */
const looksLikeLimit = (message: string | undefined) =>
  !!message && /\b(429|4006|neuron|quota|rate.?limit|capacity|exceeded)\b/i.test(message);

/**
 * Whether the provider said the key itself is wrong. Google answers a bad key
 * with **400** "API key not valid" (checked 2026-10-20), not with 401, so the
 * status alone would call a typo in the key a generic failure.
 */
const looksLikeBadKey = (message: string | undefined) =>
  !!message && /api key not valid|api_key_invalid|invalid api key|authentication error/i.test(message);

/** Which failure an HTTP status means, with the provider's words as a tiebreaker. */
export function failureForStatus(status: number, detail?: string): AiFailure {
  if (status === 401 || status === 403 || looksLikeBadKey(detail)) return 'unauthorized';
  if (status === 429 || looksLikeLimit(detail)) return 'rate-limited';
  return 'provider';
}

/** The error a failed reply means, worded for the user. */
export function refusal(reply: Reply): AiError {
  const detail = errorDetail(reply.body);

  return new AiError(failureForStatus(reply.status, detail), detail ?? `HTTP ${reply.status}`);
}

/**
 * The `result` object out of Cloudflare's envelope (`{ success, result, errors }`).
 *
 * Separate from the request so it can be tested without a network: this is the
 * half that breaks silently if a field ever moves, and the half that must never
 * hand a screen `undefined` to write into a file.
 */
export function resultFromResponse(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') throw new AiError('malformed');

  const envelope = body as { success?: unknown; result?: unknown };

  // The envelope can say 200 with `success: false`; the status code alone is
  // not the whole truth.
  if (envelope.success === false) throw new AiError('provider', errorDetail(body));

  const result = envelope.result;
  if (!result || typeof result !== 'object') throw new AiError('malformed', errorDetail(body));

  return result as Record<string, unknown>;
}

/* ------------------------------------------------------------- cloudflare */

const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4/accounts';

/**
 * Runs one Workers AI model on the user's own Cloudflare account and hands
 * back its `result`.
 *
 * This is the REST door to the same models the Worker used to reach through
 * its `AI` binding: an account id in the path and an API token with the
 * "Workers AI" permission in the header. `body` is JSON for most models and a
 * `FormData` for the FLUX 2 ones, which accept nothing else.
 */
export async function runCloudflare(
  account: string,
  token: string,
  model: string,
  body: unknown,
  timeoutMs?: number
): Promise<Record<string, unknown>> {
  const reply = await send(`${CLOUDFLARE_API}/${encodeURIComponent(account)}/ai/run/${model}`, {
    headers: { Authorization: `Bearer ${token}` },
    body,
    timeoutMs,
  });

  // A malformed or unknown account id is not a 401 but a 404 "Could not route
  // to /client/v4/accounts/…" (checked 2026-10-20). The models here are fixed,
  // so a 404 can only mean the id the user typed.
  if (reply.status === 404) throw new AiError('unauthorized', 'nieznane ID konta Cloudflare');
  if (!reply.ok) throw refusal(reply);

  return resultFromResponse(reply.body);
}
