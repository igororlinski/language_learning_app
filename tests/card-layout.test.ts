/**
 * Card layout: how the two mandatory fields and the extra ones fall into two
 * faces. Everything here is free to move — a mandatory field can sit on either
 * side, and a side can end up empty. Pure functions, so no database.
 */
import { cardPieces, piecesOnSide, sideLines, type CardPlacement } from '@/lib/card-layout';

import { check, group } from './harness';

/** A card whose question is on the front and answer on the back, as usual. */
const plainCard = (): CardPlacement => ({
  front: 'to break',
  back: 'lamac',
  frontSide: 'front',
  frontPosition: 0,
  backSide: 'back',
  backPosition: 0,
});

const extra = (side: 'front' | 'back', position: number, value: string) => ({
  side,
  position,
  value,
});

const texts = (lines: { text: string; base: boolean }[]) =>
  lines.map((line) => (line.base ? `[${line.text}]` : line.text));

group('Domyslny uklad karty');

const plain = cardPieces(plainCard(), [
  extra('front', 1, '/breik/'),
  extra('back', 1, 'break-broke-broken'),
]);

check('przod: pole podstawowe, potem dodatkowe', texts(sideLines(plain, 'front')), [
  '[to break]',
  '/breik/',
]);
check('tyl tak samo', texts(sideLines(plain, 'back')), ['[lamac]', 'break-broke-broken']);

group('Pole podstawowe da sie przesunac');

// The extra field was dragged above the question.
const reordered = cardPieces({ ...plainCard(), frontPosition: 1 }, [
  extra('front', 0, '/breik/'),
]);

check('dodatkowe nad podstawowym', texts(sideLines(reordered, 'front')), [
  '/breik/',
  '[to break]',
]);

// Both mandatory fields dragged to the back: the front holds one extra field.
const questionMoved = cardPieces(
  { ...plainCard(), frontSide: 'back', frontPosition: 1, backPosition: 0 },
  [extra('front', 0, 'obrazek')]
);

check('pytanie zjechalo na tyl', texts(sideLines(questionMoved, 'back')), [
  '[lamac]',
  '[to break]',
]);
check('a z przodu zostalo samo pole dodatkowe', texts(sideLines(questionMoved, 'front')), [
  'obrazek',
]);

group('Pusta strona karty');

// Everything on the back — nothing shows before the answer is revealed.
const emptyFront = cardPieces(
  { ...plainCard(), frontSide: 'back', frontPosition: 0, backPosition: 1 },
  []
);

check('przod nie ma ani jednej linii', sideLines(emptyFront, 'front'), []);
check('tyl ma oba pola podstawowe', texts(sideLines(emptyFront, 'back')), [
  '[to break]',
  '[lamac]',
]);

group('Puste pola dodatkowe');

const withBlanks = cardPieces(plainCard(), [
  extra('front', 1, '   '),
  extra('front', 2, 'czasownik'),
]);

check('puste pole nie trafia na karte, reszta zostaje', texts(sideLines(withBlanks, 'front')), [
  '[to break]',
  'czasownik',
]);
check(
  'ale nadal jest czescia ukladu',
  piecesOnSide(withBlanks, 'front').length,
  3
);

// Positions do not have to be a tidy 0,1,2 — after an edit they may have gaps.
const gappy = cardPieces({ ...plainCard(), frontPosition: 5 }, [
  extra('front', 9, 'dol'),
  extra('front', 1, 'gora'),
]);

check('dziury w pozycjach nie psuja kolejnosci', texts(sideLines(gappy, 'front')), [
  'gora',
  '[to break]',
  'dol',
]);
