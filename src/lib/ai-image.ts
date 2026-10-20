import type { PictureQuality } from '@/db/schema';
import { hasCloudflare, type AiKeys } from '@/lib/ai-keys';
import { AiError, runCloudflare } from '@/lib/ai-transport';
import { recordSpend } from '@/lib/ai-usage';

/**
 * Turning words into a picture, with FLUX on Workers AI — on the user's own
 * Cloudflare account since 2026-10-20 (`ai-keys.ts`), where it used to be the
 * Worker's binding on ours.
 *
 * A picture is generated **once**, on a button in the card editor, and never
 * again — a review must never cost money or need a network.
 */

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
 * the extra steps were buying nothing and costing 40% more. The model's own
 * ceiling is eight.
 */
const STEPS = 4;

/** Cloudflare's own limit on the prompt. */
const MAX_PROMPT = 2048;

/**
 * The decoration every picture prompt carries.
 *
 * A flashcard wants one recognisable thing on a plain background, not an
 * artwork: whatever is drawn has to read at a glance, on a phone, next to the
 * word it belongs to. Asking for no text matters more than it looks — image
 * models like writing labels into pictures, and a misspelt word on a vocabulary
 * card teaches the misspelling.
 *
 * The subject goes in as given. A Polish subject gives poorer results than an
 * English one, because that is what these models are trained on — which is why
 * a mnemonic's scene arrives from the language model already in English.
 */
export function buildPrompt(term: string): string {
  const subject = term.trim().replace(/\s+/g, ' ');

  const prompt =
    `Simple, clear illustration of: ${subject}. ` +
    'Single subject, centred, plain light background, bright and legible at small size. ' +
    'No text, no letters, no numbers, no watermark.';

  return prompt.slice(0, MAX_PROMPT);
}


/**
 * The image models, by the short name the rest of this file uses.
 *
 * **Measured 2026-09-08** against the 10 000 neurons that are free each day —
 * per 1024x1024 picture, and per association, which draws three at once:
 *
 *   schnell     57,6   →   173 per association   ~57 a day
 *   klein-4b   104,0   →   312 per association   ~32 a day
 *
 * Two more were tried and dropped, which is worth more than their names:
 * **`flux-2-dev` cost ~8000 neurons for one picture** — four fifths of a day —
 * where the pricing page predicted 150, and `flux-2-klein-9b` is priced in the
 * same order of magnitude. A new image model goes in here only after one call
 * has been measured on the Cloudflare dashboard, never from the price list.
 */
const IMAGE_MODELS = {
  schnell: '@cf/black-forest-labs/flux-1-schnell',
  'klein-4b': '@cf/black-forest-labs/flux-2-klein-4b',
} as const;

type ImageModel = keyof typeof IMAGE_MODELS;

/**
 * The two speeds the user chooses between, and why each is a list.
 *
 * Measured 2026-09-08 on the same scene, three pictures in parallel: schnell
 * 3,9 s, klein-4b 20,8 s. Quick is five times faster; careful fills the frame
 * instead of leaving a doodle in a field of white.
 *
 * The second entry is what happens when the first refuses, and it is not
 * theoretical: schnell turned down "a young military cadet sitting on a wooden
 * chair" as NSFW (`8007`) — one of the examples our own mnemonic prompt
 * teaches — where klein drew it without complaint. A slow picture beats a
 * baffling refusal, so quick falls back to careful and careful to quick.
 */
const QUALITY_MODELS: Record<PictureQuality, ImageModel[]> = {
  fast: ['schnell', 'klein-4b'],
  accurate: ['klein-4b', 'schnell'],
};

/**
 * The square every picture comes back as. Schnell draws 1024x1024 without being
 * asked; the FLUX 2 models want to be told. It is also what the neuron price is
 * quoted against — four 512x512 tiles.
 */
const IMAGE_SIZE = 1024;

/** What one picture cost, by the model that drew it. Measured 2026-09-08. */
const imageNeurons = (model: ImageModel) => (model === 'schnell' ? 19.2 + 9.6 * STEPS : 104);

/**
 * What each model wants on its input — which is not the same thing twice.
 *
 * `schnell` takes plain JSON and prices itself by `steps`. The FLUX 2 models
 * take a **multipart form** and refuse anything else (`5006: required
 * properties at '/' are 'multipart'`), because they also accept reference
 * images to work from; even a bare prompt has to arrive through that door.
 */
function imageInput(model: ImageModel, prompt: string): unknown {
  if (model === 'schnell') return { prompt, steps: STEPS };

  const form = new FormData();

  form.append('prompt', prompt);
  form.append('width', String(IMAGE_SIZE));
  form.append('height', String(IMAGE_SIZE));

  return form;
}

/**
 * One picture down the chain of models: the first one that draws wins.
 *
 * A model answering without a picture has failed exactly as much as one that
 * refused, because the caller writes this straight into a file.
 */
async function drawOne(
  keys: AiKeys,
  chain: ImageModel[],
  prompt: string
): Promise<{ image: string; model: ImageModel } | { error: AiError }> {
  let error = new AiError('malformed');

  for (const model of chain) {
    try {
      const result = await runCloudflare(
        keys.cloudflareAccount,
        keys.cloudflareToken,
        IMAGE_MODELS[model],
        imageInput(model, prompt)
      );
      const image = result.image;

      if (typeof image === 'string' && image.length > 0) return { image, model };

      error = new AiError('malformed', 'brak obrazu w odpowiedzi');
    } catch (failure) {
      error = failure instanceof AiError ? failure : new AiError('network');
    }
  }

  return { error };
}

/**
 * Several pictures of one prompt — a mnemonic's round of three — drawn side by
 * side, so the wait is one picture's, not three.
 *
 * Hands back however many were drawn: two pictures beat an error message, and
 * only a round that drew nothing at all has failed — with the first refusal,
 * which is what explains it. What was drawn is counted against today's neurons.
 */
export async function generatePictures(
  prompt: string,
  quality: PictureQuality,
  count: number,
  keys: AiKeys
): Promise<string[]> {
  if (!prompt.trim()) throw new AiError('empty-prompt');
  if (!hasCloudflare(keys)) throw new AiError('no-image-key');

  const chain = QUALITY_MODELS[quality] ?? QUALITY_MODELS.fast;
  const text = prompt.slice(0, MAX_PROMPT);

  const attempts = await Promise.all(
    Array.from({ length: Math.max(1, count) }, () => drawOne(keys, chain, text))
  );

  const drawn = attempts.filter(
    (attempt): attempt is { image: string; model: ImageModel } => 'image' in attempt
  );

  recordSpend('neurons', drawn.reduce((sum, attempt) => sum + imageNeurons(attempt.model), 0));

  if (drawn.length === 0) throw (attempts[0] as { error: AiError }).error;

  return drawn.map((attempt) => attempt.image);
}

/** One picture, as base64. The prompt is passed whole, so a mnemonic can send its scene. */
export async function generatePicture(
  prompt: string,
  quality: PictureQuality,
  keys: AiKeys
): Promise<string> {
  return (await generatePictures(prompt, quality, 1, keys))[0];
}

/** One picture of one word — what an `ai-image` field asks for. */
export async function generateImage(
  term: string,
  quality: PictureQuality,
  keys: AiKeys
): Promise<string> {
  if (!term.trim()) throw new AiError('empty-prompt');

  return generatePicture(buildPrompt(term), quality, keys);
}
