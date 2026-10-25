import { StyleSheet, View, type ViewStyle } from 'react-native';

import { RatingColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { goalShare } from '@/lib/goals';

/**
 * How far today's goal is: accent while it is not met, the green of "Dobrze"
 * once it is. Plain `View`s, like every other bar in the app.
 */
export function GoalBar({
  today,
  height = 6,
  style,
}: {
  today: { answers: number; goal: number; met: boolean };
  height?: number;
  style?: ViewStyle;
}) {
  const theme = useTheme();

  return (
    <View
      style={[styles.track, { height, borderRadius: height / 2, backgroundColor: theme.backgroundSelected }, style]}>
      <View
        style={{
          width: `${goalShare(today) * 100}%`,
          height: '100%',
          borderRadius: height / 2,
          backgroundColor: today.met ? RatingColors.good : theme.accent,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    overflow: 'hidden',
  },
});
