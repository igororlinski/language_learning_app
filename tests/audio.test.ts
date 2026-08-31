/**
 * Rules for audio attached to fields: the size limit and the name a copy is
 * stored under. Pure functions — the copying itself lives in
 * `src/lib/audio-files.ts` and needs a device.
 */
import {
  audioLabel,
  extensionOf,
  formatBytes,
  MAX_AUDIO_BYTES,
  storedFileName,
  withinSizeLimit,
} from '@/lib/audio';

import { check, group } from './harness';

group('Limit rozmiaru pliku');

check('limit to 10 MB', MAX_AUDIO_BYTES, 10 * 1024 * 1024);
check('plik pod limitem przechodzi', withinSizeLimit(MAX_AUDIO_BYTES - 1), true);
check('plik dokladnie na limicie przechodzi', withinSizeLimit(MAX_AUDIO_BYTES), true);
check('plik nad limitem odpada', withinSizeLimit(MAX_AUDIO_BYTES + 1), false);
// A picker that reports no size at all should not block the import.
check('brak rozmiaru nie blokuje', withinSizeLimit(undefined), true);

group('Rozmiar po polsku');

check('bajty', formatBytes(512), '512 B');
check('kilobajty bez czesci dziesietnej', formatBytes(2048), '2 KB');
check('megabajty z przecinkiem', formatBytes(2.5 * 1024 * 1024), '2,5 MB');

group('Nazwa zapisanego pliku');

check('rozszerzenie z nazwy', extensionOf('nagranie.MP3'), 'mp3');
check('nazwa bez rozszerzenia dostaje domyslne', extensionOf('nagranie'), 'm4a');

// Two files may share a name, so the stored one is built from the clock and a
// random tail — only the extension survives.
const at = new Date(2026, 7, 31, 12, 0, 0);
const stored = storedFileName('wymowa.mp3', at, () => 0.5);

check('nazwa konczy sie rozszerzeniem oryginalu', stored.endsWith('.mp3'), true);
check('nazwa nie zawiera oryginalnej nazwy', stored.includes('wymowa'), false);
check(
  'ta sama chwila i inna losowosc daja inna nazwe',
  storedFileName('wymowa.mp3', at, () => 0.1) === stored,
  false
);

group('Etykieta pola audio');

check('pusta nazwa dostaje zastepnik', audioLabel('   '), 'Nagranie');
check('nazwa pliku zostaje', audioLabel('wymowa.mp3'), 'wymowa.mp3');
