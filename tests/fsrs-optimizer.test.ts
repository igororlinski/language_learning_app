/**
 * Fitting the initial stabilities to what a deck's history actually shows.
 * Pure functions, so no database — the samples are handed in.
 */
import { default_w, forgetting_curve, Rating } from 'ts-fsrs';

import {
  fitStability,
  MIN_SAMPLES,
  optimizeWeights,
  RATING_ORDER,
  type StabilitySample,
} from '@/lib/fsrs-optimizer';

import { check, group } from './harness';

/**
 * Reviews generated from a known stability: at each delay, the share that is
 * still recalled is exactly what the forgetting curve predicts. A fit that
 * cannot find the number back out of this is not fitting anything.
 */
const fromStability = (
  rating: StabilitySample['rating'],
  stability: number,
  count = 200
): StabilitySample[] => {
  const samples: StabilitySample[] = [];

  for (let index = 0; index < count; index += 1) {
    const deltaDays = 1 + (index % 20);
    const recall = forgetting_curve(default_w, deltaDays, stability);
    // Deterministic instead of random: the share recalled at each delay is
    // spread evenly, so the same input always gives the same fit.
    samples.push({ rating, deltaDays, recalled: (index % 100) / 100 < recall });
  }

  return samples;
};

group('Odzyskiwanie znanej stabilnosci');

for (const known of [1, 5, 20]) {
  const fitted = fitStability(fromStability(Rating.Good, known), [...default_w]);

  check(
    `dopasowanie trafia w ${known} dni`,
    Math.abs(fitted - known) / known < 0.35,
    true
  );
}

group('Optymalizator rusza tylko to, co ma z czego');

const enough = fromStability(Rating.Good, 7);
const tooFew: StabilitySample[] = Array.from({ length: MIN_SAMPLES - 1 }, (_, index) => ({
  rating: Rating.Easy,
  deltaDays: 1 + index,
  recalled: true,
}));

const result = optimizeWeights([...enough, ...tooFew]);

check('ocena z historia zostaje dopasowana', result.fitted, [Rating.Good]);
check('a ta bez niej zostaje nietknieta', result.weights[3], default_w[3]);
check('policzone probki sa raportowane', result.counts[Rating.Good], enough.length);
check('razem z tymi, ktorych bylo za malo', result.counts[Rating.Easy], tooFew.length);
check('reszta wag zostaje bez zmian', result.weights.slice(4), [...default_w].slice(4));
check('liczba wag sie nie zmienia', result.weights.length, default_w.length);

// A brand new deck must come back saying it fitted nothing at all.
const empty = optimizeWeights([]);

check('pusta historia nie zmienia niczego', empty.fitted, []);
check('i oddaje wagi wejsciowe', empty.weights, [...default_w]);
check('kazda ocena raportuje zero', RATING_ORDER.map((r) => empty.counts[r]), [0, 0, 0, 0]);

// Fitting twice in a row must not drift: the second run starts from the first.
const once = optimizeWeights(enough);
const twice = optimizeWeights(enough, once.weights);

check('powtorne dopasowanie na tych samych danych nie rusza wag', twice.weights, once.weights);
