/**
 * Ids, recovery codes and friend codes.
 *
 * Codes are Crockford's base32: digits and capitals without I, L, O and U, so
 * nothing read off a screen can be mistyped as something else. Reading is
 * forgiving — any case, with or without dashes and spaces, O for 0 and I or L
 * for 1 — and writing always gives the same grouped form.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 100 bits: guessing one is out of the question, so it can be the password. */
export const RECOVERY_LENGTH = 20;

/** 40 bits: enough not to be found by trying, short enough to read out. */
export const FRIEND_LENGTH = 8;

/** `length` characters, each from one random byte — 256 is 8 × 32, so no bias. */
function randomCode(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));

  return Array.from(bytes, (byte) => ALPHABET[byte & 31]).join('');
}

/** `ABCD-EFGH-…`: groups of four. */
const grouped = (code: string) => code.match(/.{1,4}/g)!.join('-');

export const newRecoveryCode = (): string => grouped(randomCode(RECOVERY_LENGTH));

export const newFriendCode = (): string => grouped(randomCode(FRIEND_LENGTH));

/**
 * A code as typed, back to its grouped form — or null when it cannot be one of
 * `length` characters. The grouped form is what is stored and hashed, so a
 * code typed in lower case without dashes still finds its account.
 */
export function normalizeCode(input: unknown, length: number): string | null {
  if (typeof input !== 'string') return null;

  const code = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');

  if (code.length !== length || [...code].some((char) => !ALPHABET.includes(char))) return null;

  return grouped(code);
}

/** SHA-256, hex. What the database keeps of a recovery code. */
export async function hashCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** 32 hex characters, like the app's own uids. */
export function newId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}
