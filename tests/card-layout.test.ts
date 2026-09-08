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

group('Czytanie na glos');

/**
 * Speaking is a property of a text, not a field of its own: a piece that has
 * been given a language keeps its words **and** gains something to say. The
 * screen then puts the loudspeaker under those very words, which is the only
 * thing that says which of several buttons belongs to which line.
 */
const spoken = cardPieces({ ...plainCard(), frontSpeech: 'en-US', backSpeech: 'pt-PT' }, [
  { side: 'front', position: 1, value: 'a janela', kind: 'text' as const, speech: 'pt-PT' },
  { side: 'front', position: 2, value: 'cichy', kind: 'text' as const },
]);

const spokenFront = sideLines(spoken, 'front');

check('pytanie czyta swoim jezykiem', spokenFront[0]?.speak, {
  text: 'to break',
  language: 'en-US',
});
check('i nadal pokazuje swoj tekst', spokenFront[0]?.text, 'to break');
check('pole dodatkowe czyta swoim', spokenFront[1]?.speak, {
  text: 'a janela',
  language: 'pt-PT',
});
check('pole bez jezyka milczy', spokenFront[2]?.speak, null);

// The two sides are independent, which one deck-wide voice could never do.
check('odpowiedz czyta innym jezykiem niz pytanie', sideLines(spoken, 'back')[0]?.speak, {
  text: 'lamac',
  language: 'pt-PT',
});

// Hiding the text hides it from the loudspeaker too, or hiding would not hide.
const hiddenSpoken = cardPieces(plainCard(), [
  {
    side: 'back',
    position: 1,
    value: 'Komar je kanapke.',
    kind: 'mnemonic' as const,
    mediaPath: 'komar.jpg',
    speech: 'pl',
    hideValue: true,
  },
]);

check('schowany tekst nie daje sie przeczytac', sideLines(hiddenSpoken, 'back')[1]?.speak, null);
check('ale obraz zostaje', Boolean(sideLines(hiddenSpoken, 'back')[1]?.media), true);

// An attachment's `value` is a file name; no phone should read one aloud.
const namedFile = cardPieces(plainCard(), [
  {
    side: 'front',
    position: 1,
    value: 'img_2043.jpg',
    kind: 'image' as const,
    mediaPath: 'stored.jpg',
    speech: 'pl',
  },
]);

check('nazwa pliku nie jest czytana', sideLines(namedFile, 'front')[1]?.speak, null);

group('Wycofane pole wymowy');

/**
 * The retired `speech` kind: a field that was nothing but a button. It carries
 * no language of its own — the deck's answer voice is filled in by whoever
 * draws it — and what it says is its own text, or the card's answer, which may
 * well be laid out on the other face.
 */
const speechCard = cardPieces(plainCard(), [
  { side: 'front', position: 1, value: '', kind: 'speech' as const },
]);

const speechLine = sideLines(speechCard, 'front')[1];

check('pole wymowy zostaje na karcie', Boolean(speechLine), true);
check('czyta odpowiedz z drugiej strony', speechLine?.speak, { text: 'lamac', language: null });
check('i nie pokazuje zadnego tekstu', speechLine?.text, '');
check('zwykla linia nie ma czego czytac', sideLines(speechCard, 'front')[0]?.speak, null);

// Its own text wins, which is how a spelling the engine mangles gets nudged.
const spelled = cardPieces(plainCard(), [
  { side: 'front', position: 1, value: 'lamacz', kind: 'speech' as const },
]);

check('wpisany tekst wygrywa z odpowiedzia', sideLines(spelled, 'front')[1]?.speak, {
  text: 'lamacz',
  language: null,
});

// A button that reads silence is worse than no button.
const mute = cardPieces(
  { ...plainCard(), back: '' },
  [{ side: 'front', position: 1, value: '', kind: 'speech' as const }]
);

check('bez odpowiedzi i bez tekstu pole znika', sideLines(mute, 'front').length, 1);
