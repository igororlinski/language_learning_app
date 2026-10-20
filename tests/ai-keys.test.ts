/**
 * What a set of the user's keys allows. A fresh install has none, and every AI
 * action must stay off until the right one is there — and say which.
 */
import {
  cleanKeys,
  cleanLmStudioUrl,
  drawBlocker,
  hasCloudflare,
  NO_KEYS,
  textBlocker,
} from '@/lib/ai-keys';
import { CLOUD_TEXT } from '@/lib/ai-transport';

import { check, group } from './harness';

const LOCAL = { provider: 'lmstudio', model: null } as const;

group('Adres LM Studio, jak go ludzie wklejaja');

check('sam adres z portem dostaje schemat', cleanLmStudioUrl('192.168.1.20:1234'), 'http://192.168.1.20:1234');
check('https zostaje', cleanLmStudioUrl('https://abc.trycloudflare.com/'), 'https://abc.trycloudflare.com');
// The paths add their own `/v1`; a pasted one would double it.
check('koncowe /v1 odpada', cleanLmStudioUrl('http://pc:1234/v1/'), 'http://pc:1234');
check('pusty zostaje pusty', cleanLmStudioUrl('   '), '');

check(
  'klucze sa przycinane',
  cleanKeys({ ...NO_KEYS, gemini: ' G ', cloudflareToken: '\tT\n' }),
  { ...NO_KEYS, gemini: 'G', cloudflareToken: 'T' }
);

group('Pierwsze uruchomienie: AI wylaczone');

check('bez kluczy nie ma tekstu', textBlocker(NO_KEYS, CLOUD_TEXT) !== null, true);
check('ani obrazow', drawBlocker(NO_KEYS) !== null, true);
check('ani LM Studio', textBlocker(NO_KEYS, LOCAL) !== null, true);

group('Co odblokowuje ktory klucz');

check('Gemini wystarcza na tekst', textBlocker({ ...NO_KEYS, gemini: 'G' }, CLOUD_TEXT), null);
check('ale nie na obrazy', drawBlocker({ ...NO_KEYS, gemini: 'G' }) !== null, true);

const cloudflare = { ...NO_KEYS, cloudflareAccount: 'ACC', cloudflareToken: 'T' };

check('Cloudflare daje obrazy', drawBlocker(cloudflare), null);
// llama stands behind Gemini, and on its own it is still a way to write text.
check('i sam w sobie tekst', textBlocker(cloudflare, CLOUD_TEXT), null);
check('konto bez tokenu nie otwiera niczego', hasCloudflare({ ...NO_KEYS, cloudflareAccount: 'ACC' }), false);

// LM Studio, once chosen, is the only thing asked — a Gemini key does not stand in for it.
check(
  'wybrane LM Studio potrzebuje adresu, nie Gemini',
  textBlocker({ ...NO_KEYS, gemini: 'G' }, LOCAL) !== null,
  true
);
check('z adresem dziala', textBlocker({ ...NO_KEYS, lmStudioUrl: 'http://pc:1234' }, LOCAL), null);
