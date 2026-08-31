/**
 * Polish-aware text matching for the in-deck card search.
 *
 * SQLite's `like` and `lower()` fold ASCII only, so `Ł` would not match `ł` and
 * `lamac` would never find `łamać`. Matching therefore happens in JS over the
 * card list the deck screen has already loaded — the query is unchanged, so
 * this adds no extra reads.
 */

/** Letters with a stroke have no canonical decomposition, so they need a map. */
const STROKED: Record<string, string> = { ł: 'l', đ: 'd', ø: 'o' };

/** Lowercases and strips diacritics, so `Łamać` and `lamac` fold to the same. */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[łđø]/g, (character) => STROKED[character])
    .normalize('NFD')
    .replace(/[\u0300-\u036F]/g, '');
}

/**
 * `fields` is every extra field of the card glued together by the query, which
 * is what lets one search cover cards carrying different numbers of them.
 */
export type SearchableCard = { front: string; back: string; fields?: string | null };

/**
 * Every whitespace-separated term has to appear somewhere in the card, so each
 * extra word narrows the result rather than widening it. All of the card's text
 * is searched together — both mandatory fields and every extra one — because
 * you rarely remember which field a word was in, let alone which side.
 */
export function matches(card: SearchableCard, query: string): boolean {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;

  const haystack = `${fold(card.front)} ${fold(card.back)} ${fold(card.fields ?? '')}`;
  return terms.every((term) => haystack.includes(term));
}

export function filterCards<T extends SearchableCard>(cards: T[], query: string): T[] {
  if (!query.trim()) return cards;
  return cards.filter((card) => matches(card, query));
}
