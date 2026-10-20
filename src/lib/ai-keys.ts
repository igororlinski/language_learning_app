import type { TextSource } from '@/lib/ai-transport';

/**
 * The user's own way into each AI provider, as typed on "Ustawienia AI".
 *
 * A fresh install has none of them, and that is the intended state: AI stays
 * off until the user brings their own accounts. Nothing here is shipped in the
 * app — there is no key of ours to extract, and nobody spends anybody else's
 * allowance.
 *
 * - **Gemini** writes associations and transcriptions (`aistudio.google.com`).
 * - **Cloudflare** — an account id and an API token with the "Workers AI"
 *   permission — draws every picture, and stands behind Gemini with llama when
 *   Gemini cannot answer. Either one of the two is enough for text.
 * - **LM Studio** is the user's own computer: an address, and a token only if
 *   they turned authentication on. It writes text instead of the cloud when
 *   chosen, and has nothing to do with pictures.
 *
 * Pure on purpose: the secure storage that holds these lives in
 * `ai-keys-store.ts`, so everything that decides what a set of keys allows can
 * be tested without a device.
 */
export type AiKeys = {
  gemini: string;
  cloudflareAccount: string;
  cloudflareToken: string;
  lmStudioUrl: string;
  lmStudioToken: string;
};

export const NO_KEYS: AiKeys = {
  gemini: '',
  cloudflareAccount: '',
  cloudflareToken: '',
  lmStudioUrl: '',
  lmStudioToken: '',
};

/**
 * LM Studio's address as something `fetch` can call.
 *
 * People paste what LM Studio shows them, which is rarely a full URL:
 * `192.168.1.20:1234` gets a scheme, a trailing slash goes, and so does a
 * trailing `/v1` — the paths here add their own.
 */
export function cleanLmStudioUrl(raw: string): string {
  let url = raw.trim();

  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;

  return url.replace(/\/+$/, '').replace(/\/v1$/i, '');
}

/** Keys as stored: trimmed, with the LM Studio address made callable. */
export function cleanKeys(keys: AiKeys): AiKeys {
  return {
    gemini: keys.gemini.trim(),
    cloudflareAccount: keys.cloudflareAccount.trim(),
    cloudflareToken: keys.cloudflareToken.trim(),
    lmStudioUrl: cleanLmStudioUrl(keys.lmStudioUrl),
    lmStudioToken: keys.lmStudioToken.trim(),
  };
}

export const hasGemini = (keys: AiKeys) => keys.gemini !== '';

/** Both halves, or neither counts: an account without a token opens nothing. */
export const hasCloudflare = (keys: AiKeys) =>
  keys.cloudflareAccount !== '' && keys.cloudflareToken !== '';

export const hasLmStudio = (keys: AiKeys) => keys.lmStudioUrl !== '';

/**
 * Why text cannot be written with these keys from this source, or null when it
 * can. The sentence is the hint under a greyed-out button, so it names what to
 * add rather than what went wrong.
 */
export function textBlocker(keys: AiKeys, source: TextSource): string | null {
  if (source.provider === 'lmstudio') {
    return hasLmStudio(keys) ? null : 'Wpisz adres LM Studio w Ustawieniach AI';
  }

  return hasGemini(keys) || hasCloudflare(keys)
    ? null
    : 'Dodaj klucz Gemini albo Cloudflare w Ustawieniach AI';
}

/** Why pictures cannot be drawn with these keys, or null when they can. */
export function drawBlocker(keys: AiKeys): string | null {
  return hasCloudflare(keys) ? null : 'Obrazy wymagają klucza Cloudflare (Ustawienia AI)';
}
