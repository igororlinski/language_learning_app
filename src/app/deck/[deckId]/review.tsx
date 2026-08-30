import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { DueCounts } from '@/components/due-counts';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Radius, RatingColors, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatInterval } from '@/lib/format';
import {
  countQueueStates,
  GRADE_LABELS,
  GRADES,
  previewGrades,
  Rating,
  type Grade,
} from '@/lib/scheduler';
import { useReviewStore } from '@/stores/review-store';

const RATING_COLOR: Record<Grade, string> = {
  [Rating.Again]: RatingColors.again,
  [Rating.Hard]: RatingColors.hard,
  [Rating.Good]: RatingColors.good,
  [Rating.Easy]: RatingColors.easy,
};

export default function ReviewScreen() {
  const theme = useTheme();
  const router = useRouter();

  const { deckId: deckIdParam } = useLocalSearchParams<{ deckId: string }>();
  const deckId = Number(deckIdParam);

  const queue = useReviewStore((s) => s.queue);
  const revealed = useReviewStore((s) => s.revealed);
  const answered = useReviewStore((s) => s.answered);
  const gradeCounts = useReviewStore((s) => s.gradeCounts);
  const start = useReviewStore((s) => s.start);
  const reveal = useReviewStore((s) => s.reveal);
  const answer = useReviewStore((s) => s.answer);
  const reset = useReviewStore((s) => s.reset);
  const history = useReviewStore((s) => s.history);
  const undo = useReviewStore((s) => s.undo);

  useEffect(() => {
    start(deckId);
    return reset;
  }, [deckId, start, reset]);

  const current = queue[0];

  // Recomputed per card so the buttons show the interval each answer would set.
  const preview = useMemo(() => (current ? previewGrades(current.fsrs, new Date()) : null), [current]);

  // Anki's bottom bar: what is still ahead in this session, by state.
  const remaining = useMemo(() => countQueueStates(queue.map((card) => card.fsrs.state)), [queue]);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        {current ? (
          <DueCounts counts={remaining} />
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            {`Odpowiedzi: ${answered}`}
          </ThemedText>
        )}
        <View style={styles.topActions}>
          {history.length > 0 ? (
            <Pressable onPress={undo} hitSlop={12}>
              <ThemedText type="small" style={{ color: theme.accent }}>
                Cofnij
              </ThemedText>
            </Pressable>
          ) : null}
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <ThemedText type="small" style={{ color: theme.accent }}>
              Zakończ
            </ThemedText>
          </Pressable>
        </View>
      </View>

      {current ? (
        <>
          <ScrollView contentContainerStyle={styles.cardArea}>
            <ThemedText style={styles.face}>{current.front}</ThemedText>

            {revealed ? (
              <>
                <View style={[styles.divider, { backgroundColor: theme.border }]} />
                <ThemedText style={[styles.face, styles.back]}>{current.back}</ThemedText>
              </>
            ) : null}
          </ScrollView>

          <View style={styles.controls}>
            {revealed && preview ? (
              <View style={styles.grades}>
                {GRADES.map((grade) => {
                  const next = preview[grade].card.due.getTime() - Date.now();
                  return (
                    <Pressable
                      key={grade}
                      onPress={() => answer(grade)}
                      style={({ pressed }) => [
                        styles.gradeButton,
                        { backgroundColor: RATING_COLOR[grade], opacity: pressed ? 0.75 : 1 },
                      ]}>
                      <ThemedText type="smallBold" style={styles.gradeLabel}>
                        {GRADE_LABELS[grade]}
                      </ThemedText>
                      <ThemedText type="small" style={styles.gradeInterval}>
                        {formatInterval(next)}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <Button title="Pokaż odpowiedź" onPress={reveal} />
            )}
          </View>
        </>
      ) : (
        <View style={styles.summary}>
          <ThemedText style={styles.summaryTitle}>
            {answered > 0 ? 'Sesja zakończona' : 'Nic do powtórki'}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {answered > 0
              ? `${answered} odpowiedzi w tej sesji`
              : 'Wróć później albo dodaj nowe karty.'}
          </ThemedText>

          {answered > 0 ? (
            <View style={styles.summaryCounts}>
              {GRADES.map((grade) => (
                <View key={grade} style={styles.summaryCount}>
                  <ThemedText style={[styles.summaryNumber, { color: RATING_COLOR[grade] }]}>
                    {gradeCounts[grade]}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {GRADE_LABELS[grade]}
                  </ThemedText>
                </View>
              ))}
            </View>
          ) : null}

          <Button title="Wróć do talii" onPress={() => router.back()} style={styles.summaryButton} />
        </View>
      )}
    </SafeAreaView>
  );
}

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
  cardArea: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.four,
    padding: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  face: {
    fontSize: 26,
    lineHeight: 34,
    fontWeight: '600',
    textAlign: 'center',
  },
  back: {
    fontWeight: '400',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
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
  summary: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  summaryTitle: {
    fontSize: 24,
    fontWeight: '600',
  },
  summaryCounts: {
    flexDirection: 'row',
    gap: Spacing.four,
    paddingVertical: Spacing.three,
  },
  summaryCount: {
    alignItems: 'center',
    gap: Spacing.half,
  },
  summaryNumber: {
    fontSize: 22,
    fontWeight: '700',
  },
  summaryButton: {
    alignSelf: 'stretch',
  },
});
