import type { ReactNode } from 'react';
import { View } from 'react-native';

import {
  BoltIcon,
  BulbIcon,
  CardsIcon,
  FlameIcon,
  LeafIcon,
  TargetIcon,
  type CutIconProps,
} from '@/components/icons';
import { MedalColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { BadgeKind } from '@/lib/badges';

/** The picture on each ladder's medals. */
const EMBLEMS: Record<BadgeKind, (props: CutIconProps) => ReactNode> = {
  // The heart of the flame cut out, like a leaf's vein.
  streak: ({ size, color, cut }) => <FlameIcon size={size} color={color} core={cut ?? color} />,
  goalDays: TargetIcon,
  answers: CardsIcon,
  bestDay: BoltIcon,
  mature: LeafIcon,
  mnemonics: BulbIcon,
};

export type MedalProps = {
  kind: BadgeKind;
  /** Which metal — the index of a tier in its ladder — or -1 for one not earned. */
  metal: number;
  /** The disc's diameter; the ribbon adds a fifth above it. */
  size: number;
  /** The ribbon it hangs from; off where medals stand in a list. */
  ribbon?: boolean;
};

/**
 * A badge as a medal: a disc in its tier's metal, a darker rim, a thin inner
 * ring and the ladder's emblem in white. One not earned yet is the same medal
 * in greys, so the board shows what there is to win.
 */
export function Medal({ kind, metal, size, ribbon = true }: MedalProps) {
  const theme = useTheme();
  const earned = metal >= 0;
  const colors = earned
    ? MedalColors[Math.min(metal, MedalColors.length - 1)]
    : { face: theme.backgroundSelected, rim: theme.border };
  const emblem = earned ? '#FFFFFF' : theme.textSecondary;
  const Emblem = EMBLEMS[kind];

  const lift = ribbon ? size * 0.3 : 0;
  // Two strips meeting behind the top of the disc, a V the medal hangs from.
  const strip = {
    position: 'absolute' as const,
    top: -size * 0.04,
    width: size * 0.26,
    height: size * 0.62,
    borderBottomLeftRadius: size * 0.03,
    borderBottomRightRadius: size * 0.03,
  };
  const inner = size * 0.74;

  return (
    <View style={{ width: size, height: size + lift, opacity: earned ? 1 : 0.75 }}>
      {ribbon ? (
        <>
          <View
            style={[
              strip,
              { left: size * 0.22, backgroundColor: colors.rim, transform: [{ rotate: '-20deg' }] },
            ]}
          />
          <View
            style={[
              strip,
              { right: size * 0.22, backgroundColor: colors.face, transform: [{ rotate: '20deg' }] },
            ]}
          />
        </>
      ) : null}

      <View
        style={{
          position: 'absolute',
          top: lift,
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: size * 0.07,
          borderColor: colors.rim,
          backgroundColor: colors.face,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        {earned ? (
          <View
            style={{
              position: 'absolute',
              width: inner,
              height: inner,
              borderRadius: inner / 2,
              borderWidth: Math.max(1, size * 0.025),
              borderColor: 'rgba(255, 255, 255, 0.4)',
            }}
          />
        ) : null}
        <Emblem size={size * 0.44} color={emblem} cut={colors.face} />
      </View>
    </View>
  );
}
