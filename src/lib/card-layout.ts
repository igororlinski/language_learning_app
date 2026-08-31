import type { FieldSide } from '@/db/schema';

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
  value: string;
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
export function cardPieces<T extends { side: FieldSide; position: number; value: string }>(
  card: CardPlacement,
  extras: T[]
): LayoutPiece[] {
  return [
    { base: 'front', side: card.frontSide, position: card.frontPosition, value: card.front },
    { base: 'back', side: card.backSide, position: card.backPosition, value: card.back },
    ...extras.map((field) => ({
      base: null,
      side: field.side,
      position: field.position,
      value: field.value,
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

/** One rendered line of a card face: a mandatory field, or an extra one. */
export type CardLine = { text: string; base: boolean };

/**
 * The lines one face shows during review. Empty extras are dropped — they still
 * exist on the card and hold their place in the editor, they just have nothing
 * to show. A face with no pieces at all renders as nothing, which is a layout
 * the editor allows on purpose.
 */
export function sideLines(pieces: LayoutPiece[], side: FieldSide): CardLine[] {
  return piecesOnSide(pieces, side)
    .filter((piece) => piece.base !== null || piece.value.trim().length > 0)
    .map((piece) => ({ text: piece.value, base: piece.base !== null }));
}
