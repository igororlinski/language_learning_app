import type { NewCardOrder, NewCardPlacement } from '@/db/schema';
import { QUEUE_STATES, State } from '@/lib/scheduler';

/**
 * Building the session queue, Anki-style. Two deck options decide it:
 *
 * - `newCardOrder` — which end of the new backlog today's cards come from.
 *   This runs *before* the daily limit trims the queue, because it decides
 *   *which* new cards get introduced at all, not just where they sit.
 * - `newCardPlacement` — where those cards land among the reviews. This runs
 *   *after* the trim, when the queue already holds exactly what will be shown.
 *
 * Both are pure functions over rows, so `queries.ts` stays the only place that
 * touches SQL and the rules can be tested without a database.
 */

/** Everything the ordering rules need from a due-card row. */
export type OrderableRow = {
  cardId: number;
  state: number;
  createdAt: Date;
};

const isNew = (row: OrderableRow) => QUEUE_STATES.newCount.includes(row.state as State);

/** Oldest/newest fall back to the id, the only tie-break that cannot repeat. */
function byAge(a: OrderableRow, b: OrderableRow): number {
  const diff = a.createdAt.getTime() - b.createdAt.getTime();
  return diff !== 0 ? diff : a.cardId - b.cardId;
}

/** Fisher–Yates, with the source of randomness passed in so tests can fix it. */
function shuffled<T>(rows: T[], random: () => number): T[] {
  const out = [...rows];

  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }

  return out;
}

/**
 * Reorders the new cards among themselves, leaving every other row exactly
 * where it was. Rewriting the new cards in place (rather than moving them to
 * the front) keeps the due-date order of learning and review cards intact,
 * which is what the daily trim and the counters rely on.
 */
export function orderNewBacklog<T extends OrderableRow>(
  rows: T[],
  order: NewCardOrder,
  random: () => number = Math.random
): T[] {
  const news = rows.filter(isNew);
  if (news.length < 2) return rows;

  const sorted =
    order === 'random'
      ? shuffled(news, random)
      : order === 'newest'
        ? [...news].sort((a, b) => byAge(b, a))
        : [...news].sort(byAge);

  let next = 0;
  return rows.map((row) => (isNew(row) ? sorted[next++] : row));
}

/**
 * Spreads the new cards evenly through the rest of the queue. Each step takes
 * whichever side has fallen behind its share, so 2 new among 4 reviews come out
 * as N R R N R R rather than in one block.
 */
function interleave<T>(news: T[], rest: T[]): T[] {
  const out: T[] = [];
  let n = 0;
  let r = 0;

  while (n < news.length || r < rest.length) {
    const takeNew = n < news.length && (r >= rest.length || n * rest.length <= r * news.length);
    out.push(takeNew ? news[n++] : rest[r++]);
  }

  return out;
}

/** Applies the deck's new-vs-review placement to an already trimmed queue. */
export function placeNewCards<T extends OrderableRow>(
  rows: T[],
  placement: NewCardPlacement
): T[] {
  const news = rows.filter(isNew);
  if (news.length === 0 || news.length === rows.length) return rows;

  const rest = rows.filter((row) => !isNew(row));

  if (placement === 'before') return [...news, ...rest];
  if (placement === 'after') return [...rest, ...news];
  return interleave(news, rest);
}
