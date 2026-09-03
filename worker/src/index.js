/**
 * The picture generator, moved off the phone.
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
 * The answer is shaped exactly like Cloudflare's own REST envelope
 * (`{ success, result: { image }, errors }`), because that is what the app
 * already knows how to read: moving the provider changed the address the app
 * calls and nothing else.
 *
 * Deploying it:
 *
 *   cd worker
 *   npx wrangler login      # opens a browser, once
 *   npx wrangler deploy
 *
 * The address it prints goes into `WORKER_URL` in `src/lib/ai-image.ts`.
 */

const MODEL = '@cf/black-forest-labs/flux-1-schnell';

/** Cloudflare's own cap on the prompt; the app trims to this too. */
const MAX_PROMPT = 2048;

/** The model's ceiling. More steps is a better picture at the same price tier. */
const MAX_STEPS = 8;

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

/**
 * Whether a Workers AI failure was the daily free allowance running out.
 *
 * The binding throws rather than handing back a status code, so the only thing
 * to go on is its message — a heuristic, deliberately. Guessing wrong costs the
 * user a less exact sentence ("Cloudflare nie zrobił obrazu" instead of "limit
 * się wyczerpał"); not guessing at all would cost them that sentence always.
 */
const looksLikeLimit = (message) =>
  /\b(429|4006|neuron|quota|rate.?limit|capacity|exceeded)\b/i.test(message);

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

    let body;

    try {
      body = await request.json();
    } catch {
      return failed('Body is not JSON.', 400);
    }

    const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';

    if (!prompt) return failed('No prompt.', 400);
    if (prompt.length > MAX_PROMPT) return failed(`Prompt over ${MAX_PROMPT} characters.`, 400);

    const asked = Number(body?.steps);
    const steps = Number.isFinite(asked) ? Math.min(Math.max(Math.trunc(asked), 1), MAX_STEPS) : MAX_STEPS;

    let result;

    try {
      result = await env.AI.run(MODEL, { prompt, steps });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return failed(message, looksLikeLimit(message) ? 429 : 502);
    }

    // The app writes this straight into a file, so an absent image must arrive
    // as a failure rather than as `undefined` in a success envelope.
    if (typeof result?.image !== 'string' || result.image.length === 0) {
      return failed('The model returned no image.', 502);
    }

    return envelope({ success: true, result: { image: result.image }, errors: [] });
  },
};
