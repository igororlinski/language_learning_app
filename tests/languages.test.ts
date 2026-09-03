/**
 * What counts as a language name, and what counts as the same one.
 *
 * The names are typed rather than picked from a list, so everything here is
 * about two spellings of one language not becoming two languages — the same
 * problem tags have, and solved the same way.
 */
import {
  allLanguages,
  dedupeLanguages,
  isUsableLanguage,
  languageName,
  languageSlug,
  languagesJson,
  MAX_LANGUAGE_LENGTH,
  parseLanguages,
} from '@/lib/languages';

import { check, group } from './harness';

group('Nazwa jezyka');

check('traci obce spacje', languageName('  angielski  '), 'angielski');
check('i sklejone spacje w srodku', languageName('staro   angielski'), 'staro angielski');
check(
  'bardzo dluga nazwa jest przycinana',
  languageName('x'.repeat(100)).length,
  MAX_LANGUAGE_LENGTH
);

group('Tozsamosc jezyka');

// The whole point: a deck saying "Angielski" and one saying "angielski" must
// not look like two different languages to whatever reads them later.
check('wielkosc liter nie tworzy nowego jezyka', languageSlug('Angielski'), languageSlug('angielski'));
check('ani ogonki', languageSlug('łaciński'), languageSlug('lacinski'));
check('rozne jezyki maja rozne slugi', languageSlug('polski') === languageSlug('polnisch'), false);

check('sama spacja to nie jezyk', isUsableLanguage('   '), false);
check('pusty tekst tez nie', isUsableLanguage(''), false);
check('zwykle slowo tak', isUsableLanguage('polski'), true);

group('Lista jezykow bez powtorek');

check(
  'powtorki znikaja, zostaje pierwsza pisownia',
  dedupeLanguages(['Angielski', 'angielski', 'ANGIELSKI']),
  ['Angielski']
);
check('puste wpisy wypadaja', dedupeLanguages(['polski', '   ', '']), ['polski']);
check('rozne jezyki zostaja w kolejnosci', dedupeLanguages(['polski', 'angielski']), [
  'polski',
  'angielski',
]);

group('Zapis i odczyt kolumny');

check('lista wraca taka, jaka poszla', parseLanguages(languagesJson(['polski', 'angielski'])), [
  'polski',
  'angielski',
]);

// One value for "this deck has not said", not two.
check('pusta lista to null w kolumnie', languagesJson([]), null);
check('same puste nazwy tez', languagesJson(['  ', '']), null);
check('null czyta sie jako pusta lista', parseLanguages(null), []);

// A row written by some future version must not be able to break the editor,
// so anything unreadable is "has not said" rather than an error.
check('smieci czytaja sie jako pusta lista', parseLanguages('{{{'), []);
check('obiekt zamiast tablicy tez', parseLanguages('{"front":"polski"}'), []);
check('liczby w tablicy wypadaja', parseLanguages('["polski", 7, null]'), ['polski']);
check('powtorki w kolumnie tez sie skladaja', parseLanguages('["polski", "Polski"]'), ['polski']);

group('Oba boki razem');

check(
  'jezyk uzyty po obu stronach liczy sie raz',
  allLanguages({ front: ['polski'], back: ['Polski', 'angielski'] }),
  ['polski', 'angielski']
);
check('pusta talia nie zna zadnego', allLanguages({ front: [], back: [] }), []);
