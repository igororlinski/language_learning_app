import { StyleSheet, View, type ViewStyle } from 'react-native';

/**
 * Icons drawn out of plain views, so they take a colour like anything else.
 *
 * **Why not an emoji.** 🔊 is painted by the phone's colour emoji font, and a
 * colour font ignores what it is told: `color` does nothing to it, leaving size
 * and opacity as the only ways to make it recede. That is a dead end the moment
 * anything wants an icon to be a different colour — an accent, a warning, a
 * dimmed state — which is exactly what this file exists to make possible.
 *
 * **Why not an icon font or SVG.** `react-native-svg` is not a dependency here,
 * and the project deleted six packages on 2026-08-31 precisely because each
 * carried native code that autolinking would pull into the build; one small
 * glyph is not the reason to bring one back. An icon font would mean loading
 * and waiting for a font, with a word of a ligature name showing on the card
 * until it arrives. Views cost nothing, render on the first frame, and answer
 * to `color`.
 *
 * The trade is that shapes have to be built out of what a view can be: a
 * rectangle, a triangle made from borders, and a ring clipped down to an arc.
 * That is enough for a speaker, and it is the reason to keep these simple.
 */

export type IconProps = {
  /**
   * The icon's height in pixels; everything else is a proportion of it, so one
   * number is the whole size. Defaults to the size of a line of small text.
   */
  size?: number;
  color: string;
  style?: ViewStyle;
};

/**
 * A loudspeaker: box, cone, one sound wave.
 *
 * One wave rather than the usual two or three. At the size this is actually
 * used — beside a word on a card — a second arc is two more pixels of grey
 * that no longer read as anything, and a speaker with no wave at all reads as
 * muted.
 */
export function SpeakerIcon({ size = 14, color, style }: IconProps) {
  // The cone is the icon's full height and the box sits inside it; a speaker
  // drawn the other way round stops looking like one.
  const coneWidth = size * 0.36;
  const boxWidth = size * 0.22;
  const boxHeight = size * 0.42;

  const ring = size * 0.78;
  const stroke = Math.max(1, size / 9);
  const waveWidth = size * 0.18;
  const waveHeight = size * 0.72;

  return (
    <View style={[styles.row, style]}>
      <View
        style={{
          width: boxWidth,
          height: boxHeight,
          backgroundColor: color,
          borderTopLeftRadius: stroke / 2,
          borderBottomLeftRadius: stroke / 2,
        }}
      />

      {/*
        A triangle with its point on the left and its flat edge on the right —
        a view with no content, where only the right border is painted: its
        inner edge collapses to a point and its outer edge spans the full
        height. The half-pixel overlap keeps a seam from showing between the
        cone and the box.
      */}
      <View
        style={{
          width: 0,
          height: 0,
          marginLeft: -0.5,
          borderRightWidth: coneWidth,
          borderRightColor: color,
          borderTopWidth: size / 2,
          borderBottomWidth: size / 2,
          borderTopColor: 'transparent',
          borderBottomColor: 'transparent',
        }}
      />

      {/*
        The wave: a full ring, pushed left until only its right edge is inside
        a box that clips everything else. Drawing an arc out of a partly
        transparent border is the usual trick and leaves a visible seam where
        the colours meet; a ring is a shape the platform draws exactly, and
        clipping it is exact too.
      */}
      <View style={{ width: waveWidth, height: waveHeight, marginLeft: size * 0.1, overflow: 'hidden' }}>
        <View
          style={{
            position: 'absolute',
            right: 0,
            top: (waveHeight - ring) / 2,
            width: ring,
            height: ring,
            borderRadius: ring / 2,
            borderWidth: stroke,
            borderColor: color,
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
