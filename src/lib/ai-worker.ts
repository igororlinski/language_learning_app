/**
 * The one door out of the app: our own Cloudflare Worker (`worker/src/index.js`).
 *
 * Everything the app asks a model for goes through here — a picture, and the
 * mnemonic association behind it — because they share the same address, the
 * same absence of a key, the same envelope and the same list of ways to fail.
 * An earlier version kept a Cloudflare token in `expo-secure-store` and asked
 * for it on a settings screen; that was correct for one phone, unusable for
 * anybody else, and the token was still one person's to burn.
 *
 * There is no credential in this file. The Worker reaches Workers AI through a
 * binding Cloudflare attaches at deploy time, so there is nothing in the bundle
 * to extract and nothing for a user to configure.
 */

/**
 * Where the Worker lives, from `npx wrangler deploy` — see `worker/wrangler.toml`.
 *
 * Annotated rather than inferred: an empty literal would narrow to type `''`,
 * and TypeScript would treat every "is it set?" branch as dead code. It sits in
 * the source rather than in `app.json` because reading it through
 * `expo-constants` would give this module a native dependency, and then it
 * could no longer run in the tests, which have no device.
 */
export const WORKER_URL: string = 'https://flashcards-ai.orli-dev.workers.dev';

/**
 * Matches `APP_SECRET` in the Worker, when one is set there. Empty means the
 * Worker has no lock, which is the state it deploys in.
 *
 * This is a lock, not a secret: it ships inside the app like any other constant
 * and can be read out of it. What it buys is that abuse of the address costs a
 * `wrangler secret put` and a redeploy to stop, instead of a new release.
 */
const APP_SECRET: string = '';

/** Why a request failed — each one becomes a different thing to tell the user. */
export type AiFailure =
  | 'not-configured'
  | 'empty-prompt'
  | 'unauthorized'
  | 'rate-limited'
  | 'provider'
  | 'network'
  | 'malformed';

const MESSAGES: Record<AiFailure, string> = {
  // Nothing the user can fix from the phone: the app was built without an
  // address for its Worker. Said plainly so a bug report can name it.
  'not-configured': 'Generator nie jest podłączony w tej wersji aplikacji.',
  'empty-prompt': 'Nie ma z czego to zrobić — pole jest puste.',
  unauthorized: 'Generator odrzucił tę wersję aplikacji.',
  'rate-limited': 'Dzienny darmowy limit się wyczerpał. Spróbuj jutro.',
  provider: 'Nie udało się.',
  network: 'Brak połączenia z generatorem.',
  malformed: 'Generator odpowiedział czymś, czego nie rozumiem.',
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

/** Cloudflare wraps every answer in this envelope, success or not; so does the Worker. */
type Envelope = {
  result?: Record<string, unknown> | null;
  success?: unknown;
  errors?: unknown;
};

/** The first error the Worker reported, as text, if it reported one. */
function errorDetail(body: Envelope): string | undefined {
  if (!Array.isArray(body.errors) || body.errors.length === 0) return undefined;

  const first: unknown = body.errors[0];
  if (typeof first === 'string') return first;

  if (first && typeof first === 'object' && 'message' in first) {
    const message = (first as { message: unknown }).message;
    if (typeof message === 'string') return message;
  }

  return undefined;
}

/** Which failure an HTTP status means. */
export function failureForStatus(status: number): AiFailure {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429) return 'rate-limited';
  return 'provider';
}

/**
 * The `result` object out of a parsed response body.
 *
 * Separate from the request so it can be tested without a network: this is the
 * half that breaks silently if a field ever moves, and the half that must never
 * hand a screen `undefined` to write into a file.
 */
export function resultFromResponse(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') throw new AiError('malformed');

  const envelope = body as Envelope;

  // The envelope can say 200 with `success: false`; the status code alone is
  // not the whole truth.
  if (envelope.success === false) throw new AiError('provider', errorDetail(envelope));

  const result = envelope.result;
  if (!result || typeof result !== 'object') throw new AiError('malformed', errorDetail(envelope));

  return result;
}

/**
 * Posts one errand to the Worker and hands back its `result`.
 *
 * Everything that can go wrong comes back as an `AiError` with something
 * sayable in it — these calls are made from event handlers, where the error
 * boundary cannot reach.
 *
 * The address is a parameter with a default so the tests can drive both the
 * configured and the unconfigured case; every screen calls it without one.
 */
export async function postToWorker(
  path: string,
  body: Record<string, unknown>,
  workerUrl: string = WORKER_URL
): Promise<Record<string, unknown>> {
  const base = workerUrl.trim().replace(/\/+$/, '');

  if (!base) throw new AiError('not-configured');

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (APP_SECRET) headers['X-App-Secret'] = APP_SECRET;

  let response: Response;

  try {
    response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new AiError('network', error instanceof Error ? error.message : undefined);
  }

  // Read the body first either way: a failing status still carries the Worker's
  // explanation, and that explanation is the only diagnosis available on a phone.
  const parsed: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const detail =
      parsed && typeof parsed === 'object' ? errorDetail(parsed as Envelope) : undefined;
    throw new AiError(failureForStatus(response.status), detail ?? `HTTP ${response.status}`);
  }

  return resultFromResponse(parsed);
}
