import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Link, useRouter } from 'expo-router';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { EmptyState } from '@/components/empty-state';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { decksWithStatsQuery, deleteDeck } from '@/db/queries';
import { useNow } from '@/hooks/use-now';
import { useTheme } from '@/hooks/use-theme';
import { cardsLabel } from '@/lib/format';

export default function DecksScreen() {
  const theme = useTheme();
  const router = useRouter();
  const now = useNow();
  const { data: decks } = useLiveQuery(decksWithStatsQuery(now), [now]);

  const confirmDelete = (deckId: number, name: string) => {
    Alert.alert('Usunąć talię?', `„${name}” zniknie razem ze wszystkimi kartami i historią.`, [
      { text: 'Anuluj', style: 'cancel' },
      { text: 'Usuń', style: 'destructive', onPress: () => deleteDeck(deckId) },
    ]);
  };

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
          <Link href={{ pathname: '/deck/[deckId]', params: { deckId: item.id } }} asChild>
            <Pressable
              onLongPress={() => confirmDelete(item.id, item.name)}
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

              {item.dueCount > 0 ? (
                <View style={[styles.badge, { backgroundColor: theme.accent }]}>
                  <ThemedText type="smallBold" style={{ color: theme.onAccent }}>
                    {item.dueCount}
                  </ThemedText>
                </View>
              ) : null}
            </Pressable>
          </Link>
        )}
      />

      <View style={[styles.footer, { borderColor: theme.border }]}>
        <Button title="Nowa talia" onPress={() => router.push('/deck-editor')} />
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
  badge: {
    minWidth: 32,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Radius.small,
    alignItems: 'center',
  },
  footer: {
    padding: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
});
