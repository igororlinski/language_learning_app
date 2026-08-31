import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { Button } from '@/components/button';
import { DueCounts } from '@/components/due-counts';
import { EmptyState } from '@/components/empty-state';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import {
  cardMediaFiles,
  cardsInDeckQuery,
  deckDueBreakdownQuery,
  deckQuery,
  deleteCard,
  moveCard,
  otherDecksQuery,
  resetCard,
} from '@/db/queries';
import { useNow } from '@/hooks/use-now';
import { useTheme } from '@/hooks/use-theme';
import { deleteMedia } from '@/lib/media-files';
import { cardsLabel, formatDue } from '@/lib/format';
import { cappedCounts, studyDayStart, totalDue } from '@/lib/limits';
import { filterCards } from '@/lib/search';
import { STATE_LABELS, State } from '@/lib/scheduler';

type CardMenuTarget = { id: number; front: string; back: string };

/** The long-press sheet shows either the card's actions or the list of decks. */
type CardMenu = { card: CardMenuTarget; view: 'actions' | 'move' };

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
  const { data: otherDecks } = useLiveQuery(otherDecksQuery(deckId), [deckId]);
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

  const [menu, setMenu] = useState<CardMenu | null>(null);
  const moveTargets = otherDecks ?? [];
  const [query, setQuery] = useState('');
  const allCards = cards ?? [];
  const searching = query.trim().length > 0;
  // Depends on `cards` (stable from useLiveQuery), not on the `?? []` fallback,
  // which would be a fresh array on every render.
  const visibleCards = useMemo(() => filterCards(cards ?? [], query), [cards, query]);

  /** Runs once the sheet has closed, so no dialog is opened from inside another. */
  const confirmDelete = (card: CardMenuTarget) => {
    Alert.alert(
      'Usunąć kartę?',
      `„${card.front}” zniknie razem z historią powtórek.`,
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Usuń',
          style: 'destructive',
          onPress: () => {
            const files = cardMediaFiles(card.id);
            deleteCard(card.id);
            deleteMedia(files);
          },
        },
      ],
      { cancelable: true }
    );
  };

  const cardMenuActions = (card: CardMenuTarget): SheetAction[] => [
    {
      label: 'Edytuj kartę',
      onPress: () => router.push({ pathname: '/card-editor', params: { deckId, cardId: card.id } }),
    },
    // Swaps what this sheet shows instead of opening a second one.
    ...(moveTargets.length > 0
      ? [
          {
            label: 'Przenieś do innej talii',
            keepOpen: true,
            onPress: () => setMenu({ card, view: 'move' }),
          },
        ]
      : []),
    { label: 'Zeruj postęp', onPress: () => resetCard(card.id) },
    { label: 'Usuń kartę', destructive: true, onPress: () => confirmDelete(card) },
  ];

  /** The card keeps its schedule and history — only the deck changes. */
  const moveActions = (card: CardMenuTarget): SheetAction[] =>
    moveTargets.map((target) => ({
      label: target.name,
      onPress: () => moveCard(card.id, target.id),
    }));

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
        data={visibleCards}
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
              {searching
                ? `${visibleCards.length} z ${cardsLabel(allCards.length)}`
                : cardsLabel(allCards.length)}
            </ThemedText>
            <DueCounts counts={counts} showLabels />
            {heldBack > 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                {`Dzienny limit wstrzymuje ${cardsLabel(heldBack)} — wrócą jutro.`}
              </ThemedText>
            ) : null}

            {allCards.length > 0 ? (
              <View style={styles.search}>
                <TextField
                  label="Szukaj w talii"
                  value={query}
                  onChangeText={setQuery}
                  placeholder="np. break, łamać, /breɪk/"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                />
                {searching ? (
                  <Pressable onPress={() => setQuery('')} hitSlop={12} style={styles.clear}>
                    <ThemedText type="small" style={{ color: theme.accent }}>
                      Wyczyść
                    </ThemedText>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          searching ? (
            <EmptyState
              title="Nic nie pasuje"
              hint={`Żadna karta w tej talii nie zawiera „${query.trim()}”.`}
            />
          ) : (
            <EmptyState
              title="Ta talia jest pusta"
              hint="Dodaj pierwszą fiszkę — przód to pytanie, tył to odpowiedź."
            />
          )
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() =>
              router.push({ pathname: '/card-editor', params: { deckId, cardId: item.id } })
            }
            onLongPress={() =>
              setMenu({
                card: { id: item.id, front: item.front, back: item.back },
                view: 'actions',
              })
            }
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

      {menu ? (
        <ActionSheet
          visible
          title={menu.view === 'move' ? 'Przenieś do talii' : menu.card.front}
          subtitle={menu.view === 'move' ? menu.card.front : menu.card.back}
          actions={menu.view === 'move' ? moveActions(menu.card) : cardMenuActions(menu.card)}
          onClose={() => setMenu(null)}
        />
      ) : null}
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
  search: {
    paddingTop: Spacing.two,
    gap: Spacing.one,
  },
  clear: {
    alignSelf: 'flex-end',
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
