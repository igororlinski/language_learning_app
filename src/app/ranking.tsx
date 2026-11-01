import { useFocusEffect, useRouter } from 'expo-router';
import { Fragment, useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Button } from '@/components/button';
import { Meter } from '@/components/meter';
import { PersonDetails } from '@/components/person-details';
import { EmptyState } from '@/components/empty-state';
import { SegmentedControl } from '@/components/segmented-control';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, MedalColors, Radius, RatingColors, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { pluralize } from '@/lib/format';
import {
  fetchLeaderboard,
  FriendsError,
  type Account,
  type Person,
  type RankingPeriod,
} from '@/lib/friends';
import { syncStats, useAccount } from '@/lib/friends-store';

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

  const toggle = (id: string) => setExpanded(expanded === id ? null : id);

  // A podium once there is someone to share it with; the rest in a list.
  const podium = people != null && people.length >= 2 ? people.slice(0, 3) : [];
  const rest = people?.slice(podium.length) ?? [];
  const leader = Math.max(0, ...(people ?? []).map((person) => person.points));
  const openOnPodium = podium.find((person) => person.id === expanded) ?? null;

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

      {people == null ? (
        <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          {loadError ? (
            <>
              <ThemedText type="small" style={{ color: theme.danger }}>
                {loadError}
              </ThemedText>
              <Button title="Spróbuj ponownie" variant="secondary" onPress={() => void refresh()} />
            </>
          ) : (
            <ActivityIndicator style={styles.spinner} />
          )}
        </View>
      ) : (
        <>
          {loadError ? (
            <ThemedText type="small" style={{ color: theme.danger }}>
              {loadError}
            </ThemedText>
          ) : null}

          {podium.length > 0 ? (
            <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
              <Podium people={podium} open={expanded} onToggle={toggle} />
              <View style={[styles.floor, { backgroundColor: theme.border }]} />
              {openOnPodium ? <PersonDetails person={openOnPodium} named /> : null}
            </View>
          ) : null}

          {rest.length > 0 ? (
            <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
              {rest.map((person, index) => (
                <Fragment key={person.id}>
                  {index > 0 ? <View style={[styles.rule, { backgroundColor: theme.border }]} /> : null}
                  <Row
                    place={podium.length + index + 1}
                    person={person}
                    leader={leader}
                    open={expanded === person.id}
                    onToggle={() => toggle(person.id)}
                  />
                </Fragment>
              ))}
            </View>
          ) : null}

          {people.length <= 1 ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.alone}>
              Jeszcze nikogo tu nie ma.
            </ThemedText>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const pointsLabel = (count: number) => `${count} ${pluralize(count, 'punkt', 'punkty', 'punktów')}`;

/** Places on the podium as they stand: second, first, third. */
const PODIUM_ORDER = [1, 0, 2];

/** How tall each place's step is, first to third. */
const STEP_HEIGHT = [68, 48, 34];

/** The metal of each place, first to third: gold, silver, bronze. */
const PLACE_METAL = [MedalColors[2], MedalColors[1], MedalColors[0]];

/**
 * The first three, standing on their steps — second, first, third — each with
 * their points. A tap opens the same details a row of the list does.
 */
function Podium({
  people,
  open,
  onToggle,
}: {
  people: readonly Person[];
  open: string | null;
  onToggle: (id: string) => void;
}) {
  const theme = useTheme();

  return (
    <View style={styles.podium}>
      {PODIUM_ORDER.map((index) => {
        const person = people[index];

        // An empty place keeps the others where they belong.
        if (!person) return <View key={index} style={styles.place} />;

        const metal = PLACE_METAL[index];

        return (
          <Pressable
            key={person.id}
            onPress={() => onToggle(person.id)}
            accessibilityRole="button"
            accessibilityState={{ expanded: open === person.id }}
            accessibilityLabel={`${index + 1}. ${person.name}, ${pointsLabel(person.points)}`}
            style={({ pressed }) => [styles.place, { opacity: pressed ? 0.6 : 1 }]}>
            <Avatar id={person.id} name={person.name} size={index === 0 ? 60 : 48} ring={metal.face} />
            <ThemedText
              type="smallBold"
              numberOfLines={1}
              style={[styles.podiumName, person.me ? { color: theme.accent } : null]}>
              {person.me ? 'Ty' : person.name}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.tabular}>
              {person.points} pkt
            </ThemedText>
            <View
              style={[
                styles.step,
                {
                  height: STEP_HEIGHT[index],
                  backgroundColor: metal.face,
                  borderColor: open === person.id ? theme.text : metal.rim,
                },
              ]}>
              <ThemedText style={styles.stepPlace}>{index + 1}</ThemedText>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * One person below the podium: their place, initial, name and points, with a
 * bar of their points against the leader's. Tapped, it opens their details.
 * The viewer's own row is tinted, so it is found without reading.
 */
function Row({
  place,
  person,
  leader,
  open,
  onToggle,
}: {
  place: number;
  person: Person;
  /** The most points anyone has — what the bar is measured against. */
  leader: number;
  open: boolean;
  onToggle: () => void;
}) {
  const theme = useTheme();

  return (
    <View
      style={[styles.row, person.me ? { backgroundColor: `${theme.accent}14` } : null]}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${place}. ${person.name}, ${pointsLabel(person.points)}`}
        style={({ pressed }) => [styles.rowMain, { opacity: pressed ? 0.6 : 1 }]}>
        <ThemedText style={[styles.placeNumber, styles.tabular]} themeColor="textSecondary">
          {place}.
        </ThemedText>
        <Avatar id={person.id} name={person.name} size={36} />
        <View style={styles.grow}>
          <ThemedText
            numberOfLines={1}
            style={[styles.personName, person.me ? { color: theme.accent } : null]}>
            {person.me ? `${person.name} (ty)` : person.name}
          </ThemedText>
          <Meter
            share={leader > 0 ? person.points / leader : 0}
            color={person.me ? theme.accent : theme.textSecondary}
            trackColor={theme.backgroundSelected}
            height={4}
            style={styles.rowMeter}
          />
        </View>
        <ThemedText style={[styles.score, styles.tabular, person.points > 0 ? { color: RatingColors.good } : null]}>
          {person.points} pkt
        </ThemedText>
      </Pressable>

      {open ? <PersonDetails person={person} /> : null}
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
  alone: {
    textAlign: 'center',
  },
  podium: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
  },
  place: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.one,
  },
  podiumName: {
    maxWidth: '100%',
  },
  step: {
    alignSelf: 'stretch',
    marginTop: Spacing.one,
    borderTopLeftRadius: Radius.medium,
    borderTopRightRadius: Radius.medium,
    borderWidth: 2,
    borderBottomWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepPlace: {
    color: '#FFFFFF',
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
  },
  tabular: {
    fontVariant: ['tabular-nums'],
  },
  row: {
    gap: Spacing.two,
    marginHorizontal: -Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    borderRadius: Radius.medium,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
  },
  // The ground the steps stand on.
  floor: {
    height: 2,
    marginTop: -Spacing.two,
    borderRadius: 1,
  },
  rowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  placeNumber: {
    width: 28,
    fontWeight: '600',
  },
  personName: {
    fontWeight: '600',
  },
  rowMeter: {
    marginTop: Spacing.one,
  },
  score: {
    fontSize: 18,
    fontWeight: '700',
  },
});
