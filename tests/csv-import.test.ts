/**
 * Spreadsheet rows into cards: the separators people actually get out of
 * Excel, Google Sheets and Anki, quotes, and Anki's header lines.
 */
import { guessSeparator, htmlToText, parseCsv } from '@/lib/csv-import';

import { check, group } from './harness';

group('Import CSV: odczyt');

check('przecinek', parseCsv('kot,gato\npies,cão'), [
  { front: 'kot', back: 'gato', extra: [], tags: [] },
  { front: 'pies', back: 'cão', extra: [], tags: [] },
]);

// Excel in a Polish locale writes semicolons, and commas stay inside the cells.
check('srednik z przecinkiem w tresci', parseCsv('kot, mały;gatinho\r\n'), [
  { front: 'kot, mały', back: 'gatinho', extra: [], tags: [] },
]);

check('tabulator', parseCsv('kot\tgato\tO gato dorme.'), [
  { front: 'kot', back: 'gato', extra: ['O gato dorme.'], tags: [] },
]);

check('cudzyslowy, "" i nowa linia w komorce', parseCsv('"powiedział ""tak""","linia 1\nlinia 2"'), [
  { front: 'powiedział "tak"', back: 'linia 1\nlinia 2', extra: [], tags: [] },
]);

check('BOM z Excela nie trafia do pytania', parseCsv('﻿kot;gato')[0]?.front, 'kot');
check('sama kolumna to pytanie bez odpowiedzi', parseCsv('kot\npies'), [
  { front: 'kot', back: '', extra: [], tags: [] },
  { front: 'pies', back: '', extra: [], tags: [] },
]);
check('wiersz bez pytania i puste linie wypadaja', parseCsv('kot;gato\n\n;sam tył\n'), [
  { front: 'kot', back: 'gato', extra: [], tags: [] },
]);
check('puste komorki na koncu wiersza nie sa polami', parseCsv('kot;gato;;')[0]?.extra, []);
check('pusta w srodku zostaje', parseCsv('kot;gato;;przyklad')[0]?.extra, ['', 'przyklad']);

check(
  'separator z pierwszego wiersza',
  [guessSeparator('a;b;c'), guessSeparator('a,b'), guessSeparator('a\tb,c')],
  [';', ',', '\t']
);
check('przecinki w cudzyslowach sie nie licza', guessSeparator('"a,b,c";d'), ';');

group('Import CSV: naglowki Anki');

const anki = [
  '#separator:tab',
  '#html:true',
  '#notetype column:1',
  '#deck column:2',
  '#tags column:5',
  'Basic\tPortugalski\tkot<br>mały\t<b>gato</b> &amp; co\tzwierzeta dom',
].join('\n');

check('kolumny typu i talii odpadaja, tagi osobno, HTML na tekst', parseCsv(anki), [
  { front: 'kot\nmały', back: 'gato & co', extra: [], tags: ['zwierzeta', 'dom'] },
]);
check('inne linie z # to komentarze', parseCsv('# moje słówka\nkot;gato').length, 1);
check('separator po nazwie', parseCsv('#separator:Comma\nkot;mały,gato')[0], {
  front: 'kot;mały',
  back: 'gato',
  extra: [],
  tags: [],
});
check('HTML bez naglowka zostaje tekstem', parseCsv('a<b>;c')[0]?.front, 'a<b>');
check('div i p to nowe linie', htmlToText('<div>raz</div><div>dwa</div>'), 'raz\ndwa');
