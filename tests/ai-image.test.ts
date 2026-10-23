/**
 * What a picture request carries: the decoration around the subject, the step
 * count — a spending decision rather than a tuning detail — and which model on
 * the user's own Cloudflare account is asked first.
 */
import { buildPrompt, generateImage, generatePicture, generatePictures } from '@/lib/ai-image';
import { NO_KEYS } from '@/lib/ai-keys';
import { setSpendSink } from '@/lib/ai-usage';

import { bodyOf, headersOf, withStub } from './ai-transport.test';
import { check, group } from './harness';

const KEYS = { ...NO_KEYS, cloudflareAccount: 'ACC', cloudflareToken: 'CFT' };
const RUN = 'https://api.cloudflare.com/client/v4/accounts/ACC/ai/run/';
const SCHNELL = `${RUN}@cf/black-forest-labs/flux-1-schnell`;
const KLEIN = `${RUN}@cf/black-forest-labs/flux-2-klein-4b`;

const drew = (image: string) => ({ status: 200, body: { success: true, result: { image } } });

let spent = 0;

setSpendSink((metric, _day, amount) => {
  if (metric === 'neurons') spent += amount;
});

group('Prompt do generatora obrazu');

const prompt = buildPrompt('  to   break  ');

check('hasło trafia do promptu', prompt.includes('to break'), true);
check('i jest scisniete ze spacji', prompt.includes('to   break'), false);
// Image models like writing words into pictures, and a misspelt word on a
// vocabulary card teaches the misspelling.
check('prompt zabrania tekstu na obrazie', prompt.includes('No text'), true);
check('mieści się w limicie Cloudflare', buildPrompt('x'.repeat(5000)).length <= 2048, true);

group('Szybki obraz na koncie uzytkownika');

const made = await withStub(drew('BASE64'), () => generateImage('dog', 'fast', KEYS));

check('obraz wraca do wolajacego', made.outcome, 'BASE64');
check('szybki to schnell', made.sent?.url, SCHNELL);
check('z tokenem uzytkownika', headersOf(made.sent).Authorization, 'Bearer CFT');
check('w ciele jedzie gotowy prompt', bodyOf(made.sent).prompt, buildPrompt('dog'));
// Steps are most of what a quick picture costs — see the comment on STEPS.
check('i liczba krokow', bodyOf(made.sent).steps, 4);
check('policzony jak szybki obraz', Math.round(spent * 10) / 10, 57.6);

group('Dokladny obraz');

spent = 0;

const careful = await withStub(drew('B'), () => generatePicture('scena', 'accurate', KEYS));

check('dokladny to klein', careful.sent?.url, KLEIN);
// FLUX 2 refuses JSON: a multipart form or nothing.
check('jako formularz', careful.sent?.init.body instanceof FormData, true);
check(
  'z promptem i rozmiarem',
  [
    (careful.sent?.init.body as FormData).get('prompt'),
    (careful.sent?.init.body as FormData).get('width'),
  ],
  ['scena', '1024']
);
check('policzony jak dokladny', spent, 104);

group('Odmowa pierwszego modelu');

// schnell refused "a young military cadet sitting on a wooden chair" as NSFW,
// one of our own prompt's examples; klein drew it.
const rescued = await withStub(
  (url) =>
    url === SCHNELL
      ? { status: 400, body: { success: false, errors: [{ message: '8007: NSFW' }] } }
      : drew('FROM-KLEIN'),
  () => generatePicture('a cadet on a chair', 'fast', KEYS)
);

check('drugi model ratuje obraz', rescued.outcome, 'FROM-KLEIN');
check('w kolejnosci szybki, potem dokladny', rescued.calls.map((call) => call.url), [SCHNELL, KLEIN]);

group('Trzy obrazy naraz');

spent = 0;

let n = 0;
const round = await withStub(
  () => drew(String.fromCharCode(65 + n++)),
  async () => (await generatePictures('scena', 'fast', 3, KEYS)).join(',')
);

check('trzy zadania obok siebie', round.calls.length, 3);
check('wszystkie obrazy wracaja', round.outcome, 'A,B,C');
check('i wszystkie sa policzone', Math.round(spent * 10) / 10, 172.8);

// Two pictures beat an error message.
let m = 0;
const partial = await withStub(
  () =>
    m++ === 1
      ? { status: 400, body: { success: false, errors: [{ message: 'no' }] } }
      : drew('X'),
  async () => (await generatePictures('scena', 'accurate', 2, KEYS)).length
);

check('niepelna runda oddaje to, co powstalo', partial.outcome, '2');

const nothing = await withStub(
  { status: 400, body: { success: false, errors: [{ message: 'refused' }] } },
  () => generatePictures('scena', 'fast', 3, KEYS)
);

check('runda bez obrazu to blad, nie pusta lista', nothing.outcome, 'provider');

group('Czego zadanie o obraz nie sprobuje');

const noKey = await withStub(drew('X'), () => generatePictures('scena', 'fast', 3, NO_KEYS));

check('bez klucza Cloudflare nic nie wychodzi', noKey.calls.length, 0);
check('a odmowa mowi, czego brak', noKey.outcome, 'no-image-key');

const tokenOnly = await withStub(drew('X'), () =>
  generatePicture('scena', 'fast', { ...NO_KEYS, cloudflareToken: 'CFT' })
);

check('token bez ID konta to tez brak klucza', tokenOnly.outcome, 'no-image-key');

const blank = await withStub(drew('X'), () => generateImage('   ', 'fast', KEYS));

check('puste haslo nie idzie nigdzie', blank.outcome, 'empty-prompt');
check('i niczego nie wysyla', blank.calls.length, 0);

setSpendSink(null);
