import { useSyncExternalStore } from 'react';

/**
 * A counter that goes up whenever the whole database is replaced — a restore.
 *
 * A restore copies another database over the live one with SQLite's backup
 * API, which does not fire the change listener `useLiveQuery` hangs on, so
 * every mounted screen would go on showing the decks that just stopped
 * existing. The root layout keys the navigator on this number instead: one
 * bump remounts every screen on fresh queries, which is exactly what "the data
 * is a different data now" means.
 */
let generation = 0;
const listeners = new Set<() => void>();

export function databaseReplaced(): void {
  generation += 1;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useDataGeneration(): number {
  return useSyncExternalStore(subscribe, () => generation);
}
