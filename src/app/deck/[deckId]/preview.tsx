import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { CardFaces, cardFacesLayout } from '@/components/card-faces';
import { EmptyState } from '@/components/empty-state';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { cardsLines } from '@/db/queries';
import { useTheme } from '@/hooks/use-theme';

/**
 * A walk through hand-picked cards, exactly as the learner would see them —
 * and **nothing else**. No grading, no schedule, no entry in `review_logs`:
 * this is for checking how a batch of cards actually reads, which is otherwise
 * only possible by studying them and spending their reviews.
 *
 * The selection arrives as ids in the route parameter rather than through a
 * store: it is read once, on entry, and the queue never changes afterwards.
 */
export default function PreviewScreen() {
  const theme = useTheme();
  const router = useRouter();

  const { ids } = useLocalSearchParams<{ deckId: string; ids: string }>();

  // Read once. A card edited or deleted elsewhere while this screen is open
  // would change the queue under the user's finger for no good reason.
  const cards = useMemo(() => {
    const picked = (ids ?? '')
      .split(',')
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id));

    return cardsLines(picked);
  }, [ids]);

  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const current = cards[index];
  const last = index >= cards.length - 1;

  const show = (next: number) => {
    setIndex(next);
    setRevealed(false);
  };

  if (!current) {
    return (
      <SafeAreaView
        style={[styles.screen, { backgroundColor: theme.background }]}
        edges={['top', 'bottom']}>
        <EmptyState
          title="Nie ma czego pokazać"
          hint="Zaznaczone karty zniknęły, zanim otworzył się podgląd."
        />
        <View style={styles.controls}>
          <Button title="Wróć" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: theme.background }]}
      edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <ThemedText type="small" themeColor="textSecondary">
          {`Podgląd — ${index + 1} z ${cards.length}`}
        </ThemedText>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Zamknij podgląd">
          <ThemedText type="small" style={{ color: theme.accent }}>
            Zamknij
          </ThemedText>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={cardFacesLayout.area}>
        <CardFaces
          frontLines={current.front}
          backLines={current.back}
          revealed={revealed}
        />
      </ScrollView>

      <View style={styles.controls}>
        {revealed ? null : <Button title="Pokaż odpowiedź" onPress={() => setRevealed(true)} />}

        <View style={styles.steps}>
          <Button
            title="Poprzednia"
            variant="secondary"
            disabled={index === 0}
            onPress={() => show(index - 1)}
            style={styles.step}
          />
          <Button
            title={last ? 'Koniec' : 'Następna'}
            variant={revealed ? 'primary' : 'secondary'}
            onPress={() => (last ? router.back() : show(index + 1))}
            style={styles.step}
          />
        </View>

        <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
          Podgląd niczego nie zapisuje — harmonogram tych kart zostaje nietknięty.
        </ThemedText>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  controls: {
    padding: Spacing.three,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  steps: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  step: {
    flex: 1,
  },
  note: {
    textAlign: 'center',
  },
});
