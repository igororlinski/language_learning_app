import type { ReactNode } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { useEntrance } from '@/hooks/use-entrance';

export type ProgressRingProps = {
  /** Outer diameter. */
  size: number;
  stroke: number;
  /** Share done, 0–1; anything outside is clamped. */
  progress: number;
  color: string;
  trackColor: string;
  /** Shown in the middle of the ring. */
  children?: ReactNode;
};

/**
 * A ring that fills clockwise from the top, out of plain views — like the
 * icons, so it needs no SVG — sweeping round to its share when it first
 * appears.
 *
 * Each half of the ring is a clip. Inside the right clip turns a half ring
 * that starts hidden on the left and sweeps into view as it turns, up to half
 * the way; the left clip does the same for the second half, starting from the
 * bottom. Round caps cover the flat ends the clips leave: one fixed at the top,
 * one riding a full-size layer that turns with the sweep. Every moving part is
 * a rotation, so the sweep runs on the native driver.
 */
export function ProgressRing({ size, stroke, progress, color, trackColor, children }: ProgressRingProps) {
  const share = Math.max(0, Math.min(1, progress));
  const grow = useEntrance();
  const swept = Animated.multiply(grow, share);
  const half = size / 2;

  const ring = {
    position: 'absolute' as const,
    top: 0,
    width: size,
    height: size,
    borderRadius: half,
    borderWidth: stroke,
    borderColor: color,
  };
  const clip = { position: 'absolute' as const, top: 0, width: half, height: size, overflow: 'hidden' as const };
  const layer = { position: 'absolute' as const, top: 0, width: size, height: size };
  const turn = (input: number[], degrees: number[]) => ({
    transform: [
      {
        rotate: swept.interpolate({
          inputRange: input,
          outputRange: degrees.map((value) => `${value}deg`),
        }),
      },
    ],
  });
  const cap = {
    position: 'absolute' as const,
    top: 0,
    left: half - stroke / 2,
    width: stroke,
    height: stroke,
    borderRadius: stroke / 2,
    backgroundColor: color,
  };

  return (
    <View style={{ width: size, height: size }}>
      <View style={[ring, { left: 0, borderColor: trackColor }]} />

      {share > 0 ? (
        <>
          <View style={[clip, { left: half }]}>
            <Animated.View style={[layer, { left: -half }, turn([0, 0.5, 1], [0, 180, 180])]}>
              <View style={[clip, { left: 0 }]}>
                <View style={[ring, { left: 0 }]} />
              </View>
            </Animated.View>
          </View>

          {share > 0.5 ? (
            <View style={[clip, { left: 0 }]}>
              <Animated.View style={[layer, { left: 0 }, turn([0, 0.5, 1], [0, 0, 180])]}>
                <View style={[clip, { left: half }]}>
                  <View style={[ring, { left: -half }]} />
                </View>
              </Animated.View>
            </View>
          ) : null}

          {share < 1 ? (
            <>
              <View style={cap} />
              <Animated.View style={[layer, { left: 0 }, turn([0, 1], [0, 360])]}>
                <View style={cap} />
              </Animated.View>
            </>
          ) : null}
        </>
      ) : null}

      <View style={[StyleSheet.absoluteFill, styles.middle]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  middle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
