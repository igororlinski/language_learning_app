import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { Button } from '@/components/button';
import { DueCounts } from '@/components/due-counts';
import { EmptyState } from '@/components/empty-state';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { decksWithStatsQuery, deleteDeck } from '@/db/queries';
import { useNow } from '@/hooks/use-now';
import { useTheme } from '@/hooks/use-theme';
import { cardsLabel } from '@/lib/format';

type DeckMenuTarget = { id: number; name: string; cardCount: number; dueCount: number };

export default function DecksScreen() {
  const theme = useTheme();
  const router = useRouter();
  const now = useNow();
  const { data: decks } = useLiveQuery(decksWithStatsQuery(now), [now]);

  const [menuDeck, setMenuDeck] = useState<DeckMenuTarget | null>(null);

  const openCards = (deckId: number) =>
    router.push({ pathname: '/deck/[deckId]', params: { deckId } });

  const startStudy = (deckId: number) =>
    router.push({ pathname: '/deck/[deckId]/review', params: { deckId } });

  /**
   * Anki-style: a deck with something due goes straight into studying. With an
   * empty queue there is nothing to study, so the card list is the useful screen.
   */
  const openDeck = (deck: DeckMenuTarget) =>
    deck.dueCount > 0 ? startStudy(deck.id) : openCards(deck.id);

  /** Runs once the sheet has closed, so no dialog is opened from inside another. */
  const confirmDelete = (deck: DeckMenuTarget) => {
    Alert.alert(
      'Usunąć talię?',
      `„${deck.name}” zniknie razem ze wszystkimi kartami i historią powtórek.`,
      [
        { text: 'Anuluj', style: 'cancel' },
        { text: 'Usuń', style: 'destructive', onPress: () => deleteDeck(deck.id) },
      ],
      { cancelable: true }
    );
  };

  const menuActions = (deck: DeckMenuTarget): SheetAction[] => [
    ...(deck.dueCount > 0
      ? [{ label: `Ucz się (${deck.dueCount})`, onPress: () => startStudy(deck.id) }]
      : []),
    { label: 'Karty w talii', onPress: () => openCards(deck.id) },
    {
      label: 'Edytuj talię',
      onPress: () => router.push({ pathname: '/deck-editor', params: { deckId: deck.id } }),
    },
    { label: 'Usuń talię', destructive: true, onPress: () => confirmDelete(deck) },
  ];

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <FlatList
        data={decks}
        keyExtractor={(deck) => String(deck.id)}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <EmptyState
            title="Nie masz jeszcze żadnej talii"
            hint={'Talia to zbiór fiszek na jeden temat — np. „Angielski B2” albo „Anatomia”.'}
          />
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => openDeck(item)}
            onLongPress={() => setMenuDeck(item)}
            style={({ pressed }) => [
              styles.row,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: theme.border,
                opacity: pressed ? 0.7 : 1,
              },
            ]}>
            <View style={styles.rowMain}>
              <ThemedText style={styles.deckName}>{item.name}</ThemedText>
              {item.description ? (
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                  {item.description}
                </ThemedText>
              ) : null}
              <ThemedText type="small" themeColor="textSecondary">
                {cardsLabel(item.cardCount)}
              </ThemedText>
            </View>

            {item.dueCount > 0 ? <DueCounts counts={item} /> : null}
          </Pressable>
        )}
      />

      <View style={[styles.footer, { borderColor: theme.border }]}>
        <Button title="Nowa talia" onPress={() => router.push('/deck-editor')} />
      </View>

      {menuDeck ? (
        <ActionSheet
          visible
          title={menuDeck.name}
          subtitle={`${cardsLabel(menuDeck.cardCount)} · ${menuDeck.dueCount} do powtórki`}
          actions={menuActions(menuDeck)}
          onClose={() => setMenuDeck(null)}
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
  deckName: {
    fontSize: 17,
    fontWeight: '600',
  },
  footer: {
    padding: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
});
