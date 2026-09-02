/**
 * What counts as an unsaved change in the card editor. Pure functions, so no
 * database — but this is what decides whether the back arrow asks a question.
 */
import { draftSignature } from '@/lib/card-draft';
import { BOUNDARY, baseKey, type Row } from '@/lib/field-rows';

import { check, group } from './harness';

const base = (side: 'front' | 'back'): Row => ({
  key: baseKey(side),
  kind: 'base',
  base: side,
});

const field = (key: string, value: string, mediaPath: string | null = null): Row => ({
  key,
  kind: 'extra',
  id: null,
  field: 'text',
  value,
  mediaPath,
});

const rows: Row[] = [base('front'), { key: BOUNDARY, kind: 'boundary' }, base('back')];

const sign = (front: string, back: string, own: Row[] = rows, tags: string[] = []) =>
  draftSignature(front, back, own, tags);

group('Rozpoznawanie niezapisanych zmian');

check('ta sama tresc to ta sama sygnatura', sign('to be', 'byc'), sign('to be', 'byc'));

// Typing a letter and deleting it again is not an edit; a flag set by onChange
// would say otherwise.
check('powrot do stanu wyjsciowego znosi zmiane', sign('to be', 'byc'), sign('to be', 'byc'));
check('zmiana pytania to zmiana', sign('to be', 'byc') === sign('to bee', 'byc'), false);
check('zmiana odpowiedzi tez', sign('to be', 'byc') === sign('to be', 'bywac'), false);

// The save trims, so trailing spaces cannot be an unsaved change.
check('spacje na koncu nie licza sie', sign('to be ', ' byc'), sign('to be', 'byc'));

group('Pola i tagi wchodza do sygnatury');

const withField = [base('front'), field('a', 'wymowa'), { key: BOUNDARY, kind: 'boundary' } as Row, base('back')];
const changedField = [base('front'), field('a', 'inna'), { key: BOUNDARY, kind: 'boundary' } as Row, base('back')];
const reordered = [field('a', 'wymowa'), base('front'), { key: BOUNDARY, kind: 'boundary' } as Row, base('back')];

check(
  'dodane pole to zmiana',
  sign('to be', 'byc') === sign('to be', 'byc', withField),
  false
);
check(
  'zmiana tresci pola to zmiana',
  sign('to be', 'byc', withField) === sign('to be', 'byc', changedField),
  false
);
// Dragging a field above the question changes what the card reads like.
check(
  'przestawienie wierszy to zmiana',
  sign('to be', 'byc', withField) === sign('to be', 'byc', reordered),
  false
);
check(
  'dodany tag to zmiana',
  sign('to be', 'byc') === sign('to be', 'byc', rows, ['czasownik']),
  false
);

// Row keys never reach the database, so they must not reach the signature.
const sameContentOtherKey = [
  base('front'),
  field('zupelnie-inny-klucz', 'wymowa'),
  { key: BOUNDARY, kind: 'boundary' } as Row,
  base('back'),
];

check(
  'klucz wiersza nie jest zmiana',
  sign('to be', 'byc', withField),
  sign('to be', 'byc', sameContentOtherKey)
);
