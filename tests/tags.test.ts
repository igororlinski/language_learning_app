/**
 * Tag rules: what counts as the same tag, and how picking several narrows the
 * card list. Pure functions, so no database.
 */
import {
  cardTagIds,
  dedupeTags,
  filterByTags,
  isUsableTag,
  MAX_TAG_LENGTH,
  tagName,
  tagSlug,
} from '@/lib/tags';

import { check, group } from './harness';

group('Nazwa i tozsamosc tagu');

check('nazwa traci obce spacje', tagName('  czasownik  '), 'czasownik');
check('i sklejone spacje w srodku', tagName('czas   przeszly'), 'czas przeszly');
check('bardzo dlugi tag jest przycinany', tagName('x'.repeat(80)).length, MAX_TAG_LENGTH);

// Uniqueness runs on the slug, so these three are one tag and not three.
check('wielkosc liter nie tworzy nowego tagu', tagSlug('Łatwe'), tagSlug('łatwe'));
check('ani ogonki', tagSlug('łatwe'), tagSlug('latwe'));
check('rozne slowa maja rozne slugi', tagSlug('łatwe') === tagSlug('trudne'), false);

check('sama spacja to nie tag', isUsableTag('   '), false);
check('pusty tekst tez nie', isUsableTag(''), false);
check('zwykle slowo tak', isUsableTag('czasownik'), true);

group('Lista tagow bez powtorek');

check(
  'powtorki znikaja, zostaje pierwsza pisownia',
  dedupeTags(['Czasownik', 'czasownik', 'CZASOWNIK']),
  ['Czasownik']
);
check('puste wpisy wypadaja', dedupeTags(['nauka', '   ', '']), ['nauka']);
check('rozne tagi zostaja w kolejnosci', dedupeTags(['b', 'a', 'b']), ['b', 'a']);

group('Filtr po tagach');

const card = (front: string, tagIds: string | null) => ({ front, tagIds });

const cards = [
  card('bez tagow', ''),
  card('jeden', '3'),
  card('dwa', '3,7'),
  card('inny', '7'),
  card('null zamiast tekstu', null),
];

check('id z kolumny sklejonej przecinkami', cardTagIds(cards[2]), [3, 7]);
check('pusta kolumna to brak tagow', cardTagIds(cards[0]), []);
check('null tez', cardTagIds(cards[4]), []);

const fronts = (picked: number[]) => filterByTags(cards, picked).map((c) => c.front);

check('nic nie wybrane, nic nie odfiltrowane', fronts([]).length, 5);
check('jeden tag zostawia karty, ktore go maja', fronts([3]), ['jeden', 'dwa']);
// Each further tag narrows the list, the way each word typed into the search does.
check('dwa tagi wymagaja obu naraz', fronts([3, 7]), ['dwa']);
check('tag, ktorego nikt nie ma, zostawia pusto', fronts([99]), []);
