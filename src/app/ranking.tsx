import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { EmptyState } from '@/components/empty-state';
import { SegmentedControl } from '@/components/segmented-control';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Radius, RatingColors, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { badgeLabel } from '@/lib/badges';
import { pluralize } from '@/lib/format';
import { fetchLeaderboard, FriendsError, type Account, type Person, type RankingPeriod } from '@/lib/friends';
import { syncStats, useAccount } from '@/lib/friends-store';
import { formatDuration } from '@/lib/stats';

/**
 * "Ranking": the viewer and their friends by points — a day's goal for every
 * day it was met — this week, this month or all time. Opened from the trophy
 * in the corner of "Statystyki"; the account and the friends themselves live
 * on "Znajomi".
 */
export { ErrorScreen as ErrorBoundary } from '@/components/error-screen';

const PERIODS: { value: RankingPeriod; label: string }[] = [
  { value: 'week', label: 'Tydzień' },
  { value: 'month', label: 'Miesiąc' },
  { value: 'all', label: 'Od początku' },
];

const failure = (error: unknown) =>
  error instanceof FriendsError ? error.message : error instanceof Error ? error.message : String(error);

export default function RankingScreen() {
  const theme = useTheme();
  const router = useRouter();
  const account = useAccount();

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      {account === undefined ? (
        <ActivityIndicator style={styles.spinner} />
      ) : account ? (
        <Board account={account} />
      ) : (
        <View style={styles.content}>
          <EmptyState title="Ranking jest ze znajomymi" hint="Załóż konto i dodaj znajomych kodem." />
          <Button title="Znajomi" onPress={() => router.replace('/friends')} />
        </View>
      )}
    </View>
  );
}

function Board({ account }: { account: Account }) {
  const theme = useTheme();

  const [period, setPeriod] = useState<RankingPeriod>('week');
  const [people, setPeople] = useState<Person[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Our own numbers go up first, so the row marked "ty" is today's.
  const load = useCallback(async () => {
    await syncStats();

    try {
      setPeople(await fetchLeaderboard(account, Date.now(), period));
      setLoadError(null);
    } catch (error) {
      setLoadError(failure(error));
    }
  }, [account, period]);

  // A spinner rather than last period's numbers under this period's name.
  const choosePeriod = (next: RankingPeriod) => {
    setPeople(null);
    setPeriod(next);
  };

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>
      <SegmentedControl<RankingPeriod>
        value={period}
        options={PERIODS}
        onChange={choosePeriod}
        accessibilityLabel="Okres rankingu"
      />

      <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        {people == null ? (
          loadError ? (
            <>
              <ThemedText type="small" style={{ color: theme.danger }}>
                {loadError}
              </ThemedText>
              <Button title="Spróbuj ponownie" variant="secondary" onPress={() => void refresh()} />
            </>
          ) : (
            <ActivityIndicator style={styles.spinner} />
          )
        ) : (
          <>
            {loadError ? (
              <ThemedText type="small" style={{ color: theme.danger }}>
                {loadError}
              </ThemedText>
            ) : null}
            {people.map((person, index) => (
              <Row
                key={person.id}
                place={index + 1}
                first={index === 0}
                person={person}
                open={expanded === person.id}
                onToggle={() => setExpanded(expanded === person.id ? null : person.id)}
              />
            ))}
            {people.length <= 1 ? (
              <ThemedText type="small" themeColor="textSecondary">
                Jeszcze nikogo tu nie ma.
              </ThemedText>
            ) : null}
          </>
        )}
      </View>
    </ScrollView>
  );
}

const daysLabel = (count: number) => `${count} ${pluralize(count, 'dzień', 'dni', 'dni')}`;

const pointsLabel = (count: number) => `${count} ${pluralize(count, 'punkt', 'punkty', 'punktów')}`;

/** One person in the ranking; tapped, it opens their badges. */
function Row({
  place,
  first,
  person,
  open,
  onToggle,
}: {
  place: number;
  first: boolean;
  person: Person;
  open: boolean;
  onToggle: () => void;
}) {
  const theme = useTheme();

  const details = [
    person.streak > 0 ? `seria ${daysLabel(person.streak)}` : null,
    person.todayMet ? 'cel dziś ✓' : null,
    person.goalDays ? `${daysLabel(person.goalDays)} z celem` : null,
    person.studyMs > 0 ? formatDuration(person.studyMs) : null,
  ].filter(Boolean);

  const labels = person.badges.map(badgeLabel).filter((label): label is string => label != null);

  return (
    <View style={[styles.row, first ? null : styles.rowRule, { borderTopColor: theme.border }]}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={`${place}. ${person.name}, ${pointsLabel(person.points)}`}
        style={({ pressed }) => [styles.rowMain, { opacity: pressed ? 0.6 : 1 }]}>
        <ThemedText style={styles.place} themeColor="textSecondary">
          {place}.
        </ThemedText>
        <View style={styles.grow}>
          <ThemedText style={[styles.personName, person.me ? { color: theme.accent } : null]}>
            {person.me ? `${person.name} (ty)` : person.name}
          </ThemedText>
          {details.length > 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              {details.join(' · ')}
            </ThemedText>
          ) : null}
        </View>
        <ThemedText style={[styles.score, person.points > 0 ? { color: RatingColors.good } : null]}>
          {person.points} pkt
        </ThemedText>
      </Pressable>

      {open ? (
        <View style={styles.rowDetails}>
          {labels.length > 0 ? (
            <>
              <ThemedText type="smallBold" themeColor="textSecondary">
                Odznaki · {labels.length}
              </ThemedText>
              <View style={styles.chips}>
                {labels.map((label) => (
                  <View key={label} style={[styles.chip, { backgroundColor: theme.backgroundSelected }]}>
                    <ThemedText type="small">{label}</ThemedText>
                  </View>
                ))}
              </View>
            </>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              Bez odznak
            </ThemedText>
          )}
        </View>
      ) : null}
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
  spinner: {
    marginVertical: Spacing.four,
  },
  card: {
    padding: Spacing.three,
    gap: Spacing.two,
    borderRadius: Radius.large,
    borderWidth: StyleSheet.hairlineWidth,
  },
  grow: {
    flex: 1,
  },
  row: {
    gap: Spacing.two,
  },
  rowRule: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two,
  },
  rowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  place: {
    width: 28,
    fontWeight: '600',
  },
  personName: {
    fontWeight: '600',
  },
  score: {
    fontSize: 20,
    fontWeight: '700',
  },
  rowDetails: {
    paddingLeft: 28 + Spacing.two,
    gap: Spacing.two,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  chip: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Radius.small,
  },
});
