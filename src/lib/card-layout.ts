import type { FieldKind, FieldSide } from '@/db/schema';
import { isMediaKind, type MediaKind } from '@/lib/media';

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
  mediaPath: string | null;
  /** Kept on the card but not shown to the learner. */
  hideValue: boolean;
  hideMedia: boolean;
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
    mediaPath?: string | null;
    hideValue?: boolean;
    hideMedia?: boolean;
  },
>(card: CardPlacement, extras: T[]): LayoutPiece[] {
  const base = (kind: BaseKind, side: FieldSide, position: number, value: string): LayoutPiece => ({
    base: kind,
    side,
    position,
    kind: 'text',
    value,
    mediaPath: null,
    hideValue: false,
    hideMedia: false,
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
      mediaPath: field.mediaPath ?? null,
      hideValue: field.hideValue ?? false,
      hideMedia: field.hideMedia ?? false,
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

/** The file a line renders instead of text, if it has one. */
export type LineMedia = { kind: MediaKind; fileName: string };

/**
 * One rendered line of a card face. A media line shows a player or a picture
 * instead of text; `text` is then the original file name, which is all the
 * label it has.
 */
export type CardLine = { text: string; base: boolean; media: LineMedia | null };

/**
 * The lines one face shows during review. Anything with nothing in it is
 * dropped — an empty text box, or a media field whose file went missing. That
 * includes the **mandatory fields**: only the question has to be filled in, so
 * a card with no answer typed simply shows nothing on its back rather than a
 * blank line where text would be. They all still exist on the card and hold
 * their place in the editor, they just have nothing to show. A face with no
 * pieces at all renders as nothing, which is a layout the editor allows on
 * purpose.
 */
export function sideLines(pieces: LayoutPiece[], side: FieldSide): CardLine[] {
  // Hidden halves are resolved first, so everything after this point cannot
  // tell "hidden" from "never filled in" — which is the point. A piece left
  // with nothing to show then falls out through the same filter as an empty
  // one, and a whole field disappears when both of its halves are hidden.
  return piecesOnSide(pieces, side)
    .map((piece) => ({
      piece,
      text: piece.hideValue ? '' : piece.value,
      media:
        !piece.hideMedia && isMediaKind(piece.kind) && piece.mediaPath
          ? { kind: piece.kind as MediaKind, fileName: piece.mediaPath }
          : null,
    }))
    .filter(({ piece, text, media }) => {
      // A mnemonic is the one media field whose text stands on its own: the
      // sentence *is* the association, and an association whose picture failed
      // is still worth reading. Every other media field is its file and nothing
      // else, so without the file there is nothing to show.
      if (piece.kind === 'mnemonic') return Boolean(media) || text.trim().length > 0;

      return isMediaKind(piece.kind) ? Boolean(media) : text.trim().length > 0;
    })
    .map(({ piece, text, media }) => ({ text, base: piece.base !== null, media }));
}
