import { default_w, forgetting_curve, INIT_S_MAX, Rating, S_MIN } from 'ts-fsrs';

/**
 * Fitting the **initial stabilities** — `w[0..3]` — to what actually happened
 * in this deck.
 *
 * ## What this is, and what it deliberately is not
 *
 * FSRS has twenty one weights. Four of them say how long a card is remembered
 * right after it is first learned, one per rating; the rest describe how that
 * memory then grows, decays and hardens. This fits **only the four**, and
 * leaves the rest at the defaults.
 *
 * That is not laziness. The other seventeen are fitted by gradient descent over
 * the whole review history, and ts-fsrs ships no training code — it exposes the
 * model forward (`forgetting_curve`) and nothing to differentiate it. Doing it
 * properly means an optimiser with numerical gradients over 21 parameters and
 * thousands of reviews, on a phone, in JavaScript; doing it badly means silently
 * scheduling worse, with no way for anyone to notice. The four initial
 * stabilities, by contrast, are a **one-dimensional fit per rating**: cheap,
 * deterministic, checkable — and they are the weights that decide the thing
 * people actually complain about, how far out a card goes the first time.
 *
 * ## What a sample is
 *
 * One card's first day, and what happened next:
 *
 * - the rating the card **ended its first study day on** — not the first answer
 *   of that day. With learning steps a card is usually answered several times
 *   before it leaves; what its memory is worth at the end is set by how that
 *   session finished.
 * - `deltaDays`, the whole days until the next review after that day, and
 * - whether it was still remembered then, meaning anything but "Znowu".
 *
 * Same-day repeats are not samples: `R(0) = 1` for any stability, so they say
 * nothing about which stability is right.
 */

export type StabilitySample = {
  /** How the card's first study day ended. */
  rating: Rating.Again | Rating.Hard | Rating.Good | Rating.Easy;
  deltaDays: number;
  recalled: boolean;
};

/** Which weight each rating's initial stability lives in. */
const WEIGHT_INDEX: Record<StabilitySample['rating'], number> = {
  [Rating.Again]: 0,
  [Rating.Hard]: 1,
  [Rating.Good]: 2,
  [Rating.Easy]: 3,
};

export const RATING_ORDER: StabilitySample['rating'][] = [
  Rating.Again,
  Rating.Hard,
  Rating.Good,
  Rating.Easy,
];

/**
 * Below this a group says more about chance than about memory. FSRS's own
 * optimiser wants far more for the full model; for a single number per rating
 * this is where the fit stops being noise.
 */
export const MIN_SAMPLES = 12;

/**
 * How badly a stability of `S` predicts what happened — the log loss over the
 * group, which is the same thing the real optimiser minimises.
 */
function loss(samples: StabilitySample[], stability: number, weights: number[]): number {
  let total = 0;

  for (const sample of samples) {
    const predicted = forgetting_curve(weights, sample.deltaDays, stability);
    // Never log(0): a certainty either way would make the whole group infinite.
    const clamped = Math.min(Math.max(predicted, 1e-6), 1 - 1e-6);

    total += sample.recalled ? -Math.log(clamped) : -Math.log(1 - clamped);
  }

  return total / samples.length;
}

/**
 * The stability that fits one rating's samples best.
 *
 * A coarse geometric sweep followed by a local refinement, rather than a
 * gradient: the search space is one bounded number, the loss is smooth in it,
 * and a sweep cannot wander off or fail to converge — which matters more here
 * than the last decimal place, since this runs on a phone with no way to
 * inspect what it did.
 */
export function fitStability(samples: StabilitySample[], weights: number[]): number {
  let best = S_MIN;
  let bestLoss = Infinity;

  // ~90 steps from S_MIN to INIT_S_MAX, each 15% up from the last.
  for (let value = S_MIN; value <= INIT_S_MAX; value *= 1.15) {
    const candidate = loss(samples, value, weights);
    if (candidate < bestLoss) {
      bestLoss = candidate;
      best = value;
    }
  }

  // Refine inside the winning step, where the sweep is at its coarsest.
  let low = Math.max(S_MIN, best / 1.15);
  let high = Math.min(INIT_S_MAX, best * 1.15);

  for (let round = 0; round < 40; round += 1) {
    const middle = (low + high) / 2;
    const left = (low + middle) / 2;
    const right = (middle + high) / 2;

    if (loss(samples, left, weights) < loss(samples, right, weights)) high = middle;
    else low = middle;
  }

  return Math.min(Math.max((low + high) / 2, S_MIN), INIT_S_MAX);
}

/** What one run of the optimiser produced. */
export type OptimizationResult = {
  /** The full twenty one weights, ready to store. */
  weights: number[];
  /** How many samples each rating contributed. */
  counts: Record<StabilitySample['rating'], number>;
  /** Which ratings had enough of them to move their weight. */
  fitted: StabilitySample['rating'][];
  /** Total samples the run had to work with. */
  total: number;
};

/**
 * Fits what the data supports and leaves the rest alone. A rating with too few
 * samples keeps whatever weight it had, so a half-used deck gets a partial
 * improvement rather than four confident guesses.
 */
export function optimizeWeights(
  samples: StabilitySample[],
  current: readonly number[] = default_w
): OptimizationResult {
  const weights = [...current];
  const counts = { [Rating.Again]: 0, [Rating.Hard]: 0, [Rating.Good]: 0, [Rating.Easy]: 0 };
  const fitted: StabilitySample['rating'][] = [];

  for (const rating of RATING_ORDER) {
    const group = samples.filter((sample) => sample.rating === rating);
    counts[rating] = group.length;

    if (group.length < MIN_SAMPLES) continue;

    weights[WEIGHT_INDEX[rating]] = fitStability(group, weights);
    fitted.push(rating);
  }

  return { weights, counts, fitted, total: samples.length };
}
