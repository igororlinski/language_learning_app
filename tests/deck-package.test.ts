/**
 * The deck file's own rules, without a database: what `deck.json` must look
 * like to be imported at all. The round trip through a real database is in
 * `data-layer.test.ts`.
 */
import { strToU8 } from 'fflate';

import {
  DECK_FORMAT,
  DECK_VERSION,
  deckFileName,
  deckManifest,
  jsonBytes,
  parseDeckManifest,
  parseDeckPackage,
  type DeckPackage,
  type PackageCard,
} from '@/lib/deck-package';

import { check, group } from './harness';

const uid = (n: number) => n.toString(16).padStart(32, '0');

const card = (n: number, patch: Partial<PackageCard> = {}): PackageCard => ({
  uid: uid(n),
  front: `pytanie ${n}`,
  back: `odpowiedź ${n}`,
  frontSide: 'front',
  frontPosition: 0,
  backSide: 'back',
  backPosition: 0,
  frontSpeech: null,
  backSpeech: 'pt-PT',
  frontPhonetic: null,
  backPhonetic: '/ˈɡatu/',
  createdAt: 1761000000000 + n,
  tags: ['zwierzęta'],
  fields: [
    {
      side: 'back',
      position: 1,
      kind: 'image',
      value: 'kot.jpg',
      mediaPath: 'abc-1.jpg',
      mnemonic: null,
      hideValue: false,
      hideMedia: false,
      speech: null,
      phonetic: null,
    },
  ],
  schedule: {
    due: 1761100000000,
    stability: 3.2,
    difficulty: 5.1,
    elapsedDays: 1,
    scheduledDays: 3,
    learningSteps: 0,
    reps: 2,
    lapses: 0,
    state: 2,
    lastReview: 1761000000000,
  },
  reviews: [
    {
      uid: uid(1000 + n),
      rating: 3,
      state: 0,
      due: 1761000000000,
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      lastElapsedDays: 0,
      scheduledDays: 0,
      learningSteps: 0,
      reviewedAt: 1761000000000,
      durationMs: 4200,
    },
  ],
  ...patch,
});

const pkg: DeckPackage = {
  format: DECK_FORMAT,
  version: DECK_VERSION,
  createdAt: '2026-10-23T12:00:00.000Z',
  withProgress: true,
  deck: {
    uid: uid(99),
    name: 'Portugalski',
    description: null,
    newPerDay: 20,
    reviewsPerDay: 200,
    newCardPlacement: 'mixed',
    newCardOrder: 'oldest',
    desiredRetention: 0.94,
    maximumInterval: 365,
    learningSteps: '1m 10m',
    relearningSteps: '10m',
    fsrsWeights: null,
    frontLanguages: '["pl"]',
    backLanguages: '["pt-PT"]',
    imageQuality: 'fast',
  },
  templates: [
    {
      name: 'Podstawowy',
      frontSide: 'front',
      frontPosition: 0,
      backSide: 'back',
      backPosition: 0,
      frontSpeech: null,
      backSpeech: 'pt-PT',
      frontPhoneticLanguage: null,
      backPhoneticLanguage: 'pt-PT',
      slots: [{ side: 'back', position: 1, kind: 'text', speech: null, phoneticLanguage: null }],
    },
  ],
  cards: [card(1), card(2)],
};

/** The package with something changed, as bytes — the way an import sees it. */
const tampered = (change: (data: Record<string, any>) => void) => {
  const data = JSON.parse(JSON.stringify(pkg));
  change(data);
  return parseDeckPackage(jsonBytes(data));
};

group('Paczka talii: odczyt');

check('paczka wraca z bajtow bez zmian', parseDeckPackage(jsonBytes(pkg)), pkg);
check('manifest tez', parseDeckManifest(jsonBytes(deckManifest(pkg))), {
  format: DECK_FORMAT,
  version: DECK_VERSION,
  createdAt: pkg.createdAt,
  name: 'Portugalski',
  cards: 2,
  withProgress: true,
});
check('kopia zapasowa to nie paczka talii', parseDeckManifest(strToU8('{"format":"fiszki-backup"}')), null);
check('smieci tez nie', parseDeckPackage(strToU8('PK\u0003\u0004')), null);

// Without progress the file carries no schedule — and none is trusted if it does.
check(
  'bez postepu harmonogram i historia sa ignorowane',
  tampered((data) => {
    data.withProgress = false;
  })?.cards.map((c) => [c.schedule, c.reviews]),
  [
    [null, []],
    [null, []],
  ]
);

group('Paczka talii: co odrzuca');

check(
  'nieznany rodzaj pola',
  tampered((data) => (data.cards[0].fields[0].kind = 'script')),
  null
);
check(
  'nieznana strona',
  tampered((data) => (data.cards[0].frontSide = 'middle')),
  null
);
check(
  'plik poza katalogiem',
  tampered((data) => (data.cards[0].fields[0].mediaPath = '../db.sqlite')),
  null
);
check(
  'plik w podkatalogu',
  tampered((data) => (data.cards[0].fields[0].mediaPath = 'a/b.jpg')),
  null
);
check(
  'zly uid',
  tampered((data) => (data.cards[0].uid = 'DROP TABLE')),
  null
);
check(
  'dwie karty z jednym uid',
  tampered((data) => (data.cards[1].uid = data.cards[0].uid)),
  null
);
check(
  'dwie odpowiedzi z jednym uid',
  tampered((data) => (data.cards[1].reviews[0].uid = data.cards[0].reviews[0].uid)),
  null
);
check(
  'ocena spoza 1–4',
  tampered((data) => (data.cards[0].reviews[0].rating = 7)),
  null
);
check(
  'stan spoza 0–3',
  tampered((data) => (data.cards[0].schedule.state = 9)),
  null
);
check(
  'nowsza wersja pliku',
  tampered((data) => (data.version = DECK_VERSION + 1)),
  null
);
check(
  'pusta nazwa pliku to brak pliku',
  tampered((data) => (data.cards[0].fields[0].mediaPath = ''))?.cards[0].fields[0].mediaPath,
  null
);
check('pusta nazwa talii dostaje zastepcza', tampered((data) => (data.deck.name = '  '))?.deck.name, 'Talia');

group('Paczka talii: nazwa pliku');

check(
  'nazwa ze zlozonymi ogonkami',
  deckFileName('Żółw: słówka (A1)', new Date(2026, 9, 23)),
  'talia-zolw-slowka-a1-2026-10-23.zip'
);
check('sama interpunkcja', deckFileName('!!!', new Date(2026, 9, 23)), 'talia-talia-2026-10-23.zip');
