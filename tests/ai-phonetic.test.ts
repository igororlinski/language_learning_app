/**
 * A transcription goes out as a text and a language name, and comes back as
 * one line between slashes — whatever wrapping the model put around it.
 */
import { parsePhonetic, requestPhonetic } from '@/lib/ai-phonetic';
import { NO_KEYS } from '@/lib/ai-keys';
import { CLOUD_TEXT } from '@/lib/ai-transport';

import { bodyOf, withStub } from './ai-transport.test';
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

const KEYS = { ...NO_KEYS, gemini: 'GKEY' };

const geminiSays = (text: string) => ({
  status: 200,
  body: { candidates: [{ content: { parts: [{ text }] } }] },
});

const asked = await withStub(geminiSays('{"ipa": "/kuˈmeɾ/"}'), () =>
  requestPhonetic('  comer ', 'pt-PT', CLOUD_TEXT, KEYS)
);

check('zapis wraca do wolajacego', asked.outcome, '/kuˈmeɾ/');

const sent = bodyOf(asked.sent) as {
  contents?: { parts?: { text?: string }[] }[];
  generationConfig?: { temperature?: number };
};

// The region matters: European and Brazilian Portuguese transcribe differently.
check(
  'tekst przyciety, jezyk jako angielska nazwa z regionem',
  sent.contents?.[0]?.parts?.[0]?.text,
  'Language: Portuguese (European)\nText: comer'
);
// One right answer and nothing to gain from a wild one.
check('niska temperatura', sent.generationConfig?.temperature, 0.2);

const garbled = await withStub(geminiSays(' '), () =>
  requestPhonetic('comer', 'pt-PT', CLOUD_TEXT, KEYS)
);

check('pusta odpowiedz modelu to blad', garbled.outcome, 'malformed');

const blank = await withStub(geminiSays('/x/'), () =>
  requestPhonetic('   ', 'pt-PT', CLOUD_TEXT, KEYS)
);

check('pusty tekst nie idzie nigdzie', blank.outcome, 'empty-prompt');
check('i niczego nie wysyla', blank.sent, null);

const noKey = await withStub(geminiSays('/x/'), () =>
  requestPhonetic('comer', 'pt-PT', CLOUD_TEXT, NO_KEYS)
);

check('bez klucza tez nie', noKey.outcome, 'no-text-key');
