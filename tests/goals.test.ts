/**
 * The daily goal, its lighter days and the streak it keeps, then the badges
 * built on them. Times are local, like the study day.
 */
import {
  BADGE_GROUPS,
  badgeId,
  badgeLabel,
  dayProgress,
  formatCount,
  newlyEarned,
  type BadgeProgress,
} from '@/lib/badges';
import {
  DEFAULT_DAILY_GOAL,
  dayKey,
  defaultLightGoal,
  goalDays,
  goalOn,
  goalShare,
  isLightDay,
  parseDailyGoal,
  parseLightDays,
  parseLightGoal,
  shiftDay,
  streak,
  totalPoints,
  weekKey,
  type StudyDay,
} from '@/lib/goals';

import { check, group } from './harness';

/** October 2026 at a local hour. The 19th is a Monday. */
const at = (day: number, hour = 12, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();

const key = (day: number) => `2026-10-${String(day).padStart(2, '0')}`;

/** A day that met a goal of `goal` (or fell short of it, with fewer answers). */
const row = (day: number, answers = 20, goal = 20): StudyDay => ({ day: key(day), answers, goal });

group('Cel dzienny: odczyt');

check('brak ustawienia to domyslny', parseDailyGoal(undefined), DEFAULT_DAILY_GOAL);
check('zapisana liczba', parseDailyGoal('50'), 50);
check('zero, ulamek i smieci to domyslny', [parseDailyGoal('0'), parseDailyGoal('2.5'), parseDailyGoal('x')], [
  DEFAULT_DAILY_GOAL,
  DEFAULT_DAILY_GOAL,
  DEFAULT_DAILY_GOAL,
]);
check('pasek nie wychodzi poza calosc', [goalShare({ answers: 5, goal: 20 }), goalShare({ answers: 40, goal: 20 })], [
  0.25, 1,
]);

group('Dni: klucz, przesuniecie, tydzien');

check('poludnie to ten dzien', dayKey(at(21)), '2026-10-21');
check('2:00 to jeszcze dzien wczesniej', dayKey(at(21, 2)), '2026-10-20');
check('klucz z zerem z przodu, zeby sortowal sie jak data', dayKey(new Date(2026, 0, 5, 12)), '2026-01-05');
check('przez koniec miesiaca', shiftDay('2026-10-31', 1), '2026-11-01');
// 25 October 2026 is when Poland goes back an hour.
check('przez zmiane czasu', shiftDay('2026-10-24', 2), '2026-10-26');
check('tydzien zaczyna sie w poniedzialek', [weekKey(key(19)), weekKey(key(22)), weekKey(key(25))], [
  key(19),
  key(19),
  key(19),
]);
check('niedziela nalezy do tygodnia, ktory konczy', weekKey(key(18)), key(12));

group('Seria: cel spelniony');

check('bez historii zero', streak([], 20, at(21)).current, 0);
check('trzy dni z celem i dzis jeszcze nic: dzien trwa, seria 3', streak([row(18), row(19), row(20)], 20, at(21)), {
  current: 3,
  longest: 3,
  today: { answers: 0, goal: 20, met: false },
});
check('dzis cel spelniony dolicza dzien', streak([row(19), row(20), row(21)], 20, at(21)).current, 3);
check('dzis ponizej celu nie dolicza', streak([row(20), row(21, 19)], 20, at(21)).current, 1);
check('dzien ponizej wlasnego celu przerywa jak pusty', streak([row(14), row(15, 5), row(20)], 20, at(21)).longest, 1);

const raised = [row(19, 20, 20), row(20, 20, 20), row(21, 20)];
check('podniesienie celu nie psuje wczorajszych dni', streak(raised, 50, at(21)), {
  current: 2,
  longest: 2,
  today: { answers: 20, goal: 50, met: false },
});
check('obnizenie celu liczy dzis od razu', streak(raised, 10, at(21)).current, 3);
check('dzien z zerem odpowiedzi nie spelnia nawet celu 0', streak([row(20, 0, 0)], 20, at(21)).current, 0);

group('Seria: dzien bez celu przerywa');

check('jeden dzien przerwy przerywa serie', streak([row(17), row(18), row(19), row(21)], 20, at(21, 13)).current, 1);
check('wczoraj pusty, dzis jeszcze nic: serii nie ma', streak([row(18), row(19)], 20, at(21)).current, 0);
check('wczoraj z celem, dzis jeszcze nic: seria trwa', streak([row(19), row(20)], 20, at(21)).current, 2);
check(
  'przerwa: najdluzsza zostaje',
  streak([row(12), row(13), row(14), row(17), row(20)], 20, at(21)),
  { current: 1, longest: 3, today: { answers: 0, goal: 20, met: false } }
);

group('Lzejsze dni');

check('dni z zapisu, bez powtorzen i smieci', parseLightDays('[6, 0, 6, 7, "x", 2.5]'), [0, 6]);
check('zly zapis to brak dni', [parseLightDays('nie'), parseLightDays(null), parseLightDays('{}')], [[], [], []]);
check('lzejszy cel z zapisu albo nic', [parseLightGoal('5'), parseLightGoal(null), parseLightGoal('0')], [5, null, null]);
check('domyslnie polowa, w dol, co najmniej 1', [defaultLightGoal(20), defaultLightGoal(37), defaultLightGoal(1)], [
  10, 18, 1,
]);

// The 24th of October 2026 is a Saturday, the 21st a Wednesday.
const weekend = { goal: 20, lightDays: [6, 0], lightGoal: null };
check('sobota jest lzejsza, sroda nie', [isLightDay(weekend, key(24)), isLightDay(weekend, key(21))], [true, false]);
check('w lzejszy dzien domyslnie polowa', goalOn(weekend, key(24)), 10);
check('w zwykly dzien zwykly cel', goalOn(weekend, key(21)), 20);
check('wybrany lzejszy cel', goalOn({ ...weekend, lightGoal: 5 }, key(25)), 5);
check('lzejszy nigdy nie wiekszy od zwyklego', goalOn({ ...weekend, lightGoal: 30 }, key(24)), 20);
check(
  'seria liczy lzejszy dzien wobec jego wlasnego celu',
  streak([row(23), row(24, 10, 10), row(25, 10, 10)], 20, at(26)).current,
  3
);

group('Punkty');

check('punkty: cel kazdego dnia z celem', totalPoints([row(19), row(20, 10, 10), row(21, 5)], 20, at(22)), 30);
check('dzis wobec celu ustawionego teraz', totalPoints([row(22, 15)], 15, at(22)), 15);
check('dzis ponizej celu nic', totalPoints([row(22, 14)], 15, at(22)), 0);
check('wiekszy cel jest wart wiecej', totalPoints([row(19, 50, 50)], 20, at(22)), 50);

group('Dni z celem');

check('dni z wlasnym celem plus dzis z obecnym', goalDays([row(19), row(20, 5), row(21, 30)], 20, at(21)), 2);

group('Odznaki');

const zero: BadgeProgress = { streak: 0, goalDays: 0, answers: 0, bestDay: 0, mature: 0, mnemonics: 0 };

check('na starcie nic', newlyEarned(zero, new Set()), []);
check(
  'kazdy prog, ktory liczba juz minela',
  newlyEarned({ ...zero, streak: 8, mnemonics: 1 }, new Set()),
  ['streak-3', 'streak-7', 'mnemonics-1']
);
check('zdobytej drugi raz sie nie dostaje', newlyEarned({ ...zero, streak: 8 }, new Set(['streak-3'])), [
  'streak-7',
]);
check('nazwa to warunek', [badgeLabel('streak-7'), badgeLabel('answers-10000'), badgeLabel('mnemonics-1')], [
  '7 dni z rzędu',
  '10\u00a0000 odpowiedzi',
  'Pierwsze skojarzenie',
]);
check('nieznana odznaka nie ma nazwy', badgeLabel('cos-5'), null);
check('kazda odznaka ma nazwe', BADGE_GROUPS.every((g) => g.tiers.every((t) => badgeLabel(badgeId(g.kind, t)))), true);
check('progi rosna', BADGE_GROUPS.every((g) => g.tiers.every((t, i) => i === 0 || t > g.tiers[i - 1])), true);
check('duze liczby z odstepem', [formatCount(1000), formatCount(50000)], ['1000', '50\u00a0000']);
check(
  'z dni: najdluzsza seria, dni z celem, suma i najlepszy dzien',
  dayProgress([row(14), row(15, 120), row(20, 3)], 20, at(21)),
  { streak: 2, goalDays: 2, answers: 143, bestDay: 120 }
);
