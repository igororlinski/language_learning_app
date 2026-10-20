import * as SecureStore from 'expo-secure-store';
import { useEffect, useSyncExternalStore } from 'react';

import { cleanKeys, NO_KEYS, type AiKeys } from '@/lib/ai-keys';

/**
 * Where the user's AI keys live: the phone's secure storage — Android Keystore
 * encryption, left out of cloud backups, gone with the app (`expo-secure-store`).
 * Never the database, which is a plain file and a future export.
 *
 * Kept apart from `ai-keys.ts` because this is the one half with a native
 * module in it: the tests run without a device and never import it.
 *
 * The keys are held in memory once read, and screens follow them through
 * `useAiKeys`, so saving on the settings screen re-enables the card editor's
 * buttons without anyone reloading anything.
 */

/** One storage entry per key. Secure-store keys allow only `[A-Za-z0-9._-]`. */
const STORAGE: Record<keyof AiKeys, string> = {
  gemini: 'ai.gemini-key',
  cloudflareAccount: 'ai.cloudflare-account',
  cloudflareToken: 'ai.cloudflare-token',
  lmStudioUrl: 'ai.lmstudio-url',
  lmStudioToken: 'ai.lmstudio-token',
};

const FIELDS = Object.keys(STORAGE) as (keyof AiKeys)[];

let current: AiKeys | null = null;
let loading: Promise<AiKeys> | null = null;
const listeners = new Set<() => void>();

const publish = (keys: AiKeys) => {
  current = keys;
  listeners.forEach((listener) => listener());
};

/** Reads every key once; later calls share the first read. */
export function loadAiKeys(): Promise<AiKeys> {
  if (current) return Promise.resolve(current);

  loading ??= Promise.all(
    FIELDS.map((field) => SecureStore.getItemAsync(STORAGE[field]).catch(() => null))
  ).then((values) => {
    const keys = { ...NO_KEYS };

    FIELDS.forEach((field, index) => {
      keys[field] = values[index] ?? '';
    });

    publish(keys);

    return keys;
  });

  return loading;
}

/**
 * Stores the keys, cleaned, and tells every screen. An emptied field is
 * deleted rather than stored empty — the same "none" either way, but nothing
 * lingers in the keystore.
 */
export async function saveAiKeys(keys: AiKeys): Promise<AiKeys> {
  const clean = cleanKeys(keys);

  await Promise.all(
    FIELDS.map((field) =>
      clean[field]
        ? SecureStore.setItemAsync(STORAGE[field], clean[field])
        : SecureStore.deleteItemAsync(STORAGE[field])
    )
  );

  publish(clean);

  return clean;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const snapshot = () => current;

/**
 * The keys, or null until the first read lands. Null is "not known yet", which
 * the screens treat as "no keys" — a button greyed out for the few
 * milliseconds of a read is better than one that works and then refuses.
 */
export function useAiKeys(): AiKeys | null {
  const keys = useSyncExternalStore(subscribe, snapshot, snapshot);

  useEffect(() => {
    void loadAiKeys();
  }, []);

  return keys;
}
