import { fold } from '@/lib/search';

/**
 * Rules for card tags, kept free of the database so they can be tested and so
 * both the editor and the deck list read them the same way.
 */

/** Nothing longer fits a chip, and nothing longer is a tag any more. */
export const MAX_TAG_LENGTH = 32;

/** What the user sees: their own spelling, trimmed and squeezed to one line. */
export function tagName(input: string): string {
  return input.trim().replace(/\s+/g, ' ').slice(0, MAX_TAG_LENGTH);
}

/**
 * What uniqueness is checked against: case and diacritics folded away, so
 * `Łatwe`, `łatwe` and `latwe` are one tag rather than three. Folding is the
 * same one the search uses — `Ł` is exactly the letter SQLite's own `nocase`
 * would leave alone.
 */
export function tagSlug(input: string): string {
  return fold(tagName(input));
}

/** Whether a typed name is worth saving at all. */
export function isUsableTag(input: string): boolean {
  return tagSlug(input).length > 0;
}

/**
 * The same list without repeats, keeping the first spelling of each. Two rows
 * differing only by case are the same tag, and the one already on the card wins.
 */
export function dedupeTags(names: string[]): string[] {
  const seen = new Set<string>();

  return names.filter((name) => {
    const slug = tagSlug(name);
    if (!slug || seen.has(slug)) return false;

    seen.add(slug);
    return true;
  });
}

/** A card as the deck list holds it: its tag ids glued together by the query. */
export type TaggedCard = { tagIds?: string | null };

/** The ids a card carries, from the comma-joined column. */
export function cardTagIds(card: TaggedCard): number[] {
  return (card.tagIds ?? '')
    .split(',')
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
}

/**
 * Every picked tag has to be on the card, so each one narrows the list further
 * — the same way each word typed into the search box does. Picking nothing
 * filters nothing.
 */
export function filterByTags<T extends TaggedCard>(cards: T[], picked: number[]): T[] {
  if (picked.length === 0) return cards;

  return cards.filter((card) => {
    const own = new Set(cardTagIds(card));
    return picked.every((id) => own.has(id));
  });
}
