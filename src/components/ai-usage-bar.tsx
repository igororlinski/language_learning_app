import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { budgetColor, Spacing } from '@/constants/theme';
import { fetchUsage, type AiBudget, type AiUsage } from '@/lib/ai-worker';

/**
 * A quiet one-line readout of today's remaining AI budget, for the one place it
 * is actually spent — the mnemonic flow. It fetches on mount and again whenever
 * `refreshToken` changes, so the screen can refresh it after each generation by
 * bumping the number.
 *
 * It renders nothing until it has real, tracked figures. A sheet whose job is
 * choosing an association must not sprout a spinner or an error for a number off
 * to the side, and a Worker with no usage store (`tracking: false`) has nothing
 * to show here — the full "Limity AI" screen is where that absence is explained.
 */
export function AiUsageBar({ refreshToken = 0 }: { refreshToken?: number }) {
  const [usage, setUsage] = useState<AiUsage | null>(null);

  useEffect(() => {
    let alive = true;

    fetchUsage()
      .then((next) => alive && setUsage(next))
      // A failed side figure is not worth a word: the generation itself already
      // reports its own failures loudly. Drop back to showing nothing.
      .catch(() => alive && setUsage(null));

    return () => {
      alive = false;
    };
  }, [refreshToken]);

  if (!usage || !usage.tracking) return null;

  return (
    <View style={styles.bar}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.text}>
        Zostało dziś: obrazy <Percent budget={usage.images} /> · skojarzenia{' '}
        <Percent budget={usage.text} />
      </ThemedText>
    </View>
  );
}

/** The percentage itself, coloured the same way the full screen colours its bars. */
function Percent({ budget }: { budget: AiBudget }) {
  return (
    <ThemedText type="smallBold" style={{ color: budgetColor(budget.pctLeft) }}>
      {budget.pctLeft}%
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  bar: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
  },
  text: {
    textAlign: 'center',
  },
});
