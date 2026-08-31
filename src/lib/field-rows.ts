import type { FieldKind, FieldSide } from '@/db/schema';
import type { BaseKind } from '@/lib/card-layout';

/**
 * The row model both editors share.
 *
 * A card's layout and a deck's default layout are the same shape: two mandatory
 * fields plus any number of extra ones, spread over two faces. The editors show
 * it as one list with a synthetic boundary row — everything above it is the
 * front, everything below it the back — and this module turns that list into
 * what the database stores, and back.
 */

export const BOUNDARY = 'boundary';

export type Row =
  | { key: string; kind: 'base'; base: BaseKind }
  | { key: typeof BOUNDARY; kind: 'boundary' }
  | {
      key: string;
      kind: 'extra';
      id: number | null;
      /** What the field holds: typed text, or one audio file. */
      field: FieldKind;
      value: string;
      audioPath: string | null;
    };

/** Where the two mandatory fields sit. */
export type RowPlacement = {
  frontSide: FieldSide;
  frontPosition: number;
  backSide: FieldSide;
  backPosition: number;
};

/** One extra field, as stored and as the editors hand it back. */
export type RowField = {
  id: number | null;
  side: FieldSide;
  position: number;
  kind: FieldKind;
  value: string;
  audioPath: string | null;
};

/** What a row means once the list order is read top to bottom. */
export type RowInfo = { side: FieldSide; label: string };

export const DEFAULT_PLACEMENT: RowPlacement = {
  frontSide: 'front',
  frontPosition: 0,
  backSide: 'back',
  backPosition: 0,
};

export const baseKey = (base: BaseKind) => `base-${base}`;

/** Builds the editors' list out of a stored placement and its extra fields. */
export function buildRows(placement: RowPlacement, fields: RowField[]): Row[] {
  type Placed = Row & { side: FieldSide; position: number };

  const placed: Placed[] = [
    {
      key: baseKey('front'),
      kind: 'base',
      base: 'front',
      side: placement.frontSide,
      position: placement.frontPosition,
    },
    {
      key: baseKey('back'),
      kind: 'base',
      base: 'back',
      side: placement.backSide,
      position: placement.backPosition,
    },
    ...fields.map<Placed>((field, index) => ({
      key: field.id === null ? `blank-${index}` : `saved-${field.id}`,
      kind: 'extra',
      id: field.id,
      field: field.kind,
      value: field.value,
      audioPath: field.audioPath,
      side: field.side,
      position: field.position,
    })),
  ];

  const onSide = (side: FieldSide): Row[] =>
    placed
      .filter((row) => row.side === side)
      .sort((a, b) => a.position - b.position)
      .map(({ side: _side, position: _position, ...row }) => row);

  return [...onSide('front'), { key: BOUNDARY, kind: 'boundary' }, ...onSide('back')];
}

/**
 * Reads the list top to bottom: everything above the boundary row belongs to
 * the front, everything below it to the back. Extra fields are numbered within
 * their side, which is all the label they get — fields carry no name.
 */
export function describeRows(rows: Row[], baseLabels: Record<BaseKind, string>) {
  const info: Record<string, RowInfo> = {};
  let side: FieldSide = 'front';
  let extras = { front: 0, back: 0 };

  for (const row of rows) {
    if (row.kind === 'boundary') {
      side = 'back';
      continue;
    }

    if (row.kind === 'base') {
      info[row.key] = { side, label: baseLabels[row.base] };
      continue;
    }

    extras = { ...extras, [side]: extras[side] + 1 };
    info[row.key] = {
      side,
      label: `${side === 'front' ? 'Przód' : 'Tył'} — pole ${extras[side]}`,
    };
  }

  return info;
}

/** Turns the arranged list back into a placement and a list of extra fields. */
export function toPlacement(rows: Row[]): { fields: RowField[]; placement: RowPlacement } {
  const fields: RowField[] = [];
  const placement: RowPlacement = { ...DEFAULT_PLACEMENT };

  let side: FieldSide = 'front';
  const next = { front: 0, back: 0 };

  for (const row of rows) {
    if (row.kind === 'boundary') {
      side = 'back';
      continue;
    }

    const position = side === 'front' ? next.front++ : next.back++;

    if (row.kind === 'base') {
      if (row.base === 'front') {
        placement.frontSide = side;
        placement.frontPosition = position;
      } else {
        placement.backSide = side;
        placement.backPosition = position;
      }
      continue;
    }

    fields.push({
      id: row.id,
      side,
      position,
      kind: row.field,
      value: row.value,
      audioPath: row.audioPath,
    });
  }

  return { fields, placement };
}

/**
 * Rebuilds a deck's default extra fields. The empty boxes are interchangeable,
 * so a deck stores only how many of them each side gets: their positions are
 * whatever the mandatory fields leave free.
 */
export function slotFields(
  placement: RowPlacement,
  counts: { front: number; back: number }
): RowField[] {
  const taken = (side: FieldSide) =>
    [
      placement.frontSide === side ? placement.frontPosition : null,
      placement.backSide === side ? placement.backPosition : null,
    ].filter((position): position is number => position !== null);

  const fill = (side: FieldSide, count: number): RowField[] => {
    const busy = new Set(taken(side));
    const fields: RowField[] = [];

    for (let position = 0; fields.length < Math.max(0, count); position += 1) {
      if (busy.has(position)) continue;
      fields.push({ id: null, side, position, kind: 'text', value: '', audioPath: null });
    }

    return fields;
  };

  return [...fill('front', counts.front), ...fill('back', counts.back)];
}

/** How many extra fields sit on each side — what a deck stores as its default. */
export function countSides(fields: RowField[]) {
  return {
    front: fields.filter((field) => field.side === 'front').length,
    back: fields.filter((field) => field.side === 'back').length,
  };
}
