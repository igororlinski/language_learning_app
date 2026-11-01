import { Animated, StyleSheet, View } from 'react-native';

import { useEntrance } from '@/hooks/use-entrance';
import { useTheme } from '@/hooks/use-theme';

/**
 * `amount`, not `value`: Reanimated's Babel plugin warns about any inline style
 * reading a `.value`, taking it for a shared value.
 */
export type StackedPart = { key: string; amount: number; color: string };

/**
 * One bar split into coloured parts by their shares, a thin gap between
 * neighbours so two close colours still read as two. Grows in from the left
 * when it first appears, like `Meter`. Parts of zero are left out; with
 * nothing at all, only the track shows.
 */
export function StackedBar({ parts, height = 12 }: { parts: readonly StackedPart[]; height?: number }) {
  const theme = useTheme();
  const grow = useEntrance();
  const shown = parts.filter((part) => part.amount > 0);

  return (
    <View style={[styles.track, { height, borderRadius: height / 2, backgroundColor: theme.backgroundSelected }]}>
      <Animated.View style={[styles.fill, { transformOrigin: 'left', transform: [{ scaleX: grow }] }]}>
        {shown.map((part) => (
          <View key={part.key} style={{ flex: part.amount, backgroundColor: part.color }} />
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    overflow: 'hidden',
  },
  fill: {
    flex: 1,
    flexDirection: 'row',
    gap: 2,
  },
});
