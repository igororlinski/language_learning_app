import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

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
 * icons, so it needs no SVG.
 *
 * Each half of the ring is a clip. Inside the right clip turns a half ring
 * that starts hidden on the left and sweeps into view as it turns, up to half
 * the way; the left clip does the same for the second half, starting from the
 * bottom. Round caps cover the flat ends the clips leave.
 */
export function ProgressRing({ size, stroke, progress, color, trackColor, children }: ProgressRingProps) {
  const share = Math.max(0, Math.min(1, progress));
  const angle = share * 360;
  const half = size / 2;
  const radius = half - stroke / 2;

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
  const turning = (degrees: number) => ({
    position: 'absolute' as const,
    top: 0,
    width: size,
    height: size,
    transform: [{ rotate: `${degrees}deg` }],
  });
  const cap = (x: number, y: number) => ({
    position: 'absolute' as const,
    left: x - stroke / 2,
    top: y - stroke / 2,
    width: stroke,
    height: stroke,
    borderRadius: stroke / 2,
    backgroundColor: color,
  });

  const end = (angle * Math.PI) / 180;

  return (
    <View style={{ width: size, height: size }}>
      <View style={[ring, { left: 0, borderColor: trackColor }]} />

      {share > 0 ? (
        <>
          <View style={[clip, { left: half }]}>
            <View style={[turning(Math.min(angle, 180)), { left: -half }]}>
              <View style={[clip, { left: 0 }]}>
                <View style={[ring, { left: 0 }]} />
              </View>
            </View>
          </View>

          {angle > 180 ? (
            <View style={[clip, { left: 0 }]}>
              <View style={[turning(angle - 180), { left: 0 }]}>
                <View style={[clip, { left: half }]}>
                  <View style={[ring, { left: -half }]} />
                </View>
              </View>
            </View>
          ) : null}

          {share < 1 ? (
            <>
              <View style={cap(half, stroke / 2)} />
              <View style={cap(half + radius * Math.sin(end), half - radius * Math.cos(end))} />
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
