import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { BadgeBoard } from '@/components/badge-board';
import { Dropdown } from '@/components/dropdown';
import { EmptyState } from '@/components/empty-state';
import { WithHelp } from '@/components/help-button';
import { CheckIcon, FlameIcon, GearIcon, PodiumIcon } from '@/components/icons';
import { ProgressRing } from '@/components/progress-ring';
import { StudyStats } from '@/components/study-stats';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { FlameColors, MaxContentWidth, Radius, RatingColors, Spacing } from '@/constants/theme';
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
import { WEEKDAYS } from '@/lib/stats';

/**
 * "Statystyki": the daily goal, the streak and the badges, which are the same
 * for every deck, and under them what the review history says, for every deck
 * or one.
 *
 * Everything here is read from `review_logs` and `fsrs_state`, which have
 * been complete since the first day, and worked out in `src/lib/stats.ts`;
 * the per-deck cards are `StudyStats`. The bars are plain `View`s, like the
 * meters on "Ustawienia AI" — one chart is no reason to bring back a native
 * SVG dependency.
 */
export { ErrorScreen as ErrorBoundary } from '@/components/error-screen';

/** The Dropdown's value for "every deck". */
const ALL_DECKS = '';

const RING_SIZE = 124;

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
        <StudyStats logs={logs} cards={cards} withMnemonic={withMnemonic} now={now} />
      )}
    </ScrollView>
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
});
