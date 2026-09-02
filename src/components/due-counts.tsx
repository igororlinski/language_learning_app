import { StyleSheet, View, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { QueueColors, Spacing } from '@/constants/theme';
import type { QueueCounts } from '@/lib/scheduler';

/** Anki's bottom bar, in Anki's order: new, learning, review. */
const SEGMENTS: { key: keyof QueueCounts; color: string; label: string }[] = [
  { key: 'newCount', color: QueueColors.new, label: 'nowe' },
  { key: 'learningCount', color: QueueColors.learning, label: 'nauka' },
  { key: 'reviewCount', color: QueueColors.review, label: 'powtórki' },
];

export type DueCountsProps = {
  counts: QueueCounts;
  /** Adds the category name next to each number. Off by default to stay compact. */
  showLabels?: boolean;
  style?: ViewStyle;
};

export function DueCounts({ counts, showLabels = false, style }: DueCountsProps) {
  return (
    <View style={[styles.row, style]}>
      {SEGMENTS.map((segment) => (
        <View key={segment.key} style={styles.segment}>
          <ThemedText
            type="smallBold"
            // Zeros are dimmed rather than dropped, so the three slots never shift.
            style={{ color: segment.color, opacity: counts[segment.key] > 0 ? 1 : 0.35 }}>
            {counts[segment.key]}
          </ThemedText>
          {showLabels ? (
            <ThemedText type="small" themeColor="textSecondary">
              {segment.label}
            </ThemedText>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  segment: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.one,
  },
});
