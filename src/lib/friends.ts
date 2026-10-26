import { AiError, send, type Reply } from '@/lib/ai-transport';
import { dayKey, shiftDay, streak, weekKey, type StudyDay } from '@/lib/goals';

/**
 * Friends and the weekly ranking: what the app sends to our server
 * (`server/`), what it accepts back, and what each failure is called.
 *
 * Pure, like `ai-text.ts`: the account itself lives in secure storage
 * (`friends-store.ts`, the native half), and the request goes through the
 * one door out of the app, `send` in `ai-transport.ts`.
 *
 * The server only ever gets **numbers** — per study day: answers, the goal,
 * study time — plus the name, the streak and badge ids. Nothing the app needs
 * waits on it: the upload runs in the background and a failed one is simply
 * repeated by the next.
 */

/**
 * The server, deployed 2026-10-25. A constant in code rather than in
 * `app.json`, for the same reason the Worker's address was: reading config
 * through `expo-constants` would give this module a native dependency and
 * take it out of the tests.
 */
export const SERVER_URL = 'https://fiszki-server.orli-dev.workers.dev';

/** How long the app waits for the server: it answers in milliseconds or not at all. */
const TIMEOUT_MS = 15_000;

/** Days sent at once — the server takes at most two weeks, the current one and the last. */
export const UPLOAD_DAYS = 14;

const DAY_MS = 86_400_000;
const MAX_ANSWERS = 100_000;
const MAX_GOAL = 1000;

/* ----------------------------------------------------------------- errors */

export type FriendsFailure =
  | 'network'
  | 'timeout'
  | 'unauthorized'
  | 'bad-name'
  | 'bad-code'
  | 'unknown-code'
  | 'own-code'
  | 'too-many-friends'
  | 'too-many-attempts'
  | 'too-many-accounts'
  | 'server';

const MESSAGES: Record<FriendsFailure, string> = {
  network: 'Brak połączenia z serwerem.',
  timeout: 'Serwer nie odpowiedział w porę. Spróbuj jeszcze raz.',
  unauthorized: 'Serwer nie zna tego kodu odzyskiwania.',
  'bad-name': 'Nazwa musi mieć od 1 do 30 znaków.',
  'bad-code': 'To nie wygląda na kod — sprawdź, czy jest cały.',
  'unknown-code': 'Nie ma nikogo z takim kodem.',
  'own-code': 'To twój własny kod.',
  'too-many-friends': 'Limit znajomych to 50.',
  'too-many-attempts': 'Za dużo błędnych kodów na dziś. Spróbuj jutro.',
  'too-many-accounts': 'Za dużo nowych kont z tej sieci na dziś. Spróbuj jutro.',
  server: 'Serwer odpowiedział błędem. Spróbuj później.',
};

export class FriendsError extends Error {
  constructor(readonly failure: FriendsFailure) {
    super(MESSAGES[failure]);
    this.name = 'FriendsError';
  }
}

/** The server's `{ error: '<code>' }` as one of ours; anything unknown is "the server failed". */
function failureOf(reply: Reply): FriendsFailure {
  const code =
    reply.body && typeof reply.body === 'object' ? (reply.body as { error?: unknown }).error : undefined;

  if (reply.status === 401) return 'unauthorized';

  return typeof code === 'string' && code in MESSAGES && code !== 'network' && code !== 'timeout'
    ? (code as FriendsFailure)
    : 'server';
}

/** One request to the server; a failure of any kind arrives as a `FriendsError`. */
async function call(
  path: string,
  {
    method = 'GET',
    code,
    body,
  }: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; code?: string; body?: unknown } = {}
): Promise<unknown> {
  let reply: Reply;

  try {
    reply = await send(`${SERVER_URL}${path}`, {
      method,
      headers: code ? { Authorization: `Bearer ${code}` } : {},
      body,
      timeoutMs: TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof AiError) throw new FriendsError(error.failure === 'timeout' ? 'timeout' : 'network');
    throw error;
  }

  if (!reply.ok) throw new FriendsError(failureOf(reply));

  return reply.body;
}

/* --------------------------------------------------------------- accounts */

/** What the phone keeps about its account. The recovery code is the only credential. */
export type Account = { id: string; name: string; friendCode: string; recoveryCode: string };

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** `{ id, name, friendCode }` out of a reply, or a failure if any of it is missing. */
function profileOf(body: unknown): Omit<Account, 'recoveryCode'> {
  const row = (body ?? {}) as Record<string, unknown>;
  const profile = { id: text(row.id), name: text(row.name), friendCode: text(row.friendCode) };

  if (!profile.id || !profile.name || !profile.friendCode) throw new FriendsError('server');

  return profile;
}

/**
 * A recovery code as typed: upper case, spaces dropped, the letters Crockford
 * base32 leaves out read as the digits they look like (O → 0, I and L → 1),
 * grouped by four with dashes. The server forgives all of it too; this is
 * what gets stored and shown back.
 */
export function cleanRecoveryCode(input: string): string {
  const bare = input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');

  return bare.match(/.{1,4}/g)?.join('-') ?? '';
}

export async function createAccount(name: string): Promise<Account> {
  const body = (await call('/v1/accounts', { method: 'POST', body: { name: name.trim() } })) as Record<
    string,
    unknown
  >;
  const recoveryCode = text(body?.recoveryCode);

  if (!recoveryCode) throw new FriendsError('server');

  return { ...profileOf(body), recoveryCode };
}

/** Signs in on this phone with a code from another one (or from before a reinstall). */
export async function recoverAccount(recoveryCode: string): Promise<Account> {
  const code = cleanRecoveryCode(recoveryCode);

  return { ...profileOf(await call('/v1/me', { code })), recoveryCode: code };
}

export async function renameAccount(account: Account, name: string): Promise<Account> {
  const profile = profileOf(
    await call('/v1/me', { method: 'PATCH', code: account.recoveryCode, body: { name: name.trim() } })
  );

  return { ...account, ...profile };
}

export async function deleteAccount(account: Account): Promise<void> {
  await call('/v1/me', { method: 'DELETE', code: account.recoveryCode });
}

/** A fresh code for friends; the old one stops working. */
export async function replaceFriendCode(account: Account): Promise<Account> {
  const body = (await call('/v1/me/friend-code', { method: 'POST', code: account.recoveryCode })) as Record<
    string,
    unknown
  >;
  const friendCode = text(body?.friendCode);

  if (!friendCode) throw new FriendsError('server');

  return { ...account, friendCode };
}

/* ---------------------------------------------------------------- friends */

/** Adds a friend by their code, both ways at once; says who it was. */
export async function addFriend(account: Account, friendCode: string): Promise<string> {
  const body = (await call('/v1/friends', {
    method: 'POST',
    code: account.recoveryCode,
    body: { friendCode: friendCode.trim() },
  })) as { friend?: { name?: unknown } } | null;

  return text(body?.friend?.name);
}

export async function removeFriend(account: Account, friendId: string): Promise<void> {
  await call(`/v1/friends/${encodeURIComponent(friendId)}`, { method: 'DELETE', code: account.recoveryCode });
}

/* ------------------------------------------------------------------ stats */

/** One upload, in the shape `PUT /v1/me/stats` takes. */
export type StatsUpload = {
  today: string;
  goal: number;
  streak: number;
  badges: string[];
  days: { day: string; answers: number; goal: number; studyMs: number }[];
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(Number.isFinite(value) ? value : min)));

/**
 * What goes to the server: today, the goal, the streak as this phone counts
 * it (with the freeze, which the server knows nothing about), the badges, and
 * the last two weeks of `study_days`.
 *
 * Today is held to the goal set now, as everywhere else; past days to their
 * own. Every value is brought within what the server accepts, because it
 * refuses a whole upload for one value out of range.
 */
export function statsUpload(
  days: readonly (StudyDay & { studyMs: number })[],
  goal: number,
  badges: readonly string[],
  now: number
): StatsUpload {
  const today = dayKey(now);
  const oldest = shiftDay(today, 1 - UPLOAD_DAYS);

  return {
    today,
    goal: clamp(goal, 1, MAX_GOAL),
    streak: streak(days, goal, now).current,
    badges: [...new Set(badges.filter((id) => /^[a-zA-Z]{1,20}-\d{1,6}$/.test(id)))],
    days: days
      .filter((row) => row.day >= oldest && row.day <= today)
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((row) => ({
        day: row.day,
        answers: clamp(row.answers, 0, MAX_ANSWERS),
        goal: clamp(row.day === today ? goal : row.goal, 1, MAX_GOAL),
        studyMs: clamp(row.studyMs, 0, DAY_MS),
      })),
  };
}

export async function uploadStats(account: Account, stats: StatsUpload): Promise<void> {
  await call('/v1/me/stats', { method: 'PUT', code: account.recoveryCode, body: stats });
}

/* ------------------------------------------------------------ leaderboard */

export type Person = {
  id: string;
  name: string;
  me: boolean;
  /** Days of this week with the goal met — what the ranking is by. */
  goalDays: number;
  todayMet: boolean;
  streak: number;
  studyMs: number;
  badges: string[];
};

const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** The ranking out of a reply. A row without an id or a name is dropped, not shown blank. */
export function parseLeaderboard(body: unknown): Person[] {
  const people = body && typeof body === 'object' ? (body as { people?: unknown }).people : undefined;

  if (!Array.isArray(people)) throw new FriendsError('server');

  return people.flatMap((value: unknown) => {
    const row = (value ?? {}) as Record<string, unknown>;
    const id = text(row.id);
    const name = text(row.name);

    if (!id || !name) return [];

    return [
      {
        id,
        name,
        me: row.me === true,
        goalDays: count(row.goalDays),
        todayMet: row.todayMet === true,
        streak: count(row.streak),
        studyMs: count(row.studyMs),
        badges: Array.isArray(row.badges) ? row.badges.filter((id): id is string => typeof id === 'string') : [],
      },
    ];
  });
}

/** This week (Monday to Sunday) for the viewer and their friends, best first. */
export async function fetchLeaderboard(account: Account, now: number): Promise<Person[]> {
  const today = dayKey(now);
  const query = `week=${weekKey(today)}&today=${today}`;

  return parseLeaderboard(await call(`/v1/leaderboard?${query}`, { code: account.recoveryCode }));
}
