import * as Speech from 'expo-speech';
import { useEffect, useState } from 'react';

/**
 * Which languages this phone can actually speak, as the tags its engine reports.
 *
 * `null` means "not known yet" and stays `null` if the engine refuses to say —
 * some Android engines throw, and some answer with an empty list until they
 * have warmed up. Both are reported as unknown rather than as "no voices",
 * because the one thing this must never do is disable a button that would have
 * worked. See `matchVoice` in `src/lib/speech.ts` for what is done with it.
 *
 * Read once per screen. The set changes only when somebody installs a voice in
 * system settings, which they cannot do without leaving the app.
 */
export function useVoices(): string[] | null {
  const [voices, setVoices] = useState<string[] | null>(null);

  useEffect(() => {
    let alive = true;

    Speech.getAvailableVoicesAsync()
      .then((available) => {
        if (!alive) return;

        const tags = available
          .map((voice) => voice.language)
          .filter((language): language is string => Boolean(language));

        // An empty answer is not an answer: engines report nothing until the
        // first utterance, and treating that as "no voices" would grey out the
        // whole feature on a phone that speaks perfectly well.
        setVoices(tags.length > 0 ? tags : null);
      })
      .catch(() => {
        if (alive) setVoices(null);
      });

    return () => {
      alive = false;
    };
  }, []);

  return voices;
}
