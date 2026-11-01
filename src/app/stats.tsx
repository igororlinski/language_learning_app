import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { BadgeBoard } from '@/components/badge-board';
import { BarChart } from '@/components/bar-chart';
import { Dropdown } from '@/components/dropdown';
import { EmptyState } from '@/components/empty-state';
import { WithHelp } from '@/components/help-button';
import { CheckIcon, FlameIcon, GearIcon, PodiumIcon } from '@/components/icons';
import { Meter } from '@/components/meter';
import { ProgressRing } from '@/components/progress-ring';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import {
  CardStateColors,
  FlameColors,
  MaxContentWidth,
  QueueColors,
  Radius,
  RatingColors,
  Spacing,
} from '@/constants/theme';
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
import { useEntrance } from '@/hooks/use-entrance';
import { useNow } from '@/hooks/use-now';
import { useStreak } from '@/hooks/use-streak';
import { useTheme } from '@/hooks/use-theme';
import { pluralize } from '@/lib/format';
import {
  dayKey,
  goalOn,
  goalShare,
  isLightDay,
  MAX_DAILY_GOAL,
  weekStrip,
  type WeekDay,
} from '@/lib/goals';
import {
  cardStates,
  forecast,
  FORECAST_DAYS,
  forecastLabel,
  formatDuration,
  formatGap,
  formatPercent,
  mnemonicComparison,
  mnemonicGap,
  recentRetention,
  RETENTION_WINDOW_DAYS,
  retentionTone,
  STUDY_TIME_DAYS,
  studyTime,
  studyTimeByDay,
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

const STUDY_CHART_HEIGHT = 48;

/** Today's answers by where the cards were, in the queue's colours. */
const TODAY_PARTS = [
  { key: 'new', label: 'nowe', color: 'new' },
  { key: 'learning', label: 'nauka', color: 'learning' },
  { key: 'review', label: 'powtórki', color: 'review' },
] as const;

const RING_SIZE = 124;

const answersLabel = (count: number) =>
  `${count} ${pluralize(count, 'odpowiedź', 'odpowiedzi', 'odpowiedzi')}`;

const daysLabel = (count: number) => `${count} ${pluralize(count, 'dzień', 'dni', 'dni')}`;

/** The week as it is lived in Poland, Monday first; the numbers are `weekday`'s. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export default function StatsScreen() {
  const theme = useTheme();
  const router = useRouter();
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
  const week = weekStrip(studyDays, plan, now);
  const lightToday = isLightDay(plan, dayKey(now));
  // Set once and left alone, so folded away behind the cog.
  const [goalSettings, setGoalSettings] = useState(false);
  // Any light day of the week tells what the lighter goal comes to now.
  const lightGoal = goalOn({ ...plan, lightDays: WEEK_ORDER }, dayKey(now));

  const toggleLightDay = (day: number) =>
    setLightDays(
      plan.lightDays.includes(day)
        ? plan.lightDays.filter((light) => light !== day)
        : [...plan.lightDays, day]
    );
  const { data: badgeRows } = useLiveQuery(badgesQuery());
  const earnedAt = new Map(badgeRows.map((row) => [row.id, row.earnedAt]));

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
  const timeByDay = studyTimeByDay(logs, now);
  const days = forecast(cards, now);
  const dueTotal = days.reduce((sum, day) => sum + day.count, 0);
  const recent = recentRetention(logs, now);
  const mnemonics = mnemonicComparison(logs, withMnemonic);
  const gap = mnemonicGap(mnemonics);
  const states = cardStates(cards);

  const deckOptions = [
    { value: ALL_DECKS, label: 'Wszystkie talie' },
    ...decks.map((row) => ({ value: String(row.id), label: row.name })),
  ];

  const card = [styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }];

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled">
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/ranking')}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Ranking ze znajomymi">
              <PodiumIcon size={22} color={theme.accent} />
            </Pressable>
          ),
        }}
      />
      <View style={card}>
        <View style={styles.cardHeader}>
          <WithHelp topic="stats.goal">
            <ThemedText type="smallBold" themeColor="textSecondary">
              Cel na dziś
            </ThemedText>
          </WithHelp>
          <Pressable
            onPress={() => setGoalSettings(!goalSettings)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Ustawienia celu"
            accessibilityState={{ expanded: goalSettings }}
            style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
            <GearIcon size={20} color={goalSettings ? theme.accent : theme.textSecondary} />
          </Pressable>
        </View>

        <View style={styles.hero}>
          <ProgressRing
            size={RING_SIZE}
            stroke={12}
            progress={goalShare(streak.today)}
            color={streak.today.met ? RatingColors.good : theme.accent}
            trackColor={theme.backgroundSelected}>
            <ThemedText style={[styles.ringCount, streak.today.met ? { color: RatingColors.good } : null]}>
              {streak.today.answers}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              z {streak.today.goal}
            </ThemedText>
          </ProgressRing>

          <View style={styles.streak}>
            <View style={styles.streakCount}>
              {/* Lit once today counts towards the streak. */}
              <FlameIcon
                size={40}
                color={streak.today.met ? FlameColors.outer : theme.backgroundSelected}
                core={streak.today.met ? FlameColors.inner : theme.backgroundElement}
              />
              <ThemedText style={styles.ringCount}>{streak.current}</ThemedText>
            </View>
            <WithHelp topic="stats.streak">
              <ThemedText type="small">
                {pluralize(streak.current, 'dzień', 'dni', 'dni')} z rzędu
              </ThemedText>
            </WithHelp>
            <ThemedText type="small" themeColor="textSecondary">
              najdłuższa: {daysLabel(streak.longest)}
            </ThemedText>
            {lightToday ? (
              <ThemedText type="small" themeColor="textSecondary">
                dziś lżejszy dzień
              </ThemedText>
            ) : null}
          </View>
        </View>

        <WeekStrip week={week} />

        {goalSettings ? (
          <View style={[styles.settings, { borderTopColor: theme.border }]}>
            <GoalInput label="Cel dzienny" value={plan.goal} max={MAX_DAILY_GOAL} onSave={setDailyGoal} />

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
            {/* Never more than the everyday goal: a lighter day asks for less. */}
            {plan.lightDays.length > 0 ? (
              <GoalInput label="Cel w lżejsze dni" value={lightGoal} max={plan.goal} onSave={setLightGoal} />
            ) : null}
          </View>
        ) : null}
      </View>

      <BadgeBoard progress={progress} earnedAt={earnedAt} />

      <View style={styles.section}>
        <ThemedText style={styles.sectionTitle}>Nauka</ThemedText>
        {decks.length > 1 ? (
          <Dropdown value={deck} options={deckOptions} onChange={setDeck} accessibilityLabel="Talia" />
        ) : null}
      </View>

      {cards.length === 0 && logs.length === 0 ? (
        <EmptyState title="Jeszcze nie ma czego liczyć" hint="Dodaj karty i zacznij naukę." />
      ) : (
        <>
          <View style={card}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              Dzisiaj
            </ThemedText>
            <ThemedText style={styles.big}>{today.answers}</ThemedText>
            {today.answers === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                Jeszcze nic
              </ThemedText>
            ) : (
              <View style={styles.legend}>
                {TODAY_PARTS.map((part) => (
                  <View key={part.key} style={styles.legendItem}>
                    <View style={[styles.dot, { backgroundColor: QueueColors[part.color] }]} />
                    <ThemedText type="small">
                      {part.label} <ThemedText type="smallBold">{today[part.key]}</ThemedText>
                    </ThemedText>
                  </View>
                ))}
              </View>
            )}
            {today.correct != null ? (
              <ThemedText type="small" themeColor="textSecondary">
                poprawnie {formatPercent(today.correct)}
              </ThemedText>
            ) : null}
          </View>

          <View style={card}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              Czas nauki · {STUDY_TIME_DAYS} dni
            </ThemedText>
            {time.week == null ? (
              <ThemedText type="small" themeColor="textSecondary">
                Jeszcze nie zmierzony
              </ThemedText>
            ) : (
              <>
                <ThemedText style={styles.big}>{formatDuration(time.week)}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  dziś {time.today == null ? '—' : formatDuration(time.today)}
                  {time.perAnswer == null ? '' : ` · ${formatDuration(time.perAnswer)} na odpowiedź`}
                </ThemedText>
                <View style={styles.chart}>
                  <BarChart
                    height={STUDY_CHART_HEIGHT}
                    bars={timeByDay.map((day, index) => ({
                      key: day.start,
                      value: day.ms,
                      label: index === timeByDay.length - 1 ? 'Dziś' : WEEKDAYS[new Date(day.start).getDay()],
                      highlight: index === timeByDay.length - 1,
                    }))}
                  />
                </View>
              </>
            )}
          </View>

          <View style={card}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              Do powtórki · {FORECAST_DAYS} dni
            </ThemedText>
            <ThemedText style={styles.big}>{dueTotal}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {pluralize(dueTotal, 'karta', 'karty', 'kart')}, dziś {days[0].count}
            </ThemedText>
            <View style={styles.chart}>
              <BarChart
                height={FORECAST_HEIGHT}
                showValues
                bars={days.map((day, index) => ({
                  key: day.start,
                  value: day.count,
                  label: forecastLabel(index, day.start),
                  highlight: index === 0,
                }))}
              />
            </View>
          </View>

          <View style={card}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              Zapamiętane · ostatnie {RETENTION_WINDOW_DAYS} dni
            </ThemedText>
            <RetentionRow stats={recent} big />
          </View>

          {/* The one number Anki cannot show, so it wears the warm background
              the association field wears in the "+" sheet. */}
          <View style={[card, { backgroundColor: theme.backgroundHighlight }]}>
            <View style={styles.cardHeader}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                Skojarzenia a pamięć
              </ThemedText>
              {gap != null ? (
                <View
                  style={[
                    styles.gap,
                    {
                      backgroundColor:
                        gap > 0 ? RatingColors.good : gap < 0 ? RatingColors.again : theme.backgroundSelected,
                    },
                  ]}>
                  <ThemedText type="smallBold" style={{ color: gap === 0 ? theme.text : '#FFFFFF' }}>
                    {formatGap(gap)}
                  </ThemedText>
                </View>
              ) : null}
            </View>
            <View style={styles.rows}>
              <View>
                <ThemedText style={styles.compareTitle}>Ze skojarzeniem</ThemedText>
                <RetentionRow stats={mnemonics.with} />
              </View>
              <View>
                <ThemedText style={styles.compareTitle}>Bez skojarzenia</ThemedText>
                <RetentionRow stats={mnemonics.without} muted />
              </View>
            </View>
          </View>

          <View style={card}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              Karty · {cards.length}
            </ThemedText>
            <States states={states} />
          </View>
        </>
      )}
    </ScrollView>
  );
}

const TONE_COLOR = {
  good: RatingColors.good,
  close: RatingColors.hard,
  low: RatingColors.again,
} as const;

/**
 * A retention figure with the count it stands on, always, and a bar with the
 * target marked across it: green at or over the target, amber just under,
 * red well under. With too few answers, the count alone — a percentage from
 * five answers would be read as if it meant something. `muted` draws the bar
 * grey, for the side of a comparison that is not the point.
 */
function RetentionRow({
  stats,
  big = false,
  muted = false,
}: {
  stats: RetentionStats;
  big?: boolean;
  muted?: boolean;
}) {
  const theme = useTheme();
  const number = big ? styles.big : styles.medium;

  if (stats.rate == null) {
    return (
      <>
        <ThemedText style={number} themeColor="textSecondary">
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
      <ThemedText style={number}>{formatPercent(stats.rate)}</ThemedText>
      <Meter
        share={stats.rate}
        color={muted ? theme.textSecondary : TONE_COLOR[retentionTone(stats.rate, stats.target)]}
        trackColor={theme.backgroundSelected}
        marker={stats.target}
        markerColor={theme.text}
        style={styles.retentionMeter}
      />
      <ThemedText type="small" themeColor="textSecondary">
        {stats.target != null ? `cel ${formatPercent(stats.target)} · ` : ''}
        {answersLabel(stats.answers)}
      </ThemedText>
    </>
  );
}

const DAY_STATUS: Record<WeekDay['status'], string> = {
  met: 'cel spełniony',
  missed: 'bez celu',
  open: 'dziś, cel jeszcze przed tobą',
  later: 'jeszcze przed tobą',
};

/**
 * This week, Monday to Sunday: a green tick for every day the goal was met,
 * grey for one that went without, today ringed in the accent and the days
 * ahead left empty. A lighter day is drawn smaller — it asks for less.
 */
function WeekStrip({ week }: { week: readonly WeekDay[] }) {
  const theme = useTheme();

  return (
    <View style={styles.week}>
      {week.map((day) => {
        const size = day.light ? 24 : 30;
        const circle =
          day.status === 'met'
            ? { backgroundColor: RatingColors.good }
            : day.status === 'missed'
              ? { backgroundColor: theme.backgroundSelected }
              : day.status === 'open'
                ? { borderWidth: 2, borderColor: theme.accent }
                : { borderWidth: 1.5, borderColor: theme.border };

        return (
          <View
            key={day.day}
            accessible
            accessibilityLabel={`${WEEKDAYS[day.weekday]}${day.light ? ', lżejszy' : ''}: ${DAY_STATUS[day.status]}`}
            style={styles.weekDay}>
            <View style={styles.weekSlot}>
              <View
                style={[
                  styles.weekCircle,
                  { width: size, height: size, borderRadius: size / 2 },
                  circle,
                ]}>
                {day.status === 'met' ? <CheckIcon size={size * 0.62} color="#FFFFFF" /> : null}
              </View>
            </View>
            <ThemedText
              type={day.isToday ? 'smallBold' : 'small'}
              style={{ color: day.isToday ? theme.accent : theme.textSecondary }}>
              {WEEKDAYS[day.weekday]}
            </ThemedText>
          </View>
        );
      })}
    </View>
  );
}

/**
 * A goal typed in. Saved when the typing ends — on "done" or on leaving the
 * field — rather than on every digit: a goal of 1 on the way to 15 would
 * otherwise mark today met for a moment. Anything outside 1…max is put back.
 */
function GoalInput({
  label,
  value,
  max,
  onSave,
}: {
  label: string;
  value: number;
  max: number;
  onSave: (goal: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const typed = Number(draft);
  const valid = draft != null && /^\d+$/.test(draft) && typed >= 1 && typed <= max;

  const commit = () => {
    if (valid && typed !== value) onSave(typed);
    setDraft(null);
  };

  return (
    <View style={styles.goalPicker}>
      <TextField
        label={label}
        value={draft ?? String(value)}
        onChangeText={setDraft}
        onEndEditing={commit}
        keyboardType="number-pad"
        returnKeyType="done"
        maxLength={String(max).length}
        error={draft != null && !valid ? `Od 1 do ${max}` : undefined}
      />
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
  const grow = useEntrance();
  const total = STATE_ROWS.reduce((sum, row) => sum + states[row.key], 0);

  return (
    <>
      <View style={[styles.stack, { backgroundColor: theme.backgroundSelected }]}>
        <Animated.View style={[styles.stackFill, { transformOrigin: 'left', transform: [{ scaleX: grow }] }]}>
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
        </Animated.View>
      </View>
      <View style={styles.legend}>
        {STATE_ROWS.map((row) => (
          <View key={row.key} style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: CardStateColors[row.key] }]} />
            <ThemedText type="small">
              {row.label} <ThemedText type="smallBold">{states[row.key]}</ThemedText>
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
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.four,
    marginTop: Spacing.two,
  },
  ringCount: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  streak: {
    flex: 1,
    gap: Spacing.half,
  },
  streakCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginBottom: Spacing.one,
  },
  week: {
    flexDirection: 'row',
    marginTop: Spacing.three,
  },
  weekDay: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.one,
  },
  // As tall as the biggest circle, so smaller ones sit on the same centre line.
  weekSlot: {
    height: 30,
    justifyContent: 'center',
  },
  weekCircle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  settings: {
    marginTop: Spacing.three,
    paddingTop: Spacing.one,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  section: {
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  sectionTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
  },
  card: {
    padding: Spacing.three,
    gap: Spacing.one,
    borderRadius: Radius.large,
    borderWidth: StyleSheet.hairlineWidth,
  },
  // The two sizes a number comes in on this screen; digits all one width, so
  // a count going up does not shuffle what stands beside it.
  big: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  medium: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  chart: {
    marginTop: Spacing.three,
  },
  retentionMeter: {
    marginVertical: Spacing.two,
  },
  rows: {
    gap: Spacing.three,
    marginTop: Spacing.two,
  },
  compareTitle: {
    fontWeight: '600',
  },
  gap: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Radius.small,
  },
  stack: {
    height: 12,
    borderRadius: Radius.small,
    overflow: 'hidden',
    marginTop: Spacing.two,
  },
  stackFill: {
    flex: 1,
    flexDirection: 'row',
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
