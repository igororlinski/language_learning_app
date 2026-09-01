import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CardFaces, cardFacesLayout } from '@/components/card-faces';
import { Button } from '@/components/button';
import { DueCounts } from '@/components/due-counts';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Radius, RatingColors, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatSchedule } from '@/lib/format';
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
  const refreshCurrent = useReviewStore((s) => s.refreshCurrent);
  const retention = useReviewStore((s) => s.retention);

  useEffect(() => {
    start(deckId);
    return reset;
  }, [deckId, start, reset]);

  // Coming back from the editor: the queue is a snapshot, so the card it holds
  // has to be read again before it is shown any further.
  useFocusEffect(
    useCallback(() => {
      refreshCurrent();
    }, [refreshCurrent])
  );

  const current = queue[0];

  // Recomputed per card so the buttons show the interval each answer would set.
  // The instant is carried along with it: the labels have to be measured against
  // the same moment the schedule was computed for, and reading the clock while
  // rendering is impure — React Compiler may reorder or skip such a render.
  const preview = useMemo(() => {
    if (!current) return null;

    const at = new Date();
    return { at: at.getTime(), grades: previewGrades(current.fsrs, at, retention) };
  }, [current, retention]);

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
          {current ? (
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/card-editor',
                  params: { deckId, cardId: current.cardId },
                })
              }
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Edytuj tę kartę">
              <ThemedText type="small" style={{ color: theme.accent }}>
                Edytuj
              </ThemedText>
            </Pressable>
          ) : null}
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
          <ScrollView contentContainerStyle={cardFacesLayout.area}>
            <CardFaces
              frontLines={current.frontLines}
              backLines={current.backLines}
              revealed={revealed}
            />
          </ScrollView>

          <View style={styles.controls}>
            {revealed && preview ? (
              <View style={styles.grades}>
                {GRADES.map((grade) => {
                  const next = preview.grades[grade].card;
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
                        {formatSchedule(next.scheduled_days, next.due.getTime() - preview.at)}
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
