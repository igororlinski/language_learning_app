import type { FieldKind, FieldSide } from '@/db/schema';

/**
 * Where the pieces of a card sit.
 *
 * A card always carries two mandatory fields — the question and the answer —
 * plus any number of extra ones. None of them is tied to a face: each piece
 * stores the side it lives on and its position within that side, so the layout
 * is free. A card may put both mandatory fields on the back and leave the front
 * to a single extra field, or leave one face empty altogether.
 *
 * Both editors and the review screen read the order from here, so they cannot
 * disagree about how a card reads.
 */

/** Which mandatory field a piece is, or `null` for an extra one. */
export type BaseKind = 'front' | 'back';

/** One element of a card's layout, mandatory or not. */
export type LayoutPiece = {
  base: BaseKind | null;
  side: FieldSide;
  position: number;
  kind: FieldKind;
  value: string;
  audioPath: string | null;
};

/** The columns that place a card's two mandatory fields. */
export type CardPlacement = {
  front: string;
  back: string;
  frontSide: FieldSide;
  frontPosition: number;
  backSide: FieldSide;
  backPosition: number;
};

/** Everything a card is made of, mandatory fields and extras in one list. */
export function cardPieces<
  T extends {
    side: FieldSide;
    position: number;
    value: string;
    kind?: FieldKind;
    audioPath?: string | null;
  },
>(card: CardPlacement, extras: T[]): LayoutPiece[] {
  const base = (kind: BaseKind, side: FieldSide, position: number, value: string): LayoutPiece => ({
    base: kind,
    side,
    position,
    kind: 'text',
    value,
    audioPath: null,
  });

  return [
    base('front', card.frontSide, card.frontPosition, card.front),
    base('back', card.backSide, card.backPosition, card.back),
    ...extras.map<LayoutPiece>((field) => ({
      base: null,
      side: field.side,
      position: field.position,
      kind: field.kind ?? 'text',
      value: field.value,
      audioPath: field.audioPath ?? null,
    })),
  ];
}

/**
 * One face's pieces in reading order. Sorting by position is enough: positions
 * are handed out per side by the editor, and `Array.sort` is stable, so pieces
 * that somehow share one keep the order they came in.
 */
export function piecesOnSide(pieces: LayoutPiece[], side: FieldSide): LayoutPiece[] {
  return pieces.filter((piece) => piece.side === side).sort((a, b) => a.position - b.position);
}

/**
 * One rendered line of a card face. An audio line shows a play button instead
 * of text; `text` is then the original file name, which is all the label it has.
 */
export type CardLine = { text: string; base: boolean; audioPath: string | null };

/**
 * The lines one face shows during review. Extras with nothing in them are
 * dropped — an empty text box, or an audio field whose file went missing. They
 * still exist on the card and hold their place in the editor, they just have
 * nothing to show. A face with no pieces at all renders as nothing, which is a
 * layout the editor allows on purpose.
 */
export function sideLines(pieces: LayoutPiece[], side: FieldSide): CardLine[] {
  return piecesOnSide(pieces, side)
    .filter((piece) => {
      if (piece.base !== null) return true;
      return piece.kind === 'audio' ? Boolean(piece.audioPath) : piece.value.trim().length > 0;
    })
    .map((piece) => ({
      text: piece.value,
      base: piece.base !== null,
      audioPath: piece.kind === 'audio' ? piece.audioPath : null,
    }));
}
