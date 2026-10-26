import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Dropdown } from '@/components/dropdown';
import { EmptyState } from '@/components/empty-state';
import { GoalBar } from '@/components/goal-bar';
import { ThemedText } from '@/components/themed-text';
import { CardStateColors, MaxContentWidth, Radius, RatingColors, Spacing } from '@/constants/theme';
import {
  awardBadges,
  badgeProgress,
  badgesQuery,
  deckNamesQuery,
  mnemonicCardsQuery,
  setDailyGoal,
  setLightDays,
  setLightGoal,
  statsCardsQuery,
  statsLogsQuery,
} from '@/db/queries';
import { useNow } from '@/hooks/use-now';
import { useStreak } from '@/hooks/use-streak';
import { useTheme } from '@/hooks/use-theme';
import { BADGE_GROUPS, badgeId, formatCount, shortCount, type BadgeProgress } from '@/lib/badges';
import { pluralize } from '@/lib/format';
import { DAILY_GOALS, dayKey, goalOn, isLightDay, LIGHT_GOALS } from '@/lib/goals';
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
  studyTime,
  todayStats,
  WEEKDAYS,
  type CardStates,
  type RetentionStats,
} from '@/lib/stats';

/**
 * "Statystyki": the daily goal, the streak and the badges, which are the same
 * for every deck, and under them what the review history says, for every deck
 * or one.
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

const GOAL_OPTIONS = DAILY_GOALS.map((goal) => ({ value: String(goal), label: answersLabel(goal) }));

/** The week as it is lived in Poland, Monday first; the numbers are `weekday`'s. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

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

  const { days: studyDays, plan, streak } = useStreak(now);
  const lightToday = isLightDay(plan, dayKey(now));
  // Any light day of the week tells what the lighter goal comes to now.
  const lightGoal = goalOn({ ...plan, lightDays: WEEK_ORDER }, dayKey(now));
  // A lighter goal only ever offers less than the everyday one — plus the one
  // in force, which a goal lowered since can have caught up with.
  const lightOptions = LIGHT_GOALS.filter((light) => light < plan.goal || light === lightGoal).map(
    (light) => ({ value: String(light), label: answersLabel(light) })
  );

  const toggleLightDay = (day: number) =>
    setLightDays(
      plan.lightDays.includes(day)
        ? plan.lightDays.filter((light) => light !== day)
        : [...plan.lightDays, day]
    );
  const { data: badgeRows } = useLiveQuery(badgesQuery());
  const earned = new Set(badgeRows.map((row) => row.id));

  // Catches what a session did not: an association made in the card editor,
  // a deck imported with its history.
  useEffect(() => {
    awardBadges();
  }, []);

  // Read rather than live: a handful of counts, worth redoing only when the
  // days, the earned badges or the cards move.
  const progress = useMemo(
    () => badgeProgress(now),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the rows are the triggers
    [now, studyDays, badgeRows, cardRows, mnemonicRows]
  );

  const logs = logRows.map((row) => ({ ...row, reviewedAt: row.reviewedAt.getTime() }));
  const cards = cardRows.map((row) => ({ ...row, due: row.due.getTime() }));
  const withMnemonic = new Set(mnemonicRows.map((row) => row.cardId));

  const today = todayStats(logs, now);
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
      <View style={card}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          Cel na dziś
        </ThemedText>
        <ThemedText style={[styles.big, streak.today.met ? { color: RatingColors.good } : null]}>
          {streak.today.answers} / {streak.today.goal}
        </ThemedText>
        {lightToday ? (
          <ThemedText type="small" themeColor="textSecondary">
            lżejszy dzień
          </ThemedText>
        ) : null}
        <GoalBar today={streak.today} height={8} />
        <Dropdown
          label="Cel dzienny"
          value={String(plan.goal)}
          options={GOAL_OPTIONS}
          onChange={(value) => setDailyGoal(Number(value))}
          style={styles.goalPicker}
        />

        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.goalPicker}>
          Lżejsze dni
        </ThemedText>
        <View style={styles.chips}>
          {WEEK_ORDER.map((day) => {
            const on = plan.lightDays.includes(day);

            return (
              <Pressable
                key={day}
                onPress={() => toggleLightDay(day)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={`Lżejszy dzień: ${WEEKDAYS[day]}`}
                style={[
                  styles.chip,
                  on
                    ? { backgroundColor: theme.accent, borderColor: theme.accent }
                    : { borderColor: theme.border },
                ]}>
                <ThemedText type="small" style={{ color: on ? theme.onAccent : theme.text }}>
                  {WEEKDAYS[day]}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
        {plan.lightDays.length > 0 && lightOptions.length > 0 ? (
          <Dropdown
            label="Cel w lżejsze dni"
            value={String(lightGoal)}
            options={lightOptions}
            onChange={(value) => setLightGoal(Number(value))}
            style={styles.goalPicker}
          />
        ) : null}
      </View>

      <View style={card}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          Seria
        </ThemedText>
        <View style={styles.compare}>
          <View style={styles.half}>
            <ThemedText style={styles.medium}>{daysLabel(streak.current)}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              teraz
            </ThemedText>
          </View>
          <View style={styles.half}>
            <ThemedText style={styles.medium}>{daysLabel(streak.longest)}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              najdłuższa
            </ThemedText>
          </View>
        </View>
      </View>

      <Badges progress={progress} earned={earned} />

      {decks.length > 1 ? (
        <Dropdown label="Talia" value={deck} options={deckOptions} onChange={setDeck} />
      ) : null}

      {cards.length === 0 && logs.length === 0 ? (
        <EmptyState title="Jeszcze nie ma czego liczyć" hint="Dodaj karty i zacznij naukę." />
      ) : (
        <>
          <View style={card}>
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

/**
 * Every ladder as a row of tiers: earned ones filled, the next one outlined
 * with how far there is still to go, the rest greyed.
 */
function Badges({ progress, earned }: { progress: BadgeProgress; earned: ReadonlySet<string> }) {
  const theme = useTheme();
  const total = BADGE_GROUPS.reduce((sum, group) => sum + group.tiers.length, 0);

  return (
    <View
      style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        Odznaki · {earned.size}/{total}
      </ThemedText>

      {BADGE_GROUPS.map((group) => {
        const next = group.tiers.find((tier) => !earned.has(badgeId(group.kind, tier)));

        return (
          <View key={group.kind} style={styles.badgeGroup}>
            <View style={styles.badgeHeader}>
              <ThemedText type="small">{group.title}</ThemedText>
              {next != null ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {formatCount(Math.min(progress[group.kind], next))} / {formatCount(next)}
                </ThemedText>
              ) : null}
            </View>
            <View style={styles.chips}>
              {group.tiers.map((tier) => {
                const has = earned.has(badgeId(group.kind, tier));
                const isNext = tier === next;

                return (
                  <View
                    key={tier}
                    accessible
                    accessibilityLabel={`${group.label(tier)}${has ? ', zdobyta' : ''}`}
                    style={[
                      styles.chip,
                      has
                        ? { backgroundColor: theme.accent, borderColor: theme.accent }
                        : isNext
                          ? { borderColor: theme.accent }
                          : {
                              backgroundColor: theme.backgroundSelected,
                              borderColor: theme.backgroundSelected,
                            },
                    ]}>
                    <ThemedText
                      type="small"
                      style={{ color: has ? theme.onAccent : isNext ? theme.text : theme.textSecondary }}>
                      {shortCount(tier)}
                    </ThemedText>
                  </View>
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
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
  goalPicker: {
    marginTop: Spacing.two,
  },
  badgeGroup: {
    gap: Spacing.one,
    marginTop: Spacing.two,
  },
  badgeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  chip: {
    minWidth: 40,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Radius.small,
    borderWidth: 1,
    alignItems: 'center',
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
