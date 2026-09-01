/**
 * The orders the card list can be arranged in.
 *
 * Sorting happens in JS over the list the deck screen has already loaded, for
 * the same two reasons the search does: SQLite would order Polish letters by
 * their bytes (`ą` lands after `z`, so `ćma` would sit past `zebra`), and the
 * screen already holds every card in the deck, so there is nothing to re-read.
 */

export const CARD_ORDERS = ['created', 'alpha', 'due', 'fields'] as const;
export type CardOrder = (typeof CARD_ORDERS)[number];

export const DEFAULT_CARD_ORDER: CardOrder = 'created';

export const CARD_ORDER_LABELS: Record<CardOrder, string> = {
  created: 'Data dodania',
  alpha: 'Alfabetycznie',
  due: 'Termin powtórki',
  fields: 'Liczba pól',
};

export type SortDirection = 'asc' | 'desc';

/**
 * Which way round each order reads when it is first picked. They differ on
 * purpose: newest cards and the fullest cards are what one looks for, while the
 * alphabet and the review queue are read from the front.
 */
export const DEFAULT_DIRECTIONS: Record<CardOrder, SortDirection> = {
  created: 'desc',
  alpha: 'asc',
  due: 'asc',
  fields: 'desc',
};

/** What the direction toggle means for the order in hand. */
export const DIRECTION_LABELS: Record<CardOrder, Record<SortDirection, string>> = {
  created: { asc: 'Od najstarszych', desc: 'Od najnowszych' },
  alpha: { asc: 'Od A do Z', desc: 'Od Z do A' },
  due: { asc: 'Najbliższe najpierw', desc: 'Najdalsze najpierw' },
  fields: { asc: 'Od najmniej pól', desc: 'Od najwięcej pól' },
};

/** Everything an order needs to know about a card. */
export type SortableCard = {
  front: string;
  createdAt: Date;
  due?: Date | null;
  fieldCount?: number | null;
};

/**
 * Polish alphabetical order, which is not byte order: `Intl.Collator` puts `ć`
 * between `c` and `d` rather than past `z`. Built once — a collator is not
 * cheap, and this runs over every card on every keystroke in the search box.
 */
const collator = new Intl.Collator('pl', { sensitivity: 'base', numeric: true });

/**
 * A card with no schedule row sorts to the very end rather than to the front,
 * which is what `null` would do numerically.
 */
const dueAt = (card: SortableCard) => card.due?.getTime() ?? Number.POSITIVE_INFINITY;

/** Every order written the ascending way round; `desc` is the exact reverse. */
const COMPARE: Record<CardOrder, (a: SortableCard, b: SortableCard) => number> = {
  created: (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  alpha: (a, b) => collator.compare(a.front, b.front),
  due: (a, b) => dueAt(a) - dueAt(b),
  fields: (a, b) => (a.fieldCount ?? 0) - (b.fieldCount ?? 0),
};

/**
 * A copy in the chosen order.
 *
 * Ties fall back to the date added, so an order that says nothing about two
 * cards — the same due date, the same number of fields — still puts them
 * somewhere stable instead of leaving it to the engine. The tie-breaker is
 * flipped along with everything else, which makes `desc` exactly the reverse
 * of `asc`; a direction that only turned part of the list round would be a
 * puzzle to look at.
 */
export function sortCards<T extends SortableCard>(
  cards: T[],
  order: CardOrder,
  direction: SortDirection = DEFAULT_DIRECTIONS[order]
): T[] {
  const compare = COMPARE[order];
  const sign = direction === 'asc' ? 1 : -1;

  return [...cards].sort((a, b) => sign * (compare(a, b) || COMPARE.created(a, b)));
}
