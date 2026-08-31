/**
 * Rules for the files a field can carry: per-kind size limits and the name a
 * copy is stored under. Pure functions — the copying itself lives in
 * `src/lib/media-files.ts` and needs a device.
 */
import {
  extensionOf,
  formatBytes,
  isMediaKind,
  MEDIA_DIRECTORIES,
  MEDIA_LIMITS,
  mediaLabel,
  storedFileName,
  withinSizeLimit,
} from '@/lib/media';

import { check, group } from './harness';

group('Rodzaje pol z plikiem');

check('tekst nie jest mediami', isMediaKind('text'), false);
check('dzwiek jest', isMediaKind('audio'), true);
check('obraz tez', isMediaKind('image'), true);
check('kazdy rodzaj ma swoj katalog', MEDIA_DIRECTORIES, {
  audio: 'card-audio',
  image: 'card-images',
});

group('Limity rozmiaru');

check('dzwiek do 10 MB', MEDIA_LIMITS.audio, 10 * 1024 * 1024);
check('obraz do 5 MB', MEDIA_LIMITS.image, 5 * 1024 * 1024);
check('plik dokladnie na limicie przechodzi', withinSizeLimit('image', MEDIA_LIMITS.image), true);
check('plik nad limitem odpada', withinSizeLimit('image', MEDIA_LIMITS.image + 1), false);
// The same file may pass as sound and fail as a picture.
check('limity sa liczone osobno', withinSizeLimit('audio', MEDIA_LIMITS.image + 1), true);
// A picker that reports no size at all should not block the import.
check('brak rozmiaru nie blokuje', withinSizeLimit('audio', undefined), true);

group('Rozmiar po polsku');

check('bajty', formatBytes(512), '512 B');
check('kilobajty bez czesci dziesietnej', formatBytes(2048), '2 KB');
check('megabajty z przecinkiem', formatBytes(2.5 * 1024 * 1024), '2,5 MB');

group('Nazwa zapisanego pliku');

check('rozszerzenie z nazwy', extensionOf('nagranie.MP3', 'm4a'), 'mp3');
check('nazwa bez rozszerzenia dostaje domyslne', extensionOf('nagranie', 'm4a'), 'm4a');

// Two files may share a name, so the stored one is built from the clock and a
// random tail — only the extension survives.
const at = new Date(2026, 7, 31, 12, 0, 0);
const stored = storedFileName('audio', 'wymowa.mp3', at, () => 0.5);

check('nazwa konczy sie rozszerzeniem oryginalu', stored.endsWith('.mp3'), true);
check('nazwa nie zawiera oryginalnej nazwy', stored.includes('wymowa'), false);
check(
  'obraz bez rozszerzenia dostaje jpg',
  storedFileName('image', 'zdjecie', at, () => 0.5).endsWith('.jpg'),
  true
);
check(
  'ta sama chwila i inna losowosc daja inna nazwe',
  storedFileName('audio', 'wymowa.mp3', at, () => 0.1) === stored,
  false
);

group('Etykieta pola z plikiem');

check('pusta nazwa dzwieku dostaje zastepnik', mediaLabel('audio', '   '), 'Nagranie');
check('pusta nazwa obrazu tez', mediaLabel('image', ''), 'Obraz');
check('nazwa pliku zostaje', mediaLabel('audio', 'wymowa.mp3'), 'wymowa.mp3');
