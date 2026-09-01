/**
 * The FSRS knobs a deck may set, and the rules for reading them.
 *
 * Kept free of ts-fsrs and of the database so both the editor and the scheduler
 * can lean on the same parsing — a deck row holds these as plain text and plain
 * numbers, and exactly one place decides what that text means.
 */

/** How a step may be written: a whole number of minutes, hours or days. */
const STEP = /^(\d+)([mhd])$/;

const MINUTES: Record<string, number> = { m: 1, h: 60, d: 24 * 60 };

/** Six is already more steps than anyone works through in one sitting. */
export const MAX_STEPS = 6;

export const DEFAULT_LEARNING_STEPS = '1m 10m';
export const DEFAULT_RELEARNING_STEPS = '10m';

/** One step in minutes, or null when it is not a step at all. */
export function stepMinutes(token: string): number | null {
  const match = STEP.exec(token.trim().toLowerCase());
  if (!match) return null;

  const value = Number(match[1]);
  return value > 0 ? value * MINUTES[match[2]] : null;
}

/**
 * The steps a deck row holds, or `null` when the text does not describe any.
 *
 * Steps have to climb: `10m 1m` would send a card backwards, and a repeated
 * step is a typo rather than an intention. At least one is required — a deck
 * with no learning steps at all is what turning them off would mean, and that
 * is a different setting nobody has asked for.
 */
export function parseSteps(text: string): string[] | null {
  const tokens = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > MAX_STEPS) return null;

  const minutes: number[] = [];

  for (const token of tokens) {
    const value = stepMinutes(token);
    if (value === null) return null;
    if (minutes.length > 0 && value <= minutes[minutes.length - 1]) return null;

    minutes.push(value);
  }

  return tokens;
}

export const isValidSteps = (text: string) => parseSteps(text) !== null;

/** The steps as the scheduler wants them, falling back on the defaults. */
export function stepsOrDefault(text: string, fallback: string): string[] {
  return parseSteps(text) ?? (parseSteps(fallback) as string[]);
}

/**
 * How likely a card should still be remembered when it comes back. Every step
 * of 0.02 is a noticeable change in workload; a finer scale would offer choices
 * nobody could tell apart.
 */
export const RETENTIONS = [0.86, 0.88, 0.9, 0.92, 0.94, 0.96, 0.98] as const;
export const DEFAULT_RETENTION = 0.94;

/** "0,94" — the label a picker shows, Polish decimal comma. */
export const formatRetention = (value: number) => value.toFixed(2).replace('.', ',');

/**
 * How far ahead a card may ever be scheduled. FSRS's own default is 36500 days
 * — a hundred years — which is a way of saying "no limit"; for anything one
 * actually wants to keep, a ceiling in months or years is the useful setting.
 */
export const NO_INTERVAL_LIMIT = 36500;

export const MAXIMUM_INTERVALS = [180, 365, 730, NO_INTERVAL_LIMIT] as const;
export const DEFAULT_MAXIMUM_INTERVAL = 365;

export const MAXIMUM_INTERVAL_LABELS: Record<number, string> = {
  180: 'Pół roku',
  365: 'Rok',
  730: 'Dwa lata',
  [NO_INTERVAL_LIMIT]: 'Bez ograniczenia',
};

/** The dropdown entry that hands the number over to the user. */
export const CUSTOM_INTERVAL = 'custom';

/**
 * A typed number of days, or null when it is not one. The ceiling is FSRS's own
 * `maximum_interval`, past which the setting stops meaning anything.
 */
export function parseMaximumInterval(text: string): number | null {
  const days = Number(text.trim());
  if (!Number.isInteger(days) || days < 1 || days > NO_INTERVAL_LIMIT) return null;

  return days;
}

/** Whether a stored value is one of the offered presets or a typed-in number. */
export const isPresetInterval = (days: number) =>
  (MAXIMUM_INTERVALS as readonly number[]).includes(days);

/** Everything a deck says about how its cards are scheduled. */
export type DeckScheduling = {
  desiredRetention: number;
  maximumInterval: number;
  learningSteps: string;
  relearningSteps: string;
};

export const DEFAULT_SCHEDULING: DeckScheduling = {
  desiredRetention: DEFAULT_RETENTION,
  maximumInterval: DEFAULT_MAXIMUM_INTERVAL,
  learningSteps: DEFAULT_LEARNING_STEPS,
  relearningSteps: DEFAULT_RELEARNING_STEPS,
};

/** A stable key for one set of options — what the engine cache is keyed on. */
export function schedulingKey(scheduling: DeckScheduling): string {
  return [
    scheduling.desiredRetention,
    scheduling.maximumInterval,
    scheduling.learningSteps,
    scheduling.relearningSteps,
  ].join('|');
}
