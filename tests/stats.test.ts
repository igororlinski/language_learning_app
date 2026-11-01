/**
 * The numbers on "Statystyki": where a day ends, what counts as remembering,
 * and how few answers are too few. Times are local, like the study day.
 */
import { Rating, State } from '@/lib/scheduler';
import {
  cardStage,
  cardStates,
  collectionGrowth,
  forecast,
  FORECAST_LONG_DAYS,
  forecastLabel,
  formatDuration,
  formatGap,
  formatSigned,
  formatPercent,
  MIN_ANSWERS,
  mnemonicComparison,
  mnemonicGap,
  ratingMix,
  recentRetention,
  retention,
  retentionTone,
  studyTime,
  studyTimeByDay,
  todayStats,
  type StatsCard,
  type StatsLog,
} from '@/lib/stats';

import { check, group } from './harness';

/** 2026-10-20 (a Tuesday) at a local hour. */
const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 9, day, hour, minute).getTime();

const NOW = at(20, 12);

const log = (reviewedAt: number, over: Partial<StatsLog> = {}): StatsLog => ({
  cardId: 1,
  rating: Rating.Good,
  state: State.Review,
  scheduledDays: 0,
  reviewedAt,
  durationMs: null,
  targetRetention: 0.94,
  ...over,
});

group('Statystyki: dzisiaj');

const today = todayStats(
  [
    log(at(20, 9), { state: State.New }),
    log(at(20, 9, 1), { state: State.Learning, rating: Rating.Again }),
    log(at(20, 10), { state: State.Review }),
    log(at(20, 10, 5), { state: State.Relearning }),
    // 3:00 belongs to yesterday's study day, and so does last evening.
    log(at(20, 3)),
    log(at(19, 21)),
  ],
  NOW
);

check('liczy tylko dzisiejszy dzien nauki (od 4:00)', today.answers, 4);
check('nowe to odpowiedzi na karty jeszcze nowe', today.new, 1);
check('nauka i ponowna nauka razem', today.learning, 2);
check('powtorki', today.review, 1);
check('poprawnie to wszystko poza „Znowu”', today.correct, 0.75);
check('bez odpowiedzi nie ma procentu', todayStats([], NOW).correct, null);

group('Statystyki: prognoza');

const card = (due: number, over: Partial<StatsCard> = {}): StatsCard => ({
  cardId: 1,
  state: State.Review,
  due,
  scheduledDays: 3,
  ...over,
});

const ahead = forecast(
  [
    card(at(18, 4)), // overdue → today
    card(at(20, 18)), // later today
    card(at(21, 4)), // tomorrow
    card(at(21, 3)), // 3:00 tomorrow is still today's study day
    card(at(23, 4)),
    card(at(27, 4)), // a week out — past the seven bars
    card(at(25, 4), { state: State.Learning, scheduledDays: 0 }), // in steps → today
    card(at(21, 4), { state: State.New, scheduledDays: 0 }), // new cards are not "due"
  ],
  NOW
);

check('siedem dni', ahead.length, 7);
check(
  'zalegle, dzisiejsze i w krokach ida na dzis',
  ahead.map((day) => day.count),
  [4, 1, 0, 1, 0, 0, 0]
);
check('dzien zaczyna sie o 4:00', new Date(ahead[1].start).getHours(), 4);

check('Dziś', forecastLabel(0, ahead[0].start), 'Dziś');
check('Jutro', forecastLabel(1, ahead[1].start), 'Jutro');
check('potem dzien tygodnia', forecastLabel(2, ahead[2].start), 'cz');

group('Statystyki: zapamietane');

const reviews = (count: number, misses: number, over: Partial<StatsLog> = {}) =>
  Array.from({ length: count }, (_, index) =>
    log(at(20, 10), { rating: index < misses ? Rating.Again : Rating.Good, ...over })
  );

check(
  'liczy tylko powtorki',
  retention([...reviews(20, 2), log(NOW, { state: State.Learning })]).answers,
  20
);
check('udzial bez „Znowu”', retention(reviews(20, 2)).rate, 0.9);
check(
  'ponizej progu nie ma procentu',
  retention(reviews(MIN_ANSWERS - 1, 0)).rate,
  null
);
check('ale liczba jest', retention(reviews(MIN_ANSWERS - 1, 0)).answers, MIN_ANSWERS - 1);
check('bez powtorek nic', retention([]), { answers: 0, rate: null, target: null });
// Every answer is held to its own deck's target.
check(
  'cel wazony tym, skad przyszly odpowiedzi',
  Math.round(
    (retention([
      ...reviews(10, 0, { targetRetention: 0.9 }),
      ...reviews(30, 0, { targetRetention: 0.94 }),
    ]).target ?? 0) * 1000
  ),
  930
);
check(
  'ostatnie 30 dni bez starszych',
  recentRetention([...reviews(20, 0), log(at(20, 10) - 40 * 86_400_000)], NOW).answers,
  20
);

group('Statystyki: skojarzenia');

const mixed = [
  ...reviews(20, 1, { cardId: 7 }),
  ...reviews(25, 5, { cardId: 8 }),
  ...reviews(3, 0, { cardId: 9 }),
];
const compared = mnemonicComparison(mixed, new Set([7]));

check('ze skojarzeniem', compared.with.rate, 0.95);
check('bez skojarzenia', formatPercent(compared.without.rate ?? 0), '82%');
check('kazda grupa ma swoja liczbe', compared.without.answers, 28);
check(
  'bez kart ze skojarzeniem — brak danych, nie zero',
  mnemonicComparison(mixed, new Set()).with,
  { answers: 0, rate: null, target: null }
);

group('Statystyki: stan kart');

check(
  'nowe, w nauce, mlode i dojrzale (od 21 dni)',
  cardStates([
    card(NOW, { state: State.New }),
    card(NOW, { state: State.Learning }),
    card(NOW, { state: State.Relearning }),
    card(NOW, { scheduledDays: 20 }),
    card(NOW, { scheduledDays: 21 }),
  ]),
  { new: 1, learning: 2, young: 1, mature: 1 }
);

check('procent zaokraglony', formatPercent(0.8749), '87%');

group('Statystyki: czas nauki');

const time = studyTime(
  [
    log(at(20, 9), { durationMs: 10_000 }),
    log(at(20, 9, 1), { durationMs: 20_000 }),
    log(at(18, 10), { durationMs: 30_000 }),
    // Untimed — from before the column existed — and out of the week.
    log(at(20, 9, 2), { durationMs: null }),
    log(at(10, 10), { durationMs: 50_000 }),
  ],
  NOW
);

check('dzis', time.today, 30_000);
check('siedem dni', time.week, 60_000);
check('srednio na zmierzona odpowiedz', time.perAnswer, 20_000);
check(
  'nic zmierzonego to brak, nie zero',
  studyTime([log(at(20, 9))], NOW),
  { today: null, week: null, perAnswer: null }
);
check(
  'dzis bez pomiaru, tydzien z pomiarem',
  studyTime([log(at(18, 10), { durationMs: 5000 })], NOW).today,
  null
);

check('sekundy', formatDuration(44_600), '45 s');
check('minuty', formatDuration(12 * 60_000 + 20_000), '12 min');
check('pelna godzina', formatDuration(60 * 60_000), '1 h');
check('godziny i minuty', formatDuration(80 * 60_000), '1 h 20 min');

group('Statystyki: czas nauki dzien po dniu');

const byDay = studyTimeByDay(
  [
    log(at(20, 9), { durationMs: 4000 }),
    log(at(20, 10), { durationMs: 6000 }),
    // 3:00 on the 20th is still the 19th's study day.
    log(at(20, 3), { durationMs: 2000 }),
    log(at(14, 10), { durationMs: 1000 }),
    // Eight days back: outside the week.
    log(at(13, 10), { durationMs: 9000 }),
    log(at(18, 10)),
  ],
  NOW
);

check('siedem dni, dzis ostatni', byDay.length, 7);
check('od 14. do 20.', [new Date(byDay[0].start).getDate(), new Date(byDay[6].start).getDate()], [14, 20]);
check('suma na dzien, 3:00 do poprzedniego', byDay.map((day) => day.ms), [1000, 0, 0, 0, 0, 2000, 10000]);

group('Statystyki: zapamietane wobec celu');

check('na celu albo wyzej', [retentionTone(0.94, 0.94), retentionTone(0.97, 0.94)], ['good', 'good']);
check('troche pod celem', retentionTone(0.9, 0.94), 'close');
check('wyraznie pod celem', retentionTone(0.85, 0.94), 'low');
check('bez celu nie ma czego porownywac', retentionTone(0.5, null), 'good');

group('Statystyki: roznica skojarzen');

const side = (rate: number | null) => ({ answers: 40, rate, target: 0.9 });

check('w punktach procentowych, jak pokazane procenty', mnemonicGap({ with: side(0.904), without: side(0.816) }), 8);
check('ujemna', mnemonicGap({ with: side(0.8), without: side(0.85) }), -5);
check('bez procentu po jednej stronie nic', mnemonicGap({ with: side(null), without: side(0.85) }), null);
check('z plusem, minusem i bez znaku', [formatGap(12), formatGap(-3), formatGap(0)], [
  '+12 pkt proc.',
  '−3 pkt proc.',
  '0 pkt proc.',
]);
group('Statystyki: oceny');

const mix = ratingMix(
  [
    log(at(20, 9), { rating: Rating.Good }),
    log(at(20, 9), { rating: Rating.Good }),
    log(at(19, 9), { rating: Rating.Easy }),
    log(at(19, 9), { rating: Rating.Again, state: State.Relearning }),
    log(at(18, 9), { rating: Rating.Hard, state: State.New }),
    log(at(18, 9), { rating: Rating.Good, state: State.Learning }),
    // Outside the thirty days.
    log(at(20, 9) - 40 * 86_400_000, { rating: Rating.Again }),
  ],
  NOW
);

check('powtorki osobno', mix.review, { again: 0, hard: 0, good: 2, easy: 1, total: 3 });
check('nauka razem z nowymi i ponowna', mix.learning, { again: 1, hard: 1, good: 1, easy: 0, total: 3 });
check('pusto bez odpowiedzi', ratingMix([], NOW).review.total, 0);

group('Statystyki: dluzsza prognoza');

check(
  'trzydziesci dni, karta za trzy tygodnie w swoim dniu',
  forecast([{ cardId: 1, state: State.Review, due: at(20, 12) + 21 * 86_400_000, scheduledDays: 21 }], NOW, FORECAST_LONG_DAYS)
    .map((day) => day.count)
    .indexOf(1),
  21
);
check('trzydziesci slupkow', forecast([], NOW, FORECAST_LONG_DAYS).length, 30);

group('Statystyki: wzrost kolekcji');

const DAY = 86_400_000;
const schedule = (cardId: number, state: number, scheduledDays: number) => ({ cardId, state, due: NOW, scheduledDays });

// Card 1: learned five weeks ago, then a 25-day interval set three weeks ago — mature since.
// Card 2: learned two weeks ago, still young. Card 3: answered, then reset to new.
const growth = collectionGrowth(
  [
    log(NOW - 35 * DAY, { cardId: 1, state: State.New, scheduledDays: 0 }),
    log(NOW - 30 * DAY, { cardId: 1, state: State.Learning, scheduledDays: 0 }),
    log(NOW - 21 * DAY, { cardId: 1, state: State.Review, scheduledDays: 9 }),
    log(NOW - 14 * DAY, { cardId: 2, state: State.New, scheduledDays: 0 }),
    log(NOW - 20 * DAY, { cardId: 3, state: State.New, scheduledDays: 0 }),
  ],
  [schedule(1, State.Review, 25), schedule(2, State.Review, 5), schedule(3, State.New, 0)],
  NOW
);

check('dwanascie tygodni, ostatni to teraz', [growth.length, growth.at(-1)?.at], [12, NOW]);
check('co tydzien rano, jak teraz', growth.at(-2)?.at, NOW - 7 * DAY);
check('przed pierwsza odpowiedzia nic', growth[0], { at: growth[0].at, learning: 0, young: 0, mature: 0 });
check(
  'karta uczona, potem dojrzala; druga dochodzi; wyzerowana znika',
  growth.slice(-6).map((week) => [week.learning, week.young, week.mature]),
  [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [0, 1, 1],
    [0, 1, 1],
    [0, 1, 1],
  ]
);
check('karta spoza talii pominieta', collectionGrowth([log(NOW - DAY, { cardId: 9 })], [], NOW).at(-1)?.young, 0);
check('zmiana ze znakiem', [formatSigned(50), formatSigned(-4), formatSigned(0)], ['+50', '−4', '0']);
group('Statystyki: etap karty');

check(
  'nowa, w nauce, ponowna nauka, mloda, dojrzala',
  [
    cardStage(State.New, 0),
    cardStage(State.Learning, 0),
    cardStage(State.Relearning, 0),
    cardStage(State.Review, 20),
    cardStage(State.Review, 21),
  ],
  ['new', 'learning', 'learning', 'young', 'mature']
);
check('bez stanu to nowa', cardStage(null, null), 'new');

