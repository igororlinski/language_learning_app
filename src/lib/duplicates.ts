import { fold } from '@/lib/search';

/**
 * Two questions are the same card if they read the same once case, Polish
 * letters and spacing are set aside: "Kot", "kot " and "kot" are one word
 * typed three times, not three cards.
 */
export const questionKey = (text: string): string => fold(text).replace(/\s+/g, ' ').trim();

/**
 * The card in the deck that already asks `front`, or null. The card being
 * edited is left out, so a card is never its own duplicate; an empty question
 * matches nothing — that is a card not written yet.
 */
export function findDuplicate<T extends { id: number; front: string }>(
  front: string,
  cards: readonly T[],
  selfId: number | null = null
): T | null {
  const key = questionKey(front);
  if (!key) return null;

  return cards.find((card) => card.id !== selfId && questionKey(card.front) === key) ?? null;
}
