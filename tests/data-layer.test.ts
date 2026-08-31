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
  createCard,
  createDeck,
  deckAllowance,
  deckDoneTodayQuery,
  deckDueBreakdownQuery,
  decksWithStatsQuery,
  deleteDeck,
  getCardFields,
  getDeckFields,
  gradeCard,
  loadDueCards,
  moveCard,
  newCardFields,
  otherDecksQuery,
  rollbackCard,
  saveCardFields,
  syncDeckFields,
  updateCard,
  updateDeck,
} from '@/db/queries';
import { decks, fsrsState, reviewLogs } from '@/db/schema';
import { cappedCounts, studyDayStart, totalDue } from '@/lib/limits';
import { countQueueStates, Rating, State } from '@/lib/scheduler';

import { check, group } from './harness';

import migration0000 from '../drizzle/0000_init.sql';
import migration0001 from '../drizzle/0001_legal_shadow_king.sql';
import migration0002 from '../drizzle/0002_wild_dark_beast.sql';
import migration0003 from '../drizzle/0003_absurd_moondragon.sql';

for (const migration of [migration0000, migration0001, migration0002, migration0003]) {
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

moveCard(moved.id, target.id);

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

group('Domyslny schemat pol w talii');

const fieldDeck = createDeck({ name: 'Z polami', newPerDay: 10, reviewsPerDay: 10 });

syncDeckFields(fieldDeck.id, [
  { id: null, name: 'Wymowa', side: 'front' },
  { id: null, name: 'Przyklad', side: 'back' },
  { id: null, name: '   ', side: 'back' },
]);

const template = getDeckFields(fieldDeck.id);

check(
  'schemat zapisany w kolejnosci z formularza, bez pustych nazw',
  template.map((field) => [field.name, field.side, field.position]),
  [
    ['Wymowa', 'front', 0],
    ['Przyklad', 'back', 1],
  ]
);

// Renaming the first, dropping the second, adding a third — one call, as the
// deck editor sends it.
syncDeckFields(fieldDeck.id, [
  { id: template[0].id, name: 'Wymowa IPA', side: 'front' },
  { id: null, name: 'Odmiana', side: 'back' },
]);

check('zmiana nazwy, usuniecie i dodanie naraz', getDeckFields(fieldDeck.id).map((f) => f.name), [
  'Wymowa IPA',
  'Odmiana',
]);
check('pole schematu zachowuje id przy zmianie nazwy', getDeckFields(fieldDeck.id)[0].id, template[0].id);

check(
  'nowa karta startuje z pustym schematem talii',
  newCardFields(fieldDeck.id),
  [
    { id: null, name: 'Wymowa IPA', side: 'front', value: '' },
    { id: null, name: 'Odmiana', side: 'back', value: '' },
  ]
);

group('Pola nalezace do karty');

const fieldCard = createCard(fieldDeck.id, 'to break', 'lamac', now, [
  { id: null, name: 'Wymowa IPA', side: 'front', value: '/breik/' },
  { id: null, name: 'Odmiana', side: 'back', value: '' },
]);

check(
  'karta niesie oba pola, tez to puste',
  getCardFields(fieldCard.id).map((field) => [field.name, field.side, field.value]),
  [
    ['Wymowa IPA', 'front', '/breik/'],
    ['Odmiana', 'back', ''],
  ]
);

check('kolejka sesji pomija pole bez tresci', loadDueCards(fieldDeck.id, now)[0].fields, [
  { name: 'Wymowa IPA', side: 'front', value: '/breik/' },
]);

// The deck's template changes; the card that already exists must not budge.
syncDeckFields(fieldDeck.id, [{ id: null, name: 'Zupelnie inne', side: 'front' }]);

check(
  'zmiana schematu talii nie rusza istniejacej karty',
  getCardFields(fieldCard.id).map((field) => field.name),
  ['Wymowa IPA', 'Odmiana']
);

const cardFieldRows = getCardFields(fieldCard.id);

// Renaming one, filling the empty one, dropping nothing — plus a field the deck
// never knew about.
saveCardFields(fieldCard.id, [
  { id: cardFieldRows[0].id, name: 'Wymowa', side: 'front', value: '/breik/' },
  { id: cardFieldRows[1].id, name: 'Odmiana', side: 'back', value: 'break-broke-broken' },
  { id: null, name: 'Notatka', side: 'back', value: 'tylko na tej karcie' },
]);

check(
  'karta ma wlasny zestaw pol, niezalezny od talii',
  getCardFields(fieldCard.id).map((field) => [field.name, field.value]),
  [
    ['Wymowa', '/breik/'],
    ['Odmiana', 'break-broke-broken'],
    ['Notatka', 'tylko na tej karcie'],
  ]
);

// A row without a name is a removal, exactly like in the deck editor.
saveCardFields(fieldCard.id, [
  { id: getCardFields(fieldCard.id)[0].id, name: '', side: 'front', value: '/breik/' },
  { id: getCardFields(fieldCard.id)[1].id, name: 'Odmiana', side: 'back', value: 'break-broke-broken' },
]);

check('pole bez nazwy znika z karty', getCardFields(fieldCard.id).map((field) => field.name), [
  'Odmiana',
]);

group('Przenosiny a pola karty');

const fieldTarget = createDeck({ name: 'Cel bez pol', newPerDay: 10, reviewsPerDay: 10 });

moveCard(fieldCard.id, fieldTarget.id);

check(
  'pola ida z karta do talii bez zadnego schematu',
  getCardFields(fieldCard.id).map((field) => [field.name, field.value]),
  [['Odmiana', 'break-broke-broken']]
);
check(
  'i widac je w sesji nowej talii',
  loadDueCards(fieldTarget.id, now).find((card) => card.cardId === fieldCard.id)?.fields,
  [{ name: 'Odmiana', side: 'back', value: 'break-broke-broken' }]
);
