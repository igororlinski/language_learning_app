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
import { deckMediaFiles, decksWithStatsQuery, deleteDeck } from '@/db/queries';
import { useNow } from '@/hooks/use-now';
import { useTheme } from '@/hooks/use-theme';
import { deleteMedia } from '@/lib/media-files';
import { cardsLabel } from '@/lib/format';
import { cappedCounts, studyDayStart, totalDue } from '@/lib/limits';

type DeckMenuTarget = { id: number; name: string; cardCount: number; due: number };

export default function DecksScreen() {
  const theme = useTheme();
  const router = useRouter();
  const now = useNow();
  const dayStart = studyDayStart(new Date(now)).getTime();
  const { data: decks } = useLiveQuery(decksWithStatsQuery(now, dayStart), [now, dayStart]);

  const [menuDeck, setMenuDeck] = useState<DeckMenuTarget | null>(null);

  const openCards = (deckId: number) =>
    router.push({ pathname: '/deck/[deckId]', params: { deckId } });

  const startStudy = (deckId: number) =>
    router.push({ pathname: '/deck/[deckId]/review', params: { deckId } });

  /** Runs once the sheet has closed, so no dialog is opened from inside another. */
  const confirmDelete = (deck: DeckMenuTarget) => {
    Alert.alert(
      'Usunąć talię?',
      `„${deck.name}” zniknie razem ze wszystkimi kartami i historią powtórek.`,
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Usuń',
          style: 'destructive',
          onPress: () => {
            // The media copies are files, not rows, so the cascade misses them.
            const files = deckMediaFiles(deck.id);
            deleteDeck(deck.id);
            deleteMedia(files);
          },
        },
      ],
      { cancelable: true }
    );
  };

  const menuActions = (deck: DeckMenuTarget): SheetAction[] => [
    ...(deck.due > 0
      ? [{ label: `Ucz się (${deck.due})`, onPress: () => startStudy(deck.id) }]
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
        renderItem={({ item }) => {
          // Counters and the tap target both read the capped numbers, so the
          // badge can never promise more than "Ucz się" will hand out.
          const counts = cappedCounts(item);
          const due = totalDue(counts);

          return (
            <Pressable
              onPress={() => (due > 0 ? startStudy(item.id) : openCards(item.id))}
              onLongPress={() => setMenuDeck({ ...item, due })}
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

              {due > 0 ? <DueCounts counts={counts} /> : null}
            </Pressable>
          );
        }}
      />

      <View style={[styles.footer, { borderColor: theme.border }]}>
        <Button title="Nowa talia" onPress={() => router.push('/deck-editor')} />
      </View>

      {menuDeck ? (
        <ActionSheet
          visible
          title={menuDeck.name}
          subtitle={`${cardsLabel(menuDeck.cardCount)} · ${menuDeck.due} do powtórki`}
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
