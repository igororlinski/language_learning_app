import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { budgetColor, Spacing } from '@/constants/theme';
import { aiUsageQuery, appSettingsQuery, textSourceFrom } from '@/db/queries';
import { useNow } from '@/hooks/use-now';
import { usageFrom, type AiBudget } from '@/lib/ai-usage';

/**
 * A quiet one-line readout of today's remaining AI budget, for the one place it
 * is actually spent — the mnemonic flow.
 *
 * It reads the counters the phone keeps itself (`src/lib/ai-usage.ts`), live
 * from the database, so it moves the moment a round is recorded — no request,
 * no spinner, nothing to fail in a sheet whose job is choosing.
 */
export function AiUsageBar() {
  const now = useNow();
  const { data: rows } = useLiveQuery(aiUsageQuery());
  const usage = usageFrom(rows, new Date(now));

  // With LM Studio writing the associations, the Gemini allowance is not what
  // this sheet is spending — naming it would answer the wrong question.
  const { data: settings } = useLiveQuery(appSettingsQuery());
  const local = textSourceFrom(settings).provider === 'lmstudio';

  return (
    <View style={styles.bar}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.text}>
        Zostało dziś: obrazy <Percent budget={usage.images} /> · skojarzenia{' '}
        {local ? 'LM Studio' : <Percent budget={usage.text} />}
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
