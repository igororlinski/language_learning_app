/**
 * The caps, on their own: the Workers runtime treats every export of the main
 * module as a handler and refuses to start on anything else, so constants the
 * tests need cannot live in `index.ts`.
 */

/** New accounts a day from one IP address. */
export const SIGNUPS_PER_IP = 5;

/** Wrong friend codes a day per account — enough for typos, not for guessing. */
export const WRONG_CODES_PER_DAY = 10;

export const MAX_FRIENDS = 50;
