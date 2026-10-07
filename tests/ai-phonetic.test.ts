/**
 * A transcription goes out as a text and a language name, and comes back as
 * one line between slashes — whatever wrapping the model put around it.
 */
import { parsePhonetic, requestPhonetic } from '@/lib/ai-phonetic';

import { withStub } from './ai-worker.test';
import { check, group } from './harness';

group('Odczyt zapisu fonetycznego');

// Gemini answers in its schema.
check('JSON ze schematu', parsePhonetic('{"ipa": "/kuˈmeɾ/"}'), '/kuˈmeɾ/');
// The fallback model answers in free text, any of these ways.
check('w plotku kodu', parsePhonetic('```json\n{"ipa": "/ʒɐˈnɛlɐ/"}\n```'), '/ʒɐˈnɛlɐ/');
check('goly zapis bez ukosnikow', parsePhonetic('kuˈmeɾ'), '/kuˈmeɾ/');
check('nawiasy kwadratowe zamienione na ukosniki', parsePhonetic('[kuˈmeɾ]'), '/kuˈmeɾ/');
check(
  'zdanie wstepu odpada',
  parsePhonetic('The IPA transcription is /ɪç ˈhaːbə ˈhʊŋɐ/.'),
  '/ɪç ˈhaːbə ˈhʊŋɐ/'
);
check('cudzyslowy odpadaja', parsePhonetic('"/kuˈmeɾ/"'), '/kuˈmeɾ/');
check('nadmiar spacji sie sciska', parsePhonetic('/ɪç   ˈhaːbə/'), '/ɪç ˈhaːbə/');
check('pusta odpowiedz to brak zapisu', parsePhonetic('   '), null);
check('pusty JSON tez', parsePhonetic('{"ipa": ""}'), null);

group('O co prosi zadanie o zapis fonetyczny');

const asked = await withStub(
  { status: 200, body: { success: true, result: { text: '{"ipa": "/kuˈmeɾ/"}' } } },
  () => requestPhonetic('  comer ', 'pt-PT', 'https://w.example.dev')
);

check('zapis wraca do wolajacego', asked.outcome, '/kuˈmeɾ/');
check('idzie na wlasna sciezke', asked.sent?.url, 'https://w.example.dev/phonetic');

const askedBody = JSON.parse(String(asked.sent?.init.body)) as { text?: unknown; language?: unknown };

check('tekst jedzie przyciety', askedBody.text, 'comer');
// The region matters: European and Brazilian Portuguese transcribe differently.
check('a jezyk jako angielska nazwa z regionem', askedBody.language, 'Portuguese (European)');

const garbled = await withStub(
  { status: 200, body: { success: true, result: { text: '' } } },
  () => requestPhonetic('comer', 'pt-PT', 'https://w.example.dev')
);

check('pusta odpowiedz modelu to blad', garbled.outcome, 'malformed');

const blank = await withStub({ status: 200, body: {} }, () =>
  requestPhonetic('   ', 'pt-PT', 'https://w.example.dev')
);

check('pusty tekst nie idzie nigdzie', blank.outcome, 'empty-prompt');
check('i niczego nie wysyla', blank.sent, null);
