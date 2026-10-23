import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { CardFaces, cardFacesLayout } from '@/components/card-faces';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Radius, RatingColors, Spacing } from '@/constants/theme';
import { cardSchedule, deckLanguages, deckScheduling } from '@/db/queries';
import { useTheme } from '@/hooks/use-theme';
import type { CardLine } from '@/lib/card-layout';
import { formatSchedule } from '@/lib/format';
import { GRADE_LABELS, GRADES, previewGrades, Rating, type Grade } from '@/lib/scheduler';
import { speechVoice } from '@/lib/speech';

const RATING_COLOR: Record<Grade, string> = {
  [Rating.Again]: RatingColors.again,
  [Rating.Hard]: RatingColors.hard,
  [Rating.Good]: RatingColors.good,
  [Rating.Easy]: RatingColors.easy,
};

/**
 * Expo Router renders this in place of the screen when it throws, keeping the
 * navigator — and the way back — alive. See `src/components/error-screen.tsx`.
 */
export { ErrorScreen as ErrorBoundary } from '@/components/error-screen';

/** The two faces the editor sends, or nothing at all when they do not parse. */
function parseFaces(json: string | undefined): { front: CardLine[]; back: CardLine[] } {
  try {
    const parsed = JSON.parse(json ?? '') as { front?: unknown; back?: unknown };

    return {
      front: Array.isArray(parsed.front) ? (parsed.front as CardLine[]) : [],
      back: Array.isArray(parsed.back) ? (parsed.back as CardLine[]) : [],
    };
  } catch {
    return { front: [], back: [] };
  }
}

/**
 * The card being edited, on the screen a review shows it on — full screen, the
 * front alone until „Pokaż odpowiedź", then the back and the four grades with
 * the intervals this card would really get.
 *
 * It replaces a box inside the editor that drew both faces at once in small
 * type, which showed what the card holds but not how it reads: whether the
 * question gives the answer away is only visible with the back still hidden.
 *
 * **Nothing here is saved.** The faces arrive from the editor's unsaved form,
 * worked out by the same `sideLines` the session uses, and a grade only ends
 * the preview — the way grading ends a card in review — without touching the
 * schedule or `review_logs`.
 */
export default function CardPreviewScreen() {
  const theme = useTheme();
  const router = useRouter();

  const {
    deckId: deckIdParam,
    cardId: cardIdParam,
    faces: facesParam,
  } = useLocalSearchParams<{ deckId: string; cardId?: string; faces: string }>();

  const deckId = Number(deckIdParam);
  const cardId = cardIdParam ? Number(cardIdParam) : null;

  const faces = useMemo(() => parseFaces(facesParam), [facesParam]);

  /** The fallback voice for a retired `speech` field, as in the session. */
  const voice = useMemo(() => speechVoice(deckLanguages(deckId)), [deckId]);

  // Where the card stands now — a new card, if it has never been saved — so
  // the buttons promise what a review today would actually schedule. The
  // instant travels with it for the reason it does in the session: the labels
  // are measured against the moment the schedule was computed for.
  const grades = useMemo(() => {
    const at = new Date();

    return {
      at: at.getTime(),
      byGrade: previewGrades(cardSchedule(cardId, at), at, deckScheduling(deckId)),
    };
  }, [cardId, deckId]);

  const [revealed, setRevealed] = useState(false);

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: theme.background }]}
      edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <ThemedText type="small" themeColor="textSecondary">
          Podgląd
        </ThemedText>
        <View style={styles.topActions}>
          {revealed ? (
            <Pressable
              onPress={() => setRevealed(false)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Od początku">
              <ThemedText type="small" style={{ color: theme.accent }}>
                Od początku
              </ThemedText>
            </Pressable>
          ) : null}
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
      </View>

      <ScrollView contentContainerStyle={cardFacesLayout.area}>
        <CardFaces
          frontLines={faces.front}
          backLines={faces.back}
          revealed={revealed}
          voice={voice}
        />
      </ScrollView>

      <View style={styles.controls}>
        {revealed ? (
          <View style={styles.grades}>
            {GRADES.map((grade) => {
              const next = grades.byGrade[grade].card;

              return (
                <Pressable
                  key={grade}
                  onPress={() => router.back()}
                  accessibilityRole="button"
                  accessibilityLabel={GRADE_LABELS[grade]}
                  style={({ pressed }) => [
                    styles.gradeButton,
                    { backgroundColor: RATING_COLOR[grade], opacity: pressed ? 0.75 : 1 },
                  ]}>
                  <ThemedText type="smallBold" style={styles.gradeLabel}>
                    {GRADE_LABELS[grade]}
                  </ThemedText>
                  <ThemedText type="small" style={styles.gradeInterval}>
                    {formatSchedule(next.scheduled_days, next.due.getTime() - grades.at)}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <Button title="Pokaż odpowiedź" onPress={() => setRevealed(true)} />
        )}
      </View>
    </SafeAreaView>
  );
}

// The review screen's own measurements, so the two cannot be told apart.
const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
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
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  grades: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  gradeButton: {
    flex: 1,
    minHeight: 60,
    borderRadius: Radius.medium,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.half,
    paddingHorizontal: Spacing.one,
  },
  gradeLabel: {
    color: '#FFFFFF',
  },
  gradeInterval: {
    color: '#FFFFFFCC',
  },
});
