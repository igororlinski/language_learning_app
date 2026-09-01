const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/** Compact interval label for the grading buttons, e.g. `10 min`, `3 dni`, `1,4 mies.` */
export function formatInterval(ms: number): string {
  const value = Math.max(ms, 0);

  if (value < HOUR) return `${Math.max(1, Math.round(value / MINUTE))} min`;
  if (value < DAY) return `${Math.round(value / HOUR)} godz.`;
  if (value < MONTH) return `${Math.max(1, Math.round(value / DAY))} dni`;
  if (value < YEAR) return `${round1(value / MONTH)} mies.`;
  return `${round1(value / YEAR)} lat`;
}

export function formatDue(due: Date | null, now = Date.now()): string {
  if (!due) return 'brak danych';

  const delta = due.getTime() - now;
  if (delta <= 0) return 'do powtórki';
  return `za ${formatInterval(delta)}`;
}

const MONTHS = [
  'sty',
  'lut',
  'mar',
  'kwi',
  'maj',
  'cze',
  'lip',
  'sie',
  'wrz',
  'paź',
  'lis',
  'gru',
];

/**
 * A date as it appears next to a card in the list: `31 sie`, and `31 sie 2025`
 * once the year stops being obvious. Written out rather than left to
 * `toLocaleDateString`, whose Polish output depends on the device's ICU data.
 */
export function formatDate(date: Date, now = new Date()): string {
  const day = `${date.getDate()} ${MONTHS[date.getMonth()]}`;

  return date.getFullYear() === now.getFullYear() ? day : `${day} ${date.getFullYear()}`;
}

export function pluralize(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (count === 1) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function cardsLabel(count: number): string {
  return `${count} ${pluralize(count, 'karta', 'karty', 'kart')}`;
}

function round1(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '').replace('.', ',');
}
