import { Animated, View, type ViewStyle } from 'react-native';

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
  style?: ViewStyle;
};

const clamp = (share: number) => Math.max(0, Math.min(1, share));

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
  style,
}: MeterProps) {
  const grow = useEntrance();

  return (
    <View style={[{ height, borderRadius: height / 2, backgroundColor: trackColor }, style]}>
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
        <View
          style={{
            position: 'absolute',
            left: `${clamp(marker) * 100}%`,
            top: -3,
            bottom: -3,
            width: 2,
            marginLeft: -1,
            borderRadius: 1,
            backgroundColor: markerColor ?? color,
          }}
        />
      ) : null}
    </View>
  );
}
