import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

/** Nothing to subscribe to — hydration happens once and never reverts. */
const subscribe = () => () => {};

/**
 * Static web rendering has no colour scheme, so the value has to be recomputed
 * on the client. `useSyncExternalStore` reports that hydration happened without
 * a setState inside an effect: the server snapshot is `false`, the client's is
 * `true`, and React swaps them during hydration on its own.
 */
export function useColorScheme() {
  const hasHydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );

  const colorScheme = useRNColorScheme();

  return hasHydrated ? colorScheme : 'light';
}
