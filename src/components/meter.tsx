import { Animated, StyleSheet, View, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useEntrance } from '@/hooks/use-entrance';

export type MeterProps = {
  /** Share filled, 0–1; anything outside is clamped. */
  share: number;
  color: string;
  trackColor: string;
  height?: number;
  /** A tick across the bar at this share — a target to compare against. */
  marker?: number | null;
  markerColor?: string;
  /** Written over the marker, so it says what it is — `cel 90%`. */
  markerLabel?: string;
  style?: ViewStyle;
};

const clamp = (share: number) => Math.max(0, Math.min(1, share));

/** Room for the label over the marker, centred on it. */
const LABEL_WIDTH = 80;

/**
 * A horizontal bar that grows in from the left when it first appears. The
 * fill is laid out at its final width and scaled from zero, so the rounded
 * ends are never stretched once it has arrived.
 */
export function Meter({
  share,
  color,
  trackColor,
  height = 8,
  marker = null,
  markerColor,
  markerLabel,
  style,
}: MeterProps) {
  const grow = useEntrance();
  const tick = markerColor ?? color;

  return (
    <View style={style}>
      {marker != null && markerLabel ? (
        <View style={styles.labelRow}>
          <ThemedText
            type="small"
            numberOfLines={1}
            style={[styles.label, { left: `${clamp(marker) * 100}%`, color: tick }]}>
            {markerLabel}
          </ThemedText>
        </View>
      ) : null}

      <View style={{ height, borderRadius: height / 2, backgroundColor: trackColor }}>
        <Animated.View
          style={{
            width: `${clamp(share) * 100}%`,
            height: '100%',
            borderRadius: height / 2,
            backgroundColor: color,
            transformOrigin: 'left',
            transform: [{ scaleX: grow }],
          }}
        />
        {marker != null ? (
          <View style={[styles.tick, { left: `${clamp(marker) * 100}%`, backgroundColor: tick }]} />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  labelRow: {
    height: 18,
    marginBottom: 2,
  },
  label: {
    position: 'absolute',
    width: LABEL_WIDTH,
    marginLeft: -LABEL_WIDTH / 2,
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 18,
  },
  tick: {
    position: 'absolute',
    top: -3,
    bottom: -3,
    width: 2,
    marginLeft: -1,
    borderRadius: 1,
  },
});
