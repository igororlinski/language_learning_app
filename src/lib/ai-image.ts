import { AiError, postToWorker } from '@/lib/ai-worker';

/**
 * Turning words into a picture, through our own Worker — see `ai-worker.ts` for
 * the address, the absence of a key and the ways a call can fail.
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
 * the extra steps were buying nothing and costing 40% more. Raising this above
 * `MAX_STEPS` in the Worker needs a redeploy — the Worker clamps what it gets.
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
 * Asks for one picture and hands back the base64 image.
 *
 * The prompt is passed whole rather than built here, so a mnemonic can send the
 * scene its own model invented instead of a bare word.
 */
export async function generatePicture(prompt: string, workerUrl?: string): Promise<string> {
  if (!prompt.trim()) throw new AiError('empty-prompt');

  const result = await postToWorker(
    '/image',
    { prompt: prompt.slice(0, MAX_PROMPT), steps: STEPS },
    workerUrl
  );

  const image = result.image;

  if (typeof image !== 'string' || image.length === 0) throw new AiError('malformed');

  return image;
}

/** One picture of one word — what an `ai-image` field asks for. */
export function generateImage(term: string, workerUrl?: string): Promise<string> {
  if (!term.trim()) throw new AiError('empty-prompt');

  return generatePicture(buildPrompt(term), workerUrl);
}
