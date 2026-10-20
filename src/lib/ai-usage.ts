/**
 * How much of each free daily AI allowance this phone has spent today.
 *
 * **Counted here, because the keys are the user's own.** The Worker used to
 * count one shared pool for everybody; now every request leaves the phone with
 * the user's own key, so the phone is the one place that sees all of them — and
 * the allowance it counts against really is the user's, not a pool.
 *
 * Approximate on purpose, as the Worker's counter was: it counts what the app
 * sent, so a key also used somewhere else shows more left than there is.
 * Guessing a little wrong costs a slightly-off meter, never a broken feature.
 *
 * **Two reset days.** Cloudflare's neuron allowance resets at 00:00 UTC,
 * Google's free-tier requests at midnight Pacific; each counter is keyed by its
 * own provider's day so the meter turns over at the right midnight.
 *
 * Pure: the writing is injected (`setSpendSink`, wired to the database in the
 * root layout), so the AI modules can record what they spent without importing
 * the database, and the tests can watch what they recorded.
 */

export type UsageMetric = 'neurons' | 'gemini';

export const DAILY_CAPS: Record<UsageMetric, number> = {
  // Workers AI's free allocation, spent by every picture.
  neurons: 10_000,
  // gemini-3.5-flash (20) + gemini-3.5-flash-lite (500), measured 2026-09-07.
  // Past this associations still come, from llama on Cloudflare — so it is a
  // quality ceiling, not a wall.
  gemini: 520,
};

const ZONES: Record<UsageMetric, string> = {
  neurons: 'UTC',
  gemini: 'America/Los_Angeles',
};

/** The calendar day in a given zone as YYYY-MM-DD — the day a counter resets on. */
export function dayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** The day a metric is counted on right now. */
export const usageDay = (metric: UsageMetric, now: Date = new Date()) => dayIn(ZONES[metric], now);

export type SpendSink = (metric: UsageMetric, day: string, amount: number) => void;

let sink: SpendSink | null = null;

/** Where spending goes. Set once, at startup, to the database. */
export function setSpendSink(next: SpendSink | null): void {
  sink = next;
}

/**
 * Records spending, and never throws: a number that fails to record is worth
 * far less than the picture the user just paid for.
 */
export function recordSpend(metric: UsageMetric, amount: number, now: Date = new Date()): void {
  if (!sink || !(amount > 0)) return;

  try {
    sink(metric, usageDay(metric, now), amount);
  } catch {
    // Swallowed on purpose; see above.
  }
}

/** One allowance: what today has spent, the ceiling, and the whole percent left. */
export type AiBudget = {
  used: number;
  cap: number;
  /** Percent of the day's allowance still free, clamped to 0..100. */
  pctLeft: number;
};

export type AiUsage = { images: AiBudget; text: AiBudget };

function budget(used: number, cap: number): AiBudget {
  const pctLeft = cap > 0 ? Math.max(0, Math.min(100, Math.round((100 * (cap - used)) / cap))) : 0;

  return { used, cap, pctLeft };
}

/**
 * Today's two budgets out of the stored rows. Rows from another day are not
 * today's spending and count for nothing — that is the whole reset.
 */
export function usageFrom(
  rows: readonly { metric: string; day: string; amount: number }[],
  now: Date = new Date()
): AiUsage {
  const spent = (metric: UsageMetric) =>
    rows
      .filter((row) => row.metric === metric && row.day === usageDay(metric, now))
      .reduce((sum, row) => sum + row.amount, 0);

  return {
    images: budget(Math.round(spent('neurons')), DAILY_CAPS.neurons),
    text: budget(spent('gemini'), DAILY_CAPS.gemini),
  };
}
