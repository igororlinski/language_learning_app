/**
 * The app's server: anonymous accounts, friends and their ranking.
 *
 * It holds **numbers only** — per study day: answers, the goal, study time —
 * plus a name, a streak and badge ids. No deck names, no card content. The
 * phone sends them in the background and never waits on this Worker for
 * anything it needs to study; offline-first stays the rule.
 *
 *   POST   /v1/accounts          { name }        → 201 { id, name, friendCode, recoveryCode }
 *   GET    /v1/me                                → { id, name, friendCode }   (also: recovery)
 *   PATCH  /v1/me                { name }        → { id, name, friendCode }
 *   DELETE /v1/me                                → 204, everything about the account gone
 *   POST   /v1/me/friend-code                    → { friendCode }, the old one stops working
 *   PUT    /v1/me/stats          Stats           → 204
 *   POST   /v1/friends           { friendCode }  → 201 (200 if already) { friend: { id, name } }
 *   DELETE /v1/friends/:id                       → 204
 *   GET    /v1/leaderboard?period=&today=        → { period, from, people: Person[] }
 *
 * Everything but `POST /v1/accounts` takes `Authorization: Bearer <recovery
 * code>`. Errors are `{ error: '<code>' }` with a fitting status; the app turns
 * the code into Polish.
 */
import {
  FRIEND_LENGTH,
  hashCode,
  newFriendCode,
  newId,
  newRecoveryCode,
  normalizeCode,
  RECOVERY_LENGTH,
} from './codes.ts';
import type { D1Database, Env } from './db.ts';
import { MAX_FRIENDS, SIGNUPS_PER_IP, WRONG_CODES_PER_DAY } from './limits.ts';
import {
  cleanName,
  isDayKey,
  KEEP_DAYS,
  monthStart,
  parseStats,
  shiftDay,
  utcDay,
  weekStart,
} from './validate.ts';

/** Bodies are a name or two weeks of numbers; anything bigger is not ours. */
const MAX_BODY_BYTES = 16_384;

/**
 * A streak is shown only while it can still be alive: the phone uploads after
 * every session and on every start, so one last sent before yesterday belongs
 * to someone who has stopped — a whole day without the goal ends a streak, and
 * yesterday's can still be carried on today.
 */
const STREAK_FRESH_DAYS = 1;

type User = { id: string; name: string; friendCode: string };

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, code: string) {
    super(code);
    this.status = status;
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

const empty = () => new Response(null, { status: 204 });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env, Date.now());
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);

      console.error(error);
      return json({ error: 'internal' }, 500);
    }
  },
};

async function route(request: Request, env: Env, now: number): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;
  const db = env.DB;

  if (path === '/v1/accounts') {
    allow(method, 'POST');
    return createAccount(db, request, now);
  }

  if (path === '/v1/me') {
    allow(method, 'GET', 'PATCH', 'DELETE');
    const user = await authenticate(db, request);

    if (method === 'GET') return json(user);
    if (method === 'PATCH') return rename(db, user, await readBody(request));

    return deleteAccount(db, user);
  }

  if (path === '/v1/me/friend-code') {
    allow(method, 'POST');
    return json({ friendCode: await replaceFriendCode(db, await authenticate(db, request)) });
  }

  if (path === '/v1/me/stats') {
    allow(method, 'PUT');
    return saveStats(db, await authenticate(db, request), await readBody(request), now);
  }

  if (path === '/v1/friends') {
    allow(method, 'POST');
    return addFriend(db, await authenticate(db, request), await readBody(request), now);
  }

  const friend = /^\/v1\/friends\/([0-9a-f]{32})$/.exec(path);

  if (friend) {
    allow(method, 'DELETE');
    const user = await authenticate(db, request);

    await db.batch([
      db.prepare('DELETE FROM friends WHERE user_id = ? AND friend_id = ?').bind(user.id, friend[1]),
      db.prepare('DELETE FROM friends WHERE user_id = ? AND friend_id = ?').bind(friend[1], user.id),
    ]);

    return empty();
  }

  if (path === '/v1/leaderboard') {
    allow(method, 'GET');
    return leaderboard(db, await authenticate(db, request), url);
  }

  throw new HttpError(404, 'not-found');
}

function allow(method: string, ...allowed: string[]) {
  if (!allowed.includes(method)) throw new HttpError(405, 'method-not-allowed');
}

async function readBody(request: Request): Promise<unknown> {
  const text = await request.text();

  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new HttpError(413, 'too-large');

  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'bad-json');
  }
}

const field = (body: unknown, key: string): unknown =>
  typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[key] : undefined;

/* --------------------------------------------------------------- accounts */

async function authenticate(db: D1Database, request: Request): Promise<User> {
  const header = request.headers.get('authorization') ?? '';
  const code = normalizeCode(header.replace(/^Bearer\s+/i, ''), RECOVERY_LENGTH);

  if (!code) throw new HttpError(401, 'unauthorized');

  const user = await db
    .prepare('SELECT id, name, friend_code AS friendCode FROM users WHERE secret_hash = ?')
    .bind(await hashCode(code))
    .first<User>();

  if (!user) throw new HttpError(401, 'unauthorized');

  return user;
}

/**
 * Bumps a daily counter and says whether it is still within `cap`. Counting
 * first and checking after keeps it one statement: two requests at once cannot
 * both slip under the cap.
 */
async function withinLimit(db: D1Database, key: string, cap: number, now: number): Promise<boolean> {
  const row = await db
    .prepare(
      `INSERT INTO limits (key, day, count) VALUES (?, ?, 1)
       ON CONFLICT (key, day) DO UPDATE SET count = count + 1
       RETURNING count`
    )
    .bind(key, utcDay(now))
    .first<{ count: number }>();

  return (row?.count ?? 1) <= cap;
}

/** How often a counter has been bumped today, without bumping it. */
async function usedToday(db: D1Database, key: string, now: number): Promise<number> {
  const row = await db
    .prepare('SELECT count FROM limits WHERE key = ? AND day = ?')
    .bind(key, utcDay(now))
    .first<{ count: number }>();

  return row?.count ?? 0;
}

async function createAccount(db: D1Database, request: Request, now: number): Promise<Response> {
  const name = cleanName(field(await readBody(request), 'name'));

  if (!name) throw new HttpError(400, 'bad-name');

  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';

  if (!(await withinLimit(db, `signup:${ip}`, SIGNUPS_PER_IP, now))) {
    throw new HttpError(429, 'too-many-accounts');
  }

  // Yesterday's counters are no use to anyone; this is as good a moment as any.
  await db.prepare('DELETE FROM limits WHERE day < ?').bind(shiftDay(utcDay(now), -1)).run();

  const id = newId();
  const recoveryCode = newRecoveryCode();
  const secretHash = await hashCode(recoveryCode);

  // A clash of 40-bit friend codes is a once-in-a-lifetime event, but the
  // UNIQUE constraint would turn it into a failed sign-up; a fresh code is free.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const friendCode = newFriendCode();

    try {
      await db
        .prepare(
          `INSERT INTO users (id, name, secret_hash, friend_code, created_at, seen_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(id, name, secretHash, friendCode, now, now)
        .run();

      return json({ id, name, friendCode, recoveryCode }, 201);
    } catch (error) {
      if (!String(error).includes('UNIQUE')) throw error;
    }
  }

  throw new HttpError(500, 'internal');
}

async function rename(db: D1Database, user: User, body: unknown): Promise<Response> {
  const name = cleanName(field(body, 'name'));

  if (!name) throw new HttpError(400, 'bad-name');

  await db.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, user.id).run();

  return json({ ...user, name });
}

async function deleteAccount(db: D1Database, user: User): Promise<Response> {
  await db.batch([
    db.prepare('DELETE FROM friends WHERE user_id = ? OR friend_id = ?').bind(user.id, user.id),
    db.prepare('DELETE FROM days WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM limits WHERE key = ?').bind(`friend:${user.id}`),
    db.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
  ]);

  return empty();
}

async function replaceFriendCode(db: D1Database, user: User): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const friendCode = newFriendCode();

    try {
      await db.prepare('UPDATE users SET friend_code = ? WHERE id = ?').bind(friendCode, user.id).run();
      return friendCode;
    } catch (error) {
      if (!String(error).includes('UNIQUE')) throw error;
    }
  }

  throw new HttpError(500, 'internal');
}

/* ------------------------------------------------------------------ stats */

async function saveStats(db: D1Database, user: User, body: unknown, now: number): Promise<Response> {
  const stats = parseStats(body);

  if (!stats) throw new HttpError(400, 'bad-stats');

  await db.batch([
    db
      .prepare(
        `UPDATE users SET goal = ?, streak = ?, streak_day = ?, badges = ?, seen_at = ?,
           points = coalesce(?, points), study_ms = coalesce(?, study_ms)
         WHERE id = ?`
      )
      .bind(
        stats.goal,
        stats.streak,
        stats.today,
        JSON.stringify(stats.badges),
        now,
        stats.points,
        stats.studyMs,
        user.id
      ),
    ...stats.days.map((day) =>
      db
        .prepare(
          `INSERT INTO days (user_id, day, answers, goal, study_ms) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (user_id, day) DO UPDATE SET
             answers = excluded.answers, goal = excluded.goal, study_ms = excluded.study_ms`
        )
        .bind(user.id, day.day, day.answers, day.goal, day.studyMs)
    ),
    db
      .prepare('DELETE FROM days WHERE user_id = ? AND day < ?')
      .bind(user.id, shiftDay(stats.today, -KEEP_DAYS)),
  ]);

  return empty();
}

/* ---------------------------------------------------------------- friends */

async function addFriend(db: D1Database, user: User, body: unknown, now: number): Promise<Response> {
  const code = normalizeCode(field(body, 'friendCode'), FRIEND_LENGTH);

  if (!code) throw new HttpError(400, 'bad-code');

  const limitKey = `friend:${user.id}`;

  if ((await usedToday(db, limitKey, now)) >= WRONG_CODES_PER_DAY) {
    throw new HttpError(429, 'too-many-attempts');
  }

  const friend = await db
    .prepare('SELECT id, name FROM users WHERE friend_code = ?')
    .bind(code)
    .first<{ id: string; name: string }>();

  if (!friend) {
    await withinLimit(db, limitKey, WRONG_CODES_PER_DAY, now);
    throw new HttpError(404, 'unknown-code');
  }

  if (friend.id === user.id) throw new HttpError(400, 'own-code');

  const already = await db
    .prepare('SELECT 1 AS yes FROM friends WHERE user_id = ? AND friend_id = ?')
    .bind(user.id, friend.id)
    .first();

  if (already) return json({ friend });

  const counts = await db
    .prepare('SELECT user_id AS id, count(*) AS count FROM friends WHERE user_id IN (?, ?) GROUP BY user_id')
    .bind(user.id, friend.id)
    .all<{ id: string; count: number }>();

  if (counts.results.some((row) => row.count >= MAX_FRIENDS)) throw new HttpError(409, 'too-many-friends');

  await db.batch([
    db
      .prepare('INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?)')
      .bind(user.id, friend.id, now),
    db
      .prepare('INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?)')
      .bind(friend.id, user.id, now),
  ]);

  return json({ friend }, 201);
}

/* ------------------------------------------------------------ leaderboard */

export type Period = 'week' | 'month' | 'all';

const PERIODS: readonly Period[] = ['week', 'month', 'all'];

export type Person = {
  id: string;
  name: string;
  me: boolean;
  /**
   * What the ranking is by: a day's goal, for every day of the period the
   * goal was met — so a bigger goal is worth more, and only a met one counts.
   */
  points: number;
  /** Days of the period with the goal met; null for all time. */
  goalDays: number | null;
  /** The goal set now; null before the first upload. */
  goal: number | null;
  todayMet: boolean;
  streak: number;
  studyMs: number;
  badges: string[];
};

/**
 * The viewer and their friends over one period, best first: points, then the
 * current streak, then by name.
 *
 * `period` is this week (from Monday), this month or all time; `today` is the
 * **viewer's** study day, and the period runs up to it. Everyone's days are
 * their own phone's local dates, so with friends in one country they line up;
 * across time zones a day is off by a few hours, and that is fine for a game
 * between friends.
 *
 * Week and month are counted here, from the days; all time is what each phone
 * last sent, worked out from its whole history — the server keeps a month.
 */
async function leaderboard(db: D1Database, user: User, url: URL): Promise<Response> {
  const asked = url.searchParams.get('period') ?? 'week';
  const today = url.searchParams.get('today');

  if (!isDayKey(today)) throw new HttpError(400, 'bad-day');
  if (!PERIODS.includes(asked as Period)) throw new HttpError(400, 'bad-period');

  const period = asked as Period;
  const from = period === 'week' ? weekStart(today) : period === 'month' ? monthStart(today) : null;
  const circle = 'SELECT ? UNION SELECT friend_id FROM friends WHERE user_id = ?';

  const [people, days] = await Promise.all([
    db
      .prepare(
        `SELECT id, name, goal, streak, streak_day AS streakDay, badges, points,
           study_ms AS studyMs FROM users
         WHERE id IN (${circle})`
      )
      .bind(user.id, user.id)
      .all<{
        id: string;
        name: string;
        goal: number | null;
        streak: number;
        streakDay: string | null;
        badges: string;
        points: number;
        studyMs: number;
      }>(),
    db
      .prepare(
        `SELECT user_id AS userId, day, answers, goal, study_ms AS studyMs FROM days
         WHERE user_id IN (${circle}) AND day >= ? AND day <= ?`
      )
      // All time still reads today, for "cel dziś ✓".
      .bind(user.id, user.id, from ?? today, today)
      .all<{ userId: string; day: string; answers: number; goal: number; studyMs: number }>(),
  ]);

  const met = (row: { answers: number; goal: number }) => row.answers > 0 && row.answers >= row.goal;
  const freshSince = shiftDay(today, -STREAK_FRESH_DAYS);

  const ranked: Person[] = people.results.map((person) => {
    const own = days.results.filter((row) => row.userId === person.id);
    const metDays = own.filter(met);

    return {
      id: person.id,
      name: person.name,
      me: person.id === user.id,
      points: from ? metDays.reduce((sum, row) => sum + row.goal, 0) : person.points,
      goalDays: from ? metDays.length : null,
      goal: person.goal,
      todayMet: own.some((row) => row.day === today && met(row)),
      streak: person.streakDay != null && person.streakDay >= freshSince ? person.streak : 0,
      studyMs: from ? own.reduce((sum, row) => sum + row.studyMs, 0) : person.studyMs,
      badges: parseBadges(person.badges),
    };
  });

  ranked.sort((a, b) => b.points - a.points || b.streak - a.streak || a.name.localeCompare(b.name, 'pl'));

  return json({ period, from, people: ranked });
}

function parseBadges(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);

    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}
