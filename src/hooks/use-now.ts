import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

/**
 * A timestamp that refreshes when the screen regains focus and then on a
 * timer, so "due" counters stay accurate while a screen stays open.
 */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());

  useFocusEffect(
    useCallback(() => {
      setNow(Date.now());
      const id = setInterval(() => setNow(Date.now()), intervalMs);
      return () => clearInterval(id);
    }, [intervalMs])
  );

  return now;
}
