/**
 * Session-queue ordering: the two deck options that decide which new cards get
 * introduced and where they sit among the reviews. Pure functions, so these run
 * without a database.
 */
import { orderNewBacklog, placeNewCards, type OrderableRow } from '@/lib/queue-order';
import { State } from '@/lib/scheduler';

import { check, group } from './harness';

/** `cardId` doubles as the minute a card was created, so age is readable. */
const row = (cardId: number, state: State): OrderableRow => ({
  cardId,
  state,
  createdAt: new Date(2026, 7, 30, 12, cardId),
});

const ids = (rows: OrderableRow[]) => rows.map((r) => r.cardId);
const shape = (rows: OrderableRow[]) =>
  rows.map((r) => (r.state === State.New ? 'N' : 'P')).join('');

// Three new cards with a review and a learning card wedged between them.
const mixedRows = [
  row(1, State.New),
  row(2, State.Review),
  row(3, State.New),
  row(4, State.Learning),
  row(5, State.New),
];

group('Kolejnosc pobierania nowych kart');

check('domyslnie od najdawniej dodanych', ids(orderNewBacklog(mixedRows, 'oldest')), [
  1, 2, 3, 4, 5,
]);
check('od najnowszych odwraca tylko nowe karty', ids(orderNewBacklog(mixedRows, 'newest')), [
  5, 2, 3, 4, 1,
]);
check(
  'powtorki i nauka zostaja na swoich miejscach',
  shape(orderNewBacklog(mixedRows, 'newest')),
  shape(mixedRows)
);

// Fisher-Yates with the randomness fixed at 0, which always swaps with the
// first remaining slot: [1, 3, 5] comes out as [3, 5, 1].
const fixedRandom = () => 0;

check('losowo tasuje nowe karty', ids(orderNewBacklog(mixedRows, 'random', fixedRandom)), [
  3, 2, 5, 4, 1,
]);
check(
  'losowo nie gubi ani nie duplikuje kart',
  [...ids(orderNewBacklog(mixedRows, 'random', fixedRandom))].sort(),
  [1, 2, 3, 4, 5]
);

const onlyNew = [row(1, State.New), row(2, State.New)];
check('jedna nowa karta nie wymaga sortowania', ids(orderNewBacklog([row(1, State.New)], 'newest')), [
  1,
]);
check('sama nowa talia da sie odwrocic', ids(orderNewBacklog(onlyNew, 'newest')), [2, 1]);

group('Rozmieszczenie nowych kart wzgledem powtorek');

// Two new cards among four reviews — the case where "wymieszane" has to spread
// rather than clump.
const twoNewFourReviews = [
  row(1, State.New),
  row(2, State.New),
  row(3, State.Review),
  row(4, State.Review),
  row(5, State.Review),
  row(6, State.Review),
];

check('przed powtorkami', shape(placeNewCards(twoNewFourReviews, 'before')), 'NNPPPP');
check('po powtorkach', shape(placeNewCards(twoNewFourReviews, 'after')), 'PPPPNN');
check('wymieszane rozklada rownomiernie', shape(placeNewCards(twoNewFourReviews, 'mixed')), 'NPPNPP');
check('wymieszane zachowuje kolejnosc powtorek', ids(placeNewCards(twoNewFourReviews, 'mixed')), [
  1, 3, 4, 2, 5, 6,
]);

const threeNewTwoReviews = [
  row(1, State.New),
  row(2, State.New),
  row(3, State.New),
  row(4, State.Review),
  row(5, State.Review),
];

check('wiecej nowych niz powtorek', shape(placeNewCards(threeNewTwoReviews, 'mixed')), 'NPNPN');

check('sesja bez nowych kart zostaje bez zmian', ids(placeNewCards([row(1, State.Review)], 'before')), [
  1,
]);
check('sesja z samych nowych kart zostaje bez zmian', ids(placeNewCards(onlyNew, 'after')), [1, 2]);
