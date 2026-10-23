/**
 * The phone counts what it spends against the user's free allowances, each on
 * its own provider's day.
 */
import { dayIn, recordSpend, setSpendSink, usageDay, usageFrom } from '@/lib/ai-usage';

import { check, group } from './harness';

group('Doba dostawcy');

// 03:00 UTC on 21 October is still 20 October in California.
const early = new Date(Date.UTC(2026, 9, 21, 3, 0));

check('Cloudflare liczy po UTC', usageDay('neurons', early), '2026-10-21');
check('Google po czasie pacyficznym', usageDay('gemini', early), '2026-10-20');
check('format daty', dayIn('UTC', new Date(Date.UTC(2026, 0, 5, 12))), '2026-01-05');

group('Zapis wydatkow');

const recorded: [string, string, number][] = [];

setSpendSink((metric, day, amount) => recorded.push([metric, day, amount]));
recordSpend('neurons', 57.6, early);
recordSpend('gemini', 1, early);
recordSpend('neurons', 0, early);

check('wydatki trafiaja do bazy z wlasna doba', recorded, [
  ['neurons', '2026-10-21', 57.6],
  ['gemini', '2026-10-20', 1],
]);

setSpendSink(() => {
  throw new Error('disk full');
});

// A number that fails to record is worth far less than the picture just paid for.
check(
  'blad zapisu nie wywraca generacji',
  (() => {
    try {
      recordSpend('neurons', 1, early);
      return 'ok';
    } catch {
      return 'rzucil';
    }
  })(),
  'ok'
);

setSpendSink(null);

group('Dzisiejsze limity');

const rows = [
  { metric: 'neurons', day: '2026-10-21', amount: 5000.4 },
  { metric: 'neurons', day: '2026-10-20', amount: 9000 },
  { metric: 'gemini', day: '2026-10-20', amount: 52 },
];

const today = usageFrom(rows, early);

check('polowa neuronow zostala', today.images.pctLeft, 50);
check('wczorajsze sie nie licza', today.images.used, 5000);
check('Gemini liczony po swojej dobie', today.text.pctLeft, 90);
check('nic wydane to 100%', usageFrom([], early).images.pctLeft, 100);
check(
  'przekroczony limit to 0%, nie liczba ujemna',
  usageFrom([{ metric: 'gemini', day: '2026-10-20', amount: 600 }], early).text.pctLeft,
  0
);
