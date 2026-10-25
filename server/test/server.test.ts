/**
 * The Worker end to end: real requests into `fetch`, real SQL against the real
 * migrations, `node:sqlite` standing in for D1. Run with `npm test` in server/.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeCode, RECOVERY_LENGTH } from '../src/codes.ts';
import worker, { type Person } from '../src/index.ts';
import { MAX_FRIENDS, SIGNUPS_PER_IP, WRONG_CODES_PER_DAY } from '../src/limits.ts';
import { cleanName, isDayKey, parseStats, shiftDay } from '../src/validate.ts';
import { createDb, type TestDb } from './d1.ts';

type Reply = { status: number; body: any };

function clientFor(db: TestDb) {
  return async (
    method: string,
    path: string,
    { body, token, ip = '10.0.0.1' }: { body?: unknown; token?: string; ip?: string } = {}
  ): Promise<Reply> => {
    const headers: Record<string, string> = { 'cf-connecting-ip': ip };
    if (token) headers.authorization = `Bearer ${token}`;

    const response = await worker.fetch(
      new Request(`https://fiszki.test${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      }),
      { DB: db }
    );
    const text = await response.text();

    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
}

/** A fresh database and a signed-up account on it. */
async function setup(name = 'Igor') {
  const db = createDb();
  const call = clientFor(db);
  const account = await signUp(call, name);

  return { db, call, account };
}

async function signUp(call: ReturnType<typeof clientFor>, name: string, ip?: string) {
  const reply = await call('POST', '/v1/accounts', { body: { name }, ip });
  assert.equal(reply.status, 201);

  return reply.body as { id: string; name: string; friendCode: string; recoveryCode: string };
}

// The viewer's week: Monday 19 October 2026 to Sunday the 25th.
const WEEK = '2026-10-19';
const TODAY = '2026-10-22';

const day = (key: string, answers: number, goal = 20, studyMs = 60_000) => ({ day: key, answers, goal, studyMs });

const stats = (over: Record<string, unknown> = {}) => ({
  today: TODAY,
  goal: 20,
  streak: 4,
  badges: ['streak-3'],
  days: [day('2026-10-19', 25), day('2026-10-20', 30), day('2026-10-21', 5), day(TODAY, 20)],
  ...over,
});

const board = async (call: ReturnType<typeof clientFor>, token: string, today = TODAY): Promise<Person[]> => {
  const reply = await call('GET', `/v1/leaderboard?week=${WEEK}&today=${today}`, { token });
  assert.equal(reply.status, 200);

  return reply.body.people;
};

describe('kody', () => {
  it('kod odzyskiwania czyta sie wyrozumiale', () => {
    assert.equal(normalizeCode('abcd efgh-jkmn pqrs tv0o', RECOVERY_LENGTH), 'ABCD-EFGH-JKMN-PQRS-TV00');
    assert.equal(normalizeCode('ILil-0000-0000-0000-0000', RECOVERY_LENGTH), '1111-0000-0000-0000-0000');
  });

  it('zla dlugosc albo litera spoza alfabetu to nie kod', () => {
    assert.equal(normalizeCode('ABCD', RECOVERY_LENGTH), null);
    assert.equal(normalizeCode('UUUU-0000-0000-0000-0000', RECOVERY_LENGTH), null);
    assert.equal(normalizeCode(42, RECOVERY_LENGTH), null);
  });
});

describe('walidacja', () => {
  it('nazwa: przyciete, jedna spacja, bez znakow sterujacych, do 30 znakow', () => {
    assert.equal(cleanName('  Anna \n  Nowak\u0007 '), 'Anna Nowak');
    assert.equal(cleanName('   '), null);
    assert.equal(cleanName('x'.repeat(31)), null);
    assert.equal(cleanName('ż'.repeat(30)), 'ż'.repeat(30));
  });

  it('dzien: prawdziwa data w formacie RRRR-MM-DD', () => {
    assert.equal(isDayKey('2026-02-28'), true);
    assert.equal(isDayKey('2026-02-30'), false);
    assert.equal(isDayKey('2026-2-28'), false);
    assert.equal(shiftDay('2026-10-24', 2), '2026-10-26');
    assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
  });

  it('statystyki: jedna zla wartosc odrzuca calosc', () => {
    assert.notEqual(parseStats(stats()), null);
    assert.equal(parseStats(stats({ goal: 0 })), null);
    assert.equal(parseStats(stats({ badges: ['<script>'] })), null);
    assert.equal(parseStats(stats({ days: [day('2026-10-01', 5)] })), null, 'dzien sprzed okna');
    assert.equal(parseStats(stats({ days: [day('2026-10-23', 5)] })), null, 'dzien po dzisiaj');
    assert.equal(parseStats(stats({ days: [day(TODAY, 5), day(TODAY, 6)] })), null, 'dzien dwa razy');
    assert.equal(parseStats(stats({ days: [day(TODAY, 1.5)] })), null);
    assert.equal(parseStats(stats({ days: [day(TODAY, 5, 20, 90_000_000)] })), null, 'wiecej niz doba');
  });
});

describe('konto', () => {
  it('zalozenie oddaje kod odzyskiwania i kod dla znajomych', async () => {
    const { account } = await setup();

    assert.match(account.recoveryCode, /^([0-9A-HJKMNP-TV-Z]{4}-){4}[0-9A-HJKMNP-TV-Z]{4}$/);
    assert.match(account.friendCode, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    assert.match(account.id, /^[0-9a-f]{32}$/);
    assert.equal(account.name, 'Igor');
  });

  it('baza trzyma skrot kodu, nie sam kod', async () => {
    const { db, account } = await setup();
    const row = db.raw.prepare('SELECT secret_hash FROM users').get() as { secret_hash: string };

    assert.match(row.secret_hash, /^[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(row).includes(account.recoveryCode));
  });

  it('kod odzyskiwania otwiera konto, takze wpisany malymi literami bez kresek', async () => {
    const { call, account } = await setup();
    const typed = account.recoveryCode.toLowerCase().replace(/-/g, ' ');

    const reply = await call('GET', '/v1/me', { token: typed });
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.body, { id: account.id, name: 'Igor', friendCode: account.friendCode });
  });

  it('bez kodu albo ze zlym kodem — 401', async () => {
    const { call } = await setup();

    assert.equal((await call('GET', '/v1/me')).status, 401);
    assert.equal((await call('GET', '/v1/me', { token: '0000-0000-0000-0000-0000' })).status, 401);
    assert.equal((await call('GET', '/v1/me', { token: 'zle' })).status, 401);
  });

  it('zla nazwa — 400, bez konta', async () => {
    const db = createDb();
    const call = clientFor(db);

    assert.deepEqual((await call('POST', '/v1/accounts', { body: { name: ' ' } })).body, { error: 'bad-name' });
    assert.equal((db.raw.prepare('SELECT count(*) AS n FROM users').get() as { n: number }).n, 0);
  });

  it(`najwyzej ${SIGNUPS_PER_IP} kont dziennie z jednego adresu`, async () => {
    const db = createDb();
    const call = clientFor(db);

    for (let n = 0; n < SIGNUPS_PER_IP; n += 1) await signUp(call, `K${n}`, '10.0.0.9');

    const refused = await call('POST', '/v1/accounts', { body: { name: 'Nadmiar' }, ip: '10.0.0.9' });
    assert.deepEqual([refused.status, refused.body], [429, { error: 'too-many-accounts' }]);
    assert.equal((await call('POST', '/v1/accounts', { body: { name: 'Inny' }, ip: '10.0.0.8' })).status, 201);
  });

  it('zmiana nazwy', async () => {
    const { call, account } = await setup();

    const reply = await call('PATCH', '/v1/me', { token: account.recoveryCode, body: { name: 'Igor O.' } });
    assert.equal(reply.body.name, 'Igor O.');
    assert.equal((await call('GET', '/v1/me', { token: account.recoveryCode })).body.name, 'Igor O.');
  });

  it('nowy kod dla znajomych uniewaznia stary', async () => {
    const { call, account } = await setup();
    const other = await signUp(call, 'Ola');

    const reply = await call('POST', '/v1/me/friend-code', { token: account.recoveryCode });
    assert.notEqual(reply.body.friendCode, account.friendCode);

    const old = await call('POST', '/v1/friends', { token: other.recoveryCode, body: { friendCode: account.friendCode } });
    assert.equal(old.status, 404);
  });
});

describe('znajomi', () => {
  it('kod laczy od razu w obie strony', async () => {
    const { call, account } = await setup();
    const ola = await signUp(call, 'Ola');

    const added = await call('POST', '/v1/friends', {
      token: ola.recoveryCode,
      body: { friendCode: account.friendCode.toLowerCase() },
    });
    assert.equal(added.status, 201);
    assert.deepEqual(added.body.friend, { id: account.id, name: 'Igor' });

    const mine = await board(call, account.recoveryCode);
    assert.deepEqual(mine.map((p) => p.name).sort(), ['Igor', 'Ola']);
  });

  it('drugi raz ten sam kod — 200, bez dubli', async () => {
    const { db, call, account } = await setup();
    const ola = await signUp(call, 'Ola');
    const add = () => call('POST', '/v1/friends', { token: ola.recoveryCode, body: { friendCode: account.friendCode } });

    await add();
    assert.equal((await add()).status, 200);
    assert.equal((db.raw.prepare('SELECT count(*) AS n FROM friends').get() as { n: number }).n, 2);
  });

  it('wlasny kod, zly format, nieznany kod', async () => {
    const { call, account } = await setup();
    const token = account.recoveryCode;

    assert.deepEqual((await call('POST', '/v1/friends', { token, body: { friendCode: account.friendCode } })).body, {
      error: 'own-code',
    });
    assert.deepEqual((await call('POST', '/v1/friends', { token, body: { friendCode: 'abc' } })).body, {
      error: 'bad-code',
    });
    assert.deepEqual((await call('POST', '/v1/friends', { token, body: { friendCode: 'ZZZZ-ZZZZ' } })).body, {
      error: 'unknown-code',
    });
  });

  it(`po ${WRONG_CODES_PER_DAY} zlych kodach dzis juz nic — takze dobry`, async () => {
    const { call, account } = await setup();
    const ola = await signUp(call, 'Ola');

    for (let n = 0; n < WRONG_CODES_PER_DAY; n += 1) {
      const code = `ZZZZ-ZZ${String(n).padStart(2, '0')}`;
      assert.equal((await call('POST', '/v1/friends', { token: ola.recoveryCode, body: { friendCode: code } })).status, 404);
    }

    const blocked = await call('POST', '/v1/friends', { token: ola.recoveryCode, body: { friendCode: account.friendCode } });
    assert.deepEqual([blocked.status, blocked.body], [429, { error: 'too-many-attempts' }]);
  });

  it(`najwyzej ${MAX_FRIENDS} znajomych`, async () => {
    const { db, call, account } = await setup();
    const insert = db.raw.prepare(
      `INSERT INTO users (id, name, secret_hash, friend_code, created_at, seen_at) VALUES (?, ?, ?, ?, 0, 0)`
    );
    const link = db.raw.prepare('INSERT INTO friends (user_id, friend_id, created_at) VALUES (?, ?, 0)');

    for (let n = 0; n < MAX_FRIENDS; n += 1) {
      const id = n.toString(16).padStart(32, '0');
      insert.run(id, `F${n}`, `hash${n}`, `F${n}`);
      link.run(account.id, id);
    }

    const ola = await signUp(call, 'Ola');
    const reply = await call('POST', '/v1/friends', { token: ola.recoveryCode, body: { friendCode: account.friendCode } });
    assert.deepEqual([reply.status, reply.body], [409, { error: 'too-many-friends' }]);
  });

  it('usuniecie znajomego rozlacza w obie strony', async () => {
    const { call, account } = await setup();
    const ola = await signUp(call, 'Ola');
    await call('POST', '/v1/friends', { token: ola.recoveryCode, body: { friendCode: account.friendCode } });

    assert.equal((await call('DELETE', `/v1/friends/${ola.id}`, { token: account.recoveryCode })).status, 204);
    assert.deepEqual((await board(call, ola.recoveryCode)).map((p) => p.name), ['Ola']);
  });
});

describe('statystyki i ranking', () => {
  async function friends() {
    const setupResult = await setup();
    const { call, account } = setupResult;
    const ola = await signUp(call, 'Ola');
    const ewa = await signUp(call, 'Ewa');
    await call('POST', '/v1/friends', { token: ola.recoveryCode, body: { friendCode: account.friendCode } });
    await call('POST', '/v1/friends', { token: ewa.recoveryCode, body: { friendCode: account.friendCode } });

    return { ...setupResult, ola, ewa };
  }

  it('zapis — 204, zla paczka — 400', async () => {
    const { call, account } = await setup();

    assert.equal((await call('PUT', '/v1/me/stats', { token: account.recoveryCode, body: stats() })).status, 204);
    assert.deepEqual((await call('PUT', '/v1/me/stats', { token: account.recoveryCode, body: { goal: 5 } })).body, {
      error: 'bad-stats',
    });
  });

  it('ranking po dniach z celem, potem serii, potem nazwie', async () => {
    const { call, account, ola, ewa } = await friends();

    // Igor: 19 and 20 met, 21 short, 22 met → 3 days.
    await call('PUT', '/v1/me/stats', { token: account.recoveryCode, body: stats() });
    // Ola: three days too, a longer streak.
    await call('PUT', '/v1/me/stats', {
      token: ola.recoveryCode,
      body: stats({ streak: 9, days: [day('2026-10-19', 10, 10), day('2026-10-20', 10, 10), day('2026-10-21', 12, 10)] }),
    });
    // Ewa: nothing sent yet.

    const people = await board(call, account.recoveryCode);

    assert.deepEqual(
      people.map((p) => [p.name, p.goalDays, p.streak, p.me]),
      [
        ['Ola', 3, 9, false],
        ['Igor', 3, 4, true],
        ['Ewa', 0, 0, false],
      ]
    );
    assert.equal(people.find((p) => p.name === 'Ewa')?.goal, null);
    assert.equal(ewa.name, 'Ewa');
  });

  it('dzis, czas nauki tygodnia i odznaki', async () => {
    const { call, account } = await setup();
    await call('PUT', '/v1/me/stats', {
      token: account.recoveryCode,
      body: stats({ days: [day('2026-10-12', 50, 20, 999_000), day('2026-10-21', 20, 20, 1000), day(TODAY, 3, 20, 500)] }),
    });

    const [me] = await board(call, account.recoveryCode);

    assert.equal(me.todayMet, false, 'dzis 3 z 20');
    assert.equal(me.studyMs, 1500, 'tylko ten tydzien');
    assert.deepEqual(me.badges, ['streak-3']);
    assert.equal(me.goal, 20);
  });

  it('kazdy dzien liczy sie wobec wlasnego celu', async () => {
    const { call, account } = await setup();
    await call('PUT', '/v1/me/stats', {
      token: account.recoveryCode,
      body: stats({ goal: 50, days: [day('2026-10-20', 20, 20), day('2026-10-21', 20, 50)] }),
    });

    assert.equal((await board(call, account.recoveryCode))[0].goalDays, 1);
  });

  it('ponowny zapis nadpisuje dzien, nie dubluje go', async () => {
    const { db, call, account } = await setup();
    await call('PUT', '/v1/me/stats', { token: account.recoveryCode, body: stats() });
    await call('PUT', '/v1/me/stats', { token: account.recoveryCode, body: stats({ days: [day(TODAY, 40)] }) });

    const rows = db.raw.prepare('SELECT day, answers FROM days ORDER BY day').all();
    assert.deepEqual(
      rows.map((row) => [row.day, row.answers]),
      [
        ['2026-10-19', 25],
        ['2026-10-20', 30],
        ['2026-10-21', 5],
        [TODAY, 40],
      ]
    );
  });

  it('seria wyslana dawno temu juz nie trwa', async () => {
    const { call, account } = await setup();
    await call('PUT', '/v1/me/stats', { token: account.recoveryCode, body: stats({ streak: 12 }) });

    assert.equal((await board(call, account.recoveryCode, shiftDay(TODAY, 2)))[0].streak, 12, 'dwa dni — moze trwac');
    assert.equal((await board(call, account.recoveryCode, shiftDay(TODAY, 3)))[0].streak, 0, 'trzy — nie');
  });

  it('obcy nie widzi nikogo poza soba', async () => {
    const { call } = await friends();
    const stranger = await signUp(call, 'Obcy');

    assert.deepEqual((await board(call, stranger.recoveryCode)).map((p) => p.name), ['Obcy']);
  });

  it('zly tydzien — 400', async () => {
    const { call, account } = await setup();

    assert.equal((await call('GET', '/v1/leaderboard?week=2026-13-01&today=x', { token: account.recoveryCode })).status, 400);
  });
});

describe('usuniecie konta', () => {
  it('znika wszystko, kod przestaje dzialac, znajomi go nie widza', async () => {
    const { db, call, account } = await setup();
    const ola = await signUp(call, 'Ola');
    await call('POST', '/v1/friends', { token: ola.recoveryCode, body: { friendCode: account.friendCode } });
    await call('PUT', '/v1/me/stats', { token: account.recoveryCode, body: stats() });

    assert.equal((await call('DELETE', '/v1/me', { token: account.recoveryCode })).status, 204);
    assert.equal((await call('GET', '/v1/me', { token: account.recoveryCode })).status, 401);
    assert.deepEqual((await board(call, ola.recoveryCode)).map((p) => p.name), ['Ola']);

    const count = (table: string) =>
      (db.raw.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${table === 'users' ? 'id' : 'user_id'} = ?`).get(account.id) as {
        n: number;
      }).n;
    assert.deepEqual([count('users'), count('days'), count('friends')], [0, 0, 0]);
  });
});

describe('protokol', () => {
  it('modul glowny eksportuje tylko handler — inaczej workerd nie wstanie', async () => {
    assert.deepEqual(Object.keys(await import('../src/index.ts')), ['default']);
  });

  it('nieznana sciezka 404, zla metoda 405, zly JSON 400, za duze 413', async () => {
    const { call, account } = await setup();
    const token = account.recoveryCode;

    assert.equal((await call('GET', '/v1/nic', { token })).status, 404);
    assert.equal((await call('GET', '/v1/accounts')).status, 405);
    assert.deepEqual((await call('PATCH', '/v1/me', { token, body: '{nie json' })).body, { error: 'bad-json' });
    assert.equal((await call('PATCH', '/v1/me', { token, body: { name: 'x'.repeat(20_000) } })).status, 413);
  });
});
