/**
 * Languages are a closed list since 2026-09-08, and the reason is the speech
 * field: a phone is told `pt-PT`, and no folding of a typed name gets there.
 * So what is tested here is the identity (a code), the door for decks written
 * before the list existed, and the two things the codes are handed to — the
 * language model, in English, and the speech engine.
 */
import {
  allLanguages,
  dedupeLanguages,
  isKnownLanguage,
  LANGUAGES,
  languageEnglish,
  languageLabel,
  languagesJson,
  parseLanguages,
  speechLanguage,
} from '@/lib/languages';

import { check, group } from './harness';

group('Katalog jezykow');

check('polski jest na liscie', isKnownLanguage('pl'), true);
check('portugalski europejski i brazylijski to dwa wpisy', isKnownLanguage('pt-BR'), true);
check('wymyslony kod nie', isKnownLanguage('klingonski'), false);

// Every entry has to answer both questions asked of it: what the user reads and
// what the prompt is told. An entry missing either would fail far from here.
check(
  'kazdy wpis ma nazwe i angielska nazwe',
  LANGUAGES.every((language) => language.code && language.name && language.english),
  true
);

// Codes are the identity, so two entries sharing one would make a deck's
// declaration ambiguous.
check(
  'kody sa unikalne',
  new Set(LANGUAGES.map((language) => language.code)).size,
  LANGUAGES.length
);

check('etykieta to polska nazwa', languageLabel('pt-PT'), 'portugalski');
// Better a bare code than an empty chip: a row from a future version still says
// something the user can read back to us.
check('nieznany kod pokazuje sam siebie', languageLabel('xx'), 'xx');
check('model dostaje angielska nazwe', languageEnglish('pl'), 'Polish');

group('Kolumna z jezykami');

check('zapis i odczyt', parseLanguages(languagesJson(['pl', 'pt-PT'])), ['pl', 'pt-PT']);
check('pusta lista to NULL', languagesJson([]), null);
check('powtorki sie skladaja', dedupeLanguages(['pl', 'pl', 'de']), ['pl', 'de']);
check('smiec nie przechodzi', dedupeLanguages(['pl', 'klingonski']), ['pl']);

// A row from a future version must not be able to break the editor.
check('niepoprawny JSON to brak jezykow', parseLanguages('{{'), []);
check('nie-tablica tez', parseLanguages('"pl"'), []);
check('brak kolumny tez', parseLanguages(null), []);

group('Talie sprzed zamknietej listy');

/**
 * Decks written between 09-03 and 09-08 hold typed names. Dropping them would
 * quietly empty the one thing that makes an association possible, so a name is
 * looked up before it is thrown away.
 */
check('nazwa z katalogu mapuje sie na kod', parseLanguages('["polski"]'), ['pl']);
check('takze bez ogonkow', parseLanguages('["hiszpanski"]'), ['es']);
check('nazwa bez regionu ladzie na domyslnym', parseLanguages('["portugalski"]'), ['pt-PT']);
check('angielski dostaje amerykanski', parseLanguages('["angielski"]'), ['en-US']);

// What cannot be resolved is dropped rather than guessed: a wrong code is worse
// than a deck that says nothing, because it would be read aloud in the wrong
// language and nobody would know why.
check('czego nie da sie rozpoznac, wypada', parseLanguages('["brzmi jak polski"]'), []);
check('a reszta listy zostaje', parseLanguages('["cos", "pl"]'), ['pl']);

group('Ktory glos czyta');

check('czyta pierwszym zadeklarowanym', speechLanguage(['pt-PT', 'es']), 'pt-PT');
check('talia bez jezykow nie ma czym czytac', speechLanguage([]), null);
check('smiec pomijany', speechLanguage(['klingonski', 'de']), 'de');

check('obie strony razem, bez powtorek', allLanguages({ front: ['pl'], back: ['pl', 'de'] }), [
  'pl',
  'de',
]);
