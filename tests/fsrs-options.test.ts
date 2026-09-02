/**
 * The FSRS knobs a deck may set: how their text is read, and what changing them
 * actually does to the first intervals. The numbers are measured through the
 * scheduler, not written down, so a change in ts-fsrs surfaces here.
 */
import {
  DEFAULT_SCHEDULING,
  MAXIMUM_INTERVALS,
  MAXIMUM_INTERVAL_LABELS,
  formatRetention,
  isPresetInterval,
  isValidSteps,
  NO_INTERVAL_LIMIT,
  parseMaximumInterval,
  parseWeights,
  parseSteps,
  RETENTIONS,
  schedulingKey,
  stepMinutes,
  stepsOrDefault,
} from '@/lib/fsrs-options';
import { firstEasyInterval } from '@/lib/scheduler';

import { check, group } from './harness';

group('Kroki nauki: zapis tekstem');

check('minuty', stepMinutes('10m'), 10);
check('godziny', stepMinutes('2h'), 120);
check('dni', stepMinutes('1d'), 1440);
check('wielkosc liter i spacje nie przeszkadzaja', stepMinutes('  15M '), 15);
check('zero to nie krok', stepMinutes('0m'), null);
check('bez jednostki nie', stepMinutes('10'), null);
check('obca jednostka nie', stepMinutes('10s'), null);

check('typowe kroki', parseSteps('1m 10m'), ['1m', '10m']);
check('jeden krok wystarczy', parseSteps('10m'), ['10m']);
check('mieszane jednostki tez', parseSteps('5m 2h 1d'), ['5m', '2h', '1d']);

// Steps have to climb: anything else sends the card backwards.
check('malejace kroki odpadaja', parseSteps('10m 1m'), null);
check('powtorzony krok tez', parseSteps('10m 10m'), null);
check('pusty tekst nie opisuje krokow', parseSteps('   '), null);
check('smiec odpada', parseSteps('1m potem 10m'), null);
check('za duzo krokow odpada', parseSteps('1m 2m 3m 4m 5m 6m 7m'), null);

check('walidacja zgadza sie z parsowaniem', isValidSteps('1m 10m'), true);
check('i odrzuca to samo', isValidSteps('10m 1m'), false);
// A deck row that somehow holds nonsense still has to schedule something.
check('bledny zapis w bazie spada na domyslny', stepsOrDefault('bzdura', '1m 10m'), ['1m', '10m']);

group('Klucz silnika obejmuje caly zestaw');

const base = DEFAULT_SCHEDULING;

check('ten sam zestaw daje ten sam klucz', schedulingKey(base), schedulingKey({ ...base }));
check(
  'inne kroki to inny klucz',
  schedulingKey({ ...base, learningSteps: '5m' }) === schedulingKey(base),
  false
);
check(
  'inny maksymalny odstep tez',
  schedulingKey({ ...base, maximumInterval: 180 }) === schedulingKey(base),
  false
);
check(
  'i inna retencja',
  schedulingKey({ ...base, desiredRetention: 0.88 }) === schedulingKey(base),
  false
);

group('Opcje realnie zmieniaja odstepy');

const easyAt = (retention: number) => firstEasyInterval({ ...base, desiredRetention: retention });

check('domyslny pierwszy odstep miesci sie w kilku dniach', easyAt(0.94) <= 6, true);
check('i nie jest zerowy', easyAt(0.94) >= 1, true);
check('wyzsza retencja skraca', easyAt(0.98) <= easyAt(0.94), true);
check('nizsza wydluza', easyAt(0.86) >= easyAt(0.94), true);

// The ceiling is the whole point of the setting: nothing may be scheduled past it.
check(
  'maksymalny odstep obcina nawet skrajna retencje',
  firstEasyInterval({ ...base, desiredRetention: 0.86, maximumInterval: 3 }) <= 3,
  true
);

check('kazda oferowana retencja daje sensowny odstep', RETENTIONS.filter((r) => easyAt(r) < 1), []);
check(
  'kazdy maksymalny odstep ma nazwe',
  MAXIMUM_INTERVALS.filter((days) => !MAXIMUM_INTERVAL_LABELS[days]),
  []
);
check('retencja pisze sie po polsku', formatRetention(0.9), '0,90');

group('Wlasna liczba dni');

check('zwykla liczba przechodzi', parseMaximumInterval('90'), 90);
check('spacje nie przeszkadzaja', parseMaximumInterval(' 45 '), 45);
check('jeden dzien to minimum', parseMaximumInterval('1'), 1);
check('zero nie', parseMaximumInterval('0'), null);
check('ujemna nie', parseMaximumInterval('-5'), null);
check('ulamek nie', parseMaximumInterval('7,5'), null);
check('kropka tez nie', parseMaximumInterval('7.5'), null);
check('tekst nie', parseMaximumInterval('rok'), null);
check('pusty nie', parseMaximumInterval(''), null);
// Past FSRS's own ceiling the setting stops meaning anything.
check('gorna granica to limit FSRS', parseMaximumInterval(String(NO_INTERVAL_LIMIT)), NO_INTERVAL_LIMIT);
check('ponad nia juz nie', parseMaximumInterval(String(NO_INTERVAL_LIMIT + 1)), null);

// Which values the editor shows as a preset, and which open the "own" field.
check('rok to gotowa pozycja', isPresetInterval(365), true);
check('a dziewiecdziesiat dni to wlasne', isPresetInterval(90), false);

group('Wagi zapisane jako tekst');

check('brak kolumny to brak wag', parseWeights(null), null);
check('poprawna lista wraca', parseWeights('[1,2,3]'), [1, 2, 3]);
// A row written by a future version, or corrupted, must not take the deck down.
check('niepoprawny JSON spada na domyslne', parseWeights('{'), null);
check('nie-lista tez', parseWeights('{"w":1}'), null);
check('lista z tekstem tez', parseWeights('[1,"dwa"]'), null);
check('lista z NaN tez', parseWeights('[1,null]'), null);
check('pusta lista tez', parseWeights('[]'), null);
