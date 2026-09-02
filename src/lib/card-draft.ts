import { toPlacement, type Row } from '@/lib/field-rows';

/**
 * Whether the card editor is holding anything that a save would write.
 *
 * The form is described as one comparable string, and "unsaved" means that
 * string differs from what it was when the card was last saved. A flag set by
 * each `onChange` would be simpler and wrong: it would also fire for typing a
 * letter and deleting it again, and then ask about abandoning changes that no
 * longer exist.
 *
 * What is deliberately outside the signature: which row is focused, whether the
 * preview is open, and the row keys — none of them reach the database, so none
 * of them is a change worth stopping the user over.
 */
export function draftSignature(
  front: string,
  back: string,
  rows: Row[],
  tags: string[]
): string {
  const { fields, placement } = toPlacement(rows);

  return JSON.stringify({
    // Trimmed, because the save trims too: a trailing space is not an edit.
    front: front.trim(),
    back: back.trim(),
    placement,
    fields: fields.map((field) => [
      field.side,
      field.position,
      field.kind,
      field.value.trim(),
      field.mediaPath,
    ]),
    tags,
  });
}
