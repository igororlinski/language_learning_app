import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

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

/**
 * A hamburger: three stacked bars. Like the speaker, it is three views so it
 * answers to `color` and renders on the first frame — a glyph would have to be
 * loaded and a colour-emoji would ignore the colour entirely.
 */
export function MenuIcon({ size = 20, color, style }: IconProps) {
  const bar = Math.max(1.5, size / 10);
  const line = { height: bar, borderRadius: bar / 2, backgroundColor: color };

  // `space-between` pins the bars to top, middle and bottom of the box; the
  // default column stretch gives each bar the box's full width.
  return (
    <View style={[{ width: size, height: size * 0.72, justifyContent: 'space-between' }, style]}>
      <View style={line} />
      <View style={line} />
      <View style={line} />
    </View>
  );
}

/**
 * A podium — second, first, third — for the ranking. Three views standing on
 * one line, so it answers to `color` like the rest of these.
 */
export function PodiumIcon({ size = 20, color, style }: IconProps) {
  const gap = Math.max(1, size / 14);
  const step = { flex: 1, backgroundColor: color, borderTopLeftRadius: gap, borderTopRightRadius: gap };

  return (
    <View style={[{ width: size, height: size * 0.8, flexDirection: 'row', alignItems: 'flex-end', gap }, style]}>
      <View style={[step, { height: '62%' }]} />
      <View style={[step, { height: '100%' }]} />
      <View style={[step, { height: '42%' }]} />
    </View>
  );
}

/**
 * A question mark in a ring, for the help buttons. The ring is a view; the
 * mark is plain text in the system font — a monochrome glyph, unlike an emoji,
 * so it takes the colour it is given.
 */
export function HelpIcon({ size = 16, color, style }: IconProps) {
  const stroke = Math.max(1, size / 12);

  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: stroke,
          borderColor: color,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}>
      <Text
        allowFontScaling={false}
        style={{
          color,
          fontSize: size * 0.68,
          lineHeight: size * 0.8,
          fontWeight: '700',
          includeFontPadding: false,
          textAlign: 'center',
        }}>
        ?
      </Text>
    </View>
  );
}

/** An icon drawn on something coloured, which some shapes cut into. */
export type CutIconProps = IconProps & {
  /**
   * The colour of what the icon stands on — a leaf's vein, a bulb's glint and
   * the edge between two cards are drawn in it, so they read as cut out of the
   * shape. Without it they are left out.
   */
  cut?: string;
};

/** A box of `size` that centres what is inside it. */
const box = (size: number, style?: ViewStyle): ViewStyle[] => [
  { width: size, height: size, alignItems: 'center', justifyContent: 'center' },
  ...(style ? [style] : []),
];

/**
 * One drop of flame: a square with three corners rounded into a circle and the
 * fourth left sharp, turned so the sharp corner points up. `side` is the
 * square's; the drop stands `side * 1.207` tall, its circle's centre
 * `side * 0.707` below the tip.
 */
function drop(side: number, centreX: number, tipY: number, color: string): ViewStyle {
  return {
    position: 'absolute',
    left: centreX - side / 2,
    top: tipY + side * 0.707 - side / 2,
    width: side,
    height: side,
    backgroundColor: color,
    borderTopLeftRadius: side / 2,
    borderBottomLeftRadius: side / 2,
    borderBottomRightRadius: side / 2,
    transform: [{ rotate: '-45deg' }],
  };
}

/** How much taller than a drop the flame is drawn: a round drop reads as water. */
const FLAME_STRETCH = 1.22;

/**
 * The streak's flame: an outer drop and a core drop sitting low inside it, the
 * way a flame is brightest at its base, both stretched upwards — a round drop
 * reads as water, a tall one as fire. Two colours: `color` for the body,
 * `core` for the heart.
 */
export function FlameIcon({ size = 24, color, core, style }: IconProps & { core: string }) {
  const height = size / FLAME_STRETCH;
  const outer = height / 1.207;
  const inner = outer * 0.56;
  const innerTip = height - outer * 0.08 - inner * 1.207;

  return (
    <View style={[{ width: outer, height: size, justifyContent: 'center' }, style]}>
      <View style={{ width: outer, height, transform: [{ scaleY: FLAME_STRETCH }] }}>
        <View style={drop(outer, outer / 2, 0, color)} />
        <View style={drop(inner, outer / 2, innerTip, core)} />
      </View>
    </View>
  );
}

/**
 * A cog: eight teeth around a thick ring. Each tooth stands at the top of its
 * own full-size layer and the layer is turned, so every tooth turns about the
 * cog's centre without any trigonometry.
 */
export function GearIcon({ size = 20, color, style }: IconProps) {
  const tooth = { width: size * 0.2, height: size * 0.27, borderRadius: size * 0.045, backgroundColor: color };
  const body = size * 0.74;

  return (
    <View style={box(size, style)}>
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
        <View
          key={angle}
          style={[StyleSheet.absoluteFill, { alignItems: 'center', transform: [{ rotate: `${angle}deg` }] }]}>
          <View style={tooth} />
        </View>
      ))}
      <View
        style={{
          width: body,
          height: body,
          borderRadius: body / 2,
          borderWidth: size * 0.17,
          borderColor: color,
        }}
      />
    </View>
  );
}

/**
 * A pencil, for renaming: the cap, the body and the point, stood on end and
 * turned so the point is down and to the left.
 */
export function PencilIcon({ size = 18, color, style }: IconProps) {
  const width = size * 0.26;

  return (
    <View style={box(size, style)}>
      <View style={{ alignItems: 'center', transform: [{ rotate: '45deg' }] }}>
        <View style={{ width, height: size * 0.14, borderRadius: size * 0.04, backgroundColor: color }} />
        <View style={{ width, height: size * 0.5, marginTop: size * 0.05, backgroundColor: color }} />
        <View
          style={{
            width: 0,
            height: 0,
            borderTopWidth: size * 0.2,
            borderTopColor: color,
            borderLeftWidth: width / 2,
            borderLeftColor: 'transparent',
            borderRightWidth: width / 2,
            borderRightColor: 'transparent',
          }}
        />
      </View>
    </View>
  );
}

/** A plus, for adding: two rounded bars crossing. */
export function PlusIcon({ size = 18, color, style }: IconProps) {
  const stroke = Math.max(2, size * 0.14);
  const bar = { position: 'absolute' as const, borderRadius: stroke / 2, backgroundColor: color };

  return (
    <View style={box(size, style)}>
      <View style={[bar, { width: size * 0.8, height: stroke }]} />
      <View style={[bar, { width: stroke, height: size * 0.8 }]} />
    </View>
  );
}

/** A tick: the bottom and right edges of a tall box, turned an eighth. */
export function CheckIcon({ size = 16, color, style }: IconProps) {
  const stroke = Math.max(1.5, size * 0.15);

  return (
    <View style={box(size, style)}>
      <View
        style={{
          width: size * 0.34,
          height: size * 0.62,
          marginTop: -size * 0.14,
          borderRightWidth: stroke,
          borderBottomWidth: stroke,
          borderColor: color,
          borderBottomRightRadius: stroke / 3,
          transform: [{ rotate: '45deg' }],
        }}
      />
    </View>
  );
}

/** A target — two rings and a bull's-eye — for days the goal was met. */
export function TargetIcon({ size = 20, color, style }: IconProps) {
  const stroke = Math.max(1.5, size * 0.11);
  const ring = (diameter: number): ViewStyle => ({
    position: 'absolute',
    width: diameter,
    height: diameter,
    borderRadius: diameter / 2,
    borderWidth: stroke,
    borderColor: color,
  });
  const eye = size * 0.22;

  return (
    <View style={box(size, style)}>
      <View style={ring(size)} />
      <View style={ring(size * 0.6)} />
      <View style={{ width: eye, height: eye, borderRadius: eye / 2, backgroundColor: color }} />
    </View>
  );
}

/** A clock at three — a ring and two hands — for time spent studying. */
export function ClockIcon({ size = 20, color, style }: IconProps) {
  const stroke = Math.max(1.5, size * 0.11);
  const hand = (length: number, horizontal: boolean): ViewStyle => ({
    position: 'absolute',
    left: horizontal ? size / 2 - stroke / 2 : size / 2 - stroke / 2,
    top: horizontal ? size / 2 - stroke / 2 : size / 2 - length + stroke / 2,
    width: horizontal ? length : stroke,
    height: horizontal ? stroke : length,
    borderRadius: stroke / 2,
    backgroundColor: color,
  });

  return (
    <View style={[{ width: size, height: size }, style]}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: stroke,
          borderColor: color,
        }}
      />
      <View style={hand(size * 0.32, false)} />
      <View style={hand(size * 0.26, true)} />
    </View>
  );
}

/** Two cards, one fanned out behind the other — for answers given. */
export function CardsIcon({ size = 20, color, cut, style }: CutIconProps) {
  const card: ViewStyle = {
    position: 'absolute',
    width: size * 0.5,
    height: size * 0.68,
    borderRadius: size * 0.08,
  };

  return (
    <View style={[{ width: size, height: size }, style]}>
      <View
        style={[
          card,
          {
            left: size * 0.13,
            top: size * 0.1,
            borderWidth: Math.max(1.5, size * 0.09),
            borderColor: color,
            transform: [{ rotate: '-14deg' }],
          },
        ]}
      />
      <View
        style={[
          card,
          {
            left: size * 0.37,
            top: size * 0.2,
            backgroundColor: color,
            // An edge cut into the back card, so the two do not run together.
            borderWidth: cut ? Math.max(1, size * 0.06) : 0,
            borderColor: cut,
            transform: [{ rotate: '10deg' }],
          },
        ]}
      />
    </View>
  );
}

/**
 * A lightning bolt — for the most answers in a day. Two triangles, each a view
 * with only borders: an upper one standing on its flat edge, a lower one
 * hanging from its flat edge, overlapping where the bolt bends.
 */
export function BoltIcon({ size = 20, color, style }: IconProps) {
  return (
    <View style={[{ width: size, height: size }, style]}>
      <View
        style={{
          position: 'absolute',
          left: size * 0.18,
          top: 0,
          width: 0,
          height: 0,
          borderBottomWidth: size * 0.56,
          borderBottomColor: color,
          borderLeftWidth: size * 0.42,
          borderLeftColor: 'transparent',
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: size * 0.4,
          top: size * 0.42,
          width: 0,
          height: 0,
          borderTopWidth: size * 0.58,
          borderTopColor: color,
          borderRightWidth: size * 0.42,
          borderRightColor: 'transparent',
        }}
      />
    </View>
  );
}

/**
 * A leaf on a stem — for mature cards. The leaf is a square with two opposite
 * corners rounded all the way, which leaves a pointed lens lying corner to
 * corner; the stem and the vein run along the same diagonal.
 */
export function LeafIcon({ size = 20, color, cut, style }: CutIconProps) {
  const leaf = size * 0.66;
  const left = size * 0.24;
  const top = size * 0.06;
  const stroke = Math.max(1.5, size * 0.08);
  const line = (length: number, centreX: number, centreY: number, tone: string): ViewStyle => ({
    position: 'absolute',
    left: centreX - stroke / 2,
    top: centreY - length / 2,
    width: stroke,
    height: length,
    borderRadius: stroke / 2,
    backgroundColor: tone,
    transform: [{ rotate: '45deg' }],
  });

  return (
    <View style={[{ width: size, height: size }, style]}>
      <View style={line(size * 0.32, left - size * 0.06, top + leaf + size * 0.06, color)} />
      <View
        style={{
          position: 'absolute',
          left,
          top,
          width: leaf,
          height: leaf,
          backgroundColor: color,
          borderTopLeftRadius: leaf,
          borderBottomRightRadius: leaf,
        }}
      />
      {cut ? <View style={line(leaf * 0.9, left + leaf / 2, top + leaf / 2, cut)} /> : null}
    </View>
  );
}

/** A light bulb — for associations: a round glass, its neck and the cap. */
export function BulbIcon({ size = 20, color, cut, style }: CutIconProps) {
  const glass = size * 0.62;
  const glint = size * 0.13;

  return (
    <View style={[{ width: size, height: size, alignItems: 'center' }, style]}>
      <View
        style={{
          marginTop: size * 0.02,
          width: glass,
          height: glass,
          borderRadius: glass / 2,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          marginTop: -size * 0.1,
          width: size * 0.32,
          height: size * 0.22,
          borderBottomLeftRadius: size * 0.05,
          borderBottomRightRadius: size * 0.05,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          marginTop: size * 0.05,
          width: size * 0.22,
          height: size * 0.08,
          borderRadius: size * 0.04,
          backgroundColor: color,
        }}
      />
      {cut ? (
        <View
          style={{
            position: 'absolute',
            left: size / 2 - glass * 0.28,
            top: size * 0.02 + glass * 0.2,
            width: glint,
            height: glint,
            borderRadius: glint / 2,
            backgroundColor: cut,
            opacity: 0.6,
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
