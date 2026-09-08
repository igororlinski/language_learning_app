import type { FieldKind, FieldSide } from '@/db/schema';
import { isMediaKind, type MediaKind } from '@/lib/media';
import { speechText } from '@/lib/speech';

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
  /**
   * The language this piece's text is read out loud in, or null for one that
   * stays silent. Carried per piece, not per card: a card asks its question in
   * one language and says its answer in another, which is the ordinary case
   * rather than an exotic one.
   */
  speech: string | null;
};

/** The columns that place a card's two mandatory fields. */
export type CardPlacement = {
  front: string;
  back: string;
  frontSide: FieldSide;
  frontPosition: number;
  backSide: FieldSide;
  backPosition: number;
  /** Optional so a caller that has no opinion — a test, a preview built by
   *  hand — does not have to say "silent" twice to mean nothing. */
  frontSpeech?: string | null;
  backSpeech?: string | null;
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
    speech?: string | null;
  },
>(card: CardPlacement, extras: T[]): LayoutPiece[] {
  const base = (
    kind: BaseKind,
    side: FieldSide,
    position: number,
    value: string,
    speech: string | null
  ): LayoutPiece => ({
    base: kind,
    side,
    position,
    kind: 'text',
    value,
    mediaPath: null,
    hideValue: false,
    hideMedia: false,
    speech,
  });

  return [
    base('front', card.frontSide, card.frontPosition, card.front, card.frontSpeech ?? null),
    base('back', card.backSide, card.backPosition, card.back, card.backSpeech ?? null),
    ...extras.map<LayoutPiece>((field) => ({
      base: null,
      side: field.side,
      position: field.position,
      kind: field.kind ?? 'text',
      value: field.value,
      mediaPath: field.mediaPath ?? null,
      hideValue: field.hideValue ?? false,
      hideMedia: field.hideMedia ?? false,
      speech: field.speech ?? null,
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
 * What a line says out loud when its loudspeaker is tapped.
 *
 * `language` is null only for a retired `speech` field, which had no language
 * of its own and borrowed the deck's — the one caller that still needs a
 * fallback. Everything made since carries its own, which is what lets one card
 * be read in two languages.
 */
export type LineSpeech = { text: string; language: string | null };

/**
 * One rendered line of a card face. A media line shows a player or a picture
 * instead of text; `text` is then the original file name, which is all the
 * label it has.
 */
export type CardLine = {
  text: string;
  base: boolean;
  media: LineMedia | null;
  /**
   * What this line reads out loud when tapped, or null for one that stays
   * silent. It is an **adornment on the line**, not a line of its own: the
   * loudspeaker sits under the very words it reads, so a card carrying several
   * spoken texts says which is which by where the buttons are.
   *
   * Resolved here rather than in the screen because a retired `speech` field
   * falls back to the card's **answer**, which lives on whichever side the
   * layout put it, and this is the one place that can see both faces at once.
   */
  speak: LineSpeech | null;
};

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
  // The answer, wherever the layout put it: a retired speech field with nothing
  // typed into it reads that, and it may well be sitting on the other face.
  const answer = pieces.find((piece) => piece.base === 'back')?.value ?? '';

  // Hidden halves are resolved first, so everything after this point cannot
  // tell "hidden" from "never filled in" — which is the point. A piece left
  // with nothing to show then falls out through the same filter as an empty
  // one, and a whole field disappears when both of its halves are hidden.
  return piecesOnSide(pieces, side)
    .map((piece) => {
      const text = piece.hideValue ? '' : piece.value;

      return {
        piece,
        text,
        media:
          !piece.hideMedia && isMediaKind(piece.kind) && piece.mediaPath
            ? { kind: piece.kind as MediaKind, fileName: piece.mediaPath }
            : null,
        speak: speechOf(piece, text, answer),
      };
    })
    .filter(({ piece, text, media, speak }) => {
      // Nothing to say is nothing to show: a retired speech field on a card
      // with no answer and no text of its own is as empty as an empty text box,
      // and a button that reads silence is worse than no button.
      if (piece.kind === 'speech') return Boolean(speak);

      // A mnemonic is the one media field whose text stands on its own: the
      // sentence *is* the association, and an association whose picture failed
      // is still worth reading. Every other media field is its file and nothing
      // else, so without the file there is nothing to show.
      if (piece.kind === 'mnemonic') return Boolean(media) || text.trim().length > 0;

      return isMediaKind(piece.kind) ? Boolean(media) : text.trim().length > 0;
    })
    .map(({ piece, text, media, speak }) => ({
      // The retired speech field is the one line whose text is the button: it
      // never had any of its own, and the word it says stands on the card as
      // the answer already.
      text: piece.kind === 'speech' ? '' : text,
      base: piece.base !== null,
      media,
      speak,
    }));
}

/**
 * What one piece reads out loud, if anything.
 *
 * Two rules, and the second is the one that matters. A piece speaks when it has
 * been **given a language** and it has words for that language to be spoken in
 * — which is why hiding a field's text silences it as well: a hidden sentence
 * read aloud is not hidden, and the loudspeaker would be handing over exactly
 * what the learner asked not to be shown.
 *
 * Only text is spoken. Every other kind's `value` is a file name, and no phone
 * should ever be asked to read „img_2043.jpg" — the editor does not offer it,
 * and this makes the offer impossible to smuggle past.
 */
function speechOf(piece: LayoutPiece, text: string, answer: string): LineSpeech | null {
  // The retired field: no language of its own, so the deck's answer voice is
  // filled in by whoever renders it, and its text falls back to the answer.
  if (piece.kind === 'speech') {
    const said = speechText(piece.value, answer);

    return said ? { text: said, language: null } : null;
  }

  if (!piece.speech || (piece.kind !== 'text' && piece.kind !== 'mnemonic')) return null;

  const said = speechText(text, '');

  return said ? { text: said, language: piece.speech } : null;
}
