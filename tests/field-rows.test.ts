/**
 * The row model both editors share: one list with a boundary row, turned into
 * a stored placement and back. Pure functions, so no database.
 */
import {
  BOUNDARY,
  buildRows,
  countSides,
  DEFAULT_PLACEMENT,
  describeRows,
  slotFields,
  toPlacement,
  type Row,
} from '@/lib/field-rows';

import { check, group } from './harness';

const labels = { front: 'Pytanie', back: 'Odpowiedz' } as const;

/** A readable sketch of the list: what each row is, in order. */
const sketch = (rows: Row[]) =>
  rows
    .map((row) =>
      row.kind === 'boundary' ? '---' : row.kind === 'base' ? row.base.toUpperCase() : 'pole'
    )
    .join(' ');

const extra = (side: 'front' | 'back', position: number, value = '') => ({
  id: null,
  side,
  position,
  value,
});

group('Budowanie listy edytora');

check(
  'domyslnie pytanie, granica, odpowiedz',
  sketch(buildRows(DEFAULT_PLACEMENT, [])),
  'FRONT --- BACK'
);

check(
  'pola dodatkowe trafiaja na swoje strony',
  sketch(
    buildRows(DEFAULT_PLACEMENT, [extra('front', 1), extra('back', 1), extra('front', 2)])
  ),
  'FRONT pole pole --- BACK pole'
);

check(
  'pole dodatkowe moze stac nad podstawowym',
  sketch(buildRows({ ...DEFAULT_PLACEMENT, frontPosition: 1 }, [extra('front', 0)])),
  'pole FRONT --- BACK'
);

check(
  'oba pola podstawowe moga stac po jednej stronie',
  sketch(
    buildRows({ frontSide: 'back', frontPosition: 1, backSide: 'back', backPosition: 0 }, [])
  ),
  '--- BACK FRONT'
);

group('Odczyt listy z powrotem');

// Question dragged below the boundary: it is on the back now.
const moved: Row[] = [
  { key: 'blank-0', kind: 'extra', id: null, value: 'obrazek' },
  { key: BOUNDARY, kind: 'boundary' },
  { key: 'base-back', kind: 'base', base: 'back' },
  { key: 'base-front', kind: 'base', base: 'front' },
];

const read = toPlacement(moved);

check('pytanie zapisane jako pole tylu', [read.placement.frontSide, read.placement.frontPosition], [
  'back',
  1,
]);
check('odpowiedz zostaje na tyle, nad nim', [read.placement.backSide, read.placement.backPosition], [
  'back',
  0,
]);
check('pole dodatkowe zostaje z przodu', read.fields, [
  { id: null, side: 'front', position: 0, value: 'obrazek' },
]);

// What goes out has to come back in the same shape.
check(
  'lista przezywa obieg tam i z powrotem',
  sketch(buildRows(read.placement, read.fields)),
  sketch(moved)
);

group('Opisy wierszy');

const described = describeRows(
  buildRows(DEFAULT_PLACEMENT, [extra('front', 1), extra('back', 1)]),
  labels
);

check('pole podstawowe dostaje swoja nazwe', described['base-front'], {
  side: 'front',
  label: 'Pytanie',
});
check('dodatkowe sa numerowane w obrebie strony', described['blank-0'], {
  side: 'front',
  label: 'Przód — pole 1',
});
check('a te pod granica naleza do tylu', described['blank-1'], {
  side: 'back',
  label: 'Tył — pole 1',
});

group('Domyslny uklad talii');

// Empty boxes are interchangeable: they fill whatever the mandatory fields
// leave free, so the deck stores only how many of them each side gets.
check('puste pola omijaja miejsce pola podstawowego', slotFields(DEFAULT_PLACEMENT, { front: 2, back: 0 }), [
  { id: null, side: 'front', position: 1, value: '' },
  { id: null, side: 'front', position: 2, value: '' },
]);

check(
  'pole podstawowe w srodku zostawia miejsce nad soba',
  slotFields({ ...DEFAULT_PLACEMENT, frontPosition: 1 }, { front: 2, back: 0 }).map(
    (field) => field.position
  ),
  [0, 2]
);

check(
  'dwa pola podstawowe po jednej stronie',
  slotFields({ frontSide: 'back', frontPosition: 0, backSide: 'back', backPosition: 1 }, {
    front: 1,
    back: 1,
  }).map((field) => [field.side, field.position]),
  [
    ['front', 0],
    ['back', 2],
  ]
);

check('liczenie pol na stronach', countSides([extra('front', 1), extra('back', 1), extra('back', 2)]), {
  front: 1,
  back: 2,
});
