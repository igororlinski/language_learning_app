/**
 * Turning a card's own words into a picture.
 *
 * The request goes to **our own Cloudflare Worker** (`worker/src/index.js`),
 * not to Cloudflare's API directly, and that is the whole point: the Worker
 * reaches Workers AI through a binding, so there is no API token in this app to
 * be unzipped out of the bundle and no key for a user to type in before the
 * feature works. An earlier version kept the token in `expo-secure-store` and
 * asked for it on a settings screen — correct for one phone, unusable for
 * anybody else, and the token was still one person's to burn.
 *
 * The Worker answers in Cloudflare's own envelope, so everything below the
 * request is unchanged from when this talked to Cloudflare directly.
 *
 * A picture is generated **once**, on a button in the card editor, and never
 * again — a review must never cost money or need a network.
 */

/**
 * Where the Worker lives, from `npx wrangler deploy` — see `worker/wrangler.toml`.
 *
 * It sits in the source rather than in `app.json` on purpose: reading it from
 * `expo-constants` would give this module a native dependency, and then it
 * could no longer run in the tests, which have no device.
 */
// Annotated rather than inferred: an empty literal would narrow to type `''`,
// and TypeScript would then treat every "is it set?" branch below as dead code.
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

/**
 * How many denoising steps to ask for, and the single biggest lever on cost.
 *
 * Cloudflare prices this model at 4.80 neurons per 512x512 tile plus **9.60 per
 * step**, so a 1024x1024 picture (four tiles) costs `19.2 + 9.6 * steps`. Steps
 * are therefore most of the bill, not a rounding error: eight of them cost 96
 * neurons — about 104 pictures inside the 10 000-neuron daily free allowance —
 * where four cost 57.6, or about 173 pictures.
 *
 * Four rather than the model's ceiling of eight because **schnell is a distilled
 * model, built to generate in one to four steps**. Asked for the same prompt at
 * 8, 4, 2 and 1 steps, it showed no visible degradation down to at least two;
 * the extra steps were buying nothing and costing 40% more. Raising this above
 * `MAX_STEPS` in the Worker needs a redeploy — the Worker clamps what it gets.
 */
const STEPS = 4;

/** Cloudflare's own limit on the prompt. */
const MAX_PROMPT = 2048;

/**
 * What actually gets asked for.
 *
 * A flashcard wants one recognisable thing on a plain background, not an
 * artwork: whatever is drawn has to read at a glance, on a phone, next to the
 * word it belongs to. Asking for no text matters more than it looks — image
 * models like writing labels into pictures, and a misspelt word on a vocabulary
 * card teaches the misspelling.
 *
 * The term goes in as the user typed it. A Polish term gives poorer results than
 * an English one, because that is what these models are trained on; translating
 * it first would mean a second provider and a second key, which is a trade worth
 * making only once the plain version proves not good enough.
 */
export function buildPrompt(term: string): string {
  const subject = term.trim().replace(/\s+/g, ' ');

  const prompt =
    `Simple, clear illustration of: ${subject}. ` +
    'Single subject, centred, plain light background, bright and legible at small size. ' +
    'No text, no letters, no numbers, no watermark.';

  return prompt.slice(0, MAX_PROMPT);
}

/** Why a generation failed — each one becomes a different thing to tell the user. */
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
  // address for its generator. Said plainly so a bug report can name it.
  'not-configured': 'Generator obrazów nie jest podłączony w tej wersji aplikacji.',
  'empty-prompt': 'To pole jest puste, więc nie ma z czego zrobić obrazu.',
  unauthorized: 'Generator obrazów odrzucił tę wersję aplikacji.',
  'rate-limited': 'Dzienny darmowy limit się wyczerpał. Spróbuj jutro.',
  provider: 'Nie udało się zrobić obrazu.',
  network: 'Brak połączenia z generatorem obrazów.',
  malformed: 'Generator odpowiedział czymś, czego nie rozumiem.',
};

export class AiImageError extends Error {
  constructor(
    readonly failure: AiFailure,
    detail?: string
  ) {
    // The provider's own words are worth keeping: "prompt blocked", "account
    // suspended" and "model overloaded" all arrive this way, and on a phone
    // there is no console to find them in.
    super(detail ? `${MESSAGES[failure]} (${detail})` : MESSAGES[failure]);
    this.name = 'AiImageError';
  }
}

/** Cloudflare wraps every answer in this envelope, success or not; so does the Worker. */
type Envelope = {
  result?: { image?: unknown } | null;
  success?: unknown;
  errors?: unknown;
};

/** The first error the generator reported, as text, if it reported one. */
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

/**
 * The base64 picture out of a parsed response body.
 *
 * Separate from the request so it can be tested without a network: this is the
 * half that breaks silently if the field ever moves, and the half that must
 * never hand a screen `undefined` to write into a file.
 */
export function imageFromResponse(body: unknown): string {
  if (!body || typeof body !== 'object') throw new AiImageError('malformed');

  const envelope = body as Envelope;

  // The envelope can say 200 with `success: false`; the status code alone is
  // not the whole truth.
  if (envelope.success === false) throw new AiImageError('provider', errorDetail(envelope));

  const image = envelope.result?.image;
  if (typeof image !== 'string' || image.length === 0) {
    throw new AiImageError('malformed', errorDetail(envelope));
  }

  return image;
}

/** Which failure an HTTP status means. */
export function failureForStatus(status: number): AiFailure {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429) return 'rate-limited';
  return 'provider';
}

/**
 * Asks for one picture and hands back the base64 image. Everything that can go
 * wrong comes back as an `AiImageError` with something sayable in it — this is
 * called from an event handler, where the error boundary cannot reach.
 *
 * The address is a parameter with a default so the tests can drive both the
 * configured and the unconfigured case; every screen calls it with one argument.
 */
export async function generateImage(term: string, workerUrl: string = WORKER_URL): Promise<string> {
  const endpoint = workerUrl.trim();

  if (!endpoint) throw new AiImageError('not-configured');
  if (!term.trim()) throw new AiImageError('empty-prompt');

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (APP_SECRET) headers['X-App-Secret'] = APP_SECRET;

  let response: Response;

  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt: buildPrompt(term), steps: STEPS }),
    });
  } catch (error) {
    throw new AiImageError('network', error instanceof Error ? error.message : undefined);
  }

  // Read the body first either way: a failing status still carries the
  // generator's explanation, and that explanation is the only diagnosis
  // available on a phone.
  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = body && typeof body === 'object' ? errorDetail(body as Envelope) : undefined;
    throw new AiImageError(failureForStatus(response.status), detail ?? `HTTP ${response.status}`);
  }

  return imageFromResponse(body);
}
