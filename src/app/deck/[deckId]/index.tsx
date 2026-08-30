import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { DueCounts } from '@/components/due-counts';
import { EmptyState } from '@/components/empty-state';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import {
  cardsInDeckQuery,
  deckDueBreakdownQuery,
  deckQuery,
  deleteCard,
  resetCard,
} from '@/db/queries';
import { useNow } from '@/hooks/use-now';
import { useTheme } from '@/hooks/use-theme';
import { cardsLabel, formatDue } from '@/lib/format';
import { cappedCounts, studyDayStart, totalDue } from '@/lib/limits';
import { STATE_LABELS, State } from '@/lib/scheduler';

/** Placeholder while the aggregate is still loading, so the counters never flicker. */
const EMPTY_BREAKDOWN = {
  newCount: 0,
  learningCount: 0,
  reviewCount: 0,
  newDoneToday: 0,
  reviewsDoneToday: 0,
};

export default function DeckScreen() {
  const theme = useTheme();
  const router = useRouter();
  const now = useNow();

  const { deckId: deckIdParam } = useLocalSearchParams<{ deckId: string }>();
  const deckId = Number(deckIdParam);

  const { data: deckRows } = useLiveQuery(deckQuery(deckId), [deckId]);
  const { data: cards } = useLiveQuery(cardsInDeckQuery(deckId), [deckId]);
  const dayStart = studyDayStart(new Date(now)).getTime();
  const { data: dueRows } = useLiveQuery(deckDueBreakdownQuery(deckId, now, dayStart), [
    deckId,
    now,
    dayStart,
  ]);

  const deck = deckRows?.[0];

  // Raw counters come from the query, the caps from the deck row; one helper
  // combines them so this screen shows exactly what the session will serve.
  const raw = dueRows?.[0] ?? EMPTY_BREAKDOWN;
  const counts = cappedCounts({
    ...raw,
    newPerDay: deck?.newPerDay ?? 0,
    reviewsPerDay: deck?.reviewsPerDay ?? 0,
  });
  const due = totalDue(counts);

  // What the daily cap is holding back right now — the difference between the
  // cards that are actually due and the ones the deck is allowed to serve.
  const heldBack = raw.newCount + raw.learningCount + raw.reviewCount - due;

  /**
   * Android keeps only the first three buttons and drops the rest, and its
   * dialogs are not cancelable unless asked — a fourth entry would silently eat
   * "Anuluj" and trap the user here. Editing is left out because tapping the
   * card already opens the editor.
   */
  const openCardMenu = (cardId: number, front: string) => {
    Alert.alert(
      front,
      'Dotknij kartę, żeby zmienić jej treść.',
      [
        { text: 'Zeruj postęp', onPress: () => resetCard(cardId) },
        { text: 'Usuń', style: 'destructive', onPress: () => deleteCard(cardId) },
        { text: 'Anuluj', style: 'cancel' },
      ],
      { cancelable: true }
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <Stack.Screen
        options={{
          title: deck?.name ?? 'Talia',
          headerRight: () =>
            deck ? (
              <Pressable
                onPress={() => router.push({ pathname: '/deck-editor', params: { deckId } })}
                hitSlop={12}>
                <ThemedText type="small" style={{ color: theme.accent }}>
                  Edytuj
                </ThemedText>
              </Pressable>
            ) : null,
        }}
      />

      <FlatList
        data={cards}
        keyExtractor={(card) => String(card.id)}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            {deck?.description ? (
              <ThemedText type="small" themeColor="textSecondary">
                {deck.description}
              </ThemedText>
            ) : null}
            <ThemedText type="small" themeColor="textSecondary">
              {cardsLabel(cards?.length ?? 0)}
            </ThemedText>
            <DueCounts counts={counts} showLabels />
            {heldBack > 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                {`Dzienny limit wstrzymuje ${cardsLabel(heldBack)} — wrócą jutro.`}
              </ThemedText>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title="Ta talia jest pusta"
            hint="Dodaj pierwszą fiszkę — przód to pytanie, tył to odpowiedź."
          />
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() =>
              router.push({ pathname: '/card-editor', params: { deckId, cardId: item.id } })
            }
            onLongPress={() => openCardMenu(item.id, item.front)}
            style={({ pressed }) => [
              styles.row,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: theme.border,
                opacity: pressed ? 0.7 : 1,
              },
            ]}>
            <View style={styles.rowMain}>
              <ThemedText numberOfLines={2} style={styles.front}>
                {item.front}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                {item.back}
              </ThemedText>
            </View>
            <View style={styles.rowMeta}>
              <ThemedText type="small" themeColor="textSecondary">
                {STATE_LABELS[(item.state ?? State.New) as State]}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {formatDue(item.due, now)}
              </ThemedText>
            </View>
          </Pressable>
        )}
      />

      <View style={[styles.footer, { borderColor: theme.border }]}>
        <Button
          title={
            due > 0
              ? `Ucz się (${due})`
              : heldBack > 0
                ? "Limit na dziś wyczerpany"
                : "Nic do powtórki"
          }
          disabled={due === 0}
          onPress={() => router.push({ pathname: '/deck/[deckId]/review', params: { deckId } })}
        />
        <Button
          title="Dodaj kartę"
          variant="secondary"
          onPress={() => router.push({ pathname: '/card-editor', params: { deckId } })}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  list: {
    padding: Spacing.three,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    gap: Spacing.one,
    paddingBottom: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.large,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowMain: {
    flex: 1,
    gap: Spacing.half,
  },
  rowMeta: {
    alignItems: 'flex-end',
    gap: Spacing.half,
  },
  front: {
    fontWeight: '600',
  },
  footer: {
    padding: Spacing.three,
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
});
