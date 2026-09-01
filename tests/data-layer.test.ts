/**
 * Data-layer tests against a real SQLite engine (`node:sqlite`), calling the
 * real functions from `src/db/queries.ts`. Run with `npm test`.
 *
 * These exist because neither `tsc` nor the bundler can see the failures that
 * actually happen here: drizzle rendering SQL differently depending on the
 * surrounding query, or a scheduling rule drifting between JS and SQL.
 */
import { eq } from 'drizzle-orm';

import { db, sqliteDb } from '@/db/client';
import {
  cardMediaFiles,
  cardsInDeckQuery,
  cardsLines,
  cardsMediaFiles,
  allTagsQuery,
  copyCards,
  deckTagsQuery,
  getCardTagNames,
  setCardTagNames,
  createCard,
  createDeck,
  deckAllowance,
  deckMediaFiles,
  deckDoneTodayQuery,
  deckDueBreakdownQuery,
  decksWithStatsQuery,
  deleteCard,
  deleteCards,
  deleteDeck,
  getCardFields,
  gradeCard,
  loadDueCards,
  moveCards,
  resetCards,
  getCardLines,
  getDeckSlots,
  newCardFields,
  newCardLayout,
  otherDecksQuery,
  rollbackCard,
  saveCardFields,
  syncDeckSlots,
  updateCard,
  updateDeck,
} from '@/db/queries';
import { decks, fsrsState, reviewLogs } from '@/db/schema';
import { cappedCounts, studyDayStart, totalDue } from '@/lib/limits';
import { sortCards } from '@/lib/card-sort';
import { filterCards } from '@/lib/search';
import { filterByTags } from '@/lib/tags';
import { countQueueStates, Rating, State } from '@/lib/scheduler';

import { check, group } from './harness';

import migration0000 from '../drizzle/0000_init.sql';
import migration0001 from '../drizzle/0001_legal_shadow_king.sql';
import migration0002 from '../drizzle/0002_wild_dark_beast.sql';
import migration0003 from '../drizzle/0003_absurd_moondragon.sql';
import migration0004 from '../drizzle/0004_aspiring_skrulls.sql';
import migration0005 from '../drizzle/0005_eminent_miek.sql';
import migration0006 from '../drizzle/0006_moaning_shiva.sql';
import migration0007 from '../drizzle/0007_bouncy_the_enforcers.sql';
import migration0008 from '../drizzle/0008_mean_lady_mastermind.sql';
import migration0009 from '../drizzle/0009_curved_jazinda.sql';
import migration0010 from '../drizzle/0010_quiet_absorbing_man.sql';

for (const migration of [
  migration0000,
  migration0001,
  migration0002,
  migration0003,
  migration0004,
  migration0005,
  migration0006,
  migration0007,
  migration0008,
  migration0009,
  migration0010,
]) {
  for (const statement of migration.split('--> statement-breakpoint')) {
    const trimmed = statement.trim();
    if (trimmed) sqliteDb.execSync(trimmed);
  }
}

/** Local-time helper, so the 4 AM rollover is exercised in the real timezone. */
const at = (hour: number, minute = 0, day = 30) => new Date(2026, 7, day, hour, minute, 0, 0);
const now = at(12);

const deckRow = (deckId: number) => db.select().from(decks).where(eq(decks.id, deckId)).get()!;

/** What the deck screen shows: raw counters capped by the deck's daily limits. */
const breakdown = (deckId: number, when: Date) => {
  const deck = deckRow(deckId);
  const row = deckDueBreakdownQuery(
    deckId,
    when.getTime(),
    studyDayStart(when).getTime()
  ).all()[0];

  return cappedCounts({ ...row, newPerDay: deck.newPerDay, reviewsPerDay: deck.reviewsPerDay });
};

/** The same numbers as the deck list computes them, from a different query. */
const fromList = (deckId: number, when: Date) => {
  const row = decksWithStatsQuery(when.getTime(), studyDayStart(when).getTime())
    .all()
    .find((deck) => deck.id === deckId)!;

  return cappedCounts(row);
};

const snapshot = (cardId: number) => {
  const row = db.select().from(fsrsState).where(eq(fsrsState.cardId, cardId)).get()!;
  return {
    due: row.due.getTime(),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsedDays: row.elapsedDays,
    scheduledDays: row.scheduledDays,
    learningSteps: row.learningSteps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    lastReview: row.lastReview ? row.lastReview.getTime() : null,
  };
};

const logCount = (cardId: number) =>
  db.select().from(reviewLogs).where(eq(reviewLogs.cardId, cardId)).all().length;

group('Granica dnia nauki (rollover 4:00)');

check('poludnie nalezy do biezacego dnia', studyDayStart(at(12)).getTime(), at(4).getTime());
check(
  '2:00 w nocy nalezy jeszcze do poprzedniego dnia',
  studyDayStart(at(2)).getTime(),
  at(4, 0, 29).getTime()
);
check('rowno 4:00 zaczyna nowy dzien', studyDayStart(at(4)).getTime(), at(4).getTime());

group('Liczniki Nowe / Nauka / Powtorki');

const plain = createDeck({ name: 'Bez limitow', newPerDay: 100, reviewsPerDay: 100 });
const p1 = createCard(plain.id, 'a', 'A', now);
const p2 = createCard(plain.id, 'b', 'B', now);
createCard(plain.id, 'c', 'C', now);

check('trzy swieze karty sa nowe i zalegle', breakdown(plain.id, now), {
  newCount: 3,
  learningCount: 0,
  reviewCount: 0,
});
check('lista talii zgodna z ekranem talii', fromList(plain.id, now), breakdown(plain.id, now));

const beforeGrade = snapshot(p1.id);
gradeCard(p1.id, Rating.Again, now);
gradeCard(p2.id, Rating.Easy, now);

check('po 2 minutach wraca karta w nauce', breakdown(plain.id, at(12, 2)), {
  newCount: 1,
  learningCount: 1,
  reviewCount: 0,
});
check(
  'lista talii nadal zgodna po ocenach',
  fromList(plain.id, at(12, 2)),
  breakdown(plain.id, at(12, 2))
);

group('Cofanie ostatniej odpowiedzi');

check('ocena dopisala wpis do historii', logCount(p1.id), 1);

rollbackCard(p1.id);

check('rollback przywraca stan nowej karty co do pola', snapshot(p1.id), beforeGrade);
check('rollback kasuje wpis z historii', logCount(p1.id), 0);

// From a non-New state ts-fsrs restores `due` as the moment of the undone
// review rather than the original due date. That is deliberate: the card lands
// back in the queue straight away.
const step1 = snapshot(p2.id);
const secondReviewAt = at(12, 11);
gradeCard(p2.id, Rating.Good, secondReviewAt);
rollbackCard(p2.id);

const undone = snapshot(p2.id);
const { due: undoneDue, ...undoneRest } = undone;
const { due: _originalDue, ...step1Rest } = step1;

check('cofniecie przywraca wszystkie pola poza due', undoneRest, step1Rest);
check('cofniecie ustawia due na moment cofnietej odpowiedzi', undoneDue, secondReviewAt.getTime());

group('Dzienne limity');

const capped = createDeck({ name: 'Z limitem', newPerDay: 2, reviewsPerDay: 1 });
const five = [1, 2, 3, 4, 5].map((n) => createCard(capped.id, `f${n}`, `b${n}`, now));

check('surowo 5 nowych, limit przycina do 2', breakdown(capped.id, now), {
  newCount: 2,
  learningCount: 0,
  reviewCount: 0,
});
check('kolejka sesji dostaje dokladnie tyle samo', loadDueCards(capped.id, now).length, 2);
check('przydzial na starcie', deckAllowance(capped.id, now), { newLeft: 2, reviewsLeft: 1 });

gradeCard(five[0].id, Rating.Easy, now);
gradeCard(five[1].id, Rating.Easy, now);

check('po wyczerpaniu limitu nowych nie ma nic', breakdown(capped.id, at(12, 5)), {
  newCount: 0,
  learningCount: 0,
  reviewCount: 0,
});
check('kolejka rowniez pusta', loadDueCards(capped.id, at(12, 5)).length, 0);
check('przydzial nowych wyczerpany', deckAllowance(capped.id, at(12, 5)), {
  newLeft: 0,
  reviewsLeft: 1,
});

group('Karty w nauce omijaja limit');

const learn = createDeck({ name: 'Nauka', newPerDay: 1, reviewsPerDay: 0 });
const l1 = createCard(learn.id, 'x', 'X', now);
createCard(learn.id, 'y', 'Y', now);

gradeCard(l1.id, Rating.Again, now);

check('limit nowych zjedzony, ale uczaca sie wraca', breakdown(learn.id, at(12, 2)), {
  newCount: 0,
  learningCount: 1,
  reviewCount: 0,
});
check('kolejka zawiera te uczaca sie karte', loadDueCards(learn.id, at(12, 2)).length, 1);
check(
  'licznik sesji zgodny z SQL',
  countQueueStates(loadDueCards(learn.id, at(12, 2)).map((row) => row.state as State)),
  { newCount: 0, learningCount: 1, reviewCount: 0 }
);

group('Nowy dzien i limit powtorek');

const tomorrow = at(12, 0, 31);

check('nazajutrz limit nowych znow dziala', breakdown(capped.id, tomorrow), {
  newCount: 2,
  learningCount: 0,
  reviewCount: 0,
});
check(
  'lista talii tez sie zresetowala',
  fromList(capped.id, tomorrow),
  breakdown(capped.id, tomorrow)
);
check('powtorki mieszcza sie w limicie 1', breakdown(capped.id, at(12, 0, 40)), {
  newCount: 2,
  learningCount: 0,
  reviewCount: 1,
});

updateDeck(capped.id, { name: 'Z limitem', newPerDay: 0, reviewsPerDay: 5 });

check('limit 0 nowych wylacza je calkowicie', breakdown(capped.id, at(12, 0, 40)), {
  newCount: 0,
  learningCount: 0,
  reviewCount: 2,
});
check('suma zasilajaca przycisk "Ucz sie"', totalDue(breakdown(capped.id, at(12, 0, 40))), 2);

group('Kolejka sesji: nowe karty wzgledem powtorek');

// Two cards taken to Review on day 30, three new ones added right after, all of
// them due on day 40 — the mix the placement option is about.
const queueDeck = createDeck({ name: 'Kolejka', newPerDay: 5, reviewsPerDay: 5 });
const older = [1, 2].map((n) => createCard(queueDeck.id, `r${n}`, `R${n}`, now));
older.forEach((card) => gradeCard(card.id, Rating.Easy, now));
[1, 2, 3].forEach((n) => createCard(queueDeck.id, `n${n}`, `N${n}`, at(12, n)));

const queueDay = at(12, 0, 60);
const shape = (deckId: number, when: Date) =>
  loadDueCards(deckId, when)
    .map((card) => (card.state === State.New ? 'N' : 'P'))
    .join('');

const setPlacement = (placement: 'mixed' | 'before' | 'after') =>
  updateDeck(queueDeck.id, {
    name: 'Kolejka',
    newPerDay: 5,
    reviewsPerDay: 5,
    newCardPlacement: placement,
  });

check('wszystkie piec kart jest zalegle', loadDueCards(queueDeck.id, queueDay).length, 5);

setPlacement('before');
check('nowe przed powtorkami', shape(queueDeck.id, queueDay), 'NNNPP');

setPlacement('after');
check('nowe po powtorkach', shape(queueDeck.id, queueDay), 'PPNNN');

setPlacement('mixed');
check('wymieszane rozklada nowe w sesji', shape(queueDeck.id, queueDay), 'NPNPN');

group('Kolejka sesji: skad brane sa nowe karty');

// Limit of one new card a day, so the gather order decides which single card
// out of three gets introduced.
const gatherDeck = createDeck({ name: 'Zrodlo', newPerDay: 1, reviewsPerDay: 0 });
const gathered = [1, 2, 3].map((n) => createCard(gatherDeck.id, `g${n}`, `G${n}`, at(12, n)));

const setOrder = (order: 'oldest' | 'newest' | 'random') =>
  updateDeck(gatherDeck.id, {
    name: 'Zrodlo',
    newPerDay: 1,
    reviewsPerDay: 0,
    newCardOrder: order,
  });

const firstCard = (random?: () => number) =>
  loadDueCards(gatherDeck.id, queueDay, 500, random)[0]?.cardId;

setOrder('oldest');
check('limit wpuszcza dokladnie jedna nowa karte', loadDueCards(gatherDeck.id, queueDay).length, 1);
check('od najdawniej dodanych bierze pierwsza', firstCard(), gathered[0].id);

setOrder('newest');
check('od najnowszych bierze ostatnia', firstCard(), gathered[2].id);

setOrder('random');
check('losowo bierze karte wskazana przez tasowanie', firstCard(() => 0), gathered[1].id);
check(
  'losowo zawsze zwraca karte z tej talii',
  gathered.map((card) => card.id).includes(firstCard(Math.random)!),
  true
);

group('Przenoszenie kart miedzy taliami');

const source = createDeck({ name: 'Zrodlowa', newPerDay: 10, reviewsPerDay: 10 });
const target = createDeck({ name: 'Docelowa', newPerDay: 10, reviewsPerDay: 10 });

const moved = createCard(source.id, 'move', 'MOVE', now);
gradeCard(moved.id, Rating.Good, now);
const scheduleBefore = snapshot(moved.id);

const cardCount = (deckId: number, when: Date) =>
  decksWithStatsQuery(when.getTime(), studyDayStart(when).getTime())
    .all()
    .find((deck) => deck.id === deckId)?.cardCount;

const newDoneToday = (deckId: number, when: Date) =>
  deckDoneTodayQuery(deckId, studyDayStart(when).getTime()).all()[0].newDoneToday;

const moveTargets = otherDecksQuery(source.id).all();

check('cele przenosin pomijaja biezaca talie', moveTargets.some((deck) => deck.id === source.id), false);
check('cele przenosin zawieraja druga talie', moveTargets.some((deck) => deck.id === target.id), true);

check('przed przenosinami karta jest w zrodle', cardCount(source.id, now), 1);
check('talia docelowa jest pusta', cardCount(target.id, now), 0);

moveCards([moved.id], target.id);

check('po przenosinach zrodlo jest puste', cardCount(source.id, now), 0);
check('karta trafila do celu', cardCount(target.id, now), 1);
check('harmonogram FSRS przetrwal przenosiny', snapshot(moved.id), scheduleBefore);
check('historia powtorek zostaje przy karcie', logCount(moved.id), 1);
check('dzisiejsza odpowiedz liczy sie do nowej talii', newDoneToday(target.id, now), 1);
check('i przestaje sie liczyc do starej', newDoneToday(source.id, now), 0);

// The card no longer hangs off the old deck, so its CASCADE cannot take it.
deleteDeck(source.id);

check('usuniecie starej talii nie kasuje przeniesionej karty', logCount(moved.id), 1);
check('karta dalej jest w talii docelowej', cardCount(target.id, now), 1);

group('Puste pola nowej karty');

const fieldDeck = createDeck({ name: 'Z polami', newPerDay: 10, reviewsPerDay: 10 });

// Position 0 on each side belongs to the mandatory field, so the empty slots
// start below it. Each one carries its own kind — a text box or an audio slot.
syncDeckSlots(fieldDeck.id, [
  { side: 'front', position: 1, kind: 'text' },
  { side: 'front', position: 2, kind: 'audio' },
  { side: 'back', position: 1, kind: 'text' },
]);

// Order between the two sides carries no meaning — each side is sorted on its
// own when the editor builds its list — so the check compares them sorted.
check(
  'nowa karta startuje ze slotami talii',
  newCardFields(fieldDeck.id)
    .map((field) => [field.side, field.position, field.kind, field.value])
    .sort(),
  [
    ['back', 1, 'text', ''],
    ['front', 1, 'text', ''],
    ['front', 2, 'audio', ''],
  ]
);

check(
  'talia bez slotow nie daje zadnych pol',
  newCardFields(createDeck({ name: 'Bez pol', newPerDay: 1, reviewsPerDay: 1 }).id),
  []
);

// Saving the deck again replaces the whole set rather than diffing it.
syncDeckSlots(fieldDeck.id, [{ side: 'back', position: 1, kind: 'audio' }]);

check(
  'ponowny zapis podmienia caly zestaw slotow',
  getDeckSlots(fieldDeck.id).map((slot) => [slot.side, slot.position, slot.kind]),
  [['back', 1, 'audio']]
);

// A deck whose default card keeps both mandatory fields on the back and leaves
// one empty box on the front — the same layout the deck editor arranges.
const oddDeck = createDeck({
  name: 'Nietypowy uklad',
  newPerDay: 10,
  reviewsPerDay: 10,
  newCardLayout: { frontSide: 'back', frontPosition: 1, backSide: 'back', backPosition: 0 },
});

syncDeckSlots(oddDeck.id, [{ side: 'front', position: 0, kind: 'text' }]);

check('talia pamieta swoj domyslny uklad', newCardLayout(oddDeck.id), {
  frontSide: 'back',
  frontPosition: 1,
  backSide: 'back',
  backPosition: 0,
});

check('puste pole trafia na wolna strone', newCardFields(oddDeck.id), [
  { id: null, side: 'front', position: 0, kind: 'text', value: '', mediaPath: null },
]);

// A card made from that template reads exactly as the deck arranged it.
const oddCard = createCard(
  oddDeck.id,
  'to fly',
  'latac',
  now,
  newCardFields(oddDeck.id),
  newCardLayout(oddDeck.id)
);

const oddQueued = () =>
  loadDueCards(oddDeck.id, now).find((card) => card.cardId === oddCard.id);

check('nowa karta dziedziczy uklad talii: przod pusty', oddQueued()?.frontLines, []);
check('a oba pola podstawowe czytaja sie z tylu', oddQueued()?.backLines, [
  { text: 'latac', base: true, media: null },
  { text: 'to fly', base: true, media: null },
]);

group('Uklad pol na karcie');

// The front reads: extra, mandatory, empty extra. The back: mandatory, extra.
const fieldCard = createCard(
  fieldDeck.id,
  'to break',
  'lamac',
  now,
  [
    { id: null, side: 'front', position: 0, kind: 'text', value: '/breik/', mediaPath: null },
    { id: null, side: 'front', position: 2, kind: 'text', value: '   ', mediaPath: null },
    { id: null, side: 'back', position: 1, kind: 'text', value: 'break-broke-broken', mediaPath: null },
  ],
  { frontSide: 'front', frontPosition: 1, backSide: 'back', backPosition: 0 }
);

check(
  'pola zapisane razem z pozycjami, puste tez',
  getCardFields(fieldCard.id).map((field) => [field.side, field.position, field.value]),
  [
    ['front', 0, '/breik/'],
    ['back', 1, 'break-broke-broken'],
    ['front', 2, ''],
  ]
);

const queued = () => loadDueCards(fieldDeck.id, now).find((card) => card.cardId === fieldCard.id);

check('przod czyta sie w kolejnosci z edytora, bez pustego pola', queued()?.frontLines, [
  { text: '/breik/', base: false, media: null },
  { text: 'to break', base: true, media: null },
]);
check('tyl tak samo', queued()?.backLines, [
  { text: 'lamac', base: true, media: null },
  { text: 'break-broke-broken', base: false, media: null },
]);

const rows = getCardFields(fieldCard.id);
const pronunciation = rows.find((field) => field.value === '/breik/')!;
const forms = rows.find((field) => field.value === 'break-broke-broken')!;
const blank = rows.find((field) => field.value === '')!;

// Dragging the pronunciation to the back and the mandatory front text below the
// empty box: both are just a different order coming out of the editor.
saveCardFields(
  fieldCard.id,
  [
    { id: blank.id, side: 'front', position: 0, kind: 'text', value: '', mediaPath: null },
    { id: pronunciation.id, side: 'back', position: 0, kind: 'text', value: '/breik/', mediaPath: null },
    { id: forms.id, side: 'back', position: 2, kind: 'text', value: 'break-broke-broken', mediaPath: null },
  ],
  { frontSide: 'front', frontPosition: 1, backSide: 'back', backPosition: 1 }
);

check('po przestawieniu przod ma tylko pole podstawowe', queued()?.frontLines, [
  { text: 'to break', base: true, media: null },
]);
check('a pole przeniesione czyta sie na tyle, nad podstawowym', queued()?.backLines, [
  { text: '/breik/', base: false, media: null },
  { text: 'lamac', base: true, media: null },
  { text: 'break-broke-broken', base: false, media: null },
]);

check('pole wyrzucone z listy znika z karty', getCardFields(fieldCard.id).length, 3);

// The deck's slots change; the card that already exists must not budge.
syncDeckSlots(fieldDeck.id, []);

check('zmiana slotow talii nie rusza istniejacej karty', getCardFields(fieldCard.id).length, 3);

group('Pusta strona karty');

const emptyFrontCard = createCard(
  fieldDeck.id,
  'to run',
  'biegac',
  now,
  [{ id: null, side: 'back', position: 2, kind: 'text', value: 'ran / run', mediaPath: null }],
  { frontSide: 'back', frontPosition: 0, backSide: 'back', backPosition: 1 }
);

const emptyFrontQueued = () =>
  loadDueCards(fieldDeck.id, now).find((card) => card.cardId === emptyFrontCard.id);

check('przod bez zadnego pola nie ma linii', emptyFrontQueued()?.frontLines, []);
check('a caly uklad czyta sie z tylu', emptyFrontQueued()?.backLines, [
  { text: 'to run', base: true, media: null },
  { text: 'biegac', base: true, media: null },
  { text: 'ran / run', base: false, media: null },
]);

group('Przenosiny a pola karty');

const fieldTarget = createDeck({ name: 'Cel', newPerDay: 10, reviewsPerDay: 10 });

moveCards([fieldCard.id], fieldTarget.id);

check(
  'uklad karty przezywa przenosiny w calosci',
  loadDueCards(fieldTarget.id, now).find((card) => card.cardId === fieldCard.id)?.backLines,
  [
    { text: '/breik/', base: false, media: null },
    { text: 'lamac', base: true, media: null },
    { text: 'break-broke-broken', base: false, media: null },
  ]
);

check('usuniecie karty zabiera jej pola', (() => {
  const throwaway = createCard(fieldTarget.id, 'x', 'X', now, [
    { id: null, side: 'front', position: 1, kind: 'text', value: 'do skasowania', mediaPath: null },
  ]);

  deleteCard(throwaway.id);
  return getCardFields(throwaway.id).length;
})(), 0);

group('Wyszukiwanie obejmuje pola dodatkowe');

const searchDeck = createDeck({ name: 'Szukanie', newPerDay: 10, reviewsPerDay: 10 });

createCard(searchDeck.id, 'to break', 'lamac', now, [
  { id: null, side: 'front', position: 1, kind: 'text', value: '/breik/', mediaPath: null },
  { id: null, side: 'back', position: 1, kind: 'text', value: 'break-broke-broken', mediaPath: null },
]);
createCard(searchDeck.id, 'to run', 'biegac', now, []);

const searchRows = cardsInDeckQuery(searchDeck.id).all();

// Pitfall 7 in CONTEXT.md: the correlated subquery has to keep the table
// qualifier, or SQLite fails on an ambiguous column name.
check(
  'podzapytanie trzyma kwalifikator tabeli',
  cardsInDeckQuery(searchDeck.id).toSQL().sql.includes('"cards"."id"'),
  true
);

check(
  'pola dodatkowe sklejone w jeden tekst',
  searchRows.find((card) => card.front === 'to break')?.fields,
  '/breik/ break-broke-broken'
);
check(
  'karta bez pol dodatkowych daje pusty tekst',
  searchRows.find((card) => card.front === 'to run')?.fields,
  ''
);

// The same shape of subquery as `fields`, so it carries the same risk — two of
// them in one select is exactly where an unqualified column would surface.
check(
  'licznik pol tez liczy sie na karte',
  [
    searchRows.find((card) => card.front === 'to break')?.fieldCount,
    searchRows.find((card) => card.front === 'to run')?.fieldCount,
  ],
  [2, 0]
);
check(
  'sortowanie po liczbie pol dostaje karte z polami na gorze',
  sortCards(searchRows, 'fields').map((card) => card.front),
  ['to break', 'to run']
);

check(
  'szukanie po tresci pola dodatkowego znajduje karte',
  filterCards(searchRows, 'broke-broken').map((card) => card.front),
  ['to break']
);
check(
  'a karty bez tego pola nie',
  filterCards(searchRows, 'biegac').map((card) => card.front),
  ['to run']
);

group('Pola z plikiem: dzwiek, obraz i wideo');

const mediaDeck = createDeck({ name: 'Z plikami', newPerDay: 10, reviewsPerDay: 10 });

const mediaCard = createCard(mediaDeck.id, 'to break', 'lamac', now, [
  { id: null, side: 'front', position: 1, kind: 'audio', value: 'break.m4a', mediaPath: 'a1.m4a' },
  { id: null, side: 'back', position: 1, kind: 'image', value: 'lamanie.jpg', mediaPath: 'i1.jpg' },
  { id: null, side: 'back', position: 2, kind: 'video', value: 'lamanie.mp4', mediaPath: 'v1.mp4' },
]);

check(
  'rodzaj i nazwa pliku zapisane przy polu',
  getCardFields(mediaCard.id).map((field) => [field.kind, field.value, field.mediaPath]),
  [
    ['audio', 'break.m4a', 'a1.m4a'],
    ['image', 'lamanie.jpg', 'i1.jpg'],
    ['video', 'lamanie.mp4', 'v1.mp4'],
  ]
);

const mediaQueued = () =>
  loadDueCards(mediaDeck.id, now).find((card) => card.cardId === mediaCard.id);

check('linia dzwieku niesie plik i jego rodzaj', mediaQueued()?.frontLines, [
  { text: 'to break', base: true, media: null },
  { text: 'break.m4a', base: false, media: { kind: 'audio', fileName: 'a1.m4a' } },
]);
check('linia obrazu i wideo tak samo', mediaQueued()?.backLines, [
  { text: 'lamac', base: true, media: null },
  { text: 'lamanie.jpg', base: false, media: { kind: 'image', fileName: 'i1.jpg' } },
  { text: 'lamanie.mp4', base: false, media: { kind: 'video', fileName: 'v1.mp4' } },
]);

// Deleting has to know the kind: each one lives in its own directory.
check(
  'pliki karty do posprzatania, z rodzajem',
  cardMediaFiles(mediaCard.id),
  [
    { kind: 'audio', fileName: 'a1.m4a' },
    { kind: 'image', fileName: 'i1.jpg' },
    { kind: 'video', fileName: 'v1.mp4' },
  ]
);
check('pliki calej talii', deckMediaFiles(mediaDeck.id).length, 3);

// A field whose file was cleared shows nothing — like an empty text box.
saveCardFields(mediaCard.id, [
  {
    id: getCardFields(mediaCard.id)[0].id,
    side: 'front',
    position: 1,
    kind: 'audio',
    value: 'break.m4a',
    mediaPath: null,
  },
]);

check('pole bez pliku nie trafia na karte', mediaQueued()?.frontLines, [
  { text: 'to break', base: true, media: null },
]);
check('i nie ma czego kasowac', cardMediaFiles(mediaCard.id), []);

group('Odczyt jednej karty po edycji');

const editedDeck = createDeck({ name: 'Edytowana', newPerDay: 10, reviewsPerDay: 10 });
const editedCard = createCard(editedDeck.id, 'to fall', 'spadac', now, [
  { id: null, side: 'back', position: 1, kind: 'text', value: 'fell / fallen', mediaPath: null },
]);

// What the review screen re-reads after the editor has been open on a card has
// to match what the session queue built at the start.
check(
  'pojedyncza karta czyta sie tak samo jak w kolejce',
  getCardLines(editedCard.id),
  (() => {
    const queued = loadDueCards(editedDeck.id, now).find((card) => card.cardId === editedCard.id)!;
    return { front: queued.frontLines, back: queued.backLines };
  })()
);

updateCard(editedCard.id, {
  front: 'to fall down',
  back: 'spadac',
  fields: [
    {
      id: getCardFields(editedCard.id)[0].id,
      side: 'back',
      position: 1,
      kind: 'text',
      value: 'fell / fallen',
      mediaPath: null,
    },
  ],
});

check('po edycji widac nowa tresc', getCardLines(editedCard.id)?.front, [
  { text: 'to fall down', base: true, media: null },
]);

deleteCard(editedCard.id);

check('skasowana karta nie ma juz stron', getCardLines(editedCard.id), null);

group('Zaznaczenie: kopiowanie kart');

const sourceDeck = createDeck({ name: 'Zrodlo', newPerDay: 10, reviewsPerDay: 10 });
const copyDeck = createDeck({ name: 'Cel kopii', newPerDay: 10, reviewsPerDay: 10 });

const withFile = createCard(sourceDeck.id, 'to sing', 'spiewac', now, [
  { id: null, side: 'back', position: 1, kind: 'audio', value: 'sing.m4a', mediaPath: 'orig.m4a' },
  { id: null, side: 'back', position: 2, kind: 'text', value: 'sang / sung', mediaPath: null },
]);
const plainCopyCard = createCard(sourceDeck.id, 'to swim', 'plywac', now);

// The file system is not available here, so the duplication is injected — the
// real one lives in `src/lib/media-files.ts` and needs a device.
const fakeCopier = (kind: 'audio' | 'image' | 'video', fileName: string) => `${kind}-2-${fileName}`;

// Answer one card first: the copy must not inherit any of this.
gradeCard(withFile.id, Rating.Good, now);

const copied = copyCards([withFile.id, plainCopyCard.id], copyDeck.id, fakeCopier, now);

check('kazda zaznaczona karta ma swoja kopie', copied.length, 2);
check('oryginaly zostaja na miejscu', cardsInDeckQuery(sourceDeck.id).all().length, 2);
check('kopie ladują w talii docelowej', cardsInDeckQuery(copyDeck.id).all().length, 2);

const copyOfWithFile = copied[0];

/** Both faces as plain text — the files differ by design, the reading must not. */
const lineTexts = (cardId: number) => {
  const row = cardsLines([cardId])[0];
  return [row.front.map((line) => line.text), row.back.map((line) => line.text)];
};

check('kopia czyta sie dokladnie jak oryginal', lineTexts(copyOfWithFile), lineTexts(withFile.id));

check(
  'pola kopii wskazuja WLASNE pliki',
  getCardFields(copyOfWithFile).map((field) => [field.kind, field.value, field.mediaPath]),
  [
    ['audio', 'sing.m4a', 'audio-2-orig.m4a'],
    ['text', 'sang / sung', null],
  ]
);
check(
  'a oryginal trzyma swoj plik dalej',
  getCardFields(withFile.id).map((field) => field.mediaPath),
  ['orig.m4a', null]
);

// A copy starts from scratch: same content, none of the schedule or history.
const copyState = db.select().from(fsrsState).where(eq(fsrsState.cardId, copyOfWithFile)).get()!;

check('kopia zaczyna jako nowa karta', [copyState.state, copyState.reps], [State.New, 0]);
check('i bez historii powtorek', logCount(copyOfWithFile), 0);
check('podczas gdy oryginal ma swoja', logCount(withFile.id), 1);

// Copying in place is how a card becomes a variant to edit.
const inPlace = copyCards([plainCopyCard.id], sourceDeck.id, fakeCopier, now);

check('kopiowac mozna tez do tej samej talii', cardsInDeckQuery(sourceDeck.id).all().length, 3);
check('kopia w miejscu to osobna karta', inPlace[0] === plainCopyCard.id, false);

check('pusta lista nic nie robi', copyCards([], copyDeck.id, fakeCopier, now), []);

group('Zaznaczenie: usuwanie i podglad');

const bulkDeck = createDeck({ name: 'Hurtem', newPerDay: 10, reviewsPerDay: 10 });
const bulk = ['a', 'b', 'c'].map((letter) =>
  createCard(bulkDeck.id, letter, letter.toUpperCase(), now, [
    {
      id: null,
      side: 'front',
      position: 1,
      kind: 'image',
      value: `${letter}.jpg`,
      mediaPath: `${letter}-1.jpg`,
    },
  ])
);

check('podglad czyta karty w podanej kolejnosci', cardsLines([bulk[2].id, bulk[0].id]).map((row) => row.front[0].text), ['c', 'a']);
check('i pomija id, ktorego juz nie ma', cardsLines([bulk[0].id, -1]).length, 1);
check('pusty wybor to pusty podglad', cardsLines([]), []);

const doomed = [bulk[0].id, bulk[1].id];

check('pliki calego zaznaczenia jednym zapytaniem', cardsMediaFiles(doomed), [
  { kind: 'image', fileName: 'a-1.jpg' },
  { kind: 'image', fileName: 'b-1.jpg' },
]);

deleteCards(doomed);

check('zaznaczone karty znikaja', cardsInDeckQuery(bulkDeck.id).all().length, 1);
check('a niezaznaczona zostaje', cardsInDeckQuery(bulkDeck.id).all()[0].front, 'c');
check('razem z nimi znikaja ich pola', getCardFields(bulk[0].id).length, 0);
check('pusta lista nie kasuje niczego', deleteCards([]), undefined);

group('Zaznaczenie: przenoszenie i zerowanie hurtem');

const bulkSource = createDeck({ name: 'Hurt zrodlo', newPerDay: 10, reviewsPerDay: 10 });
const bulkTarget = createDeck({ name: 'Hurt cel', newPerDay: 10, reviewsPerDay: 10 });
const trio = ['p', 'q', 'r'].map((letter) =>
  createCard(bulkSource.id, letter, letter.toUpperCase(), now)
);

gradeCard(trio[0].id, Rating.Good, now);
gradeCard(trio[1].id, Rating.Good, now);

moveCards([trio[0].id, trio[1].id], bulkTarget.id);

check('zaznaczone karty zmieniaja talie', cardsInDeckQuery(bulkTarget.id).all().length, 2);
check('niezaznaczona zostaje', cardsInDeckQuery(bulkSource.id).all()[0].front, 'r');
// Moving keeps the schedule, exactly as it does for a single card.
check('przeniesione karty nie wracaja do stanu nowego', snapshot(trio[0].id).state, State.Learning);

resetCards([trio[0].id, trio[1].id], now);

check(
  'zerowanie obejmuje cale zaznaczenie',
  [snapshot(trio[0].id).state, snapshot(trio[1].id).state],
  [State.New, State.New]
);
check('a licznik powtorek wraca do zera', snapshot(trio[0].id).reps, 0);
// The card starts over, but what happened to it stays on the record.
check('historia powtorek zostaje nietknieta', logCount(trio[0].id), 1);
check('karta poza zaznaczeniem zachowuje swoj stan', snapshot(trio[2].id).state, State.New);
check('pusta lista niczego nie przenosi', moveCards([], bulkTarget.id), undefined);
check('pusta lista niczego nie zeruje', resetCards([], now), undefined);

group('Tagi kart');

const tagDeck = createDeck({ name: 'Tagi', newPerDay: 10, reviewsPerDay: 10 });
const tagged = createCard(tagDeck.id, 'to sleep', 'spac', now);
const alsoTagged = createCard(tagDeck.id, 'to wake', 'budzic sie', now);
createCard(tagDeck.id, 'bez tagow', 'nic', now);

setCardTagNames(tagged.id, ['Czasownik', 'trudne']);
setCardTagNames(alsoTagged.id, ['czasownik']);

check('karta pamieta swoje tagi', getCardTagNames(tagged.id), ['Czasownik', 'trudne']);
// The second card asked for a different spelling of a tag that already exists;
// uniqueness runs on the folded slug, so it joins the same row.
check('rozna pisownia to ten sam tag', allTagsQuery().all().length, 2);
check(
  'druga karta dostala istniejacy tag, nie nowy',
  getCardTagNames(alsoTagged.id),
  ['Czasownik']
);

const deckTags = deckTagsQuery(tagDeck.id).all();

check(
  'talia widzi swoje tagi z licznikami',
  deckTags.map((tag) => [tag.name, tag.cardCount]),
  [
    ['Czasownik', 2],
    ['trudne', 1],
  ]
);

const taggedRows = cardsInDeckQuery(tagDeck.id).all();
const verbId = deckTags.find((tag) => tag.name === 'Czasownik')!.id;
const hardId = deckTags.find((tag) => tag.name === 'trudne')!.id;

// Same correlated-subquery shape as `fields` and `fieldCount`, same pitfall.
check(
  'kolumna z tagami trzyma kwalifikator tabeli',
  cardsInDeckQuery(tagDeck.id).toSQL().sql.includes('"cards"."id"'),
  true
);
check(
  'filtr po jednym tagu',
  filterByTags(taggedRows, [verbId]).map((card) => card.front).sort(),
  ['to sleep', 'to wake']
);
check(
  'filtr po dwoch tagach wymaga obu',
  filterByTags(taggedRows, [verbId, hardId]).map((card) => card.front),
  ['to sleep']
);

// Taking a tag off the last card that had it takes the tag itself: every tag is
// born attached to a card, so one with no cards is a typo, not a category.
setCardTagNames(tagged.id, ['Czasownik']);

check('tag bez kart znika', allTagsQuery().all().map((tag) => tag.name), ['Czasownik']);
check('a tag nadal uzywany zostaje', getCardTagNames(tagged.id), ['Czasownik']);

// Deleting a card takes its links with it, and with them any tag left orphaned.
deleteCards([tagged.id, alsoTagged.id]);
setCardTagNames(createCard(tagDeck.id, 'nowa', 'new', now).id, []);

check('kaskada zabiera powiazania', allTagsQuery().all(), []);
