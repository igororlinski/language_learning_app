/**
 * Friends: what goes to our server, what comes back, and what each refusal is
 * called — against a stubbed `fetch`, like the AI providers. The server's own
 * side has its tests in `server/test`.
 */
import {
  addFriend,
  cleanRecoveryCode,
  createAccount,
  fetchLeaderboard,
  FriendsError,
  parseLeaderboard,
  recoverAccount,
  SERVER_URL,
  statsUpload,
  uploadStats,
  type Account,
} from '@/lib/friends';

import { bodyOf, headersOf, withStub } from './ai-transport.test';
import { check, group } from './harness';

const ACCOUNT: Account = {
  id: 'a'.repeat(32),
  name: 'Ola',
  friendCode: 'ABCD-EFGH',
  recoveryCode: 'AAAA-BBBB-CCCC-DDDD-EEEE',
};

/** A friends call's result, or `!<failure>` when it was refused. */
const outcomeOf = <T>(call: () => Promise<T>) => async () => {
  try {
    return JSON.stringify(await call());
  } catch (error) {
    if (error instanceof FriendsError) return `!${error.failure}`;
    throw error;
  }
};

// Sunday 2026-10-25, noon: the study day `2026-10-25`, its week from the 19th.
const NOW = new Date(2026, 9, 25, 12).getTime();

group('Znajomi: kod odzyskiwania');

check('wielkie litery, kreski co cztery', cleanRecoveryCode(' aaaa bbbb-cccc dddd eeee '), 'AAAA-BBBB-CCCC-DDDD-EEEE');
check('O to zero, I i L to jedynka', cleanRecoveryCode('o1il'), '0111');
check('pusty', cleanRecoveryCode(' - '), '');

group('Znajomi: co jedzie na serwer');

const day = (key: string, answers: number, goal: number, studyMs = 0) => ({ day: key, answers, goal, studyMs });

const upload = statsUpload(
  [
    day('2026-10-11', 30, 20), // fifteen days back: outside the two weeks
    day('2026-10-12', 30, 20, 1000), // the oldest day that still goes
    day('2026-10-24', 25, 20, 200_000_000), // a day longer than a day
    day('2026-10-23', 25, 20, 60_000),
    day('2026-10-25', 12, 1), // today: held to the goal set now
  ],
  10,
  ['streak-3', 'goalDays-1', 'streak-3', 'zły identyfikator'],
  NOW
);

check('dziś to dzień nauki telefonu', upload.today, '2026-10-25');
check('ostatnie dwa tygodnie, po kolei', upload.days.map((row) => row.day), [
  '2026-10-12',
  '2026-10-23',
  '2026-10-24',
  '2026-10-25',
]);
check('dziś liczy się wobec celu ustawionego teraz', upload.days[3].goal, 10);
check('dawne dni zostają przy swoim celu', upload.days[1].goal, 20);
check('czas dnia nie przekracza doby', upload.days[2].studyMs, 86_400_000);
check('seria liczona na telefonie: 23, 24 i dziś', upload.streak, 3);
check('odznaki bez powtórzeń i bez śmieci', upload.badges, ['streak-3', 'goalDays-1']);
check('cel spoza zakresu przycięty', statsUpload([], 5000, [], NOW).goal, 1000);

const put = await withStub({ status: 204, body: null }, () => uploadStats(ACCOUNT, upload));

check('wysyłka: PUT na /v1/me/stats', [put.sent?.url, put.sent?.init.method], [
  `${SERVER_URL}/v1/me/stats`,
  'PUT',
]);
check('wysyłka: kod odzyskiwania w nagłówku', headersOf(put.sent).Authorization, `Bearer ${ACCOUNT.recoveryCode}`);
check('wysyłka: treść to dokładnie podsumowanie', bodyOf(put.sent), upload);

group('Znajomi: konto');

const created = await withStub(
  {
    status: 201,
    body: { id: 'b'.repeat(32), name: 'Ola', friendCode: 'WXYZ-1234', recoveryCode: 'QQQQ-RRRR-SSSS-TTTT-VVVV' },
  },
  outcomeOf(() => createAccount('  Ola  '))
);

check('nowe konto: POST z przyciętą nazwą', [created.sent?.init.method, bodyOf(created.sent)], [
  'POST',
  { name: 'Ola' },
]);
check('nowe konto: bez nagłówka z kodem', headersOf(created.sent).Authorization, undefined);
check('nowe konto: kod odzyskiwania zostaje przy koncie', JSON.parse(created.outcome).recoveryCode, 'QQQQ-RRRR-SSSS-TTTT-VVVV');

const recovered = await withStub(
  { status: 200, body: { id: 'b'.repeat(32), name: 'Ola', friendCode: 'WXYZ-1234' } },
  outcomeOf(() => recoverAccount('qqqq rrrr ssss tttt vvvv'))
);

check('odzyskanie: GET /v1/me z oczyszczonym kodem', [recovered.sent?.url, headersOf(recovered.sent).Authorization], [
  `${SERVER_URL}/v1/me`,
  'Bearer QQQQ-RRRR-SSSS-TTTT-VVVV',
]);
check('odzyskanie: zapisany kod jest oczyszczony', JSON.parse(recovered.outcome).recoveryCode, 'QQQQ-RRRR-SSSS-TTTT-VVVV');

const half = await withStub({ status: 200, body: { id: 'x' } }, outcomeOf(() => recoverAccount('QQQQ')));
check('odpowiedź bez nazwy to błąd serwera, nie puste konto', half.outcome, '!server');

group('Znajomi: odmowy');

const refused = async (status: number, body: unknown) =>
  (await withStub({ status, body }, outcomeOf(() => addFriend(ACCOUNT, 'ZZZZ-ZZZZ')))).outcome;

check('nieznany kod', await refused(404, { error: 'unknown-code' }), '!unknown-code');
check('własny kod', await refused(400, { error: 'own-code' }), '!own-code');
check('za dużo prób', await refused(429, { error: 'too-many-attempts' }), '!too-many-attempts');
check('401 to nieznane konto, cokolwiek w treści', await refused(401, { error: 'whatever' }), '!unauthorized');
check('nieznany kod błędu to błąd serwera', await refused(500, { error: 'internal' }), '!server');
check('kody transportu nie przechodzą z serwera', await refused(400, { error: 'network' }), '!server');

const offline = await withStub(
  () => {
    throw new Error('Network request failed');
  },
  outcomeOf(() => addFriend(ACCOUNT, 'ZZZZ-ZZZZ'))
);

check('bez sieci', offline.outcome, '!network');

const added = await withStub({ status: 201, body: { friend: { id: 'c'.repeat(32), name: 'Ewa' } } }, () =>
  addFriend(ACCOUNT, ' wxyz-1234 ')
);

check('dodanie znajomego oddaje jego nazwę', added.outcome, 'Ewa');
check('dodanie znajomego: kod w treści', bodyOf(added.sent), { friendCode: 'wxyz-1234' });

group('Znajomi: ranking');

const board = await withStub(
  {
    status: 200,
    body: {
      week: '2026-10-19',
      people: [
        { id: 'c'.repeat(32), name: 'Ewa', me: false, goalDays: 5, todayMet: true, streak: 9, studyMs: 1, badges: ['streak-7', 3] },
        { id: '', name: 'bez id' },
        { id: 'a'.repeat(32), name: 'Ola', me: true, goalDays: 'dużo' },
      ],
    },
  },
  outcomeOf(() => fetchLeaderboard(ACCOUNT, NOW))
);

check('ranking: tydzień od poniedziałku i dzisiejszy dzień', board.sent?.url, `${SERVER_URL}/v1/leaderboard?week=2026-10-19&today=2026-10-25`);

const people = JSON.parse(board.outcome) as ReturnType<typeof parseLeaderboard>;

check('ranking: wiersz bez id wypada', people.map((person) => person.name), ['Ewa', 'Ola']);
check('ranking: odznaki to same napisy', people[0].badges, ['streak-7']);
check('ranking: liczba, która nie jest liczbą, to zero', people[1].goalDays, 0);
check('ranking: „ja” tylko przy true', [people[0].me, people[1].me], [false, true]);

const broken = await withStub({ status: 200, body: { week: '2026-10-19' } }, outcomeOf(() => fetchLeaderboard(ACCOUNT, NOW)));
check('ranking bez listy to błąd serwera', broken.outcome, '!server');
