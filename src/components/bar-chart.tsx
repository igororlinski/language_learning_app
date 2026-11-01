import { Animated, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useEntrance } from '@/hooks/use-entrance';
import { useTheme } from '@/hooks/use-theme';

export type ChartBar = {
  key: string | number;
  value: number;
  /** Under the bar: the day it stands for. */
  label: string;
  /** Today's bar — full accent and a bold label; the rest are paler. */
  highlight?: boolean;
};

export type BarChartProps = {
  bars: readonly ChartBar[];
  height: number;
  /** Each bar's value written over it. */
  showValues?: boolean;
};

/**
 * A row of bars over a baseline, each as tall as its share of the highest,
 * growing up from the line when the chart first appears. A bar of zero is
 * left out — an empty day should look empty, not like a little bit.
 */
export function BarChart({ bars, height, showValues = false }: BarChartProps) {
  const theme = useTheme();
  const grow = useEntrance();
  const peak = Math.max(1, ...bars.map((bar) => bar.value));

  return (
    <View>
      <View style={[styles.plot, { borderBottomColor: theme.border }]}>
        {bars.map((bar) => (
          <View key={bar.key} style={styles.column}>
            {showValues ? (
              <ThemedText
                type="small"
                style={[styles.value, { color: theme.textSecondary, opacity: bar.value > 0 ? 1 : 0.5 }]}>
                {bar.value}
              </ThemedText>
            ) : null}
            <View style={[styles.slot, { height }]}>
              {bar.value > 0 ? (
                <Animated.View
                  style={[
                    styles.bar,
                    {
                      height: Math.max(3, (bar.value / peak) * height),
                      backgroundColor: theme.accent,
                      opacity: bar.highlight ? 1 : 0.35,
                      transformOrigin: 'bottom',
                      transform: [{ scaleY: grow }],
                    },
                  ]}
                />
              ) : null}
            </View>
          </View>
        ))}
      </View>

      <View style={styles.labels}>
        {bars.map((bar) => (
          <ThemedText
            key={bar.key}
            type={bar.highlight ? 'smallBold' : 'small'}
            style={[styles.label, { color: bar.highlight ? theme.accent : theme.textSecondary }]}>
            {bar.label}
          </ThemedText>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  plot: {
    flexDirection: 'row',
    gap: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  column: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.one,
  },
  value: {
    fontVariant: ['tabular-nums'],
  },
  slot: {
    width: '100%',
    justifyContent: 'flex-end',
  },
  bar: {
    width: '100%',
    borderTopLeftRadius: Radius.small,
    borderTopRightRadius: Radius.small,
  },
  labels: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  label: {
    flex: 1,
    textAlign: 'center',
  },
});
