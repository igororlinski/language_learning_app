import { Animated, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useEntrance } from '@/hooks/use-entrance';
import { useTheme } from '@/hooks/use-theme';

export type ChartBar = {
  key: string | number;
  value: number;
  /**
   * The bar in coloured layers, bottom first, instead of one accent block;
   * `value` is still their total.
   */
  stack?: readonly { value: number; color: string }[];
  /** Under the bar: the day it stands for. Empty for a bar left unnamed. */
  label: string;
  /** Today's bar — full accent and a bold label; the rest are paler. */
  highlight?: boolean;
};

export type BarChartProps = {
  bars: readonly ChartBar[];
  height: number;
  /** Each bar's value written over it. */
  showValues?: boolean;
  /** Thin bars with spilling labels even for a few bars — for labels wider than a bar. */
  thin?: boolean;
};

/** More bars than this and they are drawn thin, and only some are named. */
const DENSE = 14;

/** Room a label under a thin bar may take, reaching right of the bar. */
const DENSE_LABEL_WIDTH = 56;

/**
 * A row of bars over a baseline, each as tall as its share of the highest,
 * growing up from the line when the chart first appears. A bar of zero is
 * left out — an empty day should look empty, not like a little bit.
 *
 * Past `DENSE` bars (a month of days) they turn thin and close together, and
 * a label stands under its bar's left edge with room to spill to the right,
 * since a thirtieth of a phone is no room for a date.
 */
export function BarChart({ bars, height, showValues = false, thin = false }: BarChartProps) {
  const theme = useTheme();
  const grow = useEntrance();
  const peak = Math.max(1, ...bars.map((bar) => bar.value));
  const dense = thin || bars.length > DENSE;

  return (
    <View>
      <View style={[styles.plot, dense ? styles.densePlot : null, { borderBottomColor: theme.border }]}>
        {bars.map((bar) => (
          <View key={bar.key} style={styles.column}>
            {showValues && !dense ? (
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
                    dense ? styles.denseBar : styles.bar,
                    {
                      height: Math.max(3, (bar.value / peak) * height),
                      transformOrigin: 'bottom',
                      transform: [{ scaleY: grow }],
                    },
                    bar.stack
                      ? null
                      : { backgroundColor: theme.accent, opacity: bar.highlight ? 1 : 0.35 },
                  ]}>
                  {bar.stack
                    ? [...bar.stack]
                        .reverse()
                        .map((layer, index) =>
                          layer.value > 0 ? (
                            <View key={index} style={{ flex: layer.value, backgroundColor: layer.color }} />
                          ) : null
                        )
                    : null}
                </Animated.View>
              ) : null}
            </View>
          </View>
        ))}
      </View>

      {dense ? (
        <View style={styles.denseLabels}>
          {bars.map((bar, index) =>
            bar.label ? (
              <ThemedText
                key={bar.key}
                type={bar.highlight ? 'smallBold' : 'small'}
                numberOfLines={1}
                style={[
                  styles.denseLabel,
                  {
                    left: `${(index / bars.length) * 100}%`,
                    color: bar.highlight ? theme.accent : theme.textSecondary,
                  },
                ]}>
                {bar.label}
              </ThemedText>
            ) : null
          )}
        </View>
      ) : (
        <View style={styles.labels}>
          {bars.map((bar) => (
            <ThemedText
              key={bar.key}
              type={bar.highlight ? 'smallBold' : 'small'}
              numberOfLines={1}
              style={[styles.label, { color: bar.highlight ? theme.accent : theme.textSecondary }]}>
              {bar.label}
            </ThemedText>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  plot: {
    flexDirection: 'row',
    gap: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  densePlot: {
    gap: 3,
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
    overflow: 'hidden',
    borderTopLeftRadius: Radius.small,
    borderTopRightRadius: Radius.small,
  },
  denseBar: {
    width: '100%',
    overflow: 'hidden',
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
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
  denseLabels: {
    height: 20,
    marginTop: Spacing.one,
  },
  denseLabel: {
    position: 'absolute',
    top: 0,
    width: DENSE_LABEL_WIDTH,
  },
});
