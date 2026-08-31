/**
 * Search matching rules. Pure functions, no database — the point is the Polish
 * folding that SQLite's `like` cannot do.
 */
import { filterCards, fold, matches } from '@/lib/search';

import { check, group } from './harness';

const card = (front: string, back: string) => ({ front, back });

group('Skladanie polskich znakow');

check('ogonki i kreski znikaja', fold('Łamać ĄĘŚŹŻÓŃ'), 'lamac aeszzon');
check('wielkosc liter nie ma znaczenia', fold('PRZYKŁAD'), fold('przykład'));
check('tekst bez diakrytykow zostaje bez zmian', fold('to break'), 'to break');
check('l z kreska nie rozklada sie samo, ale jest zmapowane', fold('ł'), 'l');

group('Dopasowanie karty');

const breaking = card('to break', 'łamać / złamać');

check('znajduje po przodzie', matches(breaking, 'break'), true);
check('znajduje po tyle', matches(breaking, 'łamać'), true);
check('znajduje mimo braku diakrytykow w zapytaniu', matches(breaking, 'lamac'), true);
check('diakrytyk w samym zapytaniu tez jest skladany', matches(breaking, 'tó'), true);
check('nie znajduje czegos, czego nie ma', matches(breaking, 'kot'), false);
check('puste zapytanie pasuje do wszystkiego', matches(breaking, '   '), true);

group('Wiele slow zaweza wynik');

check('oba slowa obecne — pasuje', matches(breaking, 'break lamac'), true);
check('drugie slowo nieobecne — nie pasuje', matches(breaking, 'break kot'), false);
check('slowa moga byc po roznych stronach karty', matches(breaking, 'to złamać'), true);

group('Filtrowanie listy');

const deck = [
  card('to break', 'łamać'),
  card('to bring', 'przynosić'),
  card('a bridge', 'most'),
];

check('filtr po wspolnym przedrostku', filterCards(deck, 'br').length, 3);
check('filtr zawezajacy — bri trafia w bring i bridge', filterCards(deck, 'bri').length, 2);
check('filtr do jednego trafienia', filterCards(deck, 'brid').length, 1);
check('puste zapytanie zwraca cala liste', filterCards(deck, '').length, 3);
check('same spacje tez zwracaja cala liste', filterCards(deck, '   ').length, 3);
check('brak trafien zwraca pusto', filterCards(deck, 'zupa').length, 0);
check(
  'zapytanie po polsku trafia w tyl karty',
  filterCards(deck, 'przynosic').map((c) => c.front),
  ['to bring']
);

group('Wyszukiwanie po polach dodatkowych');

// `fields` is what the query glues together out of every extra field, so one
// search covers cards carrying different numbers of them.
const withFields = {
  front: 'to break',
  back: 'lamac',
  fields: '/breɪk/ break-broke-broken',
};

check('trafia w tresc pola dodatkowego', matches(withFields, 'broke-broken'), true);
check('polskie znaki tez sie skladaja', matches({ ...withFields, fields: 'łamać się' }, 'lamac sie'), true);
check(
  'slowo z pola dodatkowego zaweza razem z podstawowym',
  matches(withFields, 'break broke'),
  true
);
check('czego nie ma, tego nie znajdzie', matches(withFields, 'zupa'), false);
check('karta bez pol dodatkowych dziala jak dawniej', matches({ front: 'a', back: 'b' }, 'a'), true);
