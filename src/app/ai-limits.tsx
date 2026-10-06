import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { budgetColor, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fetchUsage, type AiBudget, type AiUsage } from '@/lib/ai-worker';

/**
 * How much of today's free AI allowances is left, as a bar and a percent.
 *
 * The allowances are a single daily pool shared by everyone who calls the
 * Worker — not a per-user quota — and they reset every day; see `ai-worker.ts`.
 * Nothing is generated here: the screen only reads `POST /usage`.
 */
export { ErrorScreen as ErrorBoundary } from '@/components/error-screen';

type Loadable =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; usage: AiUsage };

export default function AiLimitsScreen() {
  const theme = useTheme();
  const [state, setState] = useState<Loadable>({ status: 'loading' });

  // The setState calls live in the promise's callbacks, not the effect body, so
  // the mount fetch never sets state synchronously — it only lands a result once
  // the Worker answers. The Worker's own words are the only diagnosis there is
  // on a phone, so a failure is shown verbatim.
  const run = useCallback(() => {
    fetchUsage()
      .then((usage) => setState({ status: 'ready', usage }))
      .catch((error) =>
        setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      );
  }, []);

  /** The retry/refresh path: back to the spinner, then ask again. */
  const reload = useCallback(() => {
    setState({ status: 'loading' });
    run();
  }, [run]);

  useEffect(() => {
    run();
  }, [run]);

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        {state.status === 'loading' ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.accent} />
            <ThemedText type="small" themeColor="textSecondary">
              Sprawdzam limity…
            </ThemedText>
          </View>
        ) : state.status === 'error' ? (
          <View style={styles.center}>
            <ThemedText type="small" style={[styles.errorText, { color: theme.danger }]}>
              {state.message}
            </ThemedText>
            <Button title="Spróbuj ponownie" variant="secondary" onPress={reload} />
          </View>
        ) : (
          <Ready usage={state.usage} onRefresh={reload} />
        )}
      </ScrollView>
    </View>
  );
}

function Ready({ usage, onRefresh }: { usage: AiUsage; onRefresh: () => void }) {
  const theme = useTheme();

  // No store wired up on the Worker yet: the numbers would all be zero, so say
  // that plainly instead of drawing two full bars that promise everything.
  if (!usage.tracking) {
    return (
      <View style={styles.cards}>
        <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <ThemedText type="small" themeColor="textSecondary">
            Licznik zużycia nie jest jeszcze włączony w tej wersji generatora.
          </ThemedText>
        </View>
        <Button title="Odśwież" variant="secondary" onPress={onRefresh} />
      </View>
    );
  }

  return (
    <View style={styles.cards}>
      <Meter title="Obrazy" budget={usage.images} />
      <Meter title="Skojarzenia" budget={usage.text} />

      <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
        Limity są wspólne i zerują się codziennie. Gdy skończy się limit skojarzeń, nadal powstają
        — tylko słabszym modelem.
      </ThemedText>

      <Button title="Odśwież" variant="secondary" onPress={onRefresh} />
    </View>
  );
}

/**
 * A labelled bar: the fill is how much is LEFT, and its colour warns as it
 * empties. Only the percentage is shown — the raw neuron/association counts are
 * deliberately left out, a percent is the whole answer the user asked for.
 */
function Meter({ title, budget }: { title: string; budget: AiBudget }) {
  const theme = useTheme();
  const color = budgetColor(budget.pctLeft);

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <View style={styles.meterHead}>
        <ThemedText style={styles.meterTitle}>{title}</ThemedText>
        <ThemedText style={[styles.meterPct, { color }]}>{budget.pctLeft}%</ThemedText>
      </View>

      <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
        <View style={[styles.fill, { width: `${budget.pctLeft}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    padding: Spacing.three,
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  center: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.six,
  },
  errorText: {
    textAlign: 'center',
  },
  cards: {
    gap: Spacing.three,
  },
  card: {
    padding: Spacing.three,
    gap: Spacing.two,
    borderRadius: Radius.large,
    borderWidth: StyleSheet.hairlineWidth,
  },
  meterHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  meterTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  meterPct: {
    fontSize: 22,
    fontWeight: '700',
  },
  track: {
    height: 10,
    borderRadius: Radius.small,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: Radius.small,
  },
  note: {
    paddingHorizontal: Spacing.one,
  },
});
