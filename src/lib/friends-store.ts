import * as SecureStore from 'expo-secure-store';
import { useEffect, useSyncExternalStore } from 'react';

import { badgesQuery, getDailyGoal, studyDaysQuery } from '@/db/queries';
import { FriendsError, statsUpload, uploadStats, type Account } from '@/lib/friends';

/**
 * The account on this phone, and the background upload.
 *
 * The recovery code is the account's only credential, so it lives where the
 * AI keys do: secure storage, never the database (which is a plain file and
 * goes into backups). Kept apart from `friends.ts` because this is the half
 * with native modules in it; the tests never import it.
 */

/** Secure-store keys allow only `[A-Za-z0-9._-]`. */
const STORAGE_KEY = 'friends.account';

/** Undefined until the first read; null once read and there is no account. */
let current: Account | null | undefined;
let loading: Promise<Account | null> | null = null;
const listeners = new Set<() => void>();

const publish = (account: Account | null) => {
  current = account;
  listeners.forEach((listener) => listener());
};

function parseAccount(value: string | null): Account | null {
  if (!value) return null;

  try {
    const row = JSON.parse(value) as Partial<Account>;
    const { id, name, friendCode, recoveryCode } = row;

    return typeof id === 'string' &&
      typeof name === 'string' &&
      typeof friendCode === 'string' &&
      typeof recoveryCode === 'string'
      ? { id, name, friendCode, recoveryCode }
      : null;
  } catch {
    return null;
  }
}

export function loadAccount(): Promise<Account | null> {
  if (current !== undefined) return Promise.resolve(current);

  loading ??= SecureStore.getItemAsync(STORAGE_KEY)
    .catch(() => null)
    .then((value) => {
      const account = parseAccount(value);
      publish(account);
      return account;
    });

  return loading;
}

/** Stores the account (or forgets it, with null) and tells every screen. */
export async function saveAccount(account: Account | null): Promise<void> {
  if (account) await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(account));
  else await SecureStore.deleteItemAsync(STORAGE_KEY);

  publish(account);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const snapshot = () => current;

/** The account, null without one, undefined until the first read lands. */
export function useAccount(): Account | null | undefined {
  const account = useSyncExternalStore(subscribe, snapshot, snapshot);

  useEffect(() => {
    void loadAccount();
  }, []);

  return account;
}

let uploading: Promise<void> | null = null;

/**
 * Sends today's numbers, if there is an account — after a session, on start
 * and when "Znajomi" opens. Never throws and never makes anyone wait: a failed
 * upload is repeated by the next one, which carries the same two weeks.
 *
 * Two calls at once share one request — the second would send the same rows.
 */
export function syncStats(now = Date.now()): Promise<void> {
  uploading ??= (async () => {
    try {
      const account = await loadAccount();
      if (!account) return;

      const stats = statsUpload(
        studyDaysQuery().all(),
        getDailyGoal(now),
        badgesQuery()
          .all()
          .map((row) => row.id),
        now
      );

      await uploadStats(account, stats);
    } catch (error) {
      // Offline is the normal case here, not an error worth a word.
      if (!(error instanceof FriendsError)) console.warn('syncStats', error);
    } finally {
      uploading = null;
    }
  })();

  return uploading;
}
