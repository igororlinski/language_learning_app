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

group('Karta bez odpowiedzi');

// Only the question has to be filled in. A card with no answer typed shows
// nothing on its back instead of a blank line where text would be.
const noAnswer = cardPieces({ ...plainCard(), back: '' }, [
  extra('back', 1, 'ran / run'),
]);

check('przod czyta sie normalnie', texts(sideLines(noAnswer, 'front')), ['[to break]']);
check('a tyl pomija puste pole podstawowe', texts(sideLines(noAnswer, 'back')), ['ran / run']);

const nothingAtAll = cardPieces({ ...plainCard(), back: '   ' }, []);

check('tyl bez niczego nie ma ani jednej linii', sideLines(nothingAtAll, 'back'), []);
check('ale pole nadal jest czescia ukladu', piecesOnSide(nothingAtAll, 'back').length, 1);

group('Schowane polowki pola');

/** A mnemonic field: a sentence to read and a picture to look at. */
const association = (overrides: { hideValue?: boolean; hideMedia?: boolean } = {}) =>
  cardPieces(plainCard(), [
    {
      side: 'back' as const,
      position: 1,
      value: 'Komar je kanapkę.',
      kind: 'mnemonic' as const,
      mediaPath: 'komar.jpg',
      ...overrides,
    },
  ]);

const backLine = (pieces: ReturnType<typeof cardPieces>) => sideLines(pieces, 'back')[1];

check('domyslnie widac i zdanie, i obraz', [
  backLine(association())?.text,
  backLine(association())?.media?.fileName,
], ['Komar je kanapkę.', 'komar.jpg']);

// Hiding is not deleting: the piece keeps its content and stays in the layout,
// it simply stops reaching the learner.
check(
  'schowane zdanie znika z karty',
  backLine(association({ hideValue: true }))?.text,
  ''
);
check(
  'ale obraz zostaje',
  backLine(association({ hideValue: true }))?.media?.fileName,
  'komar.jpg'
);
check(
  'schowany obraz znika z karty',
  backLine(association({ hideMedia: true }))?.media,
  null
);
check(
  'a zdanie zostaje',
  backLine(association({ hideMedia: true }))?.text,
  'Komar je kanapkę.'
);

// Both halves hidden leaves nothing to show, so the field falls out through the
// same filter an empty one does.
check(
  'schowane obie polowki to pole bez linii',
  sideLines(association({ hideValue: true, hideMedia: true }), 'back').length,
  1
);
check(
  'ale pole nadal jest czescia ukladu',
  piecesOnSide(association({ hideValue: true, hideMedia: true }), 'back').length,
  2
);

group('Pole wymowy');

/**
 * A speech field carries no file and shows no text — it is a button. What it
 * says is its own text, or the card's answer, and the answer may well be laid
 * out on the other face, which is why this is resolved here rather than in the
 * screen that draws one side.
 */
const speechCard = cardPieces(plainCard(), [
  { side: 'front', position: 1, value: '', kind: 'speech' as const },
]);

const speechLine = sideLines(speechCard, 'front')[1];

check('pole wymowy zostaje na karcie', Boolean(speechLine), true);
check('czyta odpowiedz z drugiej strony', speechLine?.speak, 'lamac');
check('i nie pokazuje zadnego tekstu', speechLine?.text, '');
check('zwykla linia nie ma czego czytac', sideLines(speechCard, 'front')[0]?.speak, null);

// Its own text wins, which is how a spelling the engine mangles gets nudged.
const spelled = cardPieces(plainCard(), [
  { side: 'front', position: 1, value: 'lamacz', kind: 'speech' as const },
]);

check('wpisany tekst wygrywa z odpowiedzia', sideLines(spelled, 'front')[1]?.speak, 'lamacz');

// A button that reads silence is worse than no button.
const mute = cardPieces(
  { ...plainCard(), back: '' },
  [{ side: 'front', position: 1, value: '', kind: 'speech' as const }]
);

check('bez odpowiedzi i bez tekstu pole znika', sideLines(mute, 'front').length, 1);
