/**
 * The orders the card list can be arranged in, plus the date label that list
 * shows. Pure functions, so no database.
 */
import {
  CARD_ORDERS,
  DEFAULT_DIRECTIONS,
  DIRECTION_LABELS,
  sortCards,
  type SortableCard,
} from '@/lib/card-sort';
import { formatDate } from '@/lib/format';

import { check, group } from './harness';

const day = (date: number) => new Date(2026, 7, date, 12, 0, 0, 0);

const card = (
  front: string,
  created: number,
  due: Date | null = null,
  fieldCount = 0
): SortableCard => ({ front, createdAt: day(created), due, fieldCount });

const fronts = (cards: SortableCard[]) => cards.map((c) => c.front);

group('Kolejnosc kart: alfabetycznie');

// Byte order would put every Polish letter past `z`; this is the whole reason
// the sort runs in JS instead of in SQLite.
const polish = [
  card('zebra', 1),
  card('ćma', 2),
  card('cebula', 3),
  card('ława', 4),
  card('lampa', 5),
  card('źrebak', 6),
];

check('polskie litery trafiaja miedzy swoje sasiadki, nie na koniec', fronts(sortCards(polish, 'alpha')), [
  'cebula',
  'ćma',
  'lampa',
  'ława',
  'zebra',
  'źrebak',
]);

check(
  'wielkosc liter nie zmienia kolejnosci',
  fronts(sortCards([card('Banan', 1), card('ananas', 2)], 'alpha')),
  ['ananas', 'Banan']
);

group('Kolejnosc kart: data dodania');

const byDate = [card('stara', 1), card('nowa', 9), card('srednia', 5)];

check('od najnowszych', fronts(sortCards(byDate, 'created')), ['nowa', 'srednia', 'stara']);
// Sorting must not rearrange the caller's array under it.
check('oryginalna lista zostaje nietknieta', fronts(byDate), ['stara', 'nowa', 'srednia']);

group('Kolejnosc kart: do powtorki');

const byDue = [
  card('pozniej', 1, day(20)),
  card('juz', 2, day(2)),
  card('bez terminu', 3, null),
  card('jutro', 4, day(3)),
];

// A card with no schedule row goes last; as a number `null` would be zero and
// would jump to the very front.
check('najblizsze terminy pierwsze, bez terminu na koncu', fronts(sortCards(byDue, 'due')), [
  'juz',
  'jutro',
  'pozniej',
  'bez terminu',
]);

group('Kolejnosc kart: liczba pol');

const byFields = [
  card('dwa', 1, null, 2),
  card('piec', 2, null, 5),
  card('zero', 3, null, 0),
  card('takze dwa', 4, null, 2),
];

check('najwiecej pol na gorze', fronts(sortCards(byFields, 'fields')), [
  'piec',
  'takze dwa',
  'dwa',
  'zero',
]);
// Two cards the order says nothing about still land in a defined place.
check(
  'remis rozstrzyga data, od najnowszych',
  fronts(sortCards(byFields, 'fields')).slice(1, 3),
  ['takze dwa', 'dwa']
);

group('Data dodania na liscie');

const today = new Date(2026, 7, 31, 12, 0, 0, 0);

check('dzien i skrocony miesiac', formatDate(new Date(2026, 7, 31), today), '31 sie');
check('styczen tez', formatDate(new Date(2026, 0, 4), today), '4 sty');
// The year only shows up once it stops being obvious.
check('inny rok dostaje rok', formatDate(new Date(2025, 11, 24), today), '24 gru 2025');

group('Przelacznik rosnaco / malejaco');

const mixed = [
  card('bób', 1, day(9), 3),
  card('agrest', 5, day(2), 1),
  card('czosnek', 3, day(5), 5),
];

// Descending has to be the list read backwards — including the tie-breaker.
// A direction that turned only part of the order round would be a puzzle.
for (const order of CARD_ORDERS) {
  check(
    `malejaco to dokladnie odwrotnosc rosnaco: ${order}`,
    fronts(sortCards(mixed, order, 'desc')),
    fronts(sortCards(mixed, order, 'asc')).reverse()
  );
}

check('rosnaco po dacie to od najstarszych', fronts(sortCards(mixed, 'created', 'asc')), [
  'bób',
  'czosnek',
  'agrest',
]);
check('rosnaco po liczbie pol to od najmniej', fronts(sortCards(mixed, 'fields', 'asc')), [
  'agrest',
  'bób',
  'czosnek',
]);

// Each order opens the way round it is usually wanted; the toggle goes from there.
check('domyslne kierunki', DEFAULT_DIRECTIONS, {
  created: 'desc',
  alpha: 'asc',
  due: 'asc',
  fields: 'desc',
});
check(
  'bez podanego kierunku obowiazuje domyslny',
  fronts(sortCards(mixed, 'created')),
  fronts(sortCards(mixed, 'created', 'desc'))
);

// The toggle names what it will do, so every order needs both words.
check(
  'kazda kolejnosc ma opis obu kierunkow',
  CARD_ORDERS.filter((order) => !DIRECTION_LABELS[order].asc || !DIRECTION_LABELS[order].desc),
  []
);
