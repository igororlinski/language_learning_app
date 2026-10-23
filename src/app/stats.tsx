import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Dropdown } from '@/components/dropdown';
import { EmptyState } from '@/components/empty-state';
import { ThemedText } from '@/components/themed-text';
import { CardStateColors, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import {
  deckNamesQuery,
  mnemonicCardsQuery,
  statsCardsQuery,
  statsLogsQuery,
} from '@/db/queries';
import { useNow } from '@/hooks/use-now';
import { useTheme } from '@/hooks/use-theme';
import { pluralize } from '@/lib/format';
import {
  cardStates,
  forecast,
  forecastLabel,
  formatDuration,
  formatPercent,
  mnemonicComparison,
  recentRetention,
  RETENTION_WINDOW_DAYS,
  STUDY_TIME_DAYS,
  streakStats,
  studyTime,
  todayStats,
  type CardStates,
  type RetentionStats,
} from '@/lib/stats';

/**
 * "Statystyki": what the review history says, for every deck or one.
 *
 * Everything here is read from `review_logs` and `fsrs_state`, which have
 * been complete since the first day, and worked out in `src/lib/stats.ts`.
 * The bars are plain `View`s, like the meters on "Ustawienia AI" — one chart
 * is no reason to bring back a native SVG dependency.
 */
export { ErrorScreen as ErrorBoundary } from '@/components/error-screen';

/** The Dropdown's value for "every deck". */
const ALL_DECKS = '';

const FORECAST_HEIGHT = 96;

const answersLabel = (count: number) =>
  `${count} ${pluralize(count, 'odpowiedź', 'odpowiedzi', 'odpowiedzi')}`;

const daysLabel = (count: number) => `${count} ${pluralize(count, 'dzień', 'dni', 'dni')}`;

export default function StatsScreen() {
  const theme = useTheme();
  const now = useNow();

  const [deck, setDeck] = useState(ALL_DECKS);
  const { data: decks } = useLiveQuery(deckNamesQuery());
  // A deck deleted while it was picked falls back to every deck rather than
  // showing an empty screen for something that no longer exists.
  const deckId = decks.some((row) => String(row.id) === deck) ? Number(deck) : null;

  const { data: logRows } = useLiveQuery(statsLogsQuery(deckId), [deckId]);
  const { data: cardRows } = useLiveQuery(statsCardsQuery(deckId), [deckId]);
  const { data: mnemonicRows } = useLiveQuery(mnemonicCardsQuery(deckId), [deckId]);

  const logs = logRows.map((row) => ({ ...row, reviewedAt: row.reviewedAt.getTime() }));
  const cards = cardRows.map((row) => ({ ...row, due: row.due.getTime() }));
  const withMnemonic = new Set(mnemonicRows.map((row) => row.cardId));

  const today = todayStats(logs, now);
  const streak = streakStats(logs, now);
  const time = studyTime(logs, now);
  const days = forecast(cards, now);
  const recent = recentRetention(logs, now);
  const mnemonics = mnemonicComparison(logs, withMnemonic);
  const states = cardStates(cards);

  const deckOptions = [
    { value: ALL_DECKS, label: 'Wszystkie talie' },
    ...decks.map((row) => ({ value: String(row.id), label: row.name })),
  ];

  const card = [styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }];
  const peak = Math.max(1, ...days.map((day) => day.count));

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}>
      {decks.length > 1 ? (
        <Dropdown label="Talia" value={deck} options={deckOptions} onChange={setDeck} />
      ) : null}

      {cards.length === 0 && logs.length === 0 ? (
        <EmptyState title="Jeszcze nie ma czego liczyć" hint="Dodaj karty i zacznij naukę." />
      ) : (
        <>
          <View style={styles.row}>
            <View style={[card, styles.half]}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                Dzisiaj
              </ThemedText>
              <ThemedText style={styles.big}>{today.answers}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {today.answers === 0
                  ? 'Jeszcze nic'
                  : `nowe ${today.new} · nauka ${today.learning} · powtórki ${today.review}`}
              </ThemedText>
              {today.correct != null ? (
                <ThemedText type="small" themeColor="textSecondary">
                  poprawnie {formatPercent(today.correct)}
                </ThemedText>
              ) : null}
            </View>

            <View style={[card, styles.half]}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                Seria
              </ThemedText>
              <ThemedText style={styles.big}>{daysLabel(streak.current)}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                najdłuższa: {daysLabel(streak.longest)}
              </ThemedText>
            </View>
          </View>

          <View style={card}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              Czas nauki
            </ThemedText>
            {time.week == null ? (
              <ThemedText type="small" themeColor="textSecondary">
                Jeszcze nie zmierzony
              </ThemedText>
            ) : (
              <View style={styles.compare}>
                <View style={styles.half}>
                  <ThemedText style={styles.medium}>
                    {time.today == null ? '—' : formatDuration(time.today)}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    dziś
                  </ThemedText>
                </View>
                <View style={styles.half}>
                  <ThemedText style={styles.medium}>{formatDuration(time.week)}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {STUDY_TIME_DAYS} dni
                  </ThemedText>
                </View>
                <View style={styles.half}>
                  <ThemedText style={styles.medium}>
                    {time.perAnswer == null ? '—' : formatDuration(time.perAnswer)}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    na odpowiedź
                  </ThemedText>
                </View>
              </View>
            )}
          </View>

          <View style={card}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              Do powtórki
            </ThemedText>
            <View style={styles.bars}>
              {days.map((day, index) => (
                <View key={day.start} style={styles.barColumn}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {day.count}
                  </ThemedText>
                  <View style={[styles.barTrack, { height: FORECAST_HEIGHT }]}>
                    <View
                      style={[
                        styles.bar,
                        {
                          height: Math.max(2, (day.count / peak) * FORECAST_HEIGHT),
                          backgroundColor: index === 0 ? theme.accent : theme.backgroundSelected,
                        },
                      ]}
                    />
                  </View>
                  <ThemedText type="small" themeColor="textSecondary">
                    {forecastLabel(index, day.start)}
                  </ThemedText>
                </View>
              ))}
            </View>
          </View>

          <View style={card}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              Zapamiętane · ostatnie {RETENTION_WINDOW_DAYS} dni
            </ThemedText>
            <Retention stats={recent} big />
          </View>

          {/* The one number Anki cannot show, so it wears the warm background
              the association field wears in the "+" sheet. */}
          <View style={[card, { backgroundColor: theme.backgroundHighlight }]}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              Skojarzenia a pamięć
            </ThemedText>
            <View style={styles.compare}>
              <View style={styles.half}>
                <ThemedText style={styles.compareTitle}>Ze skojarzeniem</ThemedText>
                <Retention stats={mnemonics.with} />
              </View>
              <View style={styles.half}>
                <ThemedText style={styles.compareTitle}>Bez skojarzenia</ThemedText>
                <Retention stats={mnemonics.without} />
              </View>
            </View>
          </View>

          <View style={card}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              Karty
            </ThemedText>
            <States states={states} />
          </View>
        </>
      )}
    </ScrollView>
  );
}

/**
 * A retention figure with the count it stands on, always — and with too few
 * answers, the count alone: a percentage from five answers would be read as
 * if it meant something.
 */
function Retention({ stats, big = false }: { stats: RetentionStats; big?: boolean }) {
  if (stats.rate == null) {
    return (
      <>
        <ThemedText style={big ? styles.big : styles.medium} themeColor="textSecondary">
          —
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {stats.answers === 0
            ? 'Brak powtórek'
            : `Za mało danych · ${answersLabel(stats.answers)}`}
        </ThemedText>
      </>
    );
  }

  return (
    <>
      <ThemedText style={big ? styles.big : styles.medium}>{formatPercent(stats.rate)}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {stats.target != null ? `cel ${formatPercent(stats.target)} · ` : ''}
        {answersLabel(stats.answers)}
      </ThemedText>
    </>
  );
}

const STATE_ROWS: { key: keyof CardStates; label: string }[] = [
  { key: 'new', label: 'Nowe' },
  { key: 'learning', label: 'W nauce' },
  { key: 'young', label: 'Młode' },
  { key: 'mature', label: 'Dojrzałe' },
];

/** One stacked bar and a legend under it. */
function States({ states }: { states: CardStates }) {
  const theme = useTheme();
  const total = STATE_ROWS.reduce((sum, row) => sum + states[row.key], 0);

  return (
    <>
      <View style={[styles.stack, { backgroundColor: theme.backgroundSelected }]}>
        {total > 0
          ? STATE_ROWS.map((row) =>
              states[row.key] > 0 ? (
                <View
                  key={row.key}
                  style={{ flex: states[row.key], backgroundColor: CardStateColors[row.key] }}
                />
              ) : null
            )
          : null}
      </View>
      <View style={styles.legend}>
        {STATE_ROWS.map((row) => (
          <View key={row.key} style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: CardStateColors[row.key] }]} />
            <ThemedText type="small">
              {row.label} {states[row.key]}
            </ThemedText>
          </View>
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    padding: Spacing.three,
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  half: {
    flex: 1,
  },
  card: {
    padding: Spacing.three,
    gap: Spacing.one,
    borderRadius: Radius.large,
    borderWidth: StyleSheet.hairlineWidth,
  },
  big: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
  },
  medium: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
  },
  bars: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.one,
  },
  barTrack: {
    width: '100%',
    justifyContent: 'flex-end',
  },
  bar: {
    width: '100%',
    borderRadius: Radius.small,
  },
  compare: {
    flexDirection: 'row',
    gap: Spacing.three,
    marginTop: Spacing.one,
  },
  compareTitle: {
    fontWeight: '600',
  },
  stack: {
    flexDirection: 'row',
    height: 12,
    borderRadius: Radius.small,
    overflow: 'hidden',
    marginTop: Spacing.two,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: Spacing.three,
    rowGap: Spacing.one,
    marginTop: Spacing.two,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
});
