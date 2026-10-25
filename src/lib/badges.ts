import { pluralize } from '@/lib/format';
import { goalDays, streak, type StudyDay } from '@/lib/goals';

/**
 * Badges: thresholds on six numbers, each a ladder of tiers.
 *
 * The label of a badge **is** its condition — „7 dni z rzędu", „100
 * dojrzałych kart" — so nothing has to explain what it is for. Earned ones are
 * stored (`badges` table) and never taken back; what counts here is only
 * whether the numbers have reached a tier yet.
 */

export type BadgeProgress = {
  /** The longest streak ever, not the current one: a badge is for having done it. */
  streak: number;
  goalDays: number;
  answers: number;
  /** Most answers in one study day. */
  bestDay: number;
  /** Cards in review with an interval of three weeks or more, as on "Statystyki". */
  mature: number;
  /** Cards that show an association during review. */
  mnemonics: number;
};

export type BadgeKind = keyof BadgeProgress;

type BadgeGroup = {
  kind: BadgeKind;
  title: string;
  tiers: readonly number[];
  label: (tier: number) => string;
};

/** `10 000`, the way Polish writes large numbers. */
export const formatCount = (count: number): string =>
  count >= 10_000 ? String(count).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0') : String(count);

/** `5 tys.` — a tier as short as a chip needs it. */
export const shortCount = (count: number): string =>
  count >= 1000 && count % 1000 === 0 ? `${count / 1000} tys.` : String(count);

export const BADGE_GROUPS: readonly BadgeGroup[] = [
  {
    kind: 'streak',
    title: 'Dni z rzędu',
    tiers: [3, 7, 14, 30, 100, 365],
    label: (tier) => `${tier} dni z rzędu`,
  },
  {
    kind: 'goalDays',
    title: 'Dni z celem',
    tiers: [1, 10, 30, 100, 365],
    label: (tier) =>
      tier === 1 ? 'Pierwszy cel dnia' : `${tier} ${pluralize(tier, 'dzień', 'dni', 'dni')} z celem`,
  },
  {
    kind: 'answers',
    title: 'Odpowiedzi',
    tiers: [100, 1000, 5000, 10_000, 50_000],
    label: (tier) => `${formatCount(tier)} odpowiedzi`,
  },
  {
    kind: 'bestDay',
    title: 'Odpowiedzi w jeden dzień',
    tiers: [50, 100, 250],
    label: (tier) => `${tier} odpowiedzi w jeden dzień`,
  },
  {
    kind: 'mature',
    title: 'Dojrzałe karty',
    tiers: [10, 100, 500, 1000],
    label: (tier) => `${formatCount(tier)} dojrzałych kart`,
  },
  {
    kind: 'mnemonics',
    title: 'Karty ze skojarzeniem',
    tiers: [1, 10, 50, 100],
    label: (tier) =>
      tier === 1 ? 'Pierwsze skojarzenie' : `${tier} ${pluralize(tier, 'karta', 'karty', 'kart')} ze skojarzeniem`,
  },
];

export const badgeId = (kind: BadgeKind, tier: number): string => `${kind}-${tier}`;

/** What a stored badge is called; null for an id this version does not know. */
export function badgeLabel(id: string): string | null {
  for (const group of BADGE_GROUPS) {
    for (const tier of group.tiers) {
      if (badgeId(group.kind, tier) === id) return group.label(tier);
    }
  }

  return null;
}

/** Ids reached by `progress` and not in `earned`, in the order of the list. */
export function newlyEarned(progress: BadgeProgress, earned: ReadonlySet<string>): string[] {
  return BADGE_GROUPS.flatMap((group) =>
    group.tiers
      .filter((tier) => progress[group.kind] >= tier)
      .map((tier) => badgeId(group.kind, tier))
      .filter((id) => !earned.has(id))
  );
}

/** The parts of the progress that come from `study_days`. */
export function dayProgress(
  days: readonly StudyDay[],
  goal: number,
  now: number
): Pick<BadgeProgress, 'streak' | 'goalDays' | 'answers' | 'bestDay'> {
  return {
    streak: streak(days, goal, now).longest,
    goalDays: goalDays(days, goal, now),
    answers: days.reduce((sum, row) => sum + row.answers, 0),
    bestDay: days.reduce((best, row) => Math.max(best, row.answers), 0),
  };
}
