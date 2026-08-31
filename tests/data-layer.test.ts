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
  cardAudioPaths,
  cardsInDeckQuery,
  createCard,
  createDeck,
  deckAllowance,
  deckAudioPaths,
  deckDoneTodayQuery,
  deckDueBreakdownQuery,
  decksWithStatsQuery,
  deleteCard,
  deleteDeck,
  getCardFields,
  gradeCard,
  loadDueCards,
  moveCard,
  newCardFields,
  newCardLayout,
  otherDecksQuery,
  rollbackCard,
  saveCardFields,
  updateDeck,
} from '@/db/queries';
import { decks, fsrsState, reviewLogs } from '@/db/schema';
import { cappedCounts, studyDayStart, totalDue } from '@/lib/limits';
import { filterCards } from '@/lib/search';
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

group('Ile pustych pol dostaje nowa karta');

const fieldDeck = createDeck({
  name: 'Z polami',
  newPerDay: 10,
  reviewsPerDay: 10,
  newFrontFields: 2,
  newBackFields: 1,
});

// Position 0 on each side belongs to the mandatory field, so the empty boxes
// start below it.
check('nowa karta startuje z pustymi polami wedlug licznikow talii', newCardFields(fieldDeck.id), [
  { id: null, side: 'front', position: 1, kind: 'text', value: '', audioPath: null },
  { id: null, side: 'front', position: 2, kind: 'text', value: '', audioPath: null },
  { id: null, side: 'back', position: 1, kind: 'text', value: '', audioPath: null },
]);

check(
  'talia bez licznikow nie daje zadnych pol',
  newCardFields(createDeck({ name: 'Bez pol', newPerDay: 1, reviewsPerDay: 1 }).id),
  []
);

// A deck whose default card keeps both mandatory fields on the back and leaves
// one empty box on the front — the same layout the deck editor arranges.
const oddDeck = createDeck({
  name: 'Nietypowy uklad',
  newPerDay: 10,
  reviewsPerDay: 10,
  newCardLayout: { frontSide: 'back', frontPosition: 1, backSide: 'back', backPosition: 0 },
  newFrontFields: 1,
  newBackFields: 0,
});

check('talia pamieta swoj domyslny uklad', newCardLayout(oddDeck.id), {
  frontSide: 'back',
  frontPosition: 1,
  backSide: 'back',
  backPosition: 0,
});

check('puste pole trafia na wolna strone', newCardFields(oddDeck.id), [
  { id: null, side: 'front', position: 0, kind: 'text', value: '', audioPath: null },
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
  { text: 'latac', base: true, audioPath: null },
  { text: 'to fly', base: true, audioPath: null },
]);

group('Uklad pol na karcie');

// The front reads: extra, mandatory, empty extra. The back: mandatory, extra.
const fieldCard = createCard(
  fieldDeck.id,
  'to break',
  'lamac',
  now,
  [
    { id: null, side: 'front', position: 0, kind: 'text', value: '/breik/', audioPath: null },
    { id: null, side: 'front', position: 2, kind: 'text', value: '   ', audioPath: null },
    { id: null, side: 'back', position: 1, kind: 'text', value: 'break-broke-broken', audioPath: null },
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
  { text: '/breik/', base: false, audioPath: null },
  { text: 'to break', base: true, audioPath: null },
]);
check('tyl tak samo', queued()?.backLines, [
  { text: 'lamac', base: true, audioPath: null },
  { text: 'break-broke-broken', base: false, audioPath: null },
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
    { id: blank.id, side: 'front', position: 0, kind: 'text', value: '', audioPath: null },
    { id: pronunciation.id, side: 'back', position: 0, kind: 'text', value: '/breik/', audioPath: null },
    { id: forms.id, side: 'back', position: 2, kind: 'text', value: 'break-broke-broken', audioPath: null },
  ],
  { frontSide: 'front', frontPosition: 1, backSide: 'back', backPosition: 1 }
);

check('po przestawieniu przod ma tylko pole podstawowe', queued()?.frontLines, [
  { text: 'to break', base: true, audioPath: null },
]);
check('a pole przeniesione czyta sie na tyle, nad podstawowym', queued()?.backLines, [
  { text: '/breik/', base: false, audioPath: null },
  { text: 'lamac', base: true, audioPath: null },
  { text: 'break-broke-broken', base: false, audioPath: null },
]);

check('pole wyrzucone z listy znika z karty', getCardFields(fieldCard.id).length, 3);

// The deck's counters change; the card that already exists must not budge.
updateDeck(fieldDeck.id, {
  name: 'Z polami',
  newPerDay: 10,
  reviewsPerDay: 10,
  newFrontFields: 0,
  newBackFields: 0,
});

check('zmiana licznikow talii nie rusza istniejacej karty', getCardFields(fieldCard.id).length, 3);

group('Pusta strona karty');

const emptyFrontCard = createCard(
  fieldDeck.id,
  'to run',
  'biegac',
  now,
  [{ id: null, side: 'back', position: 2, kind: 'text', value: 'ran / run', audioPath: null }],
  { frontSide: 'back', frontPosition: 0, backSide: 'back', backPosition: 1 }
);

const emptyFrontQueued = () =>
  loadDueCards(fieldDeck.id, now).find((card) => card.cardId === emptyFrontCard.id);

check('przod bez zadnego pola nie ma linii', emptyFrontQueued()?.frontLines, []);
check('a caly uklad czyta sie z tylu', emptyFrontQueued()?.backLines, [
  { text: 'to run', base: true, audioPath: null },
  { text: 'biegac', base: true, audioPath: null },
  { text: 'ran / run', base: false, audioPath: null },
]);

group('Przenosiny a pola karty');

const fieldTarget = createDeck({ name: 'Cel', newPerDay: 10, reviewsPerDay: 10 });

moveCard(fieldCard.id, fieldTarget.id);

check(
  'uklad karty przezywa przenosiny w calosci',
  loadDueCards(fieldTarget.id, now).find((card) => card.cardId === fieldCard.id)?.backLines,
  [
    { text: '/breik/', base: false, audioPath: null },
    { text: 'lamac', base: true, audioPath: null },
    { text: 'break-broke-broken', base: false, audioPath: null },
  ]
);

check('usuniecie karty zabiera jej pola', (() => {
  const throwaway = createCard(fieldTarget.id, 'x', 'X', now, [
    { id: null, side: 'front', position: 1, kind: 'text', value: 'do skasowania', audioPath: null },
  ]);

  deleteCard(throwaway.id);
  return getCardFields(throwaway.id).length;
})(), 0);

group('Wyszukiwanie obejmuje pola dodatkowe');

const searchDeck = createDeck({ name: 'Szukanie', newPerDay: 10, reviewsPerDay: 10 });

createCard(searchDeck.id, 'to break', 'lamac', now, [
  { id: null, side: 'front', position: 1, kind: 'text', value: '/breik/', audioPath: null },
  { id: null, side: 'back', position: 1, kind: 'text', value: 'break-broke-broken', audioPath: null },
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

group('Pola z dzwiekiem');

const audioDeck = createDeck({ name: 'Z dzwiekiem', newPerDay: 10, reviewsPerDay: 10 });

const audioCard = createCard(audioDeck.id, 'to break', 'lamac', now, [
  { id: null, side: 'front', position: 1, kind: 'audio', value: 'break.m4a', audioPath: 'a1.m4a' },
  { id: null, side: 'back', position: 1, kind: 'audio', value: 'lamac.m4a', audioPath: 'a2.m4a' },
]);

check(
  'rodzaj i sciezka pliku zapisane przy polu',
  getCardFields(audioCard.id).map((field) => [field.kind, field.value, field.audioPath]),
  [
    ['audio', 'break.m4a', 'a1.m4a'],
    ['audio', 'lamac.m4a', 'a2.m4a'],
  ]
);

const audioQueued = () =>
  loadDueCards(audioDeck.id, now).find((card) => card.cardId === audioCard.id);

check('linia dzwieku niesie sciezke pliku', audioQueued()?.frontLines, [
  { text: 'to break', base: true, audioPath: null },
  { text: 'break.m4a', base: false, audioPath: 'a1.m4a' },
]);

check('pliki karty do posprzatania', cardAudioPaths(audioCard.id).sort(), ['a1.m4a', 'a2.m4a']);
check('pliki calej talii', deckAudioPaths(audioDeck.id).sort(), ['a1.m4a', 'a2.m4a']);

// A field whose file was cleared shows nothing — like an empty text box.
saveCardFields(audioCard.id, [
  { id: getCardFields(audioCard.id)[0].id, side: 'front', position: 1, kind: 'audio', value: 'break.m4a', audioPath: null },
]);

check('pole audio bez pliku nie trafia na karte', audioQueued()?.frontLines, [
  { text: 'to break', base: true, audioPath: null },
]);
check('i nie ma czego kasowac', cardAudioPaths(audioCard.id), []);
