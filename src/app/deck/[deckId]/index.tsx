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
import { STATE_LABELS, State } from '@/lib/scheduler';

/** Placeholder while the aggregate is still loading, so the counters never flicker. */
const EMPTY_DUE = { dueCount: 0, newCount: 0, learningCount: 0, reviewCount: 0 };

export default function DeckScreen() {
  const theme = useTheme();
  const router = useRouter();
  const now = useNow();

  const { deckId: deckIdParam } = useLocalSearchParams<{ deckId: string }>();
  const deckId = Number(deckIdParam);

  const { data: deckRows } = useLiveQuery(deckQuery(deckId), [deckId]);
  const { data: cards } = useLiveQuery(cardsInDeckQuery(deckId), [deckId]);
  const { data: dueRows } = useLiveQuery(deckDueBreakdownQuery(deckId, now), [deckId, now]);

  const deck = deckRows?.[0];
  const due = dueRows?.[0] ?? EMPTY_DUE;

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
            <DueCounts counts={due} showLabels />
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
          title={due.dueCount > 0 ? `Ucz się (${due.dueCount})` : 'Nic do powtórki'}
          disabled={due.dueCount === 0}
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
